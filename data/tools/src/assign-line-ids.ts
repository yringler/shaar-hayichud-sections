/**
 * Gives every line in a chapter a stable id. Idempotent: lines that already
 * have an id keep it; only text without one gets a new id.
 *
 * Handles the pre-line-id shape too, where a leaf's text was one string with
 * lines joined by "\n": each string child becomes one Line per non-blank line,
 * in place. Line text is otherwise kept byte-for-byte (no trimming).
 */
import { isLine, type Chapter, type Line, type TextNode } from './chapter.js';
import { isLineId, newLineId, type RandomBytes } from './line-id.js';

/** Legacy input: children may still hold plain strings or id-less lines. */
export type LegacyChild = string | { id?: string; text: string } | LegacyNode;
export interface LegacyNode {
  label?: string;
  children: LegacyChild[];
  translation?: string;
}

const splitLines = (text: string) => text.split('\n').filter((l) => l.trim() !== '');

/** Every valid line id already present, so new ids can avoid them. */
export function collectLineIds(chapter: LegacyNode[], into = new Set<string>()): Set<string> {
  const visit = (node: LegacyNode) => {
    for (const c of node.children) {
      if (typeof c === 'string') continue;
      if ('children' in c) visit(c);
      else if (isLineId(c.id)) into.add(c.id);
    }
  };
  chapter.forEach(visit);
  return into;
}

/**
 * Returns the chapter with ids on every line and how many were assigned.
 * `taken` must already hold every id in the corpus (see collectLineIds); new
 * ids are added to it. A line object whose text contains "\n" is split; its
 * first part keeps the id.
 */
export function assignLineIds(
  chapter: LegacyNode[],
  taken: Set<string>,
  random?: RandomBytes,
): { chapter: Chapter; assigned: number } {
  let assigned = 0;
  const fresh = () => {
    assigned++;
    return random ? newLineId(taken, random) : newLineId(taken);
  };
  const visit = (node: LegacyNode): TextNode => {
    const children: (TextNode | Line)[] = [];
    for (const c of node.children) {
      if (typeof c === 'string') {
        for (const text of splitLines(c)) children.push({ id: fresh(), text });
      } else if (!('children' in c)) {
        splitLines(c.text).forEach((text, i) =>
          children.push({ id: i === 0 && isLineId(c.id) ? c.id : fresh(), text }),
        );
      } else {
        children.push(visit(c));
      }
    }
    // Rebuild with the same key order; anything else on the node is kept.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = k === 'children' ? children : v;
    return out as unknown as TextNode;
  };
  return { chapter: chapter.map(visit), assigned };
}

/** True when every child is a Line with a valid id or a node (recursively). */
export function hasAllLineIds(chapter: LegacyNode[]): boolean {
  const ok = (node: LegacyNode): boolean =>
    node.children.every((c) =>
      typeof c === 'string' ? false : 'children' in c ? ok(c) : isLine(c) && isLineId(c.id) && !c.text.includes('\n'),
    );
  return chapter.every(ok);
}

/** Serialises like the file it came from (tab or 2-space indent, trailing newline or not). */
export function formatLike(original: string, data: unknown): string {
  const indent = /^\t/m.test(original) ? '\t' : 2;
  return JSON.stringify(data, null, indent) + (original.endsWith('\n') ? '\n' : '');
}
