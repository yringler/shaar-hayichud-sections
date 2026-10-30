/**
 * Publishing the committed transcripts (data/transcripts/) and alignments
 * (data/alignments/) as /data/v1/ files:
 *
 * - alignments/<encoded id>.json     schema/v1/alignment.schema.json
 * - alignments/chapters/<key>.json   schema/v1/chapter-alignments.schema.json
 * - transcripts/<encoded id>.json    schema/v1/transcript.schema.json
 * - outlines/<encoded id>.json       schema/v1/outline.schema.json
 *
 * Which lectures are published, and the confidence floor, come from one
 * file: data/audio-publish.json (PublishPolicy). The raw Sofer files are
 * never published; transcripts are converted to paragraphs, with the
 * re-timed word times from data/retimed/ when the lecture has them.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { encodePathSegment, type Catalog, type CatalogItem, type CatalogLecture, type CatalogSection } from './catalog.js';
import { walkLines, type Chapter } from './chapter.js';
import { wordTimes } from './retimed.js';
import { TRANSCRIPTION_SERIES } from './transcription-config.js';
import type { SchemaSet } from './validate.js';

/** data/audio-publish.json */
export interface PublishPolicy {
  /** Alignment segments below this (0..1) are left out of the published files. */
  minConfidence: number;
  /** Heading ids (`:N`): every lecture under one of them is published. */
  sections: string[];
  /** Lecture ids published individually. */
  lectures: string[];
}

export function parsePublishPolicy(raw: unknown): { policy: PublishPolicy; errors: string[] } {
  const errors: string[] = [];
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const allowed = new Set(['$comment', 'minConfidence', 'sections', 'lectures']);
  for (const k of Object.keys(o)) if (!allowed.has(k)) errors.push(`unknown key "${k}"`);
  const strings = (k: string): string[] => {
    const v = o[k];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      errors.push(`"${k}" must be an array of strings`);
      return [];
    }
    return v as string[];
  };
  const mc = o['minConfidence'];
  if (typeof mc !== 'number' || mc < 0 || mc > 1) errors.push('"minConfidence" must be a number from 0 to 1');
  return {
    policy: { minConfidence: typeof mc === 'number' ? mc : 1, sections: strings('sections'), lectures: strings('lectures') },
    errors,
  };
}

/** A catalog lecture with its place in the catalog. */
export interface LectureInfo {
  lecture: CatalogLecture;
  series: CatalogSection;
  /** Headings from the series (inclusive) down to the lecture's parent. */
  ancestors: CatalogSection[];
}

export function lectureInfos(catalog: Catalog): Map<string, LectureInfo> {
  const out = new Map<string, LectureInfo>();
  const visit = (items: CatalogItem[], ancestors: CatalogSection[]) => {
    for (const item of items) {
      if (item.type === 'section') visit(item.items, [...ancestors, item]);
      else out.set(item.id, { lecture: item, series: ancestors[0]!, ancestors });
    }
  };
  for (const s of catalog.series) visit(s.items, [s]);
  return out;
}

/** "Chapter 10" parent heading -> "chapter_10" (the rule `yarn align` uses). */
export function chapterKeyOf(info: LectureInfo): string | null {
  const parent = info.ancestors[info.ancestors.length - 1];
  const m = parent ? /^Chapter (\d+)$/.exec(parent.title.trim()) : null;
  return m ? `chapter_${m[1]!.padStart(2, '0')}` : null;
}

/** Policy errors (unknown ids) plus the published lecture ids. */
export function selectPublished(policy: PublishPolicy, infos: Map<string, LectureInfo>): { ids: Set<string>; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  const sectionIds = new Set<string>();
  for (const info of infos.values()) for (const s of info.ancestors) sectionIds.add(s.id);
  for (const id of policy.sections) if (!sectionIds.has(id)) errors.push(`section id "${id}" is not in classes.txt`);
  for (const id of policy.lectures) if (!infos.has(id)) errors.push(`lecture id "${id}" is not in classes.txt`);
  const sections = new Set(policy.sections);
  for (const [id, info] of infos) {
    if (policy.lectures.includes(id) || info.ancestors.some((s) => sections.has(s.id))) ids.add(id);
  }
  return { ids, errors };
}

// ---------------------------------------------------------------------------
// Transcripts: Sofer words -> paragraphs
// ---------------------------------------------------------------------------

export interface TimedWord {
  word: string;
  start: number;
  end: number;
  /** Sofer speaker label (diarization), when the transcript has them. */
  speaker?: string | null;
}

export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** Present only when the transcript has speaker labels. */
  speaker?: string;
}

export interface ParagraphOptions {
  /** A silence at least this long (s) ends a paragraph of at least `minWords`. */
  pauseSeconds: number;
  minWords: number;
  /** A sentence end ends a paragraph of at least `sentenceWords` words when followed by `sentencePauseSeconds` of silence... */
  sentenceWords: number;
  sentencePauseSeconds: number;
  /** ...and always once the paragraph has `targetWords`. */
  targetWords: number;
  /** Hard cap: a paragraph never grows past this many words. */
  maxWords: number;
}

export const DEFAULT_PARAGRAPH_OPTIONS: ParagraphOptions = {
  pauseSeconds: 2,
  minWords: 8,
  sentenceWords: 25,
  sentencePauseSeconds: 0.8,
  targetWords: 70,
  maxWords: 200,
};

const SENTENCE_END = /[.?!]["'”’)\]]*$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Writes the Name as G-d in machine-made English (Sofer transcripts and
 * outline titles), the spelling the chapter translations use: God, God's,
 * Godly, Godliness (and all-caps forms) become G-d, G-d's, G-dly, G-dliness.
 * Lower-case "godly" and "godliness" always mean the same and change too, but
 * a bare lower-case "god" or "gods" ("their god is science") is left alone.
 * The stored Sofer files keep Sofer's spelling; this runs only on what is
 * published.
 */
export function reverentSpelling(text: string): string {
  return text
    .replace(/\bGod(liness|ly)?\b/g, 'G-d$1')
    .replace(/\bGOD(LINESS|LY)?\b/g, 'G-D$1')
    .replace(/\bgod(liness|ly)\b/g, 'g-d$1');
}

/**
 * Groups words into paragraphs: split at every change of speaker (when the
 * words carry speaker labels), at long pauses, or at a sentence end once the
 * paragraph is long enough (sooner if the speaker pauses there).
 */
export function paragraphs(words: TimedWord[], opts: ParagraphOptions = DEFAULT_PARAGRAPH_OPTIONS): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let current: TimedWord[] = [];
  const speakerOf = (w: TimedWord): string | null => w.speaker ?? null;
  const flush = () => {
    if (current.length === 0) return;
    const speaker = speakerOf(current[0]!);
    out.push({
      startSeconds: round2(current[0]!.start),
      endSeconds: round2(Math.max(current[current.length - 1]!.end, current[0]!.start)),
      text: reverentSpelling(current.map((w) => w.word.trim()).join(' ')),
      ...(speaker !== null ? { speaker } : {}),
    });
    current = [];
  };
  for (const [i, w] of words.entries()) {
    if (w.word.trim() === '') continue;
    if (current.length > 0 && speakerOf(current[0]!) !== speakerOf(w)) flush();
    current.push(w);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    const n = current.length;
    const sentenceEnd = SENTENCE_END.test(w.word.trim());
    if (
      (gap >= opts.pauseSeconds && n >= opts.minWords) ||
      (sentenceEnd && n >= opts.targetWords) ||
      (sentenceEnd && n >= opts.sentenceWords && gap >= opts.sentencePauseSeconds) ||
      n >= opts.maxWords
    ) {
      flush();
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Alignments
// ---------------------------------------------------------------------------

/** The fields of a stored alignment (data/alignments/) that are published. */
export interface SourceAlignment {
  lectureId: string;
  chapter: string;
  segments: { startSeconds: number; endSeconds: number; chapter: string; lineId: string; confidence?: number }[];
}

export interface PublishedAlignment {
  schemaVersion: 1;
  lectureId: string;
  chapter: string;
  segments: { startSeconds: number; endSeconds: number; chapter: string; lineId: string; confidence: number }[];
}

export function publishAlignment(a: SourceAlignment, minConfidence: number): PublishedAlignment {
  return {
    schemaVersion: 1,
    lectureId: a.lectureId,
    chapter: a.chapter,
    segments: a.segments
      .map((s) => ({ ...s, confidence: s.confidence ?? 1 }))
      .filter((s) => s.confidence >= minConfidence)
      .map((s) => ({
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds,
        chapter: s.chapter,
        lineId: s.lineId,
        confidence: s.confidence,
      })),
  };
}

/** The chapters an alignment covers: its `chapter`, then its segments' chapters, in order of first appearance. */
export function alignmentChapters(a: Pick<PublishedAlignment, 'chapter' | 'segments'>): string[] {
  return [...new Set([a.chapter, ...a.segments.map((s) => s.chapter)])];
}

/** alignments/chapters/<key>.json (schema/v1/chapter-alignments.schema.json). */
export interface ChapterAlignments {
  schemaVersion: 1;
  chapter: string;
  lectures: {
    id: string;
    url: string;
    title: string;
    seriesId: string;
    series: string;
    /** Headings between the series and the lecture, e.g. "Chapters 10-15 / Chapter 10". */
    part: string;
    durationSeconds: number | null;
    /** Per-lecture alignment, relative to /data/v1/. */
    alignment: string;
    /** Published transcript, relative to /data/v1/, if there is one. */
    transcript?: string;
    /** Published topic outline, relative to /data/v1/, if there is one. */
    outline?: string;
  }[];
  /** Aligned lines in document order; refs sorted by confidence (desc), then lecture order. */
  lines: {
    lineId: string;
    refs: { lecture: number; startSeconds: number; endSeconds: number; confidence: number }[];
  }[];
}

export function chapterAlignments(
  chapterKey: string,
  chapter: Chapter,
  alignments: PublishedAlignment[],
  infos: Map<string, LectureInfo>,
  transcriptIds: Set<string>,
  outlineIds: Set<string> = new Set(),
): ChapterAlignments {
  // Lectures in catalog order.
  const order = [...infos.keys()];
  const sorted = alignments
    .filter((a) => a.segments.length > 0)
    .sort((a, b) => order.indexOf(a.lectureId) - order.indexOf(b.lectureId));
  const lectures = sorted.map((a) => {
    const info = infos.get(a.lectureId)!;
    const file = `${encodePathSegment(a.lectureId)}.json`;
    return {
      id: a.lectureId,
      url: info.lecture.url,
      title: info.lecture.title,
      seriesId: info.series.id,
      series: info.series.title,
      part: info.ancestors.slice(1).map((s) => s.title).join(' / '),
      durationSeconds: info.lecture.durationSeconds,
      alignment: `alignments/${file}`,
      ...(transcriptIds.has(a.lectureId) ? { transcript: `transcripts/${file}` } : {}),
      ...(outlineIds.has(a.lectureId) ? { outline: `outlines/${file}` } : {}),
    };
  });
  const byLine = new Map<string, ChapterAlignments['lines'][number]['refs']>();
  sorted.forEach((a, lecture) => {
    for (const s of a.segments) {
      if (s.chapter !== chapterKey) continue;
      const refs = byLine.get(s.lineId) ?? [];
      refs.push({ lecture, startSeconds: s.startSeconds, endSeconds: s.endSeconds, confidence: s.confidence });
      byLine.set(s.lineId, refs);
    }
  });
  const lines: ChapterAlignments['lines'] = [];
  for (const { line } of walkLines(chapter)) {
    const refs = byLine.get(line.id);
    if (!refs) continue;
    refs.sort((x, y) => y.confidence - x.confidence || x.lecture - y.lecture || x.startSeconds - y.startSeconds);
    lines.push({ lineId: line.id, refs });
  }
  return { schemaVersion: 1, chapter: chapterKey, lectures, lines };
}

// ---------------------------------------------------------------------------
// Outlines: Sofer's auto-generated topic list -> outline.schema.json
// ---------------------------------------------------------------------------

/** One topic as stored in data/outlines/ (the fields publishing reads). */
export interface SourceTopic {
  title: string;
  start_time_sec?: number | null;
  confidence: string;
  /** Sofer's [start, end) indices of the topic's first words in the transcript's word list. */
  token_span?: number[] | null;
}

/**
 * Topic start times moved onto the re-timed words. Sofer located each topic
 * on its own (possibly wrong) word times; the topic's first word is
 * `token_span[0]`, or else the first word whose Sofer start equals the topic's
 * time. A topic that can be tied to no word is dropped rather than shown at a
 * time known to be unreliable.
 */
export function retimeTopics(topics: SourceTopic[], soferStarts: readonly number[], retimedStarts: readonly number[]): SourceTopic[] {
  const out: SourceTopic[] = [];
  for (const t of topics) {
    let i = Array.isArray(t.token_span) && typeof t.token_span[0] === 'number' ? t.token_span[0] : -1;
    if (!(i >= 0 && i < retimedStarts.length) && typeof t.start_time_sec === 'number') {
      i = soferStarts.findIndex((s) => Math.abs(s - t.start_time_sec!) < 0.005);
    }
    if (i >= 0 && i < retimedStarts.length) out.push({ ...t, start_time_sec: retimedStarts[i]! });
  }
  return out;
}

export interface PublishedOutline {
  schemaVersion: 1;
  lectureId: string;
  generatedBy: string;
  topics: { title: string; startSeconds: number; confidence: 'HIGH' | 'MEDIUM' }[];
}

/** Keeps topics located with HIGH or MEDIUM confidence that have a start time, in time order. */
export function publishOutline(lectureId: string, topics: SourceTopic[], generatedBy = 'sofer.ai'): PublishedOutline {
  const kept: PublishedOutline['topics'] = [];
  for (const t of topics) {
    const title = typeof t.title === 'string' ? reverentSpelling(t.title.trim()) : '';
    if (typeof t.start_time_sec !== 'number' || title === '') continue;
    if (t.confidence !== 'HIGH' && t.confidence !== 'MEDIUM') continue;
    kept.push({ title, startSeconds: round2(t.start_time_sec), confidence: t.confidence });
  }
  kept.sort((a, b) => a.startSeconds - b.startSeconds);
  return { schemaVersion: 1, lectureId, generatedBy, topics: kept };
}

/** The topic array of a stored outline file: `topics` (or `outline`), or the file itself when it is an array. */
export function sourceTopics(raw: unknown): SourceTopic[] {
  if (Array.isArray(raw)) return raw as SourceTopic[];
  const o = (raw ?? {}) as Record<string, unknown>;
  for (const k of ['topics', 'outline']) if (Array.isArray(o[k])) return o[k] as SourceTopic[];
  return [];
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface PublishInput {
  dataDir: string;
  policyFile: string;
  catalog: Catalog;
  chapters: { key: string; data: Chapter }[];
  schemas: SchemaSet;
}

export interface PublishedAudio {
  /** Path relative to dist/v1 -> JSON. */
  files: Map<string, unknown>;
  alignmentItems: { id: string; path: string; schema: string }[];
  chapterItems: { id: string; path: string; schema: string }[];
  transcriptItems: { id: string; path: string; schema: string }[];
  outlineItems: { id: string; path: string; schema: string }[];
  errors: string[];
}

interface StoredTranscriptLike {
  lectureId: string;
  result: { timestamps?: TimedWord[] | null };
}

/** Whether the series is configured (transcription-config.ts) to label speakers. */
export function speakerLabelsOn(seriesId: string, config = TRANSCRIPTION_SERIES): boolean {
  const mode = config.find((c) => c.seriesId === seriesId)?.speakers.mode ?? 'off';
  return mode !== 'off';
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Builds the published audio files. Assumes the sources were already
 * validated (sources.ts); the outputs are validated against the v1 schemas.
 */
export function publishAudio(input: PublishInput): PublishedAudio {
  const { dataDir, catalog, schemas } = input;
  const files = new Map<string, unknown>();
  const out: PublishedAudio = {
    files,
    alignmentItems: [],
    chapterItems: [],
    transcriptItems: [],
    outlineItems: [],
    errors: [],
  };
  const policyName = path.basename(input.policyFile);
  if (!existsSync(input.policyFile)) {
    out.errors.push(`${policyName}: missing`);
    return out;
  }
  const { policy, errors: policyErrors } = parsePublishPolicy(readJson(input.policyFile));
  const infos = lectureInfos(catalog);
  const selected = selectPublished(policy, infos);
  out.errors.push(...[...policyErrors, ...selected.errors].map((e) => `${policyName}: ${e}`));
  if (out.errors.length > 0) return out;

  const published = [...infos.keys()].filter((id) => selected.ids.has(id));
  const fileOf = (id: string) => `${encodePathSegment(id)}.json`;

  const transcriptIds = new Set<string>();
  const outlineIds = new Set<string>();
  const alignmentsByChapter = new Map<string, PublishedAlignment[]>();
  for (const id of published) {
    const info = infos.get(id)!;
    const alignmentFile = path.join(dataDir, 'alignments', fileOf(id));
    const transcriptFile = path.join(dataDir, 'transcripts', fileOf(id));
    const outlineFile = path.join(dataDir, 'outlines', fileOf(id));
    let chapter = chapterKeyOf(info);

    if (existsSync(outlineFile)) {
      let topics = sourceTopics(readJson(outlineFile));
      // On a re-timed lecture the topics move with the words they start at.
      if (existsSync(transcriptFile)) {
        const sofer = (readJson(transcriptFile) as StoredTranscriptLike).result.timestamps ?? [];
        const times = wordTimes(dataDir, id, sofer);
        if (times.source === 'retimed') {
          topics = retimeTopics(topics, sofer.map((w) => w.start), times.words.map((w) => w.start));
        }
      }
      const outline = publishOutline(id, topics);
      if (outline.topics.length > 0) {
        const p = `outlines/${fileOf(id)}`;
        files.set(p, outline);
        outlineIds.add(id);
        out.outlineItems.push({ id, path: p, schema: 'schema/outline.schema.json' });
      }
    }

    if (existsSync(alignmentFile)) {
      const a = publishAlignment(readJson(alignmentFile) as SourceAlignment, policy.minConfidence);
      chapter = a.chapter;
      const p = `alignments/${fileOf(id)}`;
      files.set(p, a);
      out.alignmentItems.push({ id, path: p, schema: 'schema/alignment.schema.json' });
      // A class that reads two chapters is listed on both chapters' indexes.
      for (const key of alignmentChapters(a)) {
        alignmentsByChapter.set(key, [...(alignmentsByChapter.get(key) ?? []), a]);
      }
    }
    if (existsSync(transcriptFile)) {
      const raw = readJson(transcriptFile) as StoredTranscriptLike;
      // Forced-alignment times from data/retimed/ when there is a current file.
      const times = wordTimes(dataDir, id, raw.result.timestamps ?? []);
      out.errors.push(...times.errors);
      const stored = times.words;
      if (stored.length === 0) continue;
      // Speaker labels are published only for series configured to label
      // speakers; a transcript made before labeling was turned off keeps its
      // stored labels but they are not shown.
      const words = speakerLabelsOn(info.series.id) ? stored : stored.map(({ speaker: _, ...w }) => w);
      const p = `transcripts/${fileOf(id)}`;
      files.set(p, {
        schemaVersion: 1,
        lectureId: id,
        language: 'en',
        ...(chapter ? { chapter } : {}),
        segments: paragraphs(words),
      });
      transcriptIds.add(id);
      out.transcriptItems.push({ id, path: p, schema: 'schema/transcript.schema.json' });
    }
  }

  for (const ch of input.chapters) {
    const list = alignmentsByChapter.get(ch.key);
    if (!list) continue;
    const index = chapterAlignments(ch.key, ch.data, list, infos, transcriptIds, outlineIds);
    if (index.lines.length === 0) continue;
    const p = `alignments/chapters/${ch.key}.json`;
    files.set(p, index);
    out.chapterItems.push({ id: ch.key, path: p, schema: 'schema/chapter-alignments.schema.json' });
  }

  for (const [p, data] of files) {
    const schema = p.startsWith('alignments/chapters/')
      ? 'chapterAlignments'
      : p.startsWith('alignments/')
        ? 'alignment'
        : p.startsWith('outlines/')
          ? 'outline'
          : 'transcript';
    out.errors.push(...schemas.validate(schema, data).map((e) => `dist/v1/${p}: ${e}`));
  }
  return out;
}
