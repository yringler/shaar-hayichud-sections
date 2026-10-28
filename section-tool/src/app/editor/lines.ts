import { Content, Line, TextNode, TextRun, isText, isTextNode } from '../models/text-node.model';
import { IdSource } from './ids';

/**
 * Line-level logic: splitting textarea text into lines, carrying line ids
 * across an edit, and snapping section splits to line boundaries. Pure.
 */

/** A textarea's text as line texts. '' is no lines; otherwise split on "\n" (or "\r\n"). */
export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r?\n/);
}

/** Every line id under `items`, in document order. */
export function collectLineIds(items: readonly Content[], into = new Set<string>()): Set<string> {
  for (const item of items) {
    if (isText(item)) item.lines.forEach((l) => into.add(l.id));
    else if (isTextNode(item)) collectLineIds(item.children, into);
  }
  return into;
}

/** Lines with fresh ids for `texts`. Each new id is added to `taken`. */
export function freshLines(texts: readonly string[], taken: Set<string>, ids: IdSource): Line[] {
  return texts.map((text) => {
    const id = ids.lineId(taken);
    taken.add(id);
    return { id, text };
  });
}

/** A run of fresh lines for plain text (e.g. a paste). */
export function freshRun(text: string, roots: readonly TextNode[], ids: IdSource): TextRun {
  return { lines: freshLines(splitLines(text), collectLineIds(roots), ids) };
}

/** Minimum similarity for an edited line to keep its id. */
export const SAME_LINE_SIMILARITY = 0.6;

/** Above this many old×new line pairs in one changed region, pair by position only. */
const MAX_ALIGN_CELLS = 40_000;

/**
 * Similarity of two lines in [0, 1]: the Dice coefficient of their character
 * bigrams, with the ends padded so one-character lines still compare.
 * Ignores surrounding whitespace.
 */
export function lineSimilarity(a: string, b: string): number {
  const x = a.trim();
  const y = b.trim();
  if (x === y) return 1;
  if (!x || !y) return 0;
  const grams = (s: string): Map<string, number> => {
    const padded = `\u0002${s}\u0003`;
    const m = new Map<string, number>();
    for (let i = 0; i < padded.length - 1; i++) {
      const g = padded.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(x);
  const gb = grams(y);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (x.length + 1 + (y.length + 1));
}

/**
 * How much of `part` appears in `whole`, in [0, 1]: the share of `part`'s
 * character bigrams (trimmed, unpadded) also found in `whole`. Lines too
 * short to have two bigrams count as 0, so they never look "absorbed".
 */
export function lineContainment(part: string, whole: string): number {
  const p = part.trim();
  const w = whole.trim();
  if (p.length < 3) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < w.length - 1; i++) {
    const g = w.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const g = p.slice(i, i + 2);
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(g, n - 1);
    }
  }
  return shared / (p.length - 1);
}

/** A new line holding at least this much of two or more vanished lines is a join. */
export const JOIN_CONTAINMENT = 0.8;

/** True when `text` absorbs most of the text of two or more of `sources`: a join. */
function isJoin(text: string, sources: readonly string[]): boolean {
  let absorbed = 0;
  for (const s of sources) {
    if (lineContainment(s, text) >= JOIN_CONTAINMENT && ++absorbed >= 2) return true;
  }
  return false;
}

/**
 * The lines for a textarea's new text, keeping ids of lines that are still
 * there. Rules, in order:
 * 1. Unchanged lines keep their id: a longest common subsequence of exact
 *    texts is matched first (so duplicates match in order).
 * 2. A still-unmatched new line whose text equals a still-unmatched old line
 *    anywhere takes its id (a line moved within the textarea).
 * 3. A still-unmatched new line whose text equals a retired line (one an
 *    earlier command removed from the document, see `retireLines`) takes
 *    its id, the most recently retired first: a line moved by cut and
 *    paste or drag and drop (two input events), or brought back by undo.
 * 4. In each changed region between the rule 1 matches, old and new lines
 *    are paired in order to maximize total similarity; a pair keeps the old
 *    id when its similarity is at least SAME_LINE_SIMILARITY (an edited
 *    line).
 * 5. A still-unmatched new line takes the id of the most similar retired
 *    line, if at least SAME_LINE_SIMILARITY (moved, then edited).
 * 6. Every other new line gets a fresh id; unmatched old ids disappear.
 *
 * Joins are a delete plus an insert: a new line that absorbs most of the
 * text of two or more unmatched lines (see JOIN_CONTAINMENT) never takes an
 * id by similarity (rules 4 and 5), so it gets a fresh id and the joined
 * lines' ids disappear.
 *
 * Fresh ids avoid `taken` (pass every line id in the document, the old ones
 * included) and are added to it. A retired line is only reused when its id
 * is not in `taken`.
 */
export function reconcileLines(
  old: readonly Line[],
  text: string,
  taken: Set<string>,
  ids: IdSource,
  retired: readonly Line[] = [],
): Line[] {
  const next = splitLines(text);
  const assigned: (string | null)[] = next.map(() => null);
  const used = new Set<number>(); // indices into old
  const regions: [number, number, number, number][] = [];

  const anchors = lcs(old.map((l) => l.text), next);
  let oi = 0;
  let ni = 0;
  for (const [ao, an] of [...anchors, [old.length, next.length] as const]) {
    if (ao > oi && an > ni) regions.push([oi, ao, ni, an]);
    if (ao < old.length) {
      assigned[an] = old[ao].id;
      used.add(ao);
    }
    oi = ao + 1;
    ni = an + 1;
  }

  // Moved lines: exact text match anywhere among the leftovers.
  for (let n = 0; n < next.length; n++) {
    if (assigned[n] !== null) continue;
    const o = old.findIndex((l, i) => !used.has(i) && l.text === next[n]);
    if (o >= 0) {
      assigned[n] = old[o].id;
      used.add(o);
    }
  }

  // Retired lines still free to come back, most recent first.
  const free = retired.filter((l) => !taken.has(l.id)).reverse();
  const claimed = new Set<string>();
  for (let n = 0; n < next.length; n++) {
    if (assigned[n] !== null) continue;
    const r = free.find((l) => !claimed.has(l.id) && l.text === next[n]);
    if (r) {
      assigned[n] = r.id;
      claimed.add(r.id);
    }
  }

  for (const [o0, o1, n0, n1] of regions) pairRegion(old, o0, o1, next, n0, n1, assigned, used);

  const vanished = [...old.filter((_, i) => !used.has(i)).map((l) => l.text), ...free.map((l) => l.text)];
  for (let n = 0; n < next.length; n++) {
    if (assigned[n] !== null || isJoin(next[n], vanished)) continue;
    let best: Line | null = null;
    let bestSim = SAME_LINE_SIMILARITY;
    for (const r of free) {
      if (claimed.has(r.id)) continue;
      const sim = lineSimilarity(r.text, next[n]);
      if (sim >= bestSim && (best === null || sim > bestSim)) {
        best = r;
        bestSim = sim;
      }
    }
    if (best) {
      assigned[n] = best.id;
      claimed.add(best.id);
    }
  }

  return next.map((t, n) => {
    let id = assigned[n];
    if (id === null) {
      id = ids.lineId(taken);
      taken.add(id);
    }
    return { id, text: t };
  });
}

/** Every line under `items`, in document order. */
export function collectLines(items: readonly Content[], into: Line[] = []): Line[] {
  for (const item of items) {
    if (isText(item)) into.push(...item.lines);
    else if (isTextNode(item)) collectLines(item.children, into);
  }
  return into;
}

/** How many retired lines the editor remembers. */
export const MAX_RETIRED = 500;

/**
 * The editor's retired lines after a command took the document from
 * `before` to `after`: non-blank lines whose ids left the document are
 * added (newest last), lines whose ids came back are dropped, and only the newest
 * MAX_RETIRED are kept. `reconcileLines` gives a retired id back to a line
 * that reappears, so ids survive changes that take more than one command.
 */
export function retireLines(
  before: readonly TextNode[],
  after: readonly TextNode[],
  retired: readonly Line[],
): Line[] {
  if (before === after) return retired as Line[];
  const now = collectLineIds(after);
  const gone = collectLines(before).filter((l) => !now.has(l.id) && l.text.trim() !== '');
  const goneIds = new Set(gone.map((l) => l.id));
  return [...retired.filter((l) => !now.has(l.id) && !goneIds.has(l.id)), ...gone].slice(-MAX_RETIRED);
}

/** Matching index pairs [oldIndex, newIndex] of a longest common subsequence. */
function lcs(a: readonly string[], b: readonly string[]): [number, number][] {
  // Trim the common prefix and suffix first: typical edits touch one line.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);

  const n = endA - start;
  const m = endB - start;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[start + i] === b[start + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      pairs.push([start + i, start + j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

/**
 * Pair the still-unmatched lines of old[o0..o1) and next[n0..n1) in order,
 * maximizing the summed similarity of pairs that reach the threshold. A new
 * line that joins two or more of the region's unmatched old lines is left
 * out. Large regions (a whole-text replace) fall back to pairing by position.
 */
function pairRegion(
  old: readonly Line[],
  o0: number,
  o1: number,
  next: readonly string[],
  n0: number,
  n1: number,
  assigned: (string | null)[],
  used: Set<number>,
): void {
  const os: number[] = [];
  for (let o = o0; o < o1; o++) if (!used.has(o)) os.push(o);
  const unmatched: number[] = [];
  for (let k = n0; k < n1; k++) if (assigned[k] === null) unmatched.push(k);
  const n = os.length;
  if (n === 0 || unmatched.length === 0) return;

  const keep = (o: number, k: number) => {
    assigned[k] = old[o].id;
    used.add(o);
  };

  if (n * unmatched.length > MAX_ALIGN_CELLS) {
    for (let k = 0; k < Math.min(n, unmatched.length); k++) {
      if (lineSimilarity(old[os[k]].text, next[unmatched[k]]) >= SAME_LINE_SIMILARITY) keep(os[k], unmatched[k]);
    }
    return;
  }

  const sources = os.map((o) => old[o].text);
  const ns = unmatched.filter((k) => !isJoin(next[k], sources));
  const m = ns.length;
  if (m === 0) return;

  const sim: number[][] = [];
  for (let i = 0; i < n; i++) {
    sim.push([]);
    for (let j = 0; j < m; j++) {
      const s = lineSimilarity(old[os[i]].text, next[ns[j]]);
      sim[i].push(s >= SAME_LINE_SIMILARITY ? s : 0);
    }
  }
  const best: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const take = sim[i][j] > 0 ? sim[i][j] + best[i + 1][j + 1] : 0;
      best[i][j] = Math.max(take, best[i + 1][j], best[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sim[i][j] > 0 && best[i][j] === sim[i][j] + best[i + 1][j + 1]) {
      keep(os[i], ns[j]);
      i++;
      j++;
    } else if (best[i + 1][j] >= best[i][j + 1]) i++;
    else j++;
  }
}

/**
 * Where a split at character `cursorPos` of a run's text falls, as a line
 * index: lines before it stay, lines from it on move. A split never cuts a
 * line:
 * - the cursor at the start of a line splits before that line;
 * - the cursor at the end of a line splits after it;
 * - the cursor inside a line splits before it (the line moves with the
 *   text after the cursor).
 * An empty line counts as "at its start". Positions past the end split after
 * the last line.
 */
export function splitLineIndex(lines: readonly Line[], cursorPos: number): number {
  let start = 0;
  for (let k = 0; k < lines.length; k++) {
    const end = start + lines[k].text.length;
    if (cursorPos <= start) return k;
    if (cursorPos === end) return k + 1;
    if (cursorPos < end) return k;
    start = end + 1; // skip the "\n"
  }
  return lines.length;
}

/** Split a run at a cursor position, snapped to a line boundary. */
export function splitRun(run: TextRun, cursorPos: number): [TextRun, TextRun] {
  const k = splitLineIndex(run.lines, cursorPos);
  return [{ lines: run.lines.slice(0, k) }, { lines: run.lines.slice(k) }];
}
