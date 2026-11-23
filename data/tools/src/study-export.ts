/**
 * The study guides' exports, both in the v1 shape (schema/v1/study.schema.json
 * and study-index.schema.json):
 *
 * - public (dist/v1/study/): the series whose series.json has `public` (the
 *   teacher's permission), each guide in its public edition (publicView:
 *   sensitive blocks replaced by their publishable text or left out, so no
 *   `sensitivity` remains). Published at /data/v1/study/.
 * - beta (dist/study-beta/v1/study/): every series, as written (`sensitivity`
 *   kept), for the lessons2 closed beta. Published unlisted (noindex) at
 *   /data/study-beta/v1/study/, outside dist/v1, so it never reaches the Dart
 *   snapshot package.
 *
 *   study/index.json               which series has a guide for which chapter,
 *                                  and each class's part of the chapter in seconds
 *   study/<series>/<chapter>.json  one guide: no word ranges, transcription ids,
 *                                  terms, review questions, omissions or notes;
 *                                  each phrase gets the line ids it overlaps,
 *                                  and its audio is flattened to lecture/start/end
 *
 * Only a file with no error is exported. A stale file (a chapter line edited
 * or a tape re-timed since it was written) is exported and marked `stale`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Line } from './chapter.js';
import {
  chapterWordRange,
  collapse,
  loadStudy,
  publicView,
  type StudyAudio,
  type StudyBlock,
  type StudyChapterFile,
  type StudyContext,
  type StudyIssue,
  type StudyPassage,
  type StudyPhrase,
  type StudySensitivity,
  type StudySeriesFile,
} from './study.js';
import type { StoredAlignment } from './transcripts.js';

export const STUDY_SCHEMA_VERSION = 1;

export interface ExportLecture {
  id: string;
  /** Seconds (audio time) where the class's part on this chapter starts and ends. */
  start: number;
  end: number;
  /** The chapter the class reads on into after this one. */
  continuesIn?: string;
}

export interface ExportAudio {
  lecture: string;
  start?: number;
  end?: number;
}

export type ExportBlock = Omit<StudyBlock, 'audio'> & { audio: ExportAudio[] };
/**
 * A phrase as the app reads it: `en` only where the teacher translates it,
 * and then (from the phrase's `audio`) the lecture and seconds where he does.
 */
export interface ExportPhrase {
  he: string;
  en?: string;
  lecture?: string;
  start?: number;
  end?: number;
  notes?: string[];
  lines: string[];
}
export interface ExportPassage {
  lines: string[];
  phrases?: ExportPhrase[];
  blocks: ExportBlock[];
  skip?: StudyPassage['skip'];
}

export interface ExportChapter {
  schemaVersion: 1;
  series: string;
  chapter: string;
  title: string;
  status: StudyChapterFile['status'];
  stale?: true;
  provenance?: { method: NonNullable<StudyChapterFile['provenance']>['method'] };
  overview: string;
  /** Where the class sums the chapter up; present only when the guide cites it. */
  overviewAudio?: ExportAudio[];
  sections: { title: string; summary: string; passages: ExportPassage[] }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The line ids each phrase overlaps. The passage's lines are joined by
 * spaces (whitespace collapsed), as the check compares them; each phrase is
 * placed at its text's next occurrence from where the previous phrase ended,
 * or, when the text no longer matches (a stale file), right after it. A
 * phrase gets every line whose characters it shares; lines whose id is not
 * in the chapter are passed in as missing and so never named.
 */
export function phraseLines(lines: readonly Line[], phrases: readonly Pick<StudyPhrase, 'he'>[]): string[][] {
  const spans: { id: string; from: number; to: number }[] = [];
  let at = 0;
  for (const l of lines) {
    const t = collapse(l.text);
    if (t === '') continue;
    spans.push({ id: l.id, from: at, to: at + t.length });
    at += t.length + 1;
  }
  const text = spans.length === 0 ? '' : collapse(lines.map((l) => l.text).join(' '));
  let cursor = 0;
  return phrases.map((p) => {
    const he = collapse(p.he);
    const found = he === '' ? -1 : text.indexOf(he, cursor);
    const from = found >= 0 ? found : cursor;
    const to = from + he.length;
    cursor = Math.min(text.length, to + 1);
    return spans.filter((s) => from < s.to && s.from < to).map((s) => s.id);
  });
}

/** The chapter a class reads after its part on `chapter`, from its alignment; null when it ends there. */
export function continuesIn(alignment: StoredAlignment | null, chapter: string): string | null {
  const segs = [...(alignment?.segments ?? [])].sort((a, b) => a.firstWord - b.firstWord);
  const mine = segs.filter((s) => s.chapter === chapter);
  if (mine.length === 0) return null;
  const last = mine[mine.length - 1]!;
  return segs.find((s) => s.chapter !== chapter && s.firstWord > last.firstWord)?.chapter ?? null;
}

/**
 * A class's part on a chapter in seconds: chapterWordRange timed with the
 * words the site plays; without a transcript or alignment, the span of the
 * guide's own audio for the class. Null when neither is known.
 */
export function lectureSpan(ctx: StudyContext, file: StudyChapterFile, lectureId: string): ExportLecture | null {
  const t = ctx.transcript(lectureId);
  const alignment = ctx.alignment(lectureId);
  const range = t ? chapterWordRange(alignment, t.words.length, file.chapter) : null;
  let start: number | undefined;
  let end: number | undefined;
  if (t && range) {
    start = t.words[range[0]]!.start;
    end = Math.max(t.words[range[1]]!.end, start);
  } else {
    const audio = [...(file.overviewAudio ?? []), ...file.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks.flatMap((b) => b.audio)))];
    for (const a of audio) {
      if (a.lecture !== lectureId) continue;
      if (a.start !== undefined) start = Math.min(start ?? a.start, a.start);
      if (a.end !== undefined) end = Math.max(end ?? a.end, a.end);
    }
    if (start === undefined || end === undefined) return null;
  }
  const next = continuesIn(alignment, file.chapter);
  return { id: lectureId, start: round2(start), end: round2(end), ...(next ? { continuesIn: next } : {}) };
}

const trimAudio = (a: StudyAudio): ExportAudio => ({
  lecture: a.lecture,
  ...(a.start !== undefined ? { start: a.start } : {}),
  ...(a.end !== undefined ? { end: a.end } : {}),
});

/** Copies only the fields the app reads, so a new writer-side field never leaks into the export. */
const trimBlock = (b: StudyBlock): ExportBlock => ({
  kind: b.kind,
  ...(b.title !== undefined ? { title: b.title } : {}),
  ...(b.question !== undefined ? { question: b.question } : {}),
  ...(b.askedBy !== undefined ? { askedBy: b.askedBy } : {}),
  text: b.text,
  ...(b.join ? { join: true as const } : {}),
  audio: b.audio.map(trimAudio),
  ...(b.outOfPlace !== undefined ? { outOfPlace: b.outOfPlace } : {}),
  ...(b.sensitivity !== undefined ? { sensitivity: trimSensitivity(b.sensitivity) } : {}),
});

/** The flag as the beta app reads it: the review stamp is editorial and stays in data/study/. */
function trimSensitivity(s: StudySensitivity): StudySensitivity {
  const { reviewed: _reviewed, ...rest } = structuredClone(s);
  return rest;
}

/** One guide as the app reads it. `lines` is the chapter's lines in order. */
export function exportChapter(file: StudyChapterFile, lines: readonly Line[], stale: boolean): ExportChapter {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    schemaVersion: STUDY_SCHEMA_VERSION,
    series: file.series,
    chapter: file.chapter,
    title: file.title,
    status: file.status,
    ...(stale ? { stale: true as const } : {}),
    ...(file.provenance ? { provenance: { method: file.provenance.method } } : {}),
    overview: file.overview,
    ...(file.overviewAudio?.length ? { overviewAudio: file.overviewAudio.map(trimAudio) } : {}),
    sections: file.sections.map((s) => ({
      title: s.title,
      summary: s.summary,
      passages: s.passages.map((p) => {
        const known = p.lines.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
        const mapped = p.phrases ? phraseLines(known, p.phrases) : [];
        return {
          lines: [...p.lines],
          ...(p.phrases
            ? {
                phrases: p.phrases.map((f, i) => ({
                  he: f.he,
                  ...(f.en !== undefined ? { en: f.en } : {}),
                  ...(f.audio ? trimAudio(f.audio) : {}),
                  ...(f.notes !== undefined ? { notes: [...f.notes] } : {}),
                  lines: mapped[i]!,
                })),
              }
            : {}),
          blocks: p.blocks.map(trimBlock),
          ...(p.skip ? { skip: { ...p.skip } } : {}),
        };
      }),
    })),
  };
}

/** An export's study/index.json (schema/v1/study-index.schema.json). */
export interface StudyIndex {
  schemaVersion: 1;
  series: {
    id: string;
    catalogSeriesId: string;
    teacher: string;
    title: string;
    chapters: { chapter: string; path: string; status: StudyChapterFile['status']; stale?: true; lectures: ExportLecture[] }[];
  }[];
}

export interface StudyExport {
  index: StudyIndex;
  /** Path relative to the edition's root (`study/<series>/<chapter>.json`) -> its JSON (schema/v1/study.schema.json). */
  files: Map<string, ExportChapter>;
  /** Study files of the edition's series left out because they have errors (relative to data/). */
  skipped: string[];
}

/** public: the series allowed publication, in their public edition. beta: every series, as written. */
export type StudyEdition = 'public' | 'beta';

/**
 * One edition of the study guides from data/study/. `issues` are
 * checkStudy's for the same directory: a file with an error (or whose
 * series.json has one) is left out; a stale one is marked.
 */
export function exportStudy(dataDir: string, ctx: StudyContext, issues: readonly StudyIssue[], edition: StudyEdition, schemaDir?: string): StudyExport {
  const index: StudyIndex = { schemaVersion: STUDY_SCHEMA_VERSION, series: [] };
  const files = new Map<string, ExportChapter>();
  const skipped: string[] = [];
  if (!existsSync(path.join(dataDir, 'study'))) return { index, files, skipped };
  const levels = new Map<string, Set<string>>();
  for (const i of issues) levels.set(i.file, (levels.get(i.file) ?? new Set()).add(i.level));
  for (const s of loadStudy(dataDir, schemaDir).series) {
    const series = s.data as StudySeriesFile | null;
    if (series && edition === 'public' && !series.public) continue;
    const seriesOk = series !== null && !levels.get(s.file)?.has('error');
    const chapters: StudyIndex['series'][number]['chapters'] = [];
    for (const ch of [...s.chapters].sort((a, b) => a.key.localeCompare(b.key))) {
      const lines = ctx.chapterLines(ch.key);
      if (!seriesOk || !ch.data || !lines || levels.get(ch.file)?.has('error')) {
        skipped.push(ch.file);
        continue;
      }
      const stale = levels.get(ch.file)?.has('stale') ?? false;
      const rel = `study/${s.id}/${ch.key}.json`;
      files.set(rel, exportChapter(edition === 'public' ? publicView(ch.data) : ch.data, lines, stale));
      chapters.push({
        chapter: ch.key,
        path: rel,
        status: ch.data.status,
        ...(stale ? { stale: true as const } : {}),
        lectures: ch.data.lectures.flatMap((l) => lectureSpan(ctx, ch.data!, l.id) ?? []),
      });
    }
    if (!seriesOk) continue;
    index.series.push({ id: series.id, catalogSeriesId: series.catalogSeriesId, teacher: series.teacher, title: series.title, chapters });
  }
  return { index, files, skipped };
}
