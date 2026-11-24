/**
 * Pure timing model of the study-guide pages (/study/<series>/chapter-N/):
 * which passage, phrase and block of a guide (data/schema/v1/study.schema.json)
 * a class is on at a time, which passage the page follows, where "play from
 * here" on a guide element starts, Autoplay next within a chapter and the
 * page's arrival links. No DOM access, so it is unit tested directly
 * (site/lib/study-model.test.mjs). The vectors in
 * site/lib/study-model.vectors.json are meant to be run by a Dart port as
 * well (as audio-model.vectors.json is), so change both together.
 *
 * Only the guide's own times are used (phrase and block audio), never the
 * line alignments: those time where the Hebrew is read, the guide where the
 * teacher says the English and explains it, and two clocks would disagree.
 * Array order is never taken for time order: each lecture's items are
 * sorted by start.
 */

import { HOLD_SECONDS, INTRO_SNAP_SECONDS, parseDeepLink, hashId, spanAt, spans, type Span, type TimedItem } from './model.ts';

/** A block stays current this long past its own end when the next one starts later (as lines do: HOLD_SECONDS). */
export const BLOCK_HOLD_SECONDS = HOLD_SECONDS;

/**
 * A phrase stays current at most this long past its own end: it is a
 * highlight while it is said, not through the explanation that follows.
 */
export const PHRASE_HOLD_SECONDS = 5;

/** A different passage becomes the one the page follows (scrolls to) once it has been current this long. */
export const PASSAGE_HOLD_SECONDS = 5;

// ---------------------------------------------------------------------------
// Input: the guide, minimally. The JSON (StudyGuide) fits these types as it
// is (extra fields are ignored); the page's controller builds the same shape
// from data-* attributes. Keys are optional: by default a passage is keyed by
// its index ("3"), its phrases "3.p0", "3.p1"… and its blocks "3.b0"… in
// array order.

export interface StudyAudio {
  lecture: string;
  start?: number | undefined;
  end?: number | undefined;
}

export interface StudyPhrase {
  key?: string | undefined;
  lines: readonly string[];
  /** Truthy (the text, or true) when the teacher gives English for it; only those phrases are timed. */
  en?: string | boolean | undefined;
  lecture?: string | undefined;
  start?: number | undefined;
  end?: number | undefined;
}

export interface StudyBlock {
  key?: string | undefined;
  /** The first entry is the main telling; the rest are other tellings. */
  audio: readonly StudyAudio[];
  /** The JSON carries the writer's note (a string); anything truthy means out of place. */
  outOfPlace?: boolean | string | undefined;
}

export interface StudyPassage {
  key?: string | undefined;
  lines: readonly string[];
  phrases?: readonly StudyPhrase[] | undefined;
  blocks: readonly StudyBlock[];
}

/** A lecture of a chapter in study/index.json (`lectures[]`): its part on the chapter. */
export interface StudyPart {
  id: string;
  start: number;
  end: number;
  continuesIn?: string | undefined;
}

/** The guide's passages in document order (sections flattened), as studyTimeline and studySeekTarget take them. */
export function guidePassages<P extends StudyPassage>(guide: { sections: readonly { passages: readonly P[] }[] }): P[] {
  return guide.sections.flatMap((s) => s.passages);
}

export function passageKey(passages: readonly StudyPassage[], i: number): string {
  return passages[i]?.key ?? String(i);
}

export function phraseKey(passages: readonly StudyPassage[], i: number, j: number): string {
  return passages[i]?.phrases?.[j]?.key ?? `${passageKey(passages, i)}.p${j}`;
}

export function blockKey(passages: readonly StudyPassage[], i: number, j: number): string {
  return passages[i]?.blocks[j]?.key ?? `${passageKey(passages, i)}.b${j}`;
}

/** A timed phrase: English, a lecture and a start. */
function timedPhrase(ph: StudyPhrase): ph is StudyPhrase & { lecture: string; start: number } {
  return Boolean(ph.en) && ph.lecture !== undefined && typeof ph.start === 'number';
}

// ---------------------------------------------------------------------------
// The timeline of one lecture.

export type StudyItemKind = 'phrase' | 'block' | 'telling';

/** One timed thing said in the lecture. */
export interface StudyItem {
  /** Phrase or block key (a telling has its block's key). */
  key: string;
  kind: StudyItemKind;
  /** Index of its passage. */
  passage: number;
  start: number;
  /** Never before start. */
  end: number;
  /** A block marked outOfPlace (its main telling far from where the passage is read), or a telling of one. */
  outOfPlace: boolean;
}

export interface StudyTimeline {
  lecture: string;
  part: StudyPart | null;
  /** Main tellings (audio[0]) of the blocks, "until the next one", held BLOCK_HOLD_SECONDS. */
  blocks: Span[];
  /** Further tellings (audio[1..]) in this lecture: current only when no main telling is. */
  tellings: Span[];
  /** Timed phrases, "until the next one", held PHRASE_HOLD_SECONDS. */
  phrases: Span[];
  /** Every item of the lecture, sorted by start (then document order). */
  items: StudyItem[];
  /** Key -> its item (for a block, the main telling when it has one here). */
  byKey: Map<string, StudyItem>;
  /** Each passage's line ids, by passage index. */
  passageLines: (readonly string[])[];
  /** Each phrase's line ids, by phrase key (timed phrases of this lecture). */
  phraseLines: Map<string, readonly string[]>;
}

export interface StudyTimelineOptions {
  blockHold?: number;
  phraseHold?: number;
}

/**
 * The timeline of `lecture` in a guide: its blocks (main tellings), further
 * tellings and timed phrases as non-overlapping spans (spans() in model.ts:
 * equal starts are current together, an overlap is cut at the next start,
 * a zero-length item still gets a span). `part` is the lecture's part on
 * the chapter (study/index.json), or null when unknown.
 */
export function studyTimeline(
  passages: readonly StudyPassage[],
  lecture: string,
  part: StudyPart | null,
  opts: StudyTimelineOptions = {},
): StudyTimeline {
  const items: StudyItem[] = [];
  const phraseLines = new Map<string, readonly string[]>();
  passages.forEach((p, i) => {
    (p.phrases ?? []).forEach((ph, j) => {
      if (!timedPhrase(ph) || ph.lecture !== lecture) return;
      const key = phraseKey(passages, i, j);
      phraseLines.set(key, ph.lines);
      items.push({ key, kind: 'phrase', passage: i, start: ph.start, end: Math.max(ph.start, ph.end ?? ph.start), outOfPlace: false });
    });
    p.blocks.forEach((b, j) => {
      const key = blockKey(passages, i, j);
      b.audio.forEach((a, n) => {
        if (a.lecture !== lecture || typeof a.start !== 'number') return;
        const kind = n === 0 ? 'block' : 'telling';
        items.push({ key, kind, passage: i, start: a.start, end: Math.max(a.start, a.end ?? a.start), outOfPlace: Boolean(b.outOfPlace) });
      });
    });
  });
  items.sort((a, b) => a.start - b.start); // stable: document order within a start
  const byKey = new Map<string, StudyItem>();
  for (const it of items) {
    const had = byKey.get(it.key);
    if (!had || (had.kind === 'telling' && it.kind === 'block')) byKey.set(it.key, it);
  }
  const of = (kind: StudyItemKind): TimedItem[] => items.filter((it) => it.kind === kind).map(({ key, start, end }) => ({ key, start, end }));
  return {
    lecture,
    part,
    blocks: spans(of('block'), opts.blockHold ?? BLOCK_HOLD_SECONDS),
    tellings: spans(of('telling'), opts.blockHold ?? BLOCK_HOLD_SECONDS),
    phrases: spans(of('phrase'), opts.phraseHold ?? PHRASE_HOLD_SECONDS),
    items,
    byKey,
    passageLines: passages.map((p) => p.lines),
    phraseLines,
  };
}

// ---------------------------------------------------------------------------
// The position at a time.

/**
 * before: the intro (before the lecture's part on the chapter, or before
 * its first item); playing: a phrase or block is current; gap: nothing is
 * (past the 30 s hold: "Not in the guide", nothing scrolls); after: past the
 * part's end (with continuesIn, the class reads on in another chapter).
 */
export type StudyState = 'before' | 'playing' | 'gap' | 'after';

export interface StudyPosition {
  state: StudyState;
  /**
   * Index of the current passage: the phrase's, else the block's, else
   * that of the last item started (gap, after), or in `before` the
   * lecture's first item's. Null when the lecture has no items.
   */
  passage: number | null;
  /** The current phrase (the first, when several start together), or null. */
  phrase: string | null;
  /** The current block, or null: of several starting together, the first not outOfPlace. */
  block: string | null;
  /** Every block current together (equal starts), the current one included. */
  blocks: string[];
  /** The block is current through a further telling (no main telling is current). */
  telling: boolean;
  /** The current block is outOfPlace. */
  outOfPlace: boolean;
  /**
   * The reading cursor: the last timed phrase of the passage started at or
   * before t (by time), or null. Hebrew-only phrases are never named: they
   * take their place from the phrases around them.
   */
  readTo: string | null;
  /** The phrase's lines, else the passage's (for line highlighting and the URL fragment); [] without a passage. */
  lines: readonly string[];
  /** In `after`: the chapter the class reads on into, or null. */
  continuesIn: string | null;
}

/** The position of a lecture's timeline at time t (seconds of the lecture's audio). */
export function studyAt(tl: StudyTimeline, t: number): StudyPosition {
  const { items, part } = tl;
  let last: StudyItem | null = null;
  for (const it of items) {
    if (it.start <= t) last = it;
    else break;
  }
  const first = items[0] ?? null;
  const pos = (state: StudyState, passage: number | null, rest: Partial<StudyPosition> = {}): StudyPosition => {
    const phrase = rest.phrase ?? null;
    return {
      state,
      passage,
      phrase,
      block: null,
      blocks: [],
      telling: false,
      outOfPlace: false,
      readTo: passage === null ? null : readTo(items, passage, t),
      lines: (phrase !== null ? tl.phraseLines.get(phrase) : undefined) ?? (passage === null ? [] : tl.passageLines[passage] ?? []),
      continuesIn: null,
      ...rest,
    };
  };

  if ((part && t < part.start) || last === null) return pos('before', first?.passage ?? null, { readTo: null });
  // Past the part's end only items actually being said keep the page on this chapter (no hold).
  if (part && t >= part.end && !items.some((it) => it.start <= t && t < it.end)) {
    return pos('after', last.passage, { continuesIn: part.continuesIn ?? null });
  }

  const phraseSpan = spanAt(tl.phrases, t);
  let blockSpan = spanAt(tl.blocks, t);
  const telling = !blockSpan;
  if (!blockSpan) blockSpan = spanAt(tl.tellings, t);
  if (!phraseSpan && !blockSpan) return pos('gap', last.passage);

  const phrase = phraseSpan?.keys[0] ?? null;
  const blockKeys = blockSpan?.keys ?? [];
  const blockItems = blockKeys.map((k) => tl.byKey.get(k)).filter((x): x is StudyItem => x !== undefined);
  const main = blockItems.find((b) => !b.outOfPlace) ?? blockItems[0] ?? null;
  const passage = (phrase !== null ? tl.byKey.get(phrase)?.passage : undefined) ?? main?.passage ?? last.passage;
  return pos('playing', passage, {
    phrase,
    block: main?.key ?? null,
    blocks: blockKeys,
    telling: telling && main !== null,
    outOfPlace: main?.outOfPlace ?? false,
  });
}

function readTo(items: readonly StudyItem[], passage: number, t: number): string | null {
  let found: StudyItem | null = null;
  for (const it of items) {
    if (it.start > t) break;
    if (it.kind === 'phrase' && it.passage === passage) found = it;
  }
  return found?.key ?? null;
}

// ---------------------------------------------------------------------------
// The passage the page follows (scrolls to).

export interface FollowState {
  /** The passage the page follows, or null before the first position. */
  passage: number | null;
  /** A different passage waiting to be followed, or null. */
  candidate: number | null;
  /** When the candidate became current. */
  since: number;
}

/**
 * Whether the page may scroll to `target` for an outOfPlace block while it
 * follows `current`: only within ±1 passage (most outOfPlace blocks belong
 * to the passage being taught; a far one is shown as "Now: … · Go to"
 * instead). Anything else may always be scrolled to.
 */
export function shouldScrollTo(current: number | null, target: number, outOfPlace = true): boolean {
  return !outOfPlace || current === null || Math.abs(target - current) <= 1;
}

/**
 * Hysteresis for the followed passage, a reducer called on every time
 * update: a different current passage is followed once it has stayed
 * current for `hold` seconds, so a short return to an earlier passage (or a
 * 3 s run of a later one) never scrolls the page. The first position is
 * followed at once; gap and after never change it (nor does before, once
 * something is followed); an outOfPlace block alone (no phrase) more than
 * one passage away never becomes a candidate (shouldScrollTo). A time
 * earlier than the candidate's start restarts the wait. Pass null as state
 * after a seek or a change of class to follow the new position at once.
 */
export function followPassage(
  state: FollowState | null,
  at: Pick<StudyPosition, 'state' | 'passage' | 'outOfPlace' | 'phrase'>,
  t: number,
  hold = PASSAGE_HOLD_SECONDS,
): FollowState {
  const cur = state?.passage ?? null;
  const want = at.passage;
  const settled = (passage: number | null): FollowState => ({ passage, candidate: null, since: t });
  if (cur === null) return settled(want);
  if (want === null || want === cur || at.state !== 'playing') return settled(cur);
  if (at.outOfPlace && at.phrase === null && !shouldScrollTo(cur, want, true)) return settled(cur);
  if (state === null || state.candidate !== want || t < state.since) return { passage: cur, candidate: want, since: t };
  return t - state.since >= hold ? settled(want) : state;
}

// ---------------------------------------------------------------------------
// Play from here.

/** A guide element: a passage, or one of its phrases or blocks (indexes into the arrays). */
export interface StudyElement {
  passage: number;
  phrase?: number | undefined;
  block?: number | undefined;
}

export interface StudySeek {
  lecture: string;
  seekSeconds: number;
  /** An earlier start to offer ("From start of class"), or null: see playStart() in model.ts. */
  offerStartSeconds: number | null;
}

interface Candidate {
  lecture: string;
  start: number;
  inPlace: boolean;
}

/** Earliest start per lecture, in first-seen order; inPlace if any of the lecture's entries is. */
function perLecture(entries: readonly Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const e of entries) {
    const had = out.find((c) => c.lecture === e.lecture);
    if (!had) out.push({ ...e });
    else {
      if (e.inPlace && !had.inPlace) had.start = e.start;
      else if (e.inPlace === had.inPlace) had.start = Math.min(had.start, e.start);
      had.inPlace ||= e.inPlace;
    }
  }
  return out;
}

function passageCandidates(p: StudyPassage): Candidate[] {
  const entries: Candidate[] = [];
  for (const ph of p.phrases ?? []) if (timedPhrase(ph)) entries.push({ lecture: ph.lecture, start: ph.start, inPlace: true });
  for (const b of p.blocks) {
    b.audio.forEach((a, n) => {
      if (typeof a.start === 'number') entries.push({ lecture: a.lecture, start: a.start, inPlace: n === 0 && !b.outOfPlace });
    });
  }
  return perLecture(entries);
}

/**
 * Where "play from here" on a passage, phrase or block starts.
 *
 * - The lecture in the player (`player`) when it has the element (any of a
 *   passage's items, the phrase, any telling of the block), at its earliest
 *   start there.
 * - Else a passage plays the lecture that teaches it in place (its phrases
 *   and the main tellings of blocks not outOfPlace; outOfPlace items only
 *   when nothing else has a time), the first in `parts` order (lectures not
 *   in parts last), from its earliest item there; a phrase from its start; a
 *   block from its main telling (else its first timed telling).
 * - A Hebrew-only phrase plays from the last timed phrase before it in the
 *   passage (per lecture, as above), else as its passage.
 * - The lead-in rule of playStart(): when the start is the lecture's first
 *   item in the guide and the lecture's part starts earlier, a lead-in
 *   shorter than `snap` is played (seek to the part's start), a longer one
 *   offered.
 *
 * Null when the element has no time in any lecture (a `skip` passage).
 */
export function studySeekTarget(
  passages: readonly StudyPassage[],
  parts: readonly StudyPart[],
  el: StudyElement,
  player: string | null,
  snap = INTRO_SNAP_SECONDS,
): StudySeek | null {
  const p = passages[el.passage];
  if (!p) return null;
  let cands: Candidate[];
  if (el.block !== undefined) {
    const b = p.blocks[el.block];
    if (!b) return null;
    cands = perLecture(
      b.audio.flatMap((a, n) => (typeof a.start === 'number' ? [{ lecture: a.lecture, start: a.start, inPlace: n === 0 }] : [])),
    );
    // The main telling's lecture first, whatever the parts order.
    cands.sort((a, c) => Number(c.inPlace) - Number(a.inPlace));
  } else if (el.phrase !== undefined) {
    const phrases = p.phrases ?? [];
    const ph = phrases[el.phrase];
    if (!ph) return null;
    if (timedPhrase(ph)) cands = [{ lecture: ph.lecture, start: ph.start, inPlace: true }];
    else {
      const before: Candidate[] = [];
      for (let j = el.phrase - 1; j >= 0; j--) {
        const x = phrases[j]!;
        if (timedPhrase(x) && !before.some((c) => c.lecture === x.lecture)) before.push({ lecture: x.lecture, start: x.start, inPlace: true });
      }
      cands = before.length > 0 ? sortByParts(before, parts) : sortByParts(passageCandidates(p), parts);
    }
  } else {
    cands = sortByParts(passageCandidates(p), parts);
  }
  const chosen = cands.find((c) => c.lecture === player) ?? cands[0];
  if (!chosen) return null;
  return leadIn(passages, parts, chosen.lecture, chosen.start, snap);
}

/** In place first, then parts order (unknown lectures last), else as given. */
function sortByParts(cands: Candidate[], parts: readonly StudyPart[]): Candidate[] {
  const order = (id: string): number => {
    const i = parts.findIndex((x) => x.id === id);
    return i < 0 ? parts.length : i;
  };
  return [...cands].sort((a, b) => Number(b.inPlace) - Number(a.inPlace) || order(a.lecture) - order(b.lecture));
}

function leadIn(passages: readonly StudyPassage[], parts: readonly StudyPart[], lecture: string, start: number, snap: number): StudySeek {
  const plain: StudySeek = { lecture, seekSeconds: start, offerStartSeconds: null };
  const partStart = parts.find((x) => x.id === lecture)?.start;
  if (partStart === undefined || partStart >= start) return plain;
  for (const p of passages) {
    for (const ph of p.phrases ?? []) if (timedPhrase(ph) && ph.lecture === lecture && ph.start < start) return plain;
    for (const b of p.blocks) for (const a of b.audio) if (a.lecture === lecture && typeof a.start === 'number' && a.start < start) return plain;
  }
  return start - partStart < snap
    ? { lecture, seekSeconds: partStart, offerStartSeconds: null }
    : { lecture, seekSeconds: start, offerStartSeconds: partStart };
}

// ---------------------------------------------------------------------------
// Autoplay next and links.

/** Autoplay next on a guide page: the chapter's next lecture in study/index.json order, or null after the last (or for a lecture not listed). */
export function nextStudyPart<P extends Pick<StudyPart, 'id'>>(parts: readonly P[], lecture: string): P | null {
  const i = parts.findIndex((p) => p.id === lecture);
  return i < 0 ? null : parts[i + 1] ?? null;
}

/**
 * A lecture's transcript page slug (/classes/transcripts/<slug>/), as
 * partials/audio/index.html builds it: lowercased, .mp3/.m4a dropped, every
 * run of other characters than a-z and 0-9 -> "-", trimmed of "-".
 */
export function transcriptSlug(lectureId: string): string {
  return lectureId
    .toLowerCase()
    .replace(/\.(mp3|m4a)$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The part whose lecture has transcript slug `slug`, or null. */
export function partForSlug<P extends Pick<StudyPart, 'id'>>(parts: readonly P[], slug: string | null): P | null {
  if (!slug) return null;
  const q = slug.toLowerCase();
  return parts.find((p) => transcriptSlug(p.id) === q) ?? null;
}

export interface StudyLink {
  /** `?class=`: a lecture's transcript slug (partForSlug), or null. */
  classSlug: string | null;
  /** `?t=`: whole seconds (fractions dropped), or null when missing or invalid. */
  t: number | null;
  /** The fragment when it is a chapter line id (8 of a-z, 2-7), else null. */
  line: string | null;
  /** The fragment, decoded, or null when empty (passage and block anchors #s-…, #b-…). */
  anchor: string | null;
}

/** A guide page's arrival link: `?class=<transcript slug>&t=<s>` (a moment in a class) and `#<line id>`. */
export function parseStudyLink(search: string, hash: string): StudyLink {
  const cls = new URLSearchParams(search).get('class')?.trim() ?? '';
  const anchor = hashId(hash);
  return {
    classSlug: cls === '' ? null : cls,
    t: parseDeepLink(search, '').t,
    line: /^[a-z2-7]{8}$/.test(anchor) ? anchor : null,
    anchor: anchor === '' ? null : anchor,
  };
}

/**
 * A link into a guide at a moment of a class (the chapter player's "Study
 * guide" pill): `<guide>?class=<transcript slug>` and, when `t` is given,
 * `&t=<whole seconds>`; the guide alone when `lecture` is null. `guide` is
 * a path (/study/<series>/chapter-N/) and keeps its own query, if any.
 */
export function studyLinkHref(guide: string, lecture: string | null, t: number | null = null): string {
  if (lecture === null) return guide;
  const [path, query = ''] = guide.split('?', 2) as [string, string?];
  const q = new URLSearchParams(query);
  q.set('class', transcriptSlug(lecture));
  if (t !== null && Number.isFinite(t)) q.set('t', String(Math.max(0, Math.floor(t))));
  else q.delete('t');
  return `${path}?${q.toString()}`;
}

/**
 * How far through an item playback is at t, from 0 (at or before its
 * start) to 1 (at or past its end); 1 for a zero-length item once started.
 * The guide page draws it on the current block's side border.
 */
export function itemProgress(start: number, end: number, t: number): number {
  if (t <= start) return end > start ? 0 : t < start ? 0 : 1;
  if (end <= start || t >= end) return 1;
  return (t - start) / (end - start);
}

/**
 * Where to scroll a page (window.scrollY) to show an element `ratio` of the
 * way down the visible area (the window minus the docked player): `top` is
 * the element's top relative to the viewport. Never negative.
 */
export function scrollTopFor(scrollY: number, top: number, visible: number, ratio: number): number {
  return Math.max(0, Math.round(scrollY + top - visible * ratio));
}
