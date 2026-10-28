/**
 * yarn align — align stored transcripts (data/transcripts/) to the lines of
 * the chapter each class teaches, writing data/alignments/<encoded id>.json.
 *
 * Offline and deterministic: rerun it whenever a transcript, a chapter or
 * the alignment code changes. By default it aligns every lecture that has a
 * stored transcript and a "### Chapter N" heading; narrow it with
 * --lecture <id> / --section <heading id>. --after-previous starts the
 * search a few lines before the last line aligned in the previous class of
 * the same chapter (useful when a class opens by recapping earlier text).
 * --verbose prints every aligned line with the transcript words it matched.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { alignTranscript, DEFAULT_ALIGN_OPTIONS, type AlignOptions } from '../align.js';
import type { Chapter } from '../chapter.js';
import { parseClassesTxt } from '../parse.js';
import { DATA_DIR, defaultPaths } from '../pipeline.js';
import {
  alignmentPath,
  chapterKeyFor,
  lectureContexts,
  selectLectures,
  transcriptPath,
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

/** How many lines before the previous class's last line to start from, with --after-previous. */
const RECAP_LINES = 3;

for (const ctx of todo) {
  const id = ctx.lecture.id;
  const chapterKey = chapterKeyFor(ctx);
  if (!chapterKey) {
    console.log(`${id}\n  skip: not under a "### Chapter N" heading`);
    continue;
  }
  const transcriptFile = transcriptPath(DATA_DIR, id);
  const transcript = JSON.parse(readFileSync(transcriptFile, 'utf8')) as StoredTranscript;
  const words = transcript.result.timestamps ?? [];
  const chapter = loadChapter(chapterKey);

  const options: AlignOptions = { ...DEFAULT_ALIGN_OPTIONS };
  if (values['min-confidence']) options.minConfidence = Number(values['min-confidence']);
  if (values['after-previous']) {
    const siblings = all.filter((c) => chapterKeyFor(c) === chapterKey);
    const prev = siblings[siblings.indexOf(ctx) - 1];
    const prevFile = prev && alignmentPath(DATA_DIR, prev.lecture.id);
    if (prevFile && existsSync(prevFile)) {
      const prevAlign = JSON.parse(readFileSync(prevFile, 'utf8')) as StoredAlignment;
      options.startLine = Math.max(0, prevAlign.stats.lastLineIndex - RECAP_LINES);
    }
  }

  const result = alignTranscript(words, chapter, options);
  const segs = result.lines;
  const alignment: StoredAlignment = {
    schemaVersion: 1,
    lectureId: id,
    chapter: chapterKey,
    transcript: path.relative(DATA_DIR, transcriptFile).split(path.sep).join('/'),
    transcriptionId: transcript.sofer.transcriptionId,
    method: { name: 'monotonic-dp', version: 1, options },
    stats: {
      transcriptWords: words.length,
      hebrewWords: result.hebrewWords,
      matchedWords: result.matchedWords,
      chapterLines: result.chapterLines.length,
      alignedLines: segs.length,
      firstLineIndex: segs[0]?.lineIndex ?? -1,
      lastLineIndex: segs[segs.length - 1]?.lineIndex ?? -1,
      meanConfidence: round(segs.reduce((s, x) => s + x.confidence, 0) / Math.max(1, segs.length)),
    },
    segments: segs.map((s) => ({
      startSeconds: round(s.startSeconds),
      endSeconds: round(s.endSeconds),
      chapter: chapterKey,
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
  console.log(
    `${id}\n  ${chapterKey}: ${st.alignedLines} lines (index ${st.firstLineIndex}..${st.lastLineIndex} of ${st.chapterLines}),` +
      ` mean confidence ${st.meanConfidence}; ${st.matchedWords}/${st.hebrewWords} Hebrew words matched -> ${path.relative(DATA_DIR, out)}`,
  );
  if (values.verbose) {
    for (const s of segs) {
      const line = result.chapterLines[s.lineIndex]!;
      const heard = words.slice(s.firstWord, s.lastWord + 1).map((w) => w.word).join(' ');
      console.log(`  [${s.lineIndex}] ${fmt(s.startSeconds)}-${fmt(s.endSeconds)} c=${s.confidence.toFixed(2)}`);
      console.log(`     text:  ${line.text}`);
      console.log(`     heard: ${heard}`);
    }
  }
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
