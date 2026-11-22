/**
 * Study guides (data/study/<series>/chapter_NN.json): a class series'
 * teaching of a chapter as passages (runs of chapter lines) with small blocks
 * of prose, each pointing at the stretch of recording it was written from.
 * Types mirror schema/study/*.schema.json; this file adds the checks a schema
 * cannot make (line ids, coverage, lectures, word ranges and their times,
 * closeness to the alignment, term spellings) and the helpers the CLIs share.
 *
 * Issue levels:
 *  - error:   the file is wrong in itself. Fails `yarn build-data`.
 *  - stale:   the file no longer matches something that changed under it (a
 *             chapter line edited in the editor, a tape re-timed). Fails
 *             `yarn study-check`, but only warns in `yarn build-data`, so a
 *             chapter edit never blocks a deploy.
 *  - warning: worth a look. Never fails anything.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { walkLines, type Chapter, type Line } from './chapter.js';
import { parseClassesTxt } from './parse.js';
import { wordTimes } from './retimed.js';
import {
  chapterKeysFor,
  lectureContexts,
  lectureFileName,
  parseChapterOverrides,
  type ChapterOverrides,
  type LectureContext,
  type SoferWord,
  type StoredAlignment,
  type StoredTranscript,
} from './transcripts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WordRange = [number, number];

export interface StudyAudio {
  lecture: string;
  words: WordRange;
  start?: number;
  end?: number;
}

export const BLOCK_KINDS = ['explanation', 'mashal', 'keyPoint', 'question', 'story', 'avodah', 'aside', 'digression', 'recap'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface StudySensitivity {
  categories: string[];
  reason: string;
  action: 'replace' | 'omit';
  publishable?: string;
  publishableTitle?: string;
}

export interface StudyBlock {
  kind: BlockKind;
  title?: string;
  question?: string;
  askedBy?: 'student' | 'teacher';
  text: string;
  join?: true;
  audio: StudyAudio[];
  outOfPlace?: string;
  sensitivity?: StudySensitivity;
}

export interface StudyPhrase {
  he: string;
  en: string;
  notes?: string[];
}

export interface StudyPassage {
  lines: string[];
  phrases?: StudyPhrase[];
  blocks: StudyBlock[];
  skip?: { reason: 'no-recording' | 'read-only'; note?: string };
}

export interface StudySection {
  title: string;
  summary: string;
  passages: StudyPassage[];
}

export interface StudyChapterFile {
  schemaVersion: 1;
  series: string;
  chapter: string;
  title: string;
  status: 'draft' | 'edited' | 'reviewed';
  provenance?: { method: 'generated' | 'migrated' | 'hand'; from?: string; date?: string; note?: string };
  lectures: { id: string; transcriptionId: string }[];
  overview: string;
  overviewAudio?: StudyAudio[];
  terms: { term: string; he: string; gloss: string; line?: string }[];
  sections: StudySection[];
  reviewQuestions: { question: string; lines: string[] }[];
  omitted?: { lecture: string; words: WordRange; reason: string; note?: string }[];
  notes?: { text: string; lines?: string[] }[];
}

export interface StudySeriesFile {
  schemaVersion: 1;
  id: string;
  catalogSeriesId: string;
  teacher: string;
  title: string;
  translation: string;
  chapterLectures?: Record<string, string[]>;
}

export interface TranslitFile {
  schemaVersion: 1;
  terms: { he: string; term: string; gloss?: string; group?: string }[];
}

export type IssueLevel = 'error' | 'stale' | 'warning';

export interface StudyIssue {
  level: IssueLevel;
  /** Path relative to data/, e.g. "study/markel-advanced/chapter_06.json". */
  file: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Context: everything a study file refers to
// ---------------------------------------------------------------------------

export interface TimedTranscript {
  transcriptionId: string;
  /** Words with the times the site plays (data/retimed/ when the lecture has them). */
  words: SoferWord[];
  times: 'retimed' | 'sofer';
}

export interface StudyContext {
  dataDir: string;
  /** Catalog lecture id -> its context (headings, duration). */
  lectures: Map<string, LectureContext>;
  overrides: ChapterOverrides;
  /** Chapter key -> its lines in document order. */
  chapterLines(key: string): Line[] | null;
  transcript(lectureId: string): TimedTranscript | null;
  alignment(lectureId: string): StoredAlignment | null;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** Reads classes.txt, alignment-chapters.json and, lazily, chapters, transcripts and alignments under `dataDir`. */
export function loadStudyContext(dataDir: string): StudyContext {
  const parsed = parseClassesTxt(readFileSync(path.join(dataDir, 'classes.txt'), 'utf8'));
  const all = lectureContexts(parsed.series);
  const lectures = new Map(all.map((c) => [c.lecture.id, c]));
  const chaptersDir = path.join(dataDir, 'chapters');
  const chapterFiles = new Set(
    readdirSync(chaptersDir)
      .filter((f) => /^chapter_\d+\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, '')),
  );
  const overridesFile = path.join(dataDir, 'alignment-chapters.json');
  const overrides = existsSync(overridesFile)
    ? parseChapterOverrides(readJson(overridesFile), new Set(lectures.keys()), chapterFiles).overrides
    : new Map();

  const cache = <T>(load: (key: string) => T | null) => {
    const seen = new Map<string, T | null>();
    return (key: string): T | null => {
      if (!seen.has(key)) seen.set(key, load(key));
      return seen.get(key) ?? null;
    };
  };
  return {
    dataDir,
    lectures,
    overrides,
    chapterLines: cache((key) => {
      const file = path.join(chaptersDir, `${key}.json`);
      if (!existsSync(file)) return null;
      return [...walkLines(readJson(file) as Chapter)].map((r) => r.line);
    }),
    transcript: cache((id) => {
      const file = path.join(dataDir, 'transcripts', lectureFileName(id));
      if (!existsSync(file)) return null;
      const t = readJson(file) as StoredTranscript;
      const timed = wordTimes(dataDir, id, t.result.timestamps ?? []);
      return { transcriptionId: t.sofer.transcriptionId, words: timed.words, times: timed.source };
    }),
    alignment: cache((id) => {
      const file = path.join(dataDir, 'alignments', lectureFileName(id));
      return existsSync(file) ? (readJson(file) as StoredAlignment) : null;
    }),
  };
}

/** The id of the catalog series (its '#' heading) a lecture is in. */
export const seriesIdOf = (ctx: LectureContext): string => ctx.ancestors[0]!.id;

/**
 * The classes of a series on a chapter, in catalog order: those the catalog
 * or data/alignment-chapters.json ties to it (chapterKeysFor) and those
 * series.json lists under `chapterLectures`.
 */
export function chapterLectureIds(ctx: StudyContext, series: StudySeriesFile, chapter: string): string[] {
  const extra = new Set(series.chapterLectures?.[chapter] ?? []);
  return [...ctx.lectures.values()]
    .filter((c) => seriesIdOf(c) === series.catalogSeriesId)
    .filter((c) => extra.has(c.lecture.id) || chapterKeysFor(c, ctx.overrides).includes(chapter))
    .map((c) => c.lecture.id);
}

/**
 * The part of a class that belongs to a chapter, as a word range: the whole
 * class, unless it also has aligned lines of other chapters; then from this
 * chapter's first line (word 0 when the class starts on this chapter) up to
 * the next other-chapter line. Null when the class has lines only of other
 * chapters.
 */
export function chapterWordRange(alignment: StoredAlignment | null, wordCount: number, chapter: string): WordRange | null {
  if (wordCount === 0) return null;
  const segs = [...(alignment?.segments ?? [])].sort((a, b) => a.firstWord - b.firstWord);
  const mine = segs.filter((s) => s.chapter === chapter);
  if (mine.length === 0) return segs.length === 0 ? [0, wordCount - 1] : null;
  const first = mine[0]!;
  const last = mine[mine.length - 1]!;
  const start = segs[0] === first ? 0 : first.firstWord;
  const after = segs.find((s) => s.chapter !== chapter && s.firstWord > last.firstWord);
  return [start, Math.min(wordCount, after ? after.firstWord : wordCount) - 1];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const HEBREW = /[א-ת]/;
export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Key for comparing Hebrew spellings: no nikud, one kind of geresh and gershayim. */
export const hebrewKey = (s: string): string =>
  collapse(s.replace(/[֑-ׇ]/g, '').replace(/[״“”]/g, '"').replace(/[׳‘’]/g, "'"));

export const clock = (seconds: number): string => {
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Problems with a prose field's Markdown (inline only) and spelling. */
export function proseProblems(text: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (text !== text.trim()) errors.push('has leading or trailing white space');
  if (/\]\(/.test(text) || /▶/.test(text)) errors.push('has a Markdown link or a ▶ (audio belongs in `audio`)');
  if (/<\/?[a-zA-Z][^>]*>/.test(text)) errors.push('has HTML');
  if (/(^|\n)\s*(#{1,6}\s|>|[-+]\s|\*\s|\d+\.\s)/.test(text)) errors.push('has a heading, list or block quote (only paragraphs are allowed)');
  if (/[^\n]\n[^\n]/.test(text)) errors.push('has a line break inside a paragraph (separate paragraphs with one blank line)');
  if (/\n{3,}/.test(text)) errors.push('has more than one blank line between paragraphs');
  if (((text.match(/\*\*/g) ?? []).length % 2) !== 0) errors.push('has an unclosed **');
  if (((text.replace(/\*\*/g, '').match(/\*/g) ?? []).length % 2) !== 0) errors.push('has an unclosed *');
  if (/\bGod(ly|liness|'s)?\b/.test(text)) errors.push('spells the Name out (write G-d, G-dly, G-dliness)');
  const he = /[א-ת][֑-״"']*[א-ת]+/.exec(text);
  if (he) warnings.push(`has Hebrew script ("${he[0]}"); write terms as italic transliterations`);
  return { errors, warnings };
}

/** The **bold** runs of a prose field, each split at "…" into the pieces that must be quotes. */
export function boldQuotes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\*\*([^*]+(?:\*[^*]+\*[^*]*)*)\*\*/g)) {
    for (const piece of m[1]!.split(/…|\.\.\./)) {
      const p = collapse(piece.replace(/\*/g, ''));
      if (p !== '') out.push(p);
    }
  }
  return out;
}

const wordCount = (text: string): number => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadedStudy {
  series: { id: string; file: string; data: StudySeriesFile | null; chapters: { file: string; key: string; data: StudyChapterFile | null }[] }[];
  translit: TranslitFile | null;
  issues: StudyIssue[];
}

const STUDY_CHAPTER_FILE = /^chapter_\d{2}\.json$/;

/** Reads and schema-validates data/study/. `data` is null for a file the schema rejects. */
export function loadStudy(dataDir: string, schemaDir = path.join(dataDir, 'schema', 'study')): LoadedStudy {
  const issues: StudyIssue[] = [];
  const studyDir = path.join(dataDir, 'study');
  const out: LoadedStudy = { series: [], translit: null, issues };
  if (!existsSync(studyDir)) return out;

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const compile = (name: string): ValidateFunction => ajv.compile(readJson(path.join(schemaDir, name)) as object);
  const validators = {
    chapter: compile('study-chapter.schema.json'),
    series: compile('study-series.schema.json'),
    translit: compile('translit.schema.json'),
  };
  const load = <T>(rel: string, validate: ValidateFunction): T | null => {
    let data: unknown;
    try {
      data = readJson(path.join(dataDir, rel));
    } catch (e) {
      issues.push({ level: 'error', file: rel, message: `invalid JSON (${(e as Error).message})` });
      return null;
    }
    if (validate(data)) return data as T;
    for (const e of (validate.errors ?? []).slice(0, 20)) {
      issues.push({ level: 'error', file: rel, message: `${e.instancePath || '/'} ${e.message ?? 'is invalid'}` });
    }
    return null;
  };

  if (existsSync(path.join(studyDir, 'translit.json'))) out.translit = load<TranslitFile>('study/translit.json', validators.translit);
  else issues.push({ level: 'error', file: 'study/translit.json', message: 'is missing' });

  for (const entry of readdirSync(studyDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = `study/${entry.name}`;
    const seriesRel = `${dir}/series.json`;
    const series = existsSync(path.join(dataDir, seriesRel)) ? load<StudySeriesFile>(seriesRel, validators.series) : null;
    if (!existsSync(path.join(dataDir, seriesRel))) issues.push({ level: 'error', file: seriesRel, message: 'is missing' });
    if (series && series.id !== entry.name) issues.push({ level: 'error', file: seriesRel, message: `"id" must be the directory name, "${entry.name}"` });
    const chapters: LoadedStudy['series'][number]['chapters'] = [];
    for (const file of readdirSync(path.join(studyDir, entry.name)).sort()) {
      if (!file.endsWith('.json') || file === 'series.json') continue;
      const rel = `${dir}/${file}`;
      if (!STUDY_CHAPTER_FILE.test(file)) {
        issues.push({ level: 'error', file: rel, message: 'study files must be named chapter_NN.json (two digits)' });
        continue;
      }
      chapters.push({ file: rel, key: file.replace(/\.json$/, ''), data: load<StudyChapterFile>(rel, validators.chapter) });
    }
    out.series.push({ id: entry.name, file: seriesRel, data: series, chapters });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** A block's main audio may be this far (s) outside the stretch where the class reads its passage. */
export const PLACE_SLACK_SECONDS = 120;
/** An uncited stretch of a class at least this long (words) is reported unless `omitted` lists it. */
export const GAP_WORDS = 250;
/** A block longer than this (words) is no longer one thought to jump to. */
export const BLOCK_MAX_WORDS = 260;

export interface ChapterStats {
  passages: number;
  skipped: number;
  blocks: number;
  byKind: Record<string, number>;
  flagged: number;
  words: number;
  /** Per lecture: words of the chapter's part of the class, and how many a block cites or `omitted` lists. */
  coverage: { lecture: string; words: number; cited: number; omitted: number }[];
}

/** Every block of a file with the passage and section it is in. */
export function* walkBlocks(file: StudyChapterFile): Generator<{ block: StudyBlock; passage: StudyPassage; section: StudySection; at: string }> {
  for (const [si, section] of file.sections.entries()) {
    for (const [pi, passage] of section.passages.entries()) {
      for (const [bi, block] of passage.blocks.entries()) {
        yield { block, passage, section, at: `/sections/${si}/passages/${pi}/blocks/${bi}` };
      }
    }
  }
}

/** Merges inclusive ranges and returns them sorted and disjoint. */
export function mergeRanges(ranges: WordRange[]): WordRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: WordRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The parts of `within` that no range covers. */
export function gaps(within: WordRange, ranges: WordRange[]): WordRange[] {
  const out: WordRange[] = [];
  let next = within[0];
  for (const r of mergeRanges(ranges)) {
    if (r[1] < within[0] || r[0] > within[1]) continue;
    if (r[0] > next) out.push([next, r[0] - 1]);
    next = Math.max(next, r[1] + 1);
  }
  if (next <= within[1]) out.push([next, within[1]]);
  return out;
}

/** Checks one schema-valid chapter file against everything it refers to. */
export function checkStudyChapter(
  rel: string,
  file: StudyChapterFile,
  series: StudySeriesFile,
  translit: TranslitFile | null,
  ctx: StudyContext,
  opts: { gapWords?: number } = {},
): { issues: StudyIssue[]; stats: ChapterStats } {
  const issues: StudyIssue[] = [];
  const add = (level: IssueLevel, message: string) => issues.push({ level, file: rel, message });
  const stats: ChapterStats = { passages: 0, skipped: 0, blocks: 0, byKind: {}, flagged: 0, words: 0, coverage: [] };

  const key = path.basename(rel, '.json');
  if (file.chapter !== key) add('error', `"chapter" must be "${key}", the file's name`);
  if (file.series !== series.id) add('error', `"series" must be "${series.id}", the directory's name`);

  // --- lines: every chapter line in exactly one passage, in order ----------
  const lines = ctx.chapterLines(key);
  if (!lines) {
    add('error', `there is no chapters/${key}.json`);
    return { issues, stats };
  }
  const lineIndex = new Map(lines.map((l, i) => [l.id, i]));
  let next = 0;
  let linesOk = true;
  for (const [si, section] of file.sections.entries()) {
    for (const [pi, passage] of section.passages.entries()) {
      const at = `/sections/${si}/passages/${pi}`;
      stats.passages += 1;
      for (const id of passage.lines) {
        const i = lineIndex.get(id);
        if (i === undefined) {
          add('stale', `${at} line "${id}" is not a line of ${key} (edited or removed in the chapter text?)`);
          linesOk = false;
        } else if (i !== next) {
          const want = lines[next];
          add('stale', `${at} line "${id}" is out of place: the next line of the chapter is ${want ? `"${want.id}" (${want.text.slice(0, 40)}…)` : 'none (the chapter has ended)'}; passages must cover every line once, in order`);
          linesOk = false;
          next = i + 1;
        } else next += 1;
      }

      // --- skip / blocks / phrases ---------------------------------------
      if (passage.skip) stats.skipped += 1;
      if (passage.skip && passage.blocks.length > 0) add('error', `${at} has both "skip" and blocks`);
      if (!passage.skip && passage.blocks.length === 0) add('error', `${at} has no blocks; add a "skip" with the reason`);
      if (!passage.phrases) {
        if (passage.skip?.reason !== 'no-recording') add('error', `${at} has no "phrases" (only a passage skipped as no-recording may leave them out)`);
      } else if (passage.lines.every((id) => lineIndex.has(id))) {
        const text = collapse(passage.lines.map((id) => lines[lineIndex.get(id)!]!.text).join(' '));
        const joined = collapse(passage.phrases.map((p) => p.he).join(' '));
        if (text !== joined) {
          let i = 0;
          while (i < text.length && text[i] === joined[i]) i += 1;
          add('stale', `${at} the phrases' Hebrew is not the text of its lines; they part at "${joined.slice(Math.max(0, i - 15), i + 25)}" (text: "${text.slice(Math.max(0, i - 15), i + 25)}")`);
        }
        for (const [fi, p] of passage.phrases.entries()) {
          const en = proseProblems(p.en);
          for (const e of en.errors) add('error', `${at}/phrases/${fi}/en ${e}`);
          if (/\*\*/.test(p.en)) add('error', `${at}/phrases/${fi}/en has bold; a translation has italics only`);
        }
      }
    }
  }
  if (linesOk && next < lines.length) {
    add('stale', `the passages stop at line ${next} of ${lines.length}: "${lines[next]!.id}" (${lines[next]!.text.slice(0, 40)}…) and the lines after it are in no passage`);
  }

  // --- lectures ------------------------------------------------------------
  const listed = new Map(file.lectures.map((l) => [l.id, l]));
  if (listed.size !== file.lectures.length) add('error', '"lectures" lists a lecture twice');
  const transcripts = new Map<string, TimedTranscript>();
  for (const l of file.lectures) {
    const lc = ctx.lectures.get(l.id);
    if (!lc) {
      add('error', `lecture "${l.id}" is not in classes.txt`);
      continue;
    }
    if (seriesIdOf(lc) !== series.catalogSeriesId) add('error', `lecture "${l.id}" is not in catalog series ${series.catalogSeriesId} (${series.title})`);
    const t = ctx.transcript(l.id);
    if (!t) {
      add('error', `lecture "${l.id}" has no stored transcript`);
      continue;
    }
    if (t.transcriptionId !== l.transcriptionId) {
      add('error', `lecture "${l.id}" was transcribed again (${t.transcriptionId}) since this file was written (${l.transcriptionId}); its word ranges must be redone`);
      continue;
    }
    transcripts.set(l.id, t);
  }
  const expected = chapterLectureIds(ctx, series, key);
  for (const id of expected) {
    const t = ctx.transcript(id);
    // A class the catalog files under two chapters may read only the other one.
    if (!listed.has(id) && t && chapterWordRange(ctx.alignment(id), t.words.length, key)) add('warning', `class "${id}" is on ${key} but the file does not cite it`);
  }

  // --- audio -----------------------------------------------------------------
  const cited = new Map<string, WordRange[]>();
  const omitted = new Map<string, WordRange[]>();
  const checkAudio = (at: string, a: { lecture: string; words: WordRange; start?: number; end?: number }, timed: boolean): boolean => {
    if (!listed.has(a.lecture)) {
      add('error', `${at} lecture "${a.lecture}" is not in the file's "lectures"`);
      return false;
    }
    const t = transcripts.get(a.lecture);
    if (!t) return false;
    const [first, last] = a.words;
    if (first > last) {
      add('error', `${at} words [${first}, ${last}]: the first word is after the last`);
      return false;
    }
    if (last >= t.words.length) {
      add('error', `${at} words [${first}, ${last}]: the transcript has ${t.words.length} words`);
      return false;
    }
    if (!timed) return true;
    const start = round2(t.words[first]!.start);
    const end = round2(Math.max(t.words[last]!.end, t.words[first]!.start));
    if (a.start === undefined || a.end === undefined) add('stale', `${at} has no start/end; run yarn study-fill`);
    else if (Math.abs(a.start - start) > 0.011 || Math.abs(a.end - end) > 0.011) {
      add('stale', `${at} start/end ${a.start}–${a.end} are not the times of words [${first}, ${last}] (${start}–${end}); run yarn study-fill`);
    }
    const duration = ctx.lectures.get(a.lecture)?.lecture.durationSeconds ?? null;
    if (duration !== null && end > duration + 5) add('error', `${at} ends at ${end} s, past the end of the recording (${duration} s)`);
    return true;
  };

  /** Per lecture: this chapter's aligned segments, by first word. */
  const aligned = new Map<string, { firstWord: number; index: number }[]>();
  const segmentsOf = (lecture: string) => {
    let segs = aligned.get(lecture);
    if (!segs) {
      segs = (ctx.alignment(lecture)?.segments ?? [])
        .filter((s) => s.chapter === key && lineIndex.has(s.lineId))
        .map((s) => ({ firstWord: s.firstWord, index: lineIndex.get(s.lineId)! }))
        .sort((a, b) => a.firstWord - b.firstWord);
      aligned.set(lecture, segs);
    }
    return segs;
  };

  const seenText = new Map<string, string>();
  for (const { block, passage, at } of walkBlocks(file)) {
    stats.blocks += 1;
    stats.byKind[block.kind] = (stats.byKind[block.kind] ?? 0) + 1;
    stats.words += wordCount(block.text) + wordCount(block.question ?? '');
    if (block.sensitivity) stats.flagged += 1;

    for (const [field, text] of [
      ['text', block.text],
      ['question', block.question],
      ['sensitivity/publishable', block.sensitivity?.publishable],
    ] as const) {
      if (text === undefined) continue;
      const p = proseProblems(text);
      for (const e of p.errors) add('error', `${at}/${field} ${e}`);
      for (const w of p.warnings) add('warning', `${at}/${field} ${w}`);
    }
    if (block.sensitivity) {
      const s = block.sensitivity;
      if (s.action === 'replace' && s.publishable === undefined) add('error', `${at}/sensitivity has action "replace" but no "publishable" text`);
      if (s.action === 'omit' && (s.publishable !== undefined || s.publishableTitle !== undefined)) add('error', `${at}/sensitivity has action "omit" and a publishable text; choose one`);
    }
    if (block.kind === 'question' && block.question === undefined) add('error', `${at} is a question block without "question"`);
    if (block.kind !== 'question' && (block.question !== undefined || block.askedBy !== undefined)) add('error', `${at} has "question"/"askedBy" but is not a question block`);
    if ((block.kind === 'mashal' || block.kind === 'story' || block.kind === 'digression') && block.title === undefined) {
      add('warning', `${at} is a ${block.kind} without a "title" to navigate by`);
    }
    if (wordCount(block.text) > BLOCK_MAX_WORDS) add('warning', `${at} is ${wordCount(block.text)} words; split it into blocks of one thought each (at most about ${BLOCK_MAX_WORDS})`);
    const dup = seenText.get(block.text);
    if (dup) add('error', `${at} repeats the text of ${dup}`);
    else seenText.set(block.text, at);

    // Bold is for words quoted from the passage's translation.
    if (passage.phrases) {
      // Compared without case and punctuation, so a quote may drop the comma its phrase ends with.
      const plain = (t: string) => collapse(t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' '));
      const english = plain(passage.phrases.map((p) => p.en).join(' '));
      for (const q of boldQuotes(block.text)) {
        if (!english.includes(plain(q))) add('warning', `${at} bold "${q.length > 50 ? `${q.slice(0, 50)}…` : q}" is not in the passage's translation; bold only quotes it`);
      }
    }

    for (const [ai, a] of block.audio.entries()) {
      if (!checkAudio(`${at}/audio/${ai}`, a, true)) continue;
      cited.set(a.lecture, [...(cited.get(a.lecture) ?? []), a.words]);
      if (ai > 0 || block.outOfPlace !== undefined || block.kind === 'recap') continue;
      // The main audio should be near where the class reads the passage.
      const idx = passage.lines.map((id) => lineIndex.get(id)).filter((i): i is number => i !== undefined);
      if (idx.length === 0) continue;
      const [lo, hi] = [Math.min(...idx), Math.max(...idx)];
      const segs = segmentsOf(a.lecture);
      const here = segs.filter((s) => s.index >= lo && s.index <= hi);
      const t = transcripts.get(a.lecture)!;
      if (here.length === 0) {
        if (segs.length > 0) add('warning', `${at} class "${a.lecture}" does not read this passage's lines; if the block belongs here, say why in "outOfPlace"`);
        continue;
      }
      const from = t.words[here[0]!.firstWord]!.start - PLACE_SLACK_SECONDS;
      const after = segs.find((s) => s.index > hi && s.firstWord > here[here.length - 1]!.firstWord);
      const to = (after ? t.words[after.firstWord]!.start : t.words[t.words.length - 1]!.end) + PLACE_SLACK_SECONDS;
      const at0 = t.words[a.words[0]]!.start;
      if (at0 < from || at0 > to) {
        add('warning', `${at} starts at ${clock(at0)}, but the class reads this passage at ${clock(from + PLACE_SLACK_SECONDS)}–${clock(to - PLACE_SLACK_SECONDS)}; move the block, or say why in "outOfPlace"`);
      }
    }
  }

  for (const [ai, a] of (file.overviewAudio ?? []).entries()) {
    if (checkAudio(`/overviewAudio/${ai}`, a, true)) cited.set(a.lecture, [...(cited.get(a.lecture) ?? []), a.words]);
  }
  for (const [oi, o] of (file.omitted ?? []).entries()) {
    if (checkAudio(`/omitted/${oi}`, o, false)) omitted.set(o.lecture, [...(omitted.get(o.lecture) ?? []), o.words]);
  }

  // --- nothing dropped silently ------------------------------------------------
  for (const [id, t] of transcripts) {
    const range = chapterWordRange(ctx.alignment(id), t.words.length, key);
    if (!range) continue;
    const c = cited.get(id) ?? [];
    const o = omitted.get(id) ?? [];
    const size = (rs: WordRange[]) => rs.reduce((n, r) => n + Math.max(0, Math.min(r[1], range[1]) - Math.max(r[0], range[0]) + 1), 0);
    stats.coverage.push({ lecture: id, words: range[1] - range[0] + 1, cited: size(mergeRanges(c)), omitted: size(mergeRanges(o)) });
    for (const g of gaps(range, [...c, ...o])) {
      const n = g[1] - g[0] + 1;
      if (n < (opts.gapWords ?? GAP_WORDS)) continue;
      add('warning', `class "${id}" words [${g[0]}, ${g[1]}] (${clock(t.words[g[0]]!.start)}–${clock(t.words[g[1]]!.end)}, ${n} words) are neither cited by a block nor listed in "omitted"`);
    }
  }

  // --- terms, questions, notes, prose ---------------------------------------
  const table = new Map((translit?.terms ?? []).map((t) => [hebrewKey(t.he), t.term]));
  const prose = [file.overview, ...file.sections.flatMap((s) => [s.summary, ...s.passages.flatMap((p) => (p.phrases ?? []).map((f) => f.en))]), ...[...walkBlocks(file)].flatMap((b) => [b.block.text, b.block.question ?? ''])].join('\n');
  const seenTerms = new Set<string>();
  for (const [ti, t] of file.terms.entries()) {
    const at = `/terms/${ti}`;
    const k = hebrewKey(t.he);
    if (seenTerms.has(k)) add('error', `${at} "${t.he}" is listed twice`);
    seenTerms.add(k);
    const known = table.get(k);
    if (known !== undefined && known !== t.term) add('error', `${at} "${t.he}" is spelled "${t.term}" here but "${known}" in study/translit.json; use "${known}"`);
    if (t.line !== undefined && !lineIndex.has(t.line)) add('stale', `${at} line "${t.line}" is not a line of ${key}`);
    if (!prose.toLowerCase().includes(t.term.toLowerCase())) add('warning', `${at} "${t.term}" does not appear in the file's prose`);
  }
  for (const [qi, q] of file.reviewQuestions.entries()) {
    for (const e of proseProblems(q.question).errors) add('error', `/reviewQuestions/${qi}/question ${e}`);
    for (const id of q.lines) if (!lineIndex.has(id)) add('stale', `/reviewQuestions/${qi} line "${id}" is not a line of ${key}`);
  }
  for (const [ni, n] of (file.notes ?? []).entries()) {
    for (const id of n.lines ?? []) if (!lineIndex.has(id)) add('stale', `/notes/${ni} line "${id}" is not a line of ${key}`);
  }
  for (const [field, text] of [['overview', file.overview], ...file.sections.map((s, i) => [`sections/${i}/summary`, s.summary])] as [string, string][]) {
    const p = proseProblems(text);
    for (const e of p.errors) add('error', `/${field} ${e}`);
    for (const w of p.warnings) add('warning', `/${field} ${w}`);
  }
  return { issues, stats };
}

export interface StudyCheck {
  issues: StudyIssue[];
  stats: Map<string, ChapterStats>;
}

/** Loads and checks all of data/study/ (or one series, or one chapter of it). */
export function checkStudy(dataDir: string, given?: StudyContext, only: { series?: string; chapter?: string; schemaDir?: string } = {}): StudyCheck {
  if (!existsSync(path.join(dataDir, 'study'))) return { issues: [], stats: new Map() };
  const ctx = given ?? loadStudyContext(dataDir);
  const loaded = loadStudy(dataDir, only.schemaDir);
  const issues = [...loaded.issues];
  const stats = new Map<string, ChapterStats>();

  // The table: one term per Hebrew spelling.
  const table = new Map<string, string>();
  for (const t of loaded.translit?.terms ?? []) {
    const k = hebrewKey(t.he);
    const prev = table.get(k);
    if (prev !== undefined && prev !== t.term) issues.push({ level: 'error', file: 'study/translit.json', message: `"${t.he}" is spelled both "${prev}" and "${t.term}"; keep one` });
    table.set(k, t.term);
  }

  for (const s of loaded.series) {
    if (only.series !== undefined && s.id !== only.series) continue;
    if (!s.data) continue;
    const seriesTitles = new Set([...ctx.lectures.values()].map(seriesIdOf));
    if (!seriesTitles.has(s.data.catalogSeriesId)) issues.push({ level: 'error', file: s.file, message: `catalog series ${s.data.catalogSeriesId} is not in classes.txt` });
    for (const [chapter, ids] of Object.entries(s.data.chapterLectures ?? {})) {
      if (!ctx.chapterLines(chapter)) issues.push({ level: 'error', file: s.file, message: `chapterLectures: there is no chapters/${chapter}.json` });
      for (const id of ids) if (!ctx.lectures.has(id)) issues.push({ level: 'error', file: s.file, message: `chapterLectures: lecture "${id}" is not in classes.txt` });
    }
    /** Hebrew spelling -> term -> chapters, for terms the table does not have. */
    const local = new Map<string, Map<string, string[]>>();
    for (const ch of s.chapters) {
      if (!ch.data) continue;
      for (const t of ch.data.terms) {
        const k = hebrewKey(t.he);
        if (table.has(k)) continue;
        const byTerm = local.get(k) ?? new Map<string, string[]>();
        byTerm.set(t.term, [...(byTerm.get(t.term) ?? []), ch.key]);
        local.set(k, byTerm);
      }
      if (only.chapter !== undefined && ch.key !== only.chapter) continue;
      const r = checkStudyChapter(ch.file, ch.data, s.data, loaded.translit, ctx);
      issues.push(...r.issues);
      stats.set(ch.file, r.stats);
    }
    for (const [he, byTerm] of local) {
      if (byTerm.size < 2) continue;
      const where = [...byTerm].map(([term, chapters]) => `"${term}" (${chapters.join(', ')})`).join(', ');
      const files = new Set([...byTerm.values()].flat());
      if (only.chapter !== undefined && !files.has(only.chapter)) continue;
      issues.push({ level: 'warning', file: `study/${s.id}`, message: `"${he}" is spelled differently across chapters: ${where}; settle it in study/translit.json` });
    }
  }
  return { issues, stats };
}

// ---------------------------------------------------------------------------
// Writing: times, and the public view
// ---------------------------------------------------------------------------

const bare = (word: string): string => word.replace(/^[("'״׳]+|[)"'״׳,.:;?!]+$/g, '');

/**
 * Expands the writer's shorthand for phrases: a phrase may be written
 * `{ "to": "<its last Hebrew word>", "en": "…" }` instead of with `he`; it
 * then runs from where the previous phrase ended through the next
 * occurrence of that word (punctuation around it ignored), and the last
 * phrase of a passage may leave out both and takes the rest. `he` is copied
 * from the chapter's lines, so it cannot be mistyped.
 */
export function expandPhrases(file: StudyChapterFile, ctx: StudyContext): { changed: number; errors: string[] } {
  const errors: string[] = [];
  let changed = 0;
  const lines = new Map((ctx.chapterLines(file.chapter) ?? []).map((l) => [l.id, l.text]));
  for (const [si, section] of file.sections.entries()) {
    for (const [pi, passage] of section.passages.entries()) {
      const at = `/sections/${si}/passages/${pi}`;
      const phrases = passage.phrases as (Partial<StudyPhrase> & { to?: string })[] | undefined;
      if (!phrases || phrases.every((p) => p.he !== undefined && p.to === undefined)) continue;
      if (!passage.lines.every((id) => lines.has(id))) {
        errors.push(`${at}: cannot expand phrases: a line id is not in ${file.chapter}`);
        continue;
      }
      const tokens = collapse(passage.lines.map((id) => lines.get(id)!).join(' ')).split(' ');
      let cursor = 0;
      for (const [fi, p] of phrases.entries()) {
        if (p.he !== undefined && p.to === undefined) {
          cursor += collapse(p.he).split(' ').length;
          continue;
        }
        let end: number;
        if (p.to !== undefined) {
          end = tokens.findIndex((t, i) => i >= cursor && (t === p.to || bare(t) === bare(p.to!)));
          if (end < 0) {
            errors.push(`${at}/phrases/${fi}: "to": "${p.to}" is not a word of the passage after "${tokens.slice(Math.max(0, cursor - 3), cursor).join(' ')}" (left: "${tokens.slice(cursor).join(' ')}")`);
            break;
          }
        } else if (fi === phrases.length - 1) end = tokens.length - 1;
        else {
          errors.push(`${at}/phrases/${fi}: has neither "he" nor "to" (only the last phrase may leave both out)`);
          break;
        }
        if (end < cursor) {
          errors.push(`${at}/phrases/${fi}: nothing is left of the passage for this phrase`);
          break;
        }
        const { en, notes } = p;
        for (const k of Object.keys(p)) delete (p as Record<string, unknown>)[k];
        Object.assign(p, { he: tokens.slice(cursor, end + 1).join(' '), en, ...(notes !== undefined ? { notes } : {}) });
        cursor = end + 1;
        changed += 1;
      }
    }
  }
  return { changed, errors };
}

/**
 * Writes every audio reference's start/end from its word range (and fills a
 * missing transcriptionId of a listed lecture). Returns how many references
 * changed and what could not be stamped.
 */
export function stampTimes(file: StudyChapterFile, ctx: StudyContext): { changed: number; errors: string[] } {
  const errors: string[] = [];
  let changed = 0;
  for (const l of file.lectures) {
    const t = ctx.transcript(l.id);
    if (!t) errors.push(`lecture "${l.id}" has no stored transcript`);
    else if (!l.transcriptionId) {
      l.transcriptionId = t.transcriptionId;
      changed += 1;
    }
  }
  const refs: { a: StudyAudio; at: string }[] = (file.overviewAudio ?? []).map((a, i) => ({ a, at: `/overviewAudio/${i}` }));
  for (const { block, at } of walkBlocks(file)) refs.push(...block.audio.map((a, i) => ({ a, at: `${at}/audio/${i}` })));
  {
    for (const { a, at } of refs) {
      const t = ctx.transcript(a.lecture);
      const [first, last] = a.words;
      if (!t || first > last || last >= t.words.length) {
        errors.push(`${at}: cannot time words [${first}, ${last}] of "${a.lecture}"`);
        continue;
      }
      const start = round2(t.words[first]!.start);
      const end = round2(Math.max(t.words[last]!.end, t.words[first]!.start));
      if (a.start !== start || a.end !== end) changed += 1;
      // Key order: lecture, words, start, end.
      const { lecture, words } = a;
      for (const k of Object.keys(a)) delete (a as unknown as Record<string, unknown>)[k];
      Object.assign(a, { lecture, words, start, end });
    }
  }
  return { changed, errors };
}

/** How a study file is written to disk: two-space JSON, with each word range on one line. */
export const formatStudyFile = (file: StudyChapterFile): string =>
  `${JSON.stringify(file, null, 2).replace(/"words": \[\s*(\d+),\s*(\d+)\s*\]/g, '"words": [$1, $2]')}\n`;

/**
 * The file as a public build would show it: a block flagged `sensitivity`
 * is left out (action 'omit') or carries its `publishable` text (action
 * 'replace'); the reviewer's notes and the omission list are dropped.
 */
export function publicView(file: StudyChapterFile): StudyChapterFile {
  const copy = structuredClone(file);
  delete copy.notes;
  delete copy.omitted;
  for (const section of copy.sections) {
    for (const passage of section.passages) {
      passage.blocks = passage.blocks.flatMap((b) => {
        const s = b.sensitivity;
        if (!s) return [b];
        if (s.action === 'omit') return [];
        const { sensitivity: _dropped, ...rest } = b;
        return [{ ...rest, text: s.publishable!, ...(s.publishableTitle !== undefined ? { title: s.publishableTitle } : {}) }];
      });
    }
  }
  return copy;
}
