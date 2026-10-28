import { Content, TextNode, isText } from '../models/text-node.model';
import { IdSource } from './ids';

/**
 * Load and save for chapter JSON (`data/chapters/chapter_NN.json`, a
 * `TextNode[]` without ids). `parseDocument` followed by `serializeDocument`
 * reproduces every chapter file's content; see the golden test in
 * serialization.spec.ts for the exact formatting contract.
 */

/** Parse chapter JSON into editor nodes, giving every node a fresh id. */
export function parseDocument(json: string, ids: IdSource): TextNode[] {
  const trimmed = json.trim();
  if (!trimmed) return [];
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of nodes');
  }
  return parsed.map((raw) => hydrateNode(raw as Record<string, unknown>, ids));
}

function hydrateNode(raw: Record<string, unknown>, ids: IdSource): TextNode {
  const node: TextNode = {
    id: ids.nodeId(),
    label: (raw['label'] as string) || '',
    children: [],
  };

  if (raw['translation'] && typeof raw['translation'] === 'string') {
    node.translation = raw['translation'];
  }

  const rawChildren = raw['children'];
  if (Array.isArray(rawChildren)) {
    for (const child of rawChildren) {
      if (typeof child === 'string') {
        if (child) node.children.push(child);
      } else if (child && typeof child === 'object') {
        node.children.push(hydrateNode(child as Record<string, unknown>, ids));
      }
    }
  }

  // Ensure at least one child (empty string) so the node renders a textarea.
  if (node.children.length === 0) {
    node.children.push('');
  }

  return node;
}

/**
 * The JSON text the editor saves: 2-space indented, keys in the order
 * label, children, translation, no trailing newline. Returns '' for the
 * blank starting document (one unlabeled node with only whitespace text) so
 * the user can paste without clearing first.
 */
export function serializeDocument(roots: readonly TextNode[]): string {
  if (roots.length === 1 && !roots[0].label) {
    const onlyChild = roots[0].children.length === 1 && roots[0].children[0];
    if (typeof onlyChild === 'string' && !onlyChild.trim()) {
      return '';
    }
  }
  return JSON.stringify(toJson(roots), null, 2);
}

/**
 * Convert editor content to its persisted shape. Rules (all existing
 * behavior, locked by tests):
 * - each string is trimmed; empty strings are dropped;
 * - a node is dropped if its children array is empty, or if it has no
 *   non-blank text, no child nodes and no translation (its label is lost);
 * - `label` is written only when non-empty, `translation` only when
 *   non-blank (trimmed).
 */
export function toJson(nodes: readonly Content[]): unknown[] {
  const result: unknown[] = [];

  for (const item of nodes) {
    if (isText(item)) {
      const trimmed = item.trim();
      if (trimmed) result.push(trimmed);
      continue;
    }

    const node = item;
    if (node.children.length === 0) continue;

    const jsonNode: Record<string, unknown> = {};
    if (node.label) jsonNode['label'] = node.label;
    jsonNode['children'] = toJson(node.children);
    if (node.translation?.trim()) jsonNode['translation'] = node.translation.trim();

    const allText = node.children.filter(isText).map((s) => s.trim()).join('');
    const hasChildNodes = node.children.some((c) => !isText(c));
    if (!allText && !hasChildNodes && !jsonNode['translation']) continue;

    result.push(jsonNode);
  }

  return result;
}
