import { Content, TextNode, isTextNode } from '../models/text-node.model';

/**
 * Immutable tree helpers. Nothing here mutates its arguments: an update
 * copies only the arrays and nodes on the path from the root to the change
 * (structural sharing), so the previous tree stays intact and every changed
 * node gets a new object reference.
 */

/** Position of a node: child indices from the root array down to the node. */
export type Path = readonly number[];

export function createNode(id: string, text = '', label = ''): TextNode {
  // Always include a text entry so the node renders an editable textarea.
  return { id, label, children: [text] };
}

export function findPath(nodes: readonly Content[], id: string): Path | null {
  for (let i = 0; i < nodes.length; i++) {
    const item = nodes[i];
    if (!isTextNode(item)) continue;
    if (item.id === id) return [i];
    const sub = findPath(item.children, id);
    if (sub) return [i, ...sub];
  }
  return null;
}

export function nodeAt(roots: readonly TextNode[], path: Path): TextNode {
  let items: readonly Content[] = roots;
  let node: TextNode | undefined;
  for (const index of path) {
    const item = items[index];
    if (!isTextNode(item)) throw new Error(`No node at path [${path.join(',')}]`);
    node = item;
    items = item.children;
  }
  if (!node) throw new Error('Empty path');
  return node;
}

/** The content array holding the node at `path` (the root array for depth 1). */
export function siblingsAt(roots: readonly TextNode[], path: Path): readonly Content[] {
  return path.length === 1 ? roots : nodeAt(roots, path.slice(0, -1)).children;
}

/**
 * Replace the content array at `parentPath` (`[]` means the root array) and
 * copy every ancestor. At the root level, `children` must hold only nodes.
 */
export function replaceChildren(
  roots: readonly TextNode[],
  parentPath: Path,
  children: Content[],
): TextNode[] {
  if (parentPath.length === 0) return children as TextNode[];
  const parent = nodeAt(roots, parentPath);
  return replaceNode(roots, parentPath, { ...parent, children });
}

/** Replace the node at `path` with `replacement`, copying every ancestor. */
export function replaceNode(roots: readonly TextNode[], path: Path, replacement: TextNode): TextNode[] {
  const parentPath = path.slice(0, -1);
  const siblings = [...siblingsAt(roots, path)];
  siblings[path[path.length - 1]] = replacement;
  return replaceChildren(roots, parentPath, siblings);
}

/** Apply `fn` to the node with `id`. Returns `roots` unchanged if not found. */
export function updateNode(
  roots: readonly TextNode[],
  id: string,
  fn: (node: TextNode) => TextNode,
): TextNode[] {
  const path = findPath(roots, id);
  if (!path) return roots as TextNode[];
  return replaceNode(roots, path, fn(nodeAt(roots, path)));
}

/** Where an entry of the input ended up after `mergeAdjacentText`. */
export interface MergedPosition {
  index: number;
  /** Characters of earlier text glued in front of the tracked entry. */
  offset: number;
}

/**
 * Join runs of adjacent strings into one string (with no separator) and
 * report where the entry at `track` ended up. If `track` is past the end,
 * the position is the end of the last entry.
 */
export function mergeAdjacentText(
  items: readonly Content[],
  track: number,
): { items: Content[]; position: MergedPosition } {
  const out: Content[] = [];
  let position: MergedPosition | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const last = out[out.length - 1];
    if (typeof item === 'string' && typeof last === 'string') {
      if (i === track) position = { index: out.length - 1, offset: last.length };
      out[out.length - 1] = last + item;
    } else {
      if (i === track) position = { index: out.length, offset: 0 };
      out.push(item);
    }
  }
  if (!position) {
    const last = out[out.length - 1];
    position = { index: Math.max(out.length - 1, 0), offset: typeof last === 'string' ? last.length : 0 };
  }
  return { items: out, position };
}
