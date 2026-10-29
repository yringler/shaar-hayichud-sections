/**
 * Stored transcripts (data/transcripts/) and alignments (data/alignments/):
 * file naming, the stored shapes, and finding a lecture's place in the
 * catalog (its heading path and the chapter it teaches).
 */
import path from 'node:path';
import { encodePathSegment } from './catalog.js';
import type { ParsedLecture, ParsedSection } from './parse.js';

/** One word with timing, as Sofer.ai returns it (GET /v1/transcriptions/{id}). */
export interface SoferWord {
  word: string;
  start: number;
  end: number;
  hebrew_word_format?: string[] | null;
  speaker?: string | null;
}

/** Raw GET /v1/transcriptions/{id} response, stored verbatim. */
export interface SoferResult {
  text: string;
  timestamps?: SoferWord[] | null;
  info: Record<string, unknown>;
}

/** data/transcripts/<encoded lecture id>.json (schema/sources/sofer-transcript.schema.json). */
export interface StoredTranscript {
  schemaVersion: 1;
  lectureId: string;
  /** Catalog URL that was submitted. */
  audioUrl: string;
  provider: 'sofer.ai';
  sofer: {
    transcriptionId: string;
    /** Title on the Sofer platform; ends with "[<lecture id>]" (used to find it again). */
    title: string;
    /** Folder names from the root, mirroring the catalog headings. */
    folderPath: string[];
    /** The `info` object sent with the create request. */
    request: Record<string, unknown>;
  };
  result: SoferResult;
}

/** File name for a lecture id: the published-URL encoding plus .json. */
export function lectureFileName(lectureId: string): string {
  return `${encodePathSegment(lectureId)}.json`;
}

export function transcriptPath(dataDir: string, lectureId: string): string {
  return path.join(dataDir, 'transcripts', lectureFileName(lectureId));
}

export function alignmentPath(dataDir: string, lectureId: string): string {
  return path.join(dataDir, 'alignments', lectureFileName(lectureId));
}

/** A lecture plus the headings it sits under (series first). */
export interface LectureContext {
  lecture: ParsedLecture & { folder: string };
  ancestors: ParsedSection[];
  /** Title as the catalog shows it ("Part N" when classes.txt gives none). */
  title: string;
  /** Position among its parent's lectures (1-based). */
  position: number;
  /**
   * The lecture has its own '- Title' and sits next to sub-headings in its
   * parent (e.g. "- Introduction" or "- Chapter 3" directly under a "## Part"
   * that also has "### Chapter N" headings). The catalog shows it as a
   * sibling of those headings, so it gets a folder of its own on Sofer.
   */
  standalone: boolean;
}

/** Every lecture with its heading path, in file order. */
export function lectureContexts(series: ParsedSection[]): LectureContext[] {
  const out: LectureContext[] = [];
  const visit = (section: ParsedSection, ancestors: ParsedSection[]) => {
    const here = [...ancestors, section];
    let position = 0;
    const hasSubsections = section.items.some((i) => i.kind === 'section');
    for (const item of section.items) {
      if (item.kind === 'section') {
        visit(item, here);
        continue;
      }
      position += 1;
      if (item.folder === null) continue;
      out.push({
        lecture: item as ParsedLecture & { folder: string },
        ancestors: here,
        title: item.title ?? `Part ${position}`,
        position,
        standalone: hasSubsections && item.title !== null,
      });
    }
  };
  for (const s of series) visit(s, []);
  return out;
}

/**
 * A title naming the one or two chapters a class reads: "Chapter 10", "Ch 10",
 * "Chapter 32 Part 2 to end", "Chapter 42 Part 2", "End Chapter 50",
 * "Chapters 41 and 42", "End Chapter 34 and Chapter 35", "End Chapter 29 and 30".
 * Not "Chapter 15 Q and A", "More on Chapter 28", "Chapter 46 Addendum",
 * "Introduction" or a range like "Ch 1-2".
 */
const CHAPTER_TITLE =
  /^(?:end\s+)?(?:chapters?|ch\.?)\s*(\d+)(?:\s+part\s+\d+(?:\s+to\s+(?:the\s+)?end)?)?(?:\s+and\s+(?:chapter\s+)?(\d+))?$/i;

export const chapterKey = (n: string | number) => `chapter_${String(n).padStart(2, '0')}`;

/** "Chapter 10" -> ["chapter_10"], "Chapters 15 and 16" -> ["chapter_15", "chapter_16"]; [] when the title names none. */
export function chapterKeysForTitle(title: string): string[] {
  const m = CHAPTER_TITLE.exec(title.trim());
  if (!m) return [];
  return m[2] && m[2] !== m[1] ? [chapterKey(m[1]!), chapterKey(m[2])] : [chapterKey(m[1]!)];
}

/**
 * One entry of data/alignment-chapters.json: the chapters a class reads, in
 * reading order, and optionally where in the recording each stretch starts.
 */
export interface ChapterOverride {
  /** Distinct chapter keys in reading order. */
  chapters: string[];
  /** When given, each range is aligned to its chapter alone (alignTranscriptByRanges). */
  ranges?: { chapter: string; fromSeconds: number }[];
}

/** Lecture id -> override, for classes whose catalog title or heading does not say. */
export type ChapterOverrides = ReadonlyMap<string, ChapterOverride>;

/**
 * The chapter text(s) a lecture teaches, in reading order, for any catalog
 * shape: an entry in `overrides`, else the lecture's own '- Title' when it
 * names chapters (Markel's "- Chapter 3" or "- End Chapter 34 and Chapter 35"
 * under a "## Part"), else its innermost heading ("### Chapter 10",
 * "### Chapters 15 and 16"). Empty for introductions, Q and A and addenda.
 */
export function chapterKeysFor(ctx: LectureContext, overrides: ChapterOverrides = new Map()): string[] {
  const listed = overrides.get(ctx.lecture.id);
  if (listed) return listed.chapters;
  if (ctx.lecture.title !== null) {
    const own = chapterKeysForTitle(ctx.lecture.title);
    if (own.length > 0) return own;
  }
  const inner = ctx.ancestors[ctx.ancestors.length - 1];
  return inner ? chapterKeysForTitle(inner.title) : [];
}

/**
 * Parses data/alignment-chapters.json. Each lecture id maps to either
 *  - chapter keys in reading order, ["chapter_12", "chapter_13"]: aligned in
 *    one pass against their concatenation, which finds the switch itself; or
 *  - ranges, [{ "chapter": "chapter_12", "fromSeconds": 0 },
 *    { "chapter": "chapter_13", "fromSeconds": 1262.5, ... }], in increasing
 *    `fromSeconds`, the first at 0: each stretch is aligned to its chapter
 *    alone. Other fields on a range (evidence, confidence, source) are
 *    notes for people and are ignored.
 * Errors for unknown lectures, unknown chapters and malformed entries.
 */
export function parseChapterOverrides(
  json: unknown,
  lectureIds: ReadonlySet<string>,
  chapterKeys: ReadonlySet<string>,
): { overrides: Map<string, ChapterOverride>; errors: string[] } {
  const overrides = new Map<string, ChapterOverride>();
  const errors: string[] = [];
  const lectures = (json as { lectures?: unknown } | null)?.lectures;
  if (typeof lectures !== 'object' || lectures === null || Array.isArray(lectures)) {
    return { overrides, errors: ['"lectures" must be an object of lecture id -> chapters'] };
  }
  for (const [id, value] of Object.entries(lectures)) {
    if (!lectureIds.has(id)) errors.push(`${id}: not a lecture in classes.txt`);
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`${id}: must list one or more chapters`);
      continue;
    }
    const known = (k: unknown) => {
      if (typeof k !== 'string' || !chapterKeys.has(k)) errors.push(`${id}: no chapter file ${String(k)}`);
    };
    if (value.every((v) => typeof v === 'string')) {
      value.forEach(known);
      if (new Set(value).size !== value.length) errors.push(`${id}: a chapter is listed twice`);
      overrides.set(id, { chapters: value as string[] });
      continue;
    }
    const ranges: { chapter: string; fromSeconds: number }[] = [];
    for (const [i, r] of value.entries()) {
      const { chapter, fromSeconds } = (r ?? {}) as { chapter?: unknown; fromSeconds?: unknown };
      if (typeof fromSeconds !== 'number' || !(fromSeconds >= 0)) {
        errors.push(`${id}: range ${i} needs "chapter" and a "fromSeconds" >= 0`);
        continue;
      }
      known(chapter);
      ranges.push({ chapter: String(chapter), fromSeconds });
    }
    if (ranges.length !== value.length) continue;
    if (ranges[0]!.fromSeconds !== 0) errors.push(`${id}: the first range must start at 0`);
    for (let i = 1; i < ranges.length; i++) {
      if (!(ranges[i]!.fromSeconds > ranges[i - 1]!.fromSeconds)) errors.push(`${id}: ranges must start in increasing order`);
    }
    overrides.set(id, { chapters: [...new Set(ranges.map((r) => r.chapter))], ranges });
  }
  return { overrides, errors };
}

/**
 * Sofer folder names, root first: every heading the lecture sits under, at
 * any depth, plus the lecture's own title when it is standalone (see
 * LectureContext.standalone), so the Sofer tree mirrors the catalog tree.
 */
export function folderPathFor(ctx: LectureContext): string[] {
  const names = ctx.ancestors.map((s) => s.title.trim());
  if (ctx.standalone) names.push(ctx.title.trim());
  return names;
}

/** Sofer title: catalog title plus the stable id in brackets, which is what dedup matches on. */
export function soferTitleFor(ctx: LectureContext): string {
  return `${ctx.title} ${titleIdSuffix(ctx.lecture.id)}`;
}

export function titleIdSuffix(lectureId: string): string {
  return `[${lectureId}]`;
}

/**
 * JSON with two-space indent, except that each word timestamp sits on one
 * line, so a transcript is a readable, diffable file of one word per line.
 */
export function formatTranscript(t: StoredTranscript): string {
  const words = t.result.timestamps ?? null;
  const marker = '__TIMESTAMPS__';
  const body = JSON.stringify({ ...t, result: { ...t.result, timestamps: words ? marker : null } }, null, 2);
  if (!words) return `${body}\n`;
  const inner = words.length === 0 ? '[]' : `[\n${words.map((w) => `      ${JSON.stringify(w)}`).join(',\n')}\n    ]`;
  return `${body.replace(`"${marker}"`, inner)}\n`;
}

/** Lectures named by id plus every lecture under the given heading ids, in that order, without repeats. */
export function selectLectures(
  all: LectureContext[],
  lectureIds: string[],
  sectionIds: string[],
): { selected: LectureContext[]; errors: string[] } {
  const selected: LectureContext[] = [];
  const errors: string[] = [];
  const add = (c: LectureContext) => {
    if (!selected.includes(c)) selected.push(c);
  };
  for (const id of lectureIds) {
    const c = all.find((x) => x.lecture.id === id);
    if (c) add(c);
    else errors.push(`no lecture with id "${id}" in classes.txt`);
  }
  for (const sid of sectionIds) {
    const under = all.filter((x) => x.ancestors.some((s) => s.id === sid));
    if (under.length === 0) errors.push(`no lectures under section id ${sid}`);
    under.forEach(add);
  }
  return { selected, errors };
}

/**
 * data/alignments/<encoded lecture id>.json. A superset of the published
 * v1 alignment shape (schema/v1/alignment.schema.json): the build validates
 * it against that schema and checks that every segment's lineId exists in
 * the segment's `chapter`. A class that reads two chapters has segments in
 * both; the top-level `chapter` is the one with the most aligned lines.
 */
export interface StoredAlignment {
  schemaVersion: 1;
  lectureId: string;
  chapter: string;
  /** Path of the transcript it was made from, relative to data/. */
  transcript: string;
  transcriptionId: string;
  method: { name: string; version: number; options: object };
  stats: {
    transcriptWords: number;
    hebrewWords: number;
    matchedWords: number;
    chapterLines: number;
    alignedLines: number;
    firstLineIndex: number;
    lastLineIndex: number;
    meanConfidence: number;
    /**
     * Only for a class aligned against several chapters (their lines
     * concatenated in reading order; the line indexes above count across
     * them): per chapter, its lines and the ones aligned, with indexes
     * within that chapter (-1 when none).
     */
    chapters?: {
      chapter: string;
      chapterLines: number;
      alignedLines: number;
      firstLineIndex: number;
      lastLineIndex: number;
    }[];
  };
  segments: {
    startSeconds: number;
    endSeconds: number;
    chapter: string;
    lineId: string;
    /** 0..1: similarity-weighted share of the line's words heard in this range. */
    confidence: number;
    matchedWords: number;
    lineWords: number;
    /** Indexes into the transcript's `result.timestamps` of the first and last matched word. */
    firstWord: number;
    lastWord: number;
  }[];
}
