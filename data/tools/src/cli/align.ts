/**
 * yarn align — align stored transcripts (data/transcripts/) to the lines of
 * the chapter(s) each class teaches, writing data/alignments/<encoded id>.json.
 *
 * Offline and deterministic: rerun it whenever a transcript, a chapter, the
 * chapter overrides or the alignment code changes. By default it aligns
 * every lecture that has a stored transcript and teaches one or two
 * chapters (chapterKeysFor: data/alignment-chapters.json, else a "Chapter N"
 * / "End Chapter N and Chapter M" lecture title, else its innermost
 * heading); narrow it with --lecture <id> / --section <heading id>. A class
 * that reads two chapters is aligned against their lines concatenated in
 * reading order, so its segments carry both chapters; an override with
 * time ranges aligns each range to its own chapter instead.
 * --after-previous starts the search a few lines before the last line
 * aligned in the previous class of the same chapter (useful when a class
 * opens by recapping earlier text). --verbose prints every aligned line
 * with the transcript words it matched.
 *
 * Word times come from data/retimed/<encoded id>.json (forced-alignment
 * re-timing, data/retime/) when it exists and matches the transcript, else
 * from Sofer; `method.times` records which. A re-timed file that no longer
 * matches its transcript is an error for that lecture (exit status 1), not a
 * silent fallback.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  alignTranscriptByRanges,
  alignTranscriptToChapters,
  DEFAULT_ALIGN_OPTIONS,
  type AlignOptions,
  type LineAlignment,
} from '../align.js';
import { walkLines, type Chapter } from '../chapter.js';
import { parseClassesTxt } from '../parse.js';
import { DATA_DIR, defaultPaths } from '../pipeline.js';
import { wordTimes } from '../retimed.js';
import {
  alignmentPath,
  chapterKeysFor,
  lectureContexts,
  parseChapterOverrides,
  selectLectures,
  transcriptPath,
  type ChapterOverride,
  type StoredAlignment,
  type StoredTranscript,
} from '../transcripts.js';

const { values } = parseArgs({
  options: {
    lecture: { type: 'string', multiple: true, default: [] },
    section: { type: 'string', multiple: true, default: [] },
    'after-previous': { type: 'boolean', default: false },
    'min-confidence': { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
});

const paths = defaultPaths();
const parsed = parseClassesTxt(readFileSync(paths.classesTxt, 'utf8'));
const all = lectureContexts(parsed.series);

const OVERRIDES_FILE = path.join(DATA_DIR, 'alignment-chapters.json');
const chapterFiles = new Set(
  readdirSync(paths.chaptersDir)
    .filter((f) => /^chapter_\d+\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, '')),
);
const { overrides, errors: overrideErrors } = existsSync(OVERRIDES_FILE)
  ? parseChapterOverrides(
      JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8')),
      new Set(all.map((c) => c.lecture.id)),
      chapterFiles,
    )
  : { overrides: new Map<string, ChapterOverride>(), errors: [] };
if (overrideErrors.length > 0) {
  for (const e of overrideErrors) console.error(`alignment-chapters.json: ${e}`);
  process.exit(2);
}

const picked =
  values.lecture.length + values.section.length > 0
    ? selectLectures(all, values.lecture, values.section)
    : { selected: all, errors: [] };
if (picked.errors.length > 0) {
  for (const e of picked.errors) console.error(e);
  process.exit(2);
}
const todo = picked.selected.filter((c) => existsSync(transcriptPath(DATA_DIR, c.lecture.id)));
if (todo.length === 0) {
  console.error('No selected lecture has a stored transcript (run yarn transcribe first).');
  process.exit(2);
}

const chapters = new Map<string, Chapter>();
const loadChapter = (key: string): Chapter => {
  let ch = chapters.get(key);
  if (!ch) {
    ch = JSON.parse(readFileSync(path.join(paths.chaptersDir, `${key}.json`), 'utf8')) as Chapter;
    chapters.set(key, ch);
  }
  return ch;
};
/** Line id -> index within its chapter. */
const lineIndexes = new Map<string, Map<string, number>>();
const lineIndexIn = (key: string): Map<string, number> => {
  let m = lineIndexes.get(key);
  if (!m) {
    m = new Map([...walkLines(loadChapter(key))].map(({ line }, i) => [line.id, i]));
    lineIndexes.set(key, m);
  }
  return m;
};

/** How many lines before the previous class's last line to start from, with --after-previous. */
const RECAP_LINES = 3;
let failed = 0;

for (const ctx of todo) {
  const id = ctx.lecture.id;
  const keys = chapterKeysFor(ctx, overrides);
  if (keys.length === 0) {
    console.log(`${id}\n  skip: teaches no chapter (no "Chapter N" heading or title, no alignment-chapters.json entry)`);
    continue;
  }
  const transcriptFile = transcriptPath(DATA_DIR, id);
  const transcript = JSON.parse(readFileSync(transcriptFile, 'utf8')) as StoredTranscript;
  const times = wordTimes(DATA_DIR, id, transcript.result.timestamps ?? []);
  if (times.errors.length > 0) {
    console.error(id);
    for (const e of times.errors) console.error(`  error: ${e}`);
    failed += 1;
    continue;
  }
  const words = times.words;
  const ranges = overrides.get(id)?.ranges;

  const options: AlignOptions = { ...DEFAULT_ALIGN_OPTIONS };
  if (values['min-confidence']) options.minConfidence = Number(values['min-confidence']);
  if (values['after-previous'] && !ranges) {
    // The previous class in catalog order that also reads our first chapter.
    const first = keys[0]!;
    const before = all.slice(0, all.indexOf(ctx)).filter((c) => chapterKeysFor(c, overrides).includes(first));
    const prev = before[before.length - 1];
    const prevFile = prev && alignmentPath(DATA_DIR, prev.lecture.id);
    if (prevFile && existsSync(prevFile)) {
      const prevAlign = JSON.parse(readFileSync(prevFile, 'utf8')) as StoredAlignment;
      const last = prevAlign.segments.filter((s) => s.chapter === first).at(-1);
      const idx = last ? lineIndexIn(first).get(last.lineId) : undefined;
      if (idx !== undefined) options.startLine = Math.max(0, idx - RECAP_LINES);
    }
  }

  const parts = keys.map((key) => ({ key, chapter: loadChapter(key) }));
  const result = ranges
    ? alignTranscriptByRanges(
        words,
        ranges.map((r) => ({ key: r.chapter, chapter: loadChapter(r.chapter), fromSeconds: r.fromSeconds })),
        options,
      )
    : alignTranscriptToChapters(words, parts, options);
  const segs: (LineAlignment & { chapter: string })[] = result.lines;

  // Line indexes across the chapters concatenated in reading order.
  const offsets = new Map<string, number>();
  let total = 0;
  const perChapter = keys.map((key) => {
    const index = lineIndexIn(key);
    offsets.set(key, total);
    total += index.size;
    const mine = segs.filter((s) => s.chapter === key).map((s) => index.get(s.lineId)!);
    return {
      chapter: key,
      chapterLines: index.size,
      alignedLines: mine.length,
      firstLineIndex: mine.length ? Math.min(...mine) : -1,
      lastLineIndex: mine.length ? Math.max(...mine) : -1,
    };
  });
  const globalIndex = (s: { chapter: string; lineId: string }) =>
    offsets.get(s.chapter)! + lineIndexIn(s.chapter).get(s.lineId)!;
  const indexes = segs.map(globalIndex);
  // The chapter the class mostly reads (the first on a tie): its catalog chapter
  // for one that only opens with the end of the previous chapter.
  const mainChapter = perChapter.reduce((a, b) => (b.alignedLines > a.alignedLines ? b : a)).chapter;

  const alignment: StoredAlignment = {
    schemaVersion: 1,
    lectureId: id,
    chapter: mainChapter,
    transcript: path.relative(DATA_DIR, transcriptFile).split(path.sep).join('/'),
    transcriptionId: transcript.sofer.transcriptionId,
    method: {
      name: ranges ? 'monotonic-dp-ranges' : 'monotonic-dp',
      version: 1,
      options: ranges ? { ...options, ranges } : options,
      times: times.source,
      ...(times.retimed
        ? { retimed: { file: times.file!, name: times.retimed.method.name, version: times.retimed.method.version } }
        : {}),
    },
    stats: {
      transcriptWords: words.length,
      hebrewWords: result.hebrewWords,
      matchedWords: result.matchedWords,
      chapterLines: total,
      alignedLines: segs.length,
      firstLineIndex: indexes.length ? Math.min(...indexes) : -1,
      lastLineIndex: indexes.length ? Math.max(...indexes) : -1,
      meanConfidence: round(segs.reduce((s, x) => s + x.confidence, 0) / Math.max(1, segs.length)),
      ...(keys.length > 1 ? { chapters: perChapter } : {}),
    },
    segments: segs.map((s) => ({
      startSeconds: round(s.startSeconds),
      endSeconds: round(s.endSeconds),
      chapter: s.chapter,
      lineId: s.lineId,
      confidence: round(s.confidence),
      matchedWords: s.matchedWords,
      lineWords: s.lineWords,
      firstWord: s.firstWord,
      lastWord: s.lastWord,
    })),
  };
  const out = alignmentPath(DATA_DIR, id);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, formatAlignment(alignment));
  const st = alignment.stats;
  for (const c of perChapter) {
    const mine = segs.filter((s) => s.chapter === c.chapter);
    const when = mine.length ? ` at ${fmt(mine[0]!.startSeconds)}-${fmt(Math.max(...mine.map((s) => s.endSeconds)))}` : '';
    if (c === perChapter[0]) console.log(`${id}${times.source === 'retimed' ? ' (retimed word times)' : ''}`);
    console.log(
      `  ${c.chapter}: ${c.alignedLines} lines (index ${c.firstLineIndex}..${c.lastLineIndex} of ${c.chapterLines})${when}`,
    );
  }
  console.log(
    `  mean confidence ${st.meanConfidence}; ${st.matchedWords}/${st.hebrewWords} Hebrew words matched -> ${path.relative(DATA_DIR, out)}`,
  );
  if (values.verbose) {
    for (const s of segs) {
      const text = [...walkLines(loadChapter(s.chapter))][lineIndexIn(s.chapter).get(s.lineId)!]!.line.text;
      const heard = words.slice(s.firstWord, s.lastWord + 1).map((w) => w.word).join(' ');
      console.log(`  [${s.chapter} ${lineIndexIn(s.chapter).get(s.lineId)}] ${fmt(s.startSeconds)}-${fmt(s.endSeconds)} c=${s.confidence.toFixed(2)}`);
      console.log(`     text:  ${text}`);
      console.log(`     heard: ${heard}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} lecture(s) not aligned: their data/retimed/ file does not match the transcript.`);
  process.exit(1);
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Two-space JSON with one segment per line. */
function formatAlignment(a: StoredAlignment): string {
  const marker = '__SEGMENTS__';
  const body = JSON.stringify({ ...a, segments: marker }, null, 2);
  const inner =
    a.segments.length === 0 ? '[]' : `[\n${a.segments.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]`;
  return `${body.replace(`"${marker}"`, inner)}\n`;
}
