import { Content, Line, TextNode, isText, runText } from '../models/text-node.model';
import { IdSource } from './ids';
import { isLineId } from './line-id';
import { freshLines } from './lines';

/**
 * Load and save for chapter JSON (`data/chapters/chapter_NN.json`): a
 * `TextNode[]` whose `children` mix sections and lines `{id, text}`. Sections
 * have no persisted id; line ids are kept exactly. `parseDocument` followed
 * by `serializeDocument` in the file's own format reproduces every chapter
 * file byte for byte; see the golden test in serialization.spec.ts.
 */

/** How the JSON text is laid out: indent unit and whether it ends in "\n". */
export interface JsonFormat {
  indent: '\t' | number;
  trailingNewline: boolean;
}

/** The format for documents that did not come from a file. */
export const DEFAULT_FORMAT: JsonFormat = { indent: 2, trailingNewline: false };

/** The format of a chapter file: tab or 2-space indent, trailing newline or not. */
export function detectFormat(json: string): JsonFormat {
  return {
    indent: /^\t/m.test(json) ? '\t' : 2,
    trailingNewline: json.endsWith('\n'),
  };
}

/**
 * Parse chapter JSON into editor nodes. Every section gets a fresh in-memory
 * id; consecutive lines become one text run. A line keeps its id when it is
 * a valid line id not already used earlier in the document; otherwise it
 * (and any legacy plain-string text) gets a fresh one. Text containing "\n"
 * is split into lines, the first keeping the id.
 */
export function parseDocument(json: string, ids: IdSource): TextNode[] {
  const trimmed = json.trim();
  if (!trimmed) return [];
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of nodes');
  }
  const ctx: ParseContext = { ids, seen: new Set(), pending: [] };
  const nodes = parsed.map((raw) => hydrateNode(raw as Record<string, unknown>, ctx));
  // Fresh ids are handed out after every kept id is known, so they never clash.
  for (const fill of ctx.pending) fill();
  return nodes;
}

interface ParseContext {
  ids: IdSource;
  /** Ids kept so far. */
  seen: Set<string>;
  /** Lines waiting for a fresh id. */
  pending: (() => void)[];
}

function hydrateNode(raw: Record<string, unknown>, ctx: ParseContext): TextNode {
  const node: TextNode = {
    id: ctx.ids.nodeId(),
    label: (raw['label'] as string) || '',
    children: [],
  };

  if (raw['translation'] && typeof raw['translation'] === 'string') {
    node.translation = raw['translation'];
  }

  const addLine = (line: Line) => {
    const last = node.children[node.children.length - 1];
    if (isText(last)) last.lines.push(line);
    else node.children.push({ lines: [line] });
  };

  const addText = (text: string, id: unknown) => {
    const parts = text.split('\n').filter((t) => t.trim() !== '');
    parts.forEach((part, i) => {
      if (i === 0 && isLineId(id) && !ctx.seen.has(id)) {
        ctx.seen.add(id);
        addLine({ id, text: part });
      } else {
        const line: Line = { id: '', text: part };
        ctx.pending.push(() => {
          line.id = freshLines([''], ctx.seen, ctx.ids)[0].id;
        });
        addLine(line);
      }
    });
  };

  const rawChildren = raw['children'];
  if (Array.isArray(rawChildren)) {
    for (const child of rawChildren) {
      if (typeof child === 'string') {
        addText(child, undefined); // legacy shape: one string of "\n"-joined lines
      } else if (child && typeof child === 'object') {
        const obj = child as Record<string, unknown>;
        if (Array.isArray(obj['children'])) {
          node.children.push(hydrateNode(obj, ctx));
        } else if (typeof obj['text'] === 'string') {
          addText(obj['text'], obj['id']);
        }
      }
    }
  }

  // Ensure at least one child (an empty run) so the node renders a textarea.
  if (node.children.length === 0) {
    node.children.push({ lines: [] });
  }

  return node;
}

/**
 * The JSON text the editor saves: keys in the order label, children,
 * translation (and id, text for lines), laid out in `format` (2-space
 * indent, no trailing newline by default). Returns '' for the blank starting
 * document (one unlabeled node with only blank text) so the user can paste
 * without clearing first.
 */
export function serializeDocument(roots: readonly TextNode[], format: JsonFormat = DEFAULT_FORMAT): string {
  if (roots.length === 1 && !roots[0].label) {
    const onlyChild = roots[0].children.length === 1 ? roots[0].children[0] : undefined;
    if (isText(onlyChild) && !runText(onlyChild).trim()) {
      return '';
    }
  }
  return JSON.stringify(toJson(roots), null, format.indent) + (format.trailingNewline ? '\n' : '');
}

/**
 * Convert editor content to its persisted shape. Rules (locked by tests):
 * - each run is written as its lines `{id, text}`, each text trimmed, blank
 *   lines dropped;
 * - a node is dropped if its children array is empty, or if it has no
 *   non-blank text, no child nodes and no translation (its label is lost);
 * - `label` is written only when non-empty, `translation` only when
 *   non-blank (trimmed).
 */
export function toJson(nodes: readonly Content[]): unknown[] {
  const result: unknown[] = [];

  for (const item of nodes) {
    if (isText(item)) {
      for (const line of item.lines) {
        const text = line.text.trim();
        if (text) result.push({ id: line.id, text });
      }
      continue;
    }

    const node = item;
    if (node.children.length === 0) continue;

    const jsonNode: Record<string, unknown> = {};
    if (node.label) jsonNode['label'] = node.label;
    jsonNode['children'] = toJson(node.children);
    if (node.translation?.trim()) jsonNode['translation'] = node.translation.trim();

    const hasText = node.children.some((c) => isText(c) && c.lines.some((l) => l.text.trim()));
    const hasChildNodes = node.children.some((c) => !isText(c));
    if (!hasText && !hasChildNodes && !jsonNode['translation']) continue;

    result.push(jsonNode);
  }

  return result;
}
