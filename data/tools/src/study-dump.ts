/**
 * What a writer of a study file needs, as plain text (yarn study-dump): the
 * chapter's lines with their ids and where each is read, the chapter's
 * classes with their auto-generated topics, the spellings of the terms that
 * occur, and each class's transcript in sentences, every sentence prefixed
 * with its word range and time and every line marked where the class reads it.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hasHebrew, normalizeHebrew } from './align.js';
import { isLine, type Chapter, type TextNode } from './chapter.js';
import { reverentSpelling } from './publish.js';
import {
  chapterLectureIds,
  chapterWordRange,
  clock,
  hebrewKey,
  type StudyChapterFile,
  type StudyContext,
  type StudySeriesFile,
  type TranslitFile,
  type WordRange,
} from './study.js';
import { lectureFileName, type SoferWord } from './transcripts.js';

const SENTENCE_END = /[.?!]["'”’)\]]*$/;
/** A sentence with no full stop is cut after this many words. */
const MAX_SENTENCE_WORDS = 60;

export interface Sentence {
  words: WordRange;
  start: number;
  text: string;
}

/** Cuts words [from, to] into sentences; a sentence also ends before every index in `breaks`. */
export function sentences(words: readonly SoferWord[], from: number, to: number, breaks: ReadonlySet<number> = new Set()): Sentence[] {
  const out: Sentence[] = [];
  let first = from;
  const flush = (last: number) => {
    if (last < first) return;
    const text = words.slice(first, last + 1).map((w) => w.word.trim()).filter((w) => w !== '').join(' ');
    if (text !== '') out.push({ words: [first, last], start: words[first]!.start, text: reverentSpelling(text) });
    first = last + 1;
  };
  for (let i = from; i <= to; i += 1) {
    if (breaks.has(i)) flush(i - 1);
    if (SENTENCE_END.test(words[i]!.word.trim()) || i - first + 1 >= MAX_SENTENCE_WORDS) flush(i);
  }
  flush(to);
  return out;
}

const BACKCHANNEL = /^(right|mhm|mm-hmm|uh-huh|okay|yeah)[.,!]?$/i;

/**
 * Folds a listener's one-word answer ("Right.") into the sentence before it:
 * its words stay inside that sentence's range, its text is dropped. Not
 * across the start of a line (`breaks`).
 */
export function foldBackchannel(sents: Sentence[], breaks: ReadonlySet<number> = new Set()): Sentence[] {
  const out: Sentence[] = [];
  for (const s of sents) {
    const prev = out[out.length - 1];
    if (prev && BACKCHANNEL.test(s.text) && !breaks.has(s.words[0])) prev.words = [prev.words[0], s.words[1]];
    else out.push({ ...s, words: [...s.words] });
  }
  return out;
}

export interface DumpOptions {
  /** Only these lectures' transcripts (ids or leading numbers such as "064"). Default: all. */
  lectures?: string[];
  /** Leave the transcripts out (lines, classes and terms only). */
  noTranscripts?: boolean;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

export function dumpChapter(ctx: StudyContext, series: StudySeriesFile, translit: TranslitFile | null, chapter: string, opts: DumpOptions = {}): string {
  const out: string[] = [];
  const lines = ctx.chapterLines(chapter);
  if (!lines) throw new Error(`there is no chapters/${chapter}.json`);
  const index = new Map(lines.map((l, i) => [l.id, i]));
  const ids = chapterLectureIds(ctx, series, chapter);
  const short = (id: string) => /^\d+/.exec(id)?.[0] ?? id;

  /** line id -> where each class reads it. */
  const readAt = new Map<string, string[]>();
  const info = ids.map((id) => {
    const t = ctx.transcript(id);
    const a = ctx.alignment(id);
    const segs = (a?.segments ?? []).filter((s) => s.chapter === chapter && index.has(s.lineId)).sort((x, y) => x.firstWord - y.firstWord);
    for (const s of segs) {
      readAt.set(s.lineId, [...(readAt.get(s.lineId) ?? []), `${short(id)} w${s.firstWord} ${t ? clock(t.words[s.firstWord]!.start) : '?'} conf ${s.confidence}`]);
    }
    return { id, t, segs, range: t ? chapterWordRange(a, t.words.length, chapter) : null };
  });

  out.push(`# ${chapter}, series ${series.id} (${series.teacher}: ${series.title})`);
  out.push(`Study file: data/study/${series.id}/${chapter}.json`);
  out.push('');
  out.push('## Classes on this chapter');
  for (const { id, t, segs, range } of info) {
    const lc = ctx.lectures.get(id)!;
    if (!t) {
      out.push(`- ${id}: NO TRANSCRIPT`);
      continue;
    }
    const part = range ? `chapter part words [${range[0]}, ${range[1]}] (${clock(t.words[range[0]]!.start)}–${clock(t.words[range[1]]!.end)})` : 'no part on this chapter';
    const read = !range ? 'reads only other chapters' : segs.length > 0 ? `reads lines ${Math.min(...segs.map((s) => index.get(s.lineId)!)) + 1}–${Math.max(...segs.map((s) => index.get(s.lineId)!)) + 1} (${segs.length} aligned)` : 'reads no line (free discussion)';
    out.push(`- "${id}" transcriptionId ${t.transcriptionId}: ${t.words.length} words, ${clock(lc.lecture.durationSeconds ?? t.words[t.words.length - 1]!.end)}, ${t.times} times; ${part}; ${read}`);
  }

  out.push('');
  out.push('## Lines (document order; section labels from the chapter file)');
  const chapterTree = readJson(path.join(ctx.dataDir, 'chapters', `${chapter}.json`)) as Chapter;
  let n = 0;
  const visit = (node: TextNode, depth: number) => {
    if (node.label) out.push(`${'  '.repeat(depth)}[section: ${node.label}]`);
    for (const child of node.children) {
      if (isLine(child)) {
        n += 1;
        const where = readAt.get(child.id);
        out.push(`${'  '.repeat(depth)}${n}. ${child.id}: ${child.text}`);
        out.push(`${'  '.repeat(depth)}     ${where ? `read: ${where.join('; ')}` : 'NOT READ in any class of this series'}`);
      } else visit(child, depth + 1);
    }
  };
  for (const node of chapterTree) visit(node, 0);

  // Terms of the table whose Hebrew occurs in the chapter or its classes.
  if (translit) {
    const heard = new Set<string>();
    const addWords = (text: string) => {
      for (const w of text.split(/\s+/)) if (hasHebrew(w)) heard.add(normalizeHebrew(w));
    };
    for (const l of lines) addWords(l.text);
    for (const { t, range } of info) if (t && range) for (let i = range[0]; i <= range[1]; i += 1) addWords(t.words[i]!.word);
    const hits = translit.terms.filter((t) => t.he.split(/\s+/).every((w) => heard.has(normalizeHebrew(w))));
    out.push('');
    out.push(`## Spellings (data/study/translit.json; ${hits.length} of ${translit.terms.length} terms occur here)`);
    const seen = new Set<string>();
    for (const t of hits) {
      const k = `${hebrewKey(t.he)}|${t.term}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(`- ${t.he} = ${t.term}${t.gloss ? ` (${t.gloss})` : ''}`);
    }
  }

  // Terms other chapters of the series define outside the table.
  const studyDir = path.join(ctx.dataDir, 'study', series.id);
  const others: string[] = [];
  const table = new Set((translit?.terms ?? []).map((t) => hebrewKey(t.he)));
  for (let c = 1; c <= 99; c += 1) {
    const key = `chapter_${String(c).padStart(2, '0')}`;
    const file = path.join(studyDir, `${key}.json`);
    if (key === chapter || !existsSync(file)) continue;
    try {
      for (const t of (readJson(file) as StudyChapterFile).terms) if (!table.has(hebrewKey(t.he))) others.push(`- ${t.he} = ${t.term} (${t.gloss}) [${key}]`);
    } catch {
      // An unreadable neighbour is the check's business, not the dump's.
    }
  }
  if (others.length > 0) {
    out.push('');
    out.push("## Terms other chapters of this series define (not in the table; reuse their spelling)");
    out.push(...others);
  }

  if (opts.noTranscripts) return `${out.join('\n')}\n`;

  const wanted = opts.lectures && opts.lectures.length > 0 ? new Set(opts.lectures) : null;
  for (const { id, t, segs, range } of info) {
    if (wanted && !wanted.has(id) && !wanted.has(short(id))) continue;
    if (!t || !range) continue;
    out.push('');
    out.push(`## Class "${id}"`);
    const outlineFile = path.join(ctx.dataDir, 'outlines', lectureFileName(id));
    if (existsSync(outlineFile)) {
      const topics = ((readJson(outlineFile) as { topics?: { title: string; token_span?: [number, number]; confidence?: string }[] }).topics ?? []).filter(
        (x) => x.token_span && (x.confidence === 'HIGH' || x.confidence === 'MEDIUM'),
      );
      if (topics.length > 0) {
        out.push('Auto-generated topics (a hint, often wrong):');
        for (const x of topics) out.push(`  - ${reverentSpelling(x.title)}`);
      }
    }
    out.push('Each sentence: [w<first>-<last> <time>]. Cite a stretch as "words": [first of its first sentence, last of its last sentence]. A listener\'s one-word "Right." is folded into the sentence before it.');
    const marks = new Map<number, string[]>();
    for (const s of segs) marks.set(s.firstWord, [...(marks.get(s.firstWord) ?? []), `=== LINE ${index.get(s.lineId)! + 1} ${s.lineId} (conf ${s.confidence}): ${lines[index.get(s.lineId)!]!.text}`]);
    const breaks = new Set(marks.keys());
    const sents = foldBackchannel(sentences(t.words, range[0], range[1], breaks), breaks);
    for (const s of sents) {
      for (const m of marks.get(s.words[0]) ?? []) out.push('', m);
      out.push(`[w${s.words[0]}-${s.words[1]} ${clock(s.start)}] ${s.text}`);
    }
  }
  return `${out.join('\n')}\n`;
}
