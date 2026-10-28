/**
 * Unit tests for hugo/assets/js/audio/model.ts (the pure logic behind
 * play.js and follow.js). Node 22.18+ runs the TypeScript directly (type
 * stripping); `yarn typecheck` checks the types.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterSeries, formatTime, lectureItems, rankRefs, spanAt, spans, topicAt } from "../hugo/assets/js/audio/model.ts";

const lectures = [
  { id: "a", url: "u/a", title: "Part 1", seriesId: "0", series: "W", part: "", durationSeconds: null, alignment: "" },
  { id: "b", url: "u/b", title: "Part 2", seriesId: "0", series: "W", part: "", durationSeconds: null, alignment: "" },
  { id: "m", url: "u/m", title: "Ch 10", seriesId: "37", series: "M", part: "", durationSeconds: null, alignment: "" },
];
const ref = (lecture, startSeconds, confidence) => ({ lecture, startSeconds, endSeconds: startSeconds + 5, confidence });

test("rankRefs: selected series, then current class, then confidence, then earliest", () => {
  const refs = [ref(0, 10, 0.8), ref(2, 50, 0.99), ref(1, 3, 0.9)];
  const order = (pref) => rankRefs(refs, lectures, pref).map((r) => r.lecture);
  assert.deepEqual(order({ currentLecture: null, seriesId: null }), [2, 1, 0]);
  assert.deepEqual(order({ currentLecture: null, seriesId: "0" }), [1, 0, 2]);
  assert.deepEqual(order({ currentLecture: 0, seriesId: "0" }), [0, 1, 2]);
  assert.deepEqual(order({ currentLecture: 0, seriesId: "37" }), [2, 0, 1]);
  // The selected series does not cover the line: fall back to the others.
  assert.deepEqual(order({ currentLecture: null, seriesId: "99" }), [2, 1, 0]);
  // Equal confidence: catalog order, then time.
  assert.deepEqual(
    rankRefs([ref(1, 3, 0.9), ref(0, 9, 0.9), ref(0, 2, 0.9)], lectures, { currentLecture: null, seriesId: null }).map((r) => [r.lecture, r.startSeconds]),
    [[0, 2], [0, 9], [1, 3]],
  );
});

test("spans: current until the next line starts, held at most 30 s past its end", () => {
  const s = spans([
    { key: "x", start: 10, end: 20 },
    { key: "y", start: 25, end: 30 },
    { key: "z", start: 100, end: 110 },
  ]);
  assert.deepEqual(s, [
    { start: 10, end: 25, keys: ["x"] },
    { start: 25, end: 60, keys: ["y"] },
    { start: 100, end: 140, keys: ["z"] },
  ]);
  assert.equal(spanAt(s, 9.9), null);
  assert.deepEqual(spanAt(s, 10)?.keys, ["x"]);
  assert.deepEqual(spanAt(s, 24.9)?.keys, ["x"]);
  assert.deepEqual(spanAt(s, 25)?.keys, ["y"]);
  assert.equal(spanAt(s, 70), null);
  assert.deepEqual(spanAt(s, 139)?.keys, ["z"]);
  assert.equal(spanAt(s, 140), null);
});

test("spans: zero-length and same-start lines (collapsed timestamps) still get a span", () => {
  const s = spans([
    { key: "a", start: 1207, end: 1207 },
    { key: "b", start: 1207, end: 1211.2 },
    { key: "c", start: 1271.7, end: 1271.7 },
    { key: "d", start: 1323.3, end: 1323.3 },
  ]);
  assert.deepEqual(s, [
    { start: 1207, end: 1241.2, keys: ["a", "b"] },
    { start: 1271.7, end: 1301.7, keys: ["c"] },
    { start: 1323.3, end: 1353.3, keys: ["d"] },
  ]);
  assert.deepEqual(spanAt(s, 1271.7)?.keys, ["c"]);
});

test("spans: an overlapping range is cut at the next line's start", () => {
  const s = spans([
    { key: "long", start: 0, end: 300 },
    { key: "next", start: 100, end: 110 },
  ]);
  assert.deepEqual(spanAt(s, 120)?.keys, ["next"]);
  assert.deepEqual(spanAt(s, 50)?.keys, ["long"]);
});

test("lectureItems picks one class's ranges", () => {
  const data = {
    schemaVersion: 1,
    chapter: "chapter_10",
    lectures,
    lines: [
      { lineId: "l1", refs: [ref(0, 1, 1), ref(2, 7, 1)] },
      { lineId: "l2", refs: [ref(2, 20, 1)] },
    ],
  };
  assert.deepEqual(lectureItems(data, 2), [
    { key: "l1", start: 7, end: 12 },
    { key: "l2", start: 20, end: 25 },
  ]);
});

test("chapterSeries lists each series once, in order", () => {
  assert.deepEqual(chapterSeries({ schemaVersion: 1, chapter: "chapter_10", lectures, lines: [] }), [
    { id: "0", title: "W" },
    { id: "37", title: "M" },
  ]);
});

test("topicAt: the last topic started", () => {
  const topics = [
    { title: "A", startSeconds: 10, confidence: "HIGH" },
    { title: "B", startSeconds: 60, confidence: "MEDIUM" },
  ];
  assert.equal(topicAt(topics, 5), null);
  assert.equal(topicAt(topics, 10)?.title, "A");
  assert.equal(topicAt(topics, 59)?.title, "A");
  assert.equal(topicAt(topics, 600)?.title, "B");
});

test("formatTime", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(75.9), "1:15");
  assert.equal(formatTime(3725), "1:02:05");
});
