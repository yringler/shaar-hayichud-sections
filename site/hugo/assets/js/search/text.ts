/**
 * Search text handling shared by the indexer (scripts/search-index.ts, run
 * after Hugo by `yarn build`) and the search page (search.ts). Both sides
 * must fold words the same way, so everything that decides what matches
 * lives here. Pure: no DOM, no Node.
 *
 * Pagefind matches whole words, and the start of a word, and knows no
 * Hebrew. The indexer therefore adds to each record, after its own folded
 * words:
 * - each Hebrew word without its prefix letters (`ובחכמה` → `בחכמה`,
 *   `חכמה`), so a search for `חכמה` finds it;
 * - the canonical token of every glossary term it contains (glossary.ts), so
 *   `chochmah` finds `חכמה` and `מידות` finds `מדות`.
 * The search page rewrites glossary forms in the query to the same tokens
 * (normalizeQuery). Display text never goes through this: results show the
 * original text (snippet, with matcher deciding what to mark).
 */
import { GLOSSARY } from './glossary.ts';

/** Quotes, gershayim and geresh (`אבי"ע`, `אבי''ע`, `ד'`), apostrophes, and Sofer's stray backslashes. */
const QUOTES = /['"`\\׳״‘’“”]/g;
/** Niqqud and cantillation (not the maqaf, U+05BE, which separates words). */
const MARKS = /[֑-ֽֿ-ׇ]/g;
const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** Word separators: whitespace, maqaf, hyphens and dashes, slashes. */
const SEPARATORS = /[\s־\-‐-―/]+/;
const HEBREW_START = /^[א-ת]/;
/** Hebrew prefix letters: ו ה ב כ ל מ ש, and Aramaic ד (`דאצילות`). */
const PREFIX_LETTERS = 'והבכלמשד';
/** At most this many prefix letters are stripped (`ושבחכמה`). */
const MAX_PREFIX = 3;
/** A stripped word keeps at least this many letters (`הקו` → `קו`). */
const MIN_STEM = 2;

/** A word as search sees it: no quotes or marks, no punctuation at its edges, lowercase. */
export function foldWord(raw: string): string {
  return raw.replace(QUOTES, '').replace(MARKS, '').replace(EDGES, '').toLowerCase();
}

/** The folded words of a text, in order. */
export function words(text: string): string[] {
  return text
    .split(SEPARATORS)
    .map(foldWord)
    .filter((w) => w !== '');
}

/** A folded Hebrew word with 1..MAX_PREFIX leading prefix letters dropped, shortest strip first. */
export function prefixVariants(word: string): string[] {
  if (!HEBREW_START.test(word)) return [];
  const out: string[] = [];
  let rest = word;
  while (out.length < MAX_PREFIX && rest.length > MIN_STEM && PREFIX_LETTERS.includes(rest.charAt(0))) {
    rest = rest.slice(1);
    out.push(rest);
  }
  return out;
}

interface Form {
  /** Folded words of the form. */
  words: string[];
  entry: number;
}

/** Glossary forms by their first folded word; canonical tokens by entry. */
const glossary = (() => {
  const byFirst = new Map<string, Form[]>();
  const canonical: string[][] = [];
  GLOSSARY.forEach((e, entry) => {
    canonical.push(words(e.he[0] ?? ''));
    for (const f of [...e.he, ...e.en]) {
      const ws = words(f);
      const first = ws[0];
      if (first === undefined) continue;
      const list = byFirst.get(first) ?? [];
      list.push({ words: ws, entry });
      byFirst.set(first, list);
    }
  });
  return { byFirst, canonical };
})();

/**
 * Glossary forms that start at ws[i]: the longest match per entry, as
 * [entry, word count]. With `prefixed`, the first word may carry prefix letters.
 */
function formsAt(ws: readonly string[], i: number, prefixed: boolean): [number, number][] {
  const w = ws[i];
  if (w === undefined) return [];
  const heads = prefixed ? [w, ...prefixVariants(w)] : [w];
  const best = new Map<number, number>();
  for (const head of heads) {
    for (const f of glossary.byFirst.get(head) ?? []) {
      const n = f.words.length;
      let ok = true;
      for (let k = 1; k < n && ok; k++) ok = ws[i + k] === f.words[k];
      if (ok && n > (best.get(f.entry) ?? 0)) best.set(f.entry, n);
    }
  }
  return [...best];
}

/** What the indexer gives Pagefind for a text: its folded words, then the extra tokens (see the file comment). */
export function indexContent(text: string): string {
  const ws = words(text);
  const extra = new Set<string>();
  for (let i = 0; i < ws.length; i++) {
    for (const v of prefixVariants(ws[i] ?? '')) extra.add(v);
    for (const [entry] of formsAt(ws, i, true)) {
      for (const t of glossary.canonical[entry] ?? []) extra.add(t);
    }
  }
  return extra.size ? `${ws.join(' ')} ${[...extra].join(' ')}` : ws.join(' ');
}

export interface QueryAnalysis {
  /** The query for Pagefind: folded words, glossary forms replaced by their canonical tokens. */
  query: string;
  /** The words the reader typed, folded. */
  typed: string[];
  /** Glossary entries the query names. */
  entries: number[];
}

/**
 * Folds the query and rewrites glossary forms (the longest at each position,
 * also behind prefix letters: `וסובב` → `סובב`) to their canonical tokens.
 * Pagefind needs every query word in a record, so a prefixed term must not
 * stay as typed: `ממלא וסובב` would then miss `ממלא ... סובב`.
 */
export function analyzeQuery(q: string): QueryAnalysis {
  const typed = words(q);
  const out: string[] = [];
  const entries: number[] = [];
  for (let i = 0; i < typed.length; ) {
    let best: [number, number] | null = null;
    for (const m of formsAt(typed, i, true)) if (!best || m[1] > best[1]) best = m;
    if (best) {
      out.push(...(glossary.canonical[best[0]] ?? []));
      if (!entries.includes(best[0])) entries.push(best[0]);
      i += best[1];
    } else {
      out.push(typed[i] ?? '');
      i++;
    }
  }
  return { query: out.join(' '), typed, entries };
}

export function normalizeQuery(q: string): string {
  return analyzeQuery(q).query;
}

/**
 * Whether a word of a result should be marked for this query: it starts
 * with a typed word (Latin: roughly, as Pagefind stems English), or it is a
 * form of a glossary term the query names. Hebrew words also match behind
 * prefix letters.
 */
export function matcher(q: string): (word: string) => boolean {
  const { typed, entries } = analyzeQuery(q);
  const starts = typed.map((t) => (HEBREW_START.test(t) ? t : englishStem(t)));
  const exact = new Set<string>();
  for (const e of entries) {
    const entry = GLOSSARY[e];
    if (!entry) continue;
    for (const f of [...entry.he, ...entry.en]) for (const w of words(f)) exact.add(w);
  }
  return (raw) =>
    raw.split(SEPARATORS).some((part) => {
      const w = foldWord(part);
      if (w === '') return false;
      const all = [w, ...prefixVariants(w)];
      return all.some((v) => exact.has(v) || starts.some((s) => v.startsWith(s)));
    });
}

/** A rough English stem for marking words: common endings dropped while 4+ letters remain. */
function englishStem(w: string): string {
  const m = /^(.{4,}?)(ations?|ing|ed|es|s|ly|ions?)$/.exec(w);
  return m?.[1] ?? w;
}

export interface SnippetPart {
  text: string;
  hit: boolean;
}

/**
 * A window of `text` around its first marked word (or its start): up to
 * `before` words before it and `size` words in all, with `…` where text was
 * cut. Adjacent unmarked text is merged into one part.
 */
export function snippet(text: string, isHit: (word: string) => boolean, size = 40, before = 12): SnippetPart[] {
  const tokens = text.trim().split(/(\s+)/);
  const wordAt: number[] = [];
  tokens.forEach((t, i) => {
    if (i % 2 === 0 && t !== '') wordAt.push(i);
  });
  const hits = wordAt.map((i) => isHit(tokens[i] ?? ''));
  const first = hits.indexOf(true);
  const from = Math.max(0, Math.min(first - before, wordAt.length - size));
  const to = Math.min(wordAt.length, from + size);
  const parts: SnippetPart[] = [];
  const push = (s: string, hit: boolean) => {
    const last = parts[parts.length - 1];
    if (last && !last.hit && !hit) last.text += s;
    else parts.push({ text: s, hit });
  };
  if (from > 0) push('… ', false);
  for (let k = from; k < to; k++) {
    if (k > from) push(tokens[(wordAt[k] ?? 0) - 1] ?? ' ', false);
    push(tokens[wordAt[k] ?? 0] ?? '', hits[k] ?? false);
  }
  if (to < wordAt.length) push(' …', false);
  return parts;
}
