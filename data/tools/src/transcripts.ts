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
}

/** Every lecture with its heading path, in file order. */
export function lectureContexts(series: ParsedSection[]): LectureContext[] {
  const out: LectureContext[] = [];
  const visit = (section: ParsedSection, ancestors: ParsedSection[]) => {
    const here = [...ancestors, section];
    let position = 0;
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
      });
    }
  };
  for (const s of series) visit(s, []);
  return out;
}

/** "Chapter 10" -> "chapter_10". Other headings ("Chapter 15 Q and A", "Introduction") teach no single chapter text. */
export function chapterKeyFor(ctx: LectureContext): string | null {
  const inner = ctx.ancestors[ctx.ancestors.length - 1];
  const m = inner ? /^Chapter (\d+)$/.exec(inner.title.trim()) : null;
  return m ? `chapter_${m[1]!.padStart(2, '0')}` : null;
}

/** Sofer folder names: one per catalog heading, series first. */
export function folderPathFor(ctx: LectureContext): string[] {
  return ctx.ancestors.map((s) => s.title.trim());
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
 * it against that schema and checks that every lineId exists in `chapter`.
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
