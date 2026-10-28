/**
 * Aligns a word-timestamped class transcript to chapter lines.
 *
 * The class reads the chapter aloud in Hebrew and explains it in English
 * (with Hebrew terms mixed in). We keep only the transcript's Hebrew words,
 * normalize both sides (nikud, punctuation, final letters, Yiddish digraphs),
 * and run one monotonic dynamic-programming alignment of transcript words
 * against chapter words:
 *
 *  - matching a transcript word to a chapter word gains a score that grows
 *    with their similarity (exact, spelling variant, prefix letter,
 *    edit distance), and gains less for isolated Hebrew words, which are
 *    usually terms inside an English explanation rather than reading;
 *  - skipping a transcript word is free (explanations, repeats, ASR noise);
 *  - skipping a chapter word inside the aligned span costs `skipCost` (free
 *    for abbreviations and markers, which are often expanded or not read),
 *    so the path cannot jump ahead to grab a stray term;
 *  - chapter words before and after the span are skipped for free, since a
 *    class reads only part of its chapter. Low-scoring prefixes are dropped
 *    as in local alignment.
 *
 * Each line's time range comes from its matched words (the densest cluster
 * in time, so an outlier cannot stretch it), and its confidence is the
 * similarity mass matched over the line's readable words. Lines below
 * `minConfidence` are left out: "not read in this class".
 */
import { walkLines, type Chapter } from './chapter.js';
import type { SoferWord } from './transcripts.js';

// ---------------------------------------------------------------- normalize

const NIKUD = /[֑-ׇ]/g;
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const LIGATURES: Record<string, string> = { װ: 'וו', ױ: 'וי', ײ: 'יי', ײַ: 'יי' };
const HEBREW_LETTER = /[א-תװ-ײיִ-ﭏ]/;
const LATIN_LETTER = /[A-Za-z]/;
/** Geresh / gershayim and the ASCII stand-ins the corpus uses for them. */
const ABBREV_MARK = /['"׳״‘’“”]/;

/**
 * Hebrew letters only, without nikud or cantillation, final forms folded to
 * medial ones and Yiddish digraph ligatures expanded. Everything else
 * (punctuation, geresh, digits, Latin) is dropped.
 */
export function normalizeHebrew(word: string): string {
  let s = word.normalize('NFD').replace(NIKUD, '').normalize('NFC');
  s = s.replace(/[יִ-ﭏ]/g, (c) => c.normalize('NFD').replace(NIKUD, ''));
  let out = '';
  for (const ch of s) {
    const lig = LIGATURES[ch];
    if (lig) out += lig;
    else if (ch >= 'א' && ch <= 'ת') out += FINALS[ch] ?? ch;
  }
  return out;
}

export const hasHebrew = (word: string) => HEBREW_LETTER.test(word);

/** A word without the vowel letters ו / י (spelling with or without them varies). */
export const skeleton = (norm: string) => norm.replace(/[וי]/g, '');

const PREFIXES = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'ד']);

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Similarity of two normalized words in [0, 1]; 0 means "not the same word". */
export function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (skeleton(a) === skeleton(b) && skeleton(a).length >= 2) return 0.9;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // One prefix letter attached or not (ו"כו" vs "כו", "והוא" vs "הוא").
  if (long.length === short.length + 1 && short.length >= 2 && PREFIXES.has(long[0]!) && long.slice(1) === short) {
    return 0.8;
  }
  if (short.length < 3) return 0;
  if (long.length - short.length > 2) return 0;
  const ratio = 1 - levenshtein(a, b) / long.length;
  return ratio >= 0.6 ? ratio * 0.9 : 0;
}

// ------------------------------------------------------------------ tokens

export interface ChapterToken {
  norm: string;
  lineIndex: number;
  /** Abbreviations and parenthesized markers: often expanded or not read, so free to skip. */
  optional: boolean;
}

export interface ChapterLineInfo {
  id: string;
  text: string;
  /** Index of its first token in the token list, and how many it has. */
  firstToken: number;
  tokenCount: number;
  /** Tokens that are expected to be read (non-optional). */
  readable: number;
}

/** Splits one line of chapter text into normalized tokens. */
export function tokenizeLine(text: string): { norm: string; optional: boolean }[] {
  const out: { norm: string; optional: boolean }[] = [];
  for (const raw of text.split(/[\s־\-–—/]+/)) {
    const norm = normalizeHebrew(raw);
    if (!norm) continue;
    const parenthesizedMarker = /^\(.*\)$/.test(raw.replace(/[.,:;]+$/, '')) && norm.length <= 2;
    out.push({ norm, optional: ABBREV_MARK.test(raw) || parenthesizedMarker });
  }
  return out;
}

export function chapterTokens(chapter: Chapter): { tokens: ChapterToken[]; lines: ChapterLineInfo[] } {
  const tokens: ChapterToken[] = [];
  const lines: ChapterLineInfo[] = [];
  for (const { line } of walkLines(chapter)) {
    const lineIndex = lines.length;
    const toks = tokenizeLine(line.text);
    lines.push({
      id: line.id,
      text: line.text,
      firstToken: tokens.length,
      tokenCount: toks.length,
      readable: toks.filter((t) => !t.optional).length,
    });
    for (const t of toks) tokens.push({ ...t, lineIndex });
  }
  return { tokens, lines };
}

export interface TranscriptToken {
  norm: string;
  /** Index into the transcript's word list. */
  wordIndex: number;
  start: number;
  end: number;
  /** Length of the run of consecutive Hebrew words this one sits in. */
  run: number;
}

/**
 * The transcript's Hebrew words. Words with neither Hebrew nor Latin letters
 * (punctuation, numbers) do not break a run; Latin words do.
 */
export function transcriptTokens(words: SoferWord[]): TranscriptToken[] {
  const out: TranscriptToken[] = [];
  let runStart = 0;
  const closeRun = () => {
    const len = out.length - runStart;
    for (let k = runStart; k < out.length; k++) out[k]!.run = len;
    runStart = out.length;
  };
  for (const [i, w] of words.entries()) {
    if (hasHebrew(w.word)) {
      const norm = normalizeHebrew(w.word);
      if (norm) out.push({ norm, wordIndex: i, start: w.start, end: w.end, run: 0 });
    } else if (LATIN_LETTER.test(w.word)) {
      closeRun();
    }
  }
  closeRun();
  return out;
}

// --------------------------------------------------------------- alignment

export interface AlignOptions {
  /** Lowest word similarity that may count as a match. */
  minSimilarity: number;
  /** Cost of leaving a readable chapter word inside the aligned span unmatched. */
  skipCost: number;
  /** Weight of a match for a word in a Hebrew run shorter than `readingRun`. */
  isolatedWeight: number;
  /** Runs at least this long are treated as reading aloud. */
  readingRun: number;
  /** Matched words of one line further apart than this (seconds) are split into clusters. */
  clusterGapSeconds: number;
  /** Lines below this confidence are dropped. */
  minConfidence: number;
  /** Chapter lines before this index are not considered (e.g. read in an earlier class). */
  startLine: number;
}

export const DEFAULT_ALIGN_OPTIONS: AlignOptions = {
  minSimilarity: 0.6,
  skipCost: 0.5,
  isolatedWeight: 0.4,
  readingRun: 3,
  clusterGapSeconds: 150,
  minConfidence: 0.35,
  startLine: 0,
};

export interface WordMatch {
  t: number;
  c: number;
  similarity: number;
}

const DIAG = 1;
const UP = 2;
const LEFT = 3;

/**
 * Monotonic alignment of transcript tokens against chapter tokens (see the
 * module comment). Returns matched pairs in increasing order of both
 * indices.
 */
export function alignTokens(
  t: TranscriptToken[],
  c: ChapterToken[],
  opts: AlignOptions = DEFAULT_ALIGN_OPTIONS,
): WordMatch[] {
  const n = t.length;
  const m = c.length;
  if (n === 0 || m === 0) return [];

  // Similarity over the distinct words only.
  const tVocab = new Map<string, number>();
  const cVocab = new Map<string, number>();
  const tIdx = t.map((x) => tVocab.get(x.norm) ?? (tVocab.set(x.norm, tVocab.size), tVocab.size - 1));
  const cIdx = c.map((x) => cVocab.get(x.norm) ?? (cVocab.set(x.norm, cVocab.size), cVocab.size - 1));
  const tWords = [...tVocab.keys()];
  const cWords = [...cVocab.keys()];
  const sim = new Float32Array(tWords.length * cWords.length);
  for (const [i, a] of tWords.entries()) {
    for (const [j, b] of cWords.entries()) sim[i * cWords.length + j] = wordSimilarity(a, b);
  }
  const simAt = (i: number, j: number) => sim[tIdx[i]! * cWords.length + cIdx[j]!]!;

  const weight = t.map((x) => (x.run >= opts.readingRun ? 1 : opts.isolatedWeight));
  const skip = c.map((x) => (x.optional ? 0 : opts.skipCost));

  // Rolling score rows, full traceback matrix.
  let prev = new Float64Array(m + 1);
  let cur = new Float64Array(m + 1);
  const back = new Uint8Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) {
    cur[0] = 0;
    const w = weight[i - 1]!;
    for (let j = 1; j <= m; j++) {
      let best = 0;
      let move = 0; // start: chapter words before j skipped for free
      const up = prev[j]!;
      if (up > best) {
        best = up;
        move = UP;
      }
      const left = cur[j - 1]! - skip[j - 1]!;
      if (left > best) {
        best = left;
        move = LEFT;
      }
      const s = simAt(i - 1, j - 1);
      if (s >= opts.minSimilarity) {
        const diag = prev[j - 1]! + w * (s - 0.4) * 2.5;
        if (diag > best) {
          best = diag;
          move = DIAG;
        }
      }
      cur[j] = best;
      back[i * (m + 1) + j] = move;
    }
    [prev, cur] = [cur, prev];
  }

  // Free trailing chapter words: end at the best column of the last row.
  let j = 0;
  for (let k = 1; k <= m; k++) if (prev[k]! > prev[j]!) j = k;
  let i = n;
  const matches: WordMatch[] = [];
  while (i > 0 && j > 0) {
    const move = back[i * (m + 1) + j];
    if (move === DIAG) {
      matches.push({ t: i - 1, c: j - 1, similarity: simAt(i - 1, j - 1) });
      i--;
      j--;
    } else if (move === UP) i--;
    else if (move === LEFT) j--;
    else break;
  }
  return matches.reverse();
}

export interface LineAlignment {
  lineId: string;
  lineIndex: number;
  startSeconds: number;
  endSeconds: number;
  confidence: number;
  matchedWords: number;
  lineWords: number;
  /** Transcript word indices (into the full word list) of the first and last matched word. */
  firstWord: number;
  lastWord: number;
}

/** Turns word matches into per-line time ranges with confidence. */
export function linesFromMatches(
  matches: WordMatch[],
  t: TranscriptToken[],
  c: ChapterToken[],
  lines: ChapterLineInfo[],
  opts: AlignOptions = DEFAULT_ALIGN_OPTIONS,
): LineAlignment[] {
  const byLine = new Map<number, WordMatch[]>();
  for (const mt of matches) {
    const li = c[mt.c]!.lineIndex;
    const list = byLine.get(li) ?? [];
    list.push(mt);
    byLine.set(li, list);
  }
  const out: LineAlignment[] = [];
  for (const [lineIndex, list] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    // Clusters of matches close in time; keep the heaviest.
    const clusters: WordMatch[][] = [];
    for (const mt of list) {
      const last = clusters[clusters.length - 1];
      const lastMatch = last?.[last.length - 1];
      if (last && lastMatch && t[mt.t]!.start - t[lastMatch.t]!.end <= opts.clusterGapSeconds) last.push(mt);
      else clusters.push([mt]);
    }
    const mass = (cl: WordMatch[]) => cl.reduce((s, x) => s + x.similarity, 0);
    const best = clusters.reduce((a, b) => (mass(b) > mass(a) ? b : a));
    const line = lines[lineIndex]!;
    const denom = Math.max(1, line.readable || line.tokenCount);
    const confidence = Math.min(1, mass(best) / denom);
    if (confidence < opts.minConfidence) continue;
    const first = t[best[0]!.t]!;
    const last = t[best[best.length - 1]!.t]!;
    out.push({
      lineId: line.id,
      lineIndex,
      startSeconds: first.start,
      endSeconds: last.end,
      confidence,
      matchedWords: best.length,
      lineWords: line.tokenCount,
      firstWord: first.wordIndex,
      lastWord: last.wordIndex,
    });
  }
  return out;
}

/** The whole step: transcript words + chapter -> aligned lines. */
export function alignTranscript(
  words: SoferWord[],
  chapter: Chapter,
  options: Partial<AlignOptions> = {},
): { lines: LineAlignment[]; chapterLines: ChapterLineInfo[]; hebrewWords: number; matchedWords: number } {
  const opts = { ...DEFAULT_ALIGN_OPTIONS, ...options };
  const { tokens, lines } = chapterTokens(chapter);
  const firstToken = lines[opts.startLine]?.firstToken ?? tokens.length;
  const window = tokens.slice(firstToken);
  const t = transcriptTokens(words);
  const matches = alignTokens(t, window, opts).map((mt) => ({ ...mt, c: mt.c + firstToken }));
  return {
    lines: linesFromMatches(matches, t, tokens, lines, opts),
    chapterLines: lines,
    hebrewWords: t.length,
    matchedWords: matches.length,
  };
}
