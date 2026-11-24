/**
 * Unit tests for hugo/assets/js/audio/study-model.ts (the timing model of the
 * study-guide pages). Node 22.18+ runs the TypeScript directly (type
 * stripping); `yarn typecheck` checks the types. Most cases are in
 * study-model.vectors.json, shared with a Dart port.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  BLOCK_HOLD_SECONDS,
  followPassage,
  guidePassages,
  nextStudyPart,
  parseStudyLink,
  partForSlug,
  PASSAGE_HOLD_SECONDS,
  PHRASE_HOLD_SECONDS,
  shouldScrollTo,
  studyAt,
  studySeekTarget,
  studyTimeline,
  transcriptSlug,
  studyLinkHref,
  itemProgress,
  scrollTopFor,
} from "../hugo/assets/js/audio/study-model.ts";

const vectors = JSON.parse(readFileSync(new URL("./study-model.vectors.json", import.meta.url), "utf8"));

test("constants", () => {
  assert.equal(BLOCK_HOLD_SECONDS, 30);
  assert.equal(PHRASE_HOLD_SECONDS, 5);
  assert.equal(PASSAGE_HOLD_SECONDS, 5);
});

for (const c of vectors.studyAt) {
  test(`vectors: studyAt: ${c.name}`, () => {
    const passages = vectors.guides[c.guide];
    const part = c.part === null ? null : vectors.parts[c.guide][c.part];
    const tl = studyTimeline(passages, c.lecture, part);
    for (const [t, expect] of c.at) {
      const got = studyAt(tl, t);
      const picked = Object.fromEntries(Object.keys(expect).map((k) => [k, got[k]]));
      assert.deepEqual(picked, expect, `studyAt(${t})`);
    }
  });
}

for (const c of vectors.followPassage) {
  test(`vectors: followPassage: ${c.name}`, () => {
    let state = null;
    for (const [t, st, passage, outOfPlace, phrase, expect] of c.steps) {
      state = followPassage(state, { state: st, passage, outOfPlace, phrase: phrase ? "x" : null }, t);
      assert.equal(state.passage, expect, `at ${t}`);
    }
  });
}

test("vectors: shouldScrollTo", () => {
  for (const [current, target, outOfPlace, expect] of vectors.shouldScrollTo) {
    assert.equal(shouldScrollTo(current, target, outOfPlace), expect, JSON.stringify([current, target, outOfPlace]));
  }
});

for (const c of vectors.studySeekTarget) {
  test(`vectors: studySeekTarget: ${c.name}`, () => {
    const got = studySeekTarget(vectors.guides.main, vectors.parts.main, c.el, c.player);
    assert.deepEqual(got === null ? null : [got.lecture, got.seekSeconds, got.offerStartSeconds], c.expect);
  });
}

test("vectors: nextStudyPart", () => {
  for (const c of vectors.nextStudyPart) {
    assert.equal(nextStudyPart(c.parts.map((id) => ({ id })), c.lecture)?.id ?? null, c.expect);
  }
});

test("vectors: transcriptSlug and partForSlug", () => {
  for (const [id, slug] of vectors.transcriptSlug) {
    assert.equal(transcriptSlug(id), slug);
    assert.equal(partForSlug([{ id: "other.mp3" }, { id }], slug.toUpperCase())?.id, id);
  }
  assert.equal(partForSlug([{ id: "a.mp3" }], null), null);
  assert.equal(partForSlug([{ id: "a.mp3" }], "b"), null);
});

test("vectors: parseStudyLink", () => {
  for (const c of vectors.parseStudyLink) {
    assert.deepEqual(parseStudyLink(c.search, c.hash), c.expect, JSON.stringify([c.search, c.hash]));
  }
});

test("explicit keys (as the page's controller passes them) replace the positional ones", () => {
  const passages = [
    { key: "s-aaaaaaaa", lines: ["aaaaaaaa"], phrases: [{ key: "ph1", lines: ["aaaaaaaa"], en: true, lecture: "A", start: 3, end: 4 }], blocks: [{ key: "b-aaaaaaaa-0", audio: [{ lecture: "A", start: 0, end: 10 }] }] },
  ];
  const got = studyAt(studyTimeline(passages, "A", null), 3.5);
  assert.deepEqual([got.passage, got.phrase, got.block, got.readTo], [0, "ph1", "b-aaaaaaaa-0", "ph1"]);
});

test("studyTimeline sorts by start and never mutates its input", () => {
  const passages = vectors.guides.main;
  const before = JSON.stringify(passages);
  const tl = studyTimeline(passages, "A", null);
  assert.equal(JSON.stringify(passages), before);
  for (let i = 1; i < tl.items.length; i++) assert.ok(tl.items[i - 1].start <= tl.items[i].start);
});

// Every published public guide, every lecture, sampled every 5 s: nothing
// throws, the position is consistent, and the followed passage (hysteresis)
// hardly ever goes backwards.
const dist = new URL("../../data/dist/v1/", import.meta.url);
const index = new URL("study/index.json", dist);
test("real public guides: studyAt and followPassage over every lecture", { skip: !existsSync(index) && "data/dist/v1 not built (yarn data)" }, () => {
  const { series } = JSON.parse(readFileSync(index, "utf8"));
  let lectures = 0;
  let samples = 0;
  let backward = 0;
  let changes = 0;
  for (const s of series) {
    for (const ch of s.chapters) {
      const passages = guidePassages(JSON.parse(readFileSync(new URL(ch.path, dist), "utf8")));
      for (const part of ch.lectures) {
        const tl = studyTimeline(passages, part.id, part);
        lectures++;
        let follow = null;
        for (let t = Math.max(0, part.start - 10); t < part.end + 40; t += 5) {
          const at = studyAt(tl, t);
          samples++;
          assert.ok(at.passage === null || (at.passage >= 0 && at.passage < passages.length));
          if (at.state === "playing") assert.ok(at.block !== null || at.phrase !== null);
          if (t >= part.end) assert.equal(at.state, "after", `${part.id} at ${t}`);
          const prev = follow?.passage ?? null;
          follow = followPassage(follow, at, t);
          if (prev !== null && follow.passage !== prev) {
            changes++;
            if (follow.passage < prev) backward++;
          }
        }
        // Every passage element with a time has a seek target.
        passages.forEach((p, i) => {
          const timed = (p.phrases ?? []).some((ph) => ph.en && typeof ph.start === "number") || p.blocks.some((b) => b.audio.some((a) => typeof a.start === "number"));
          const target = studySeekTarget(passages, ch.lectures, { passage: i }, part.id);
          assert.equal(target !== null, timed, `${ch.chapter} passage ${i}`);
        });
      }
    }
  }
  assert.ok(lectures > 0 && samples > 0);
  assert.ok(changes > 0);
  assert.ok(backward <= 5, `${backward} backward passage changes of ${changes}`);
  console.log(`# real guides: ${lectures} lectures, ${samples} samples, ${changes} passage changes, ${backward} backward`);
});

test("studyLinkHref: a moment of a class in a guide", () => {
  const g = "/study/walters-original/chapter-10/";
  assert.equal(studyLinkHref(g, null), g);
  assert.equal(studyLinkHref(g, "07 - Chap- 10-1 Atmus Ohr Ein Sof (M).mp3"), `${g}?class=07-chap-10-1-atmus-ohr-ein-sof-m`);
  assert.equal(studyLinkHref(g, "07 - Chap- 10-1 Atmus Ohr Ein Sof (M).mp3", 125.9), `${g}?class=07-chap-10-1-atmus-ohr-ein-sof-m&t=125`);
  assert.equal(studyLinkHref(g, "a.mp3", -3), `${g}?class=a&t=0`);
  assert.equal(studyLinkHref(`${g}?class=x&t=4`, "b.mp3"), `${g}?class=b`);
  assert.equal(studyLinkHref(g, "a.mp3", Number.NaN), `${g}?class=a`);
  // What parseStudyLink reads back.
  const href = studyLinkHref(g, "Part 4.mp3", 61.5);
  const link = parseStudyLink(href.slice(href.indexOf("?")), "");
  assert.deepEqual([link.classSlug, link.t], ["part-4", 61]);
});

test("itemProgress", () => {
  assert.equal(itemProgress(10, 20, 5), 0);
  assert.equal(itemProgress(10, 20, 10), 0);
  assert.equal(itemProgress(10, 20, 15), 0.5);
  assert.equal(itemProgress(10, 20, 20), 1);
  assert.equal(itemProgress(10, 20, 99), 1);
  assert.equal(itemProgress(10, 10, 10), 1);
  assert.equal(itemProgress(10, 10, 9), 0);
  assert.equal(itemProgress(10, 5, 12), 1);
});

test("scrollTopFor", () => {
  assert.equal(scrollTopFor(1000, 500, 800, 0.25), 1300);
  assert.equal(scrollTopFor(1000, -200, 800, 0.3), 560);
  assert.equal(scrollTopFor(0, 100, 800, 0.25), 0);
});
