/**
 * Pure logic shared by play.ts and follow.ts: the published chapter
 * alignment shape (data/schema/v1/chapter-alignments.schema.json), choosing
 * which class to play for a line, and which line is current at a time.
 * No DOM access, so it is unit tested directly (site/lib/audio-model.test.mjs).
 */

export interface Lecture {
  id: string;
  url: string;
  title: string;
  seriesId: string;
  series: string;
  part: string;
  durationSeconds: number | null;
  alignment: string;
  transcript?: string;
  /** Auto-generated topic outline (outline.schema.json), relative to /data/v1/. */
  outline?: string;
}

/** data/schema/v1/outline.schema.json */
export interface Topic {
  title: string;
  startSeconds: number;
  confidence: 'HIGH' | 'MEDIUM';
}

export interface Outline {
  schemaVersion: 1;
  lectureId: string;
  generatedBy: string;
  topics: Topic[];
}

/** The topic under way at time t (the last one started), or null before the first. */
export function topicAt(topics: readonly Topic[], t: number): Topic | null {
  let found: Topic | null = null;
  for (const topic of topics) {
    if (topic.startSeconds <= t) found = topic;
    else break;
  }
  return found;
}

export interface Ref {
  /** Index into ChapterAlignments.lectures. */
  lecture: number;
  startSeconds: number;
  endSeconds: number;
  confidence: number;
}

export interface ChapterAlignments {
  schemaVersion: 1;
  chapter: string;
  lectures: Lecture[];
  lines: { lineId: string; refs: Ref[] }[];
}

export interface Preference {
  /** Series picked in the selector (saved across chapters). */
  seriesId: string | null;
  /** The class loaded in the player, if any: within a series, staying in it wins. */
  currentLecture: number | null;
}

/**
 * Candidates for playing a line, best first: the selected series (the
 * reader's saved teacher), then the class already in the player, then
 * highest confidence, then the earliest class (catalog order) and time.
 */
export function rankRefs(refs: readonly Ref[], lectures: readonly Lecture[], pref: Preference): Ref[] {
  const key = (r: Ref): number[] => [
    lectures[r.lecture]?.seriesId === pref.seriesId ? 0 : 1,
    r.lecture === pref.currentLecture ? 0 : 1,
    -r.confidence,
    r.lecture,
    r.startSeconds,
  ];
  return [...refs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const d = ka[i]! - kb[i]!;
      if (d !== 0) return d;
    }
    return 0;
  });
}

/** A stretch of a recording during which `keys` (line ids or paragraph ids) are current. */
export interface Span {
  start: number;
  end: number;
  keys: string[];
}

export interface TimedItem {
  key: string;
  start: number;
  end: number;
}

/**
 * How long an item stays current after its own end when the next item
 * starts later (the teacher is usually still explaining it).
 */
export const HOLD_SECONDS = 30;

/**
 * "Until the next item" model: an item is current from its start until the
 * next item (in time order) starts, but no longer than HOLD_SECONDS past its
 * own end. Items that start at the same time (Sofer sometimes collapses
 * timestamps to one instant) are current together. Spans never overlap, so
 * at most one group is current at any time, and zero-length items still get
 * a span.
 */
export function spans(items: readonly TimedItem[], hold = HOLD_SECONDS): Span[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const groups: { start: number; end: number; keys: string[] }[] = [];
  for (const it of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.start === it.start) {
      last.keys.push(it.key);
      last.end = Math.max(last.end, it.end);
    } else {
      groups.push({ start: it.start, end: Math.max(it.start, it.end), keys: [it.key] });
    }
  }
  return groups.map((g, i) => {
    const next = groups[i + 1];
    const until = g.end + hold;
    return { start: g.start, end: next ? Math.min(next.start, until) : until, keys: g.keys };
  });
}

/** The span current at time t (binary search over non-overlapping spans), or null. */
export function spanAt(list: readonly Span[], t: number): Span | null {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = list[mid]!;
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return s;
  }
  return null;
}

/** Timed items (line ids) of one class in a chapter alignment. */
export function lectureItems(data: ChapterAlignments, lecture: number): TimedItem[] {
  const out: TimedItem[] = [];
  for (const line of data.lines) {
    for (const r of line.refs) {
      if (r.lecture === lecture) out.push({ key: line.lineId, start: r.startSeconds, end: r.endSeconds });
    }
  }
  return out;
}

/** Series that discuss this chapter, in catalog order of their first class. */
export function chapterSeries(data: ChapterAlignments): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const l of data.lectures) if (!out.some((s) => s.id === l.seriesId)) out.push({ id: l.seriesId, title: l.series });
  return out;
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
