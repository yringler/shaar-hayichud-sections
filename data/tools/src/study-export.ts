/**
 * The study-beta export: data/dist/study-beta/, a trimmed and enriched copy
 * of the study guides for the lessons2 closed beta (published by the site at
 * /data/study-beta/, noindex). Unversioned and not part of dist/v1, so it
 * never reaches the Dart snapshot package.
 *
 *   index.json                 which series has a guide for which chapter, and
 *                              each class's part of the chapter in seconds
 *   <series>/<chapter>.json    one guide: no word ranges, transcription ids,
 *                              terms, review questions, omissions or notes;
 *                              each phrase gets the line ids it overlaps
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
  type StudyAudio,
  type StudyBlock,
  type StudyChapterFile,
  type StudyContext,
  type StudyIssue,
  type StudyPassage,
  type StudyPhrase,
  type StudySeriesFile,
} from './study.js';
import type { StoredAlignment } from './transcripts.js';

export const STUDY_BETA_SCHEMA_VERSION = 1;

export interface StudyBetaLecture {
  id: string;
  /** Seconds (audio time) where the class's part on this chapter starts and ends. */
  start: number;
  end: number;
  /** The chapter the class reads on into after this one. */
  continuesIn?: string;
}

export interface StudyBetaIndexChapter {
  /** Path of the guide, relative to the index. */
  file: string;
  status: StudyChapterFile['status'];
  /** Present (true) when the guide no longer matches the text or the timing in places. */
  stale?: true;
  /** The classes the guide cites, in class order. */
  lectures: StudyBetaLecture[];
}

export interface StudyBetaIndex {
  schemaVersion: 1;
  generated: string;
  series: {
    id: string;
    catalogSeriesId: string;
    teacher: string;
    title: string;
    chapters: Record<string, StudyBetaIndexChapter>;
  }[];
}

export interface StudyBetaAudio {
  lecture: string;
  start?: number;
  end?: number;
}

export type StudyBetaBlock = Omit<StudyBlock, 'audio'> & { audio: StudyBetaAudio[] };
export type StudyBetaPhrase = StudyPhrase & { lines: string[] };
export interface StudyBetaPassage {
  lines: string[];
  phrases?: StudyBetaPhrase[];
  blocks: StudyBetaBlock[];
  skip?: StudyPassage['skip'];
}

export interface StudyBetaChapter {
  schemaVersion: 1;
  series: string;
  chapter: string;
  title: string;
  status: StudyChapterFile['status'];
  stale?: true;
  provenance?: { method: NonNullable<StudyChapterFile['provenance']>['method'] };
  overview: string;
  sections: { title: string; summary: string; passages: StudyBetaPassage[] }[];
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
export function lectureSpan(ctx: StudyContext, file: StudyChapterFile, lectureId: string): StudyBetaLecture | null {
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

const trimAudio = (a: StudyAudio): StudyBetaAudio => ({
  lecture: a.lecture,
  ...(a.start !== undefined ? { start: a.start } : {}),
  ...(a.end !== undefined ? { end: a.end } : {}),
});

/** Copies only the fields the app reads, so a new writer-side field never leaks into the export. */
const trimBlock = (b: StudyBlock): StudyBetaBlock => ({
  kind: b.kind,
  ...(b.title !== undefined ? { title: b.title } : {}),
  ...(b.question !== undefined ? { question: b.question } : {}),
  ...(b.askedBy !== undefined ? { askedBy: b.askedBy } : {}),
  text: b.text,
  ...(b.join ? { join: true as const } : {}),
  audio: b.audio.map(trimAudio),
  ...(b.outOfPlace !== undefined ? { outOfPlace: b.outOfPlace } : {}),
  ...(b.sensitivity !== undefined ? { sensitivity: structuredClone(b.sensitivity) } : {}),
});

/** One guide as the app reads it. `lines` is the chapter's lines in order. */
export function studyBetaChapter(file: StudyChapterFile, lines: readonly Line[], stale: boolean): StudyBetaChapter {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    schemaVersion: STUDY_BETA_SCHEMA_VERSION,
    series: file.series,
    chapter: file.chapter,
    title: file.title,
    status: file.status,
    ...(stale ? { stale: true as const } : {}),
    ...(file.provenance ? { provenance: { method: file.provenance.method } } : {}),
    overview: file.overview,
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
                  en: f.en,
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

export interface StudyBetaExport {
  index: StudyBetaIndex;
  /** Path relative to dist/study-beta/ -> its JSON (index.json not included). */
  files: Map<string, StudyBetaChapter>;
  /** Study files left out because they have errors (relative to data/). */
  skipped: string[];
}

/**
 * Builds the export from data/study/. `issues` are checkStudy's for the same
 * directory: a file with an error (or whose series.json has one) is left out.
 */
export function exportStudyBeta(dataDir: string, ctx: StudyContext, issues: readonly StudyIssue[], generated = new Date().toISOString(), schemaDir?: string): StudyBetaExport {
  const index: StudyBetaIndex = { schemaVersion: STUDY_BETA_SCHEMA_VERSION, generated, series: [] };
  const files = new Map<string, StudyBetaChapter>();
  const skipped: string[] = [];
  if (!existsSync(path.join(dataDir, 'study'))) return { index, files, skipped };

  const levels = new Map<string, Set<string>>();
  for (const i of issues) levels.set(i.file, (levels.get(i.file) ?? new Set()).add(i.level));
  const loaded = loadStudy(dataDir, schemaDir);
  for (const s of loaded.series) {
    const seriesOk = s.data !== null && !levels.get(s.file)?.has('error');
    const chapters: Record<string, StudyBetaIndexChapter> = {};
    for (const ch of s.chapters) {
      const lines = ctx.chapterLines(ch.key);
      if (!seriesOk || !ch.data || !lines || levels.get(ch.file)?.has('error')) {
        skipped.push(ch.file);
        continue;
      }
      const stale = levels.get(ch.file)?.has('stale') ?? false;
      const rel = `${s.id}/${ch.key}.json`;
      files.set(rel, studyBetaChapter(ch.data, lines, stale));
      chapters[ch.key] = {
        file: rel,
        status: ch.data.status,
        ...(stale ? { stale: true as const } : {}),
        lectures: ch.data.lectures.flatMap((l) => lectureSpan(ctx, ch.data!, l.id) ?? []),
      };
    }
    if (!seriesOk) continue;
    const series = s.data as StudySeriesFile;
    index.series.push({ id: series.id, catalogSeriesId: series.catalogSeriesId, teacher: series.teacher, title: series.title, chapters });
  }
  return { index, files, skipped };
}
