import { Content, TextNode, isText, isTextNode } from '../models/text-node.model';
import { IdSource } from './ids';
import { parseDocument } from './serialization';
import {
  createNode,
  findPath,
  mergeAdjacentText,
  nodeAt,
  replaceChildren,
  replaceNode,
  siblingsAt,
  updateNode,
} from './tree';

/**
 * Every change to the document is one of these commands. `applyCommand` is
 * a pure function from (document, command) to (new document, focus); it never
 * mutates the document it is given.
 *
 * `contentIndex` indexes `node.children`: it names which text entry (and so
 * which textarea) of the node the command came from.
 */
export type EditorCommand =
  | { type: 'updateText'; nodeId: string; contentIndex: number; text: string }
  | { type: 'updateLabel'; nodeId: string; label: string }
  | { type: 'updateTranslation'; nodeId: string; translation: string }
  /** Enter: text after the cursor becomes a new child of this node. */
  | { type: 'splitToChild'; nodeId: string; contentIndex: number; cursorPos: number }
  /** Tab: text after the cursor becomes a new sibling after this node. */
  | { type: 'splitToSibling'; nodeId: string; contentIndex: number; cursorPos: number }
  /** Alt+Enter: text after the cursor, and everything after it in the parent, moves up one level. */
  | { type: 'splitToParentSibling'; nodeId: string; contentIndex: number; cursorPos: number }
  /** Shift+Enter: this node's content is spliced into its parent in place. */
  | { type: 'mergeWithParent'; nodeId: string }
  /** Shift+Tab: this node's content is appended to the previous sibling node. */
  | { type: 'mergeWithPreviousSibling'; nodeId: string }
  | { type: 'deleteNode'; nodeId: string }
  | { type: 'clearAll' }
  /** Replace the document with one node holding the pasted plain text. */
  | { type: 'loadText'; text: string }
  /** Replace the document with parsed chapter JSON. Throws on invalid JSON. */
  | { type: 'loadJson'; json: string };

/**
 * Where the caret should go after a command: the textarea for
 * `node.children[contentIndex]` of node `nodeId`, at character `offset`.
 * If that entry is not text, the UI falls back to the node's first textarea.
 */
export interface Focus {
  nodeId: string;
  contentIndex: number;
  offset: number;
}

export interface CommandResult {
  roots: TextNode[];
  /** null: leave focus where it is. */
  focus: Focus | null;
}

export function applyCommand(roots: TextNode[], cmd: EditorCommand, ids: IdSource): CommandResult {
  switch (cmd.type) {
    case 'updateText':
      return unfocused(updateText(roots, cmd.nodeId, cmd.contentIndex, cmd.text));
    case 'updateLabel':
      return unfocused(updateNode(roots, cmd.nodeId, (n) => ({ ...n, label: cmd.label })));
    case 'updateTranslation':
      return unfocused(updateNode(roots, cmd.nodeId, (n) => ({ ...n, translation: cmd.translation })));
    case 'splitToChild':
      return splitToChild(roots, cmd.nodeId, cmd.contentIndex, cmd.cursorPos, ids);
    case 'splitToSibling':
      return splitToSibling(roots, cmd.nodeId, cmd.contentIndex, cmd.cursorPos, ids);
    case 'splitToParentSibling':
      return splitToParentSibling(roots, cmd.nodeId, cmd.contentIndex, cmd.cursorPos, ids);
    case 'mergeWithParent':
      return mergeWithParent(roots, cmd.nodeId);
    case 'mergeWithPreviousSibling':
      return mergeWithPreviousSibling(roots, cmd.nodeId);
    case 'deleteNode':
      return unfocused(deleteNode(roots, cmd.nodeId, ids));
    case 'clearAll':
      return unfocused([createNode(ids.nodeId())]);
    case 'loadText':
      return unfocused([createNode(ids.nodeId(), cmd.text.trim())]);
    case 'loadJson': {
      const nodes = parseDocument(cmd.json, ids);
      return unfocused(nodes.length > 0 ? nodes : [createNode(ids.nodeId())]);
    }
  }
}

function unfocused(roots: TextNode[]): CommandResult {
  return { roots, focus: null };
}

function focusStart(nodeId: string): Focus {
  return { nodeId, contentIndex: 0, offset: 0 };
}

function updateText(roots: TextNode[], nodeId: string, contentIndex: number, text: string): TextNode[] {
  return updateNode(roots, nodeId, (node) => {
    if (contentIndex < node.children.length && isText(node.children[contentIndex])) {
      const children = [...node.children];
      children[contentIndex] = text;
      return { ...node, children };
    }
    if (contentIndex === node.children.length) {
      return { ...node, children: [...node.children, text] };
    }
    return node; // entry is a child node: ignore
  });
}

function splitToChild(
  roots: TextNode[],
  nodeId: string,
  contentIndex: number,
  cursorPos: number,
  ids: IdSource,
): CommandResult {
  const path = findPath(roots, nodeId);
  if (!path) return unfocused(roots);
  const node = nodeAt(roots, path);
  const item = node.children[contentIndex];
  const children = [...node.children];
  let newChild: TextNode;

  if (isText(item)) {
    // Keep the text before the cursor even if empty, to keep a textarea here.
    newChild = createNode(ids.nodeId(), item.substring(cursorPos));
    children.splice(contentIndex, 1, item.substring(0, cursorPos), newChild);
  } else {
    // Cursor is on a child node: insert an empty child after it.
    newChild = createNode(ids.nodeId());
    children.splice(contentIndex + 1, 0, newChild);
  }

  return {
    roots: replaceChildren(roots, path, children),
    focus: focusStart(newChild.id),
  };
}

function splitToSibling(
  roots: TextNode[],
  nodeId: string,
  contentIndex: number,
  cursorPos: number,
  ids: IdSource,
): CommandResult {
  const path = findPath(roots, nodeId);
  if (!path) return unfocused(roots);
  const node = nodeAt(roots, path);
  const item = node.children[contentIndex];
  if (!isText(item)) return unfocused(roots);

  const nodeChildren = [...node.children];
  nodeChildren[contentIndex] = item.substring(0, cursorPos);
  const sibling = createNode(ids.nodeId(), item.substring(cursorPos));

  const index = path[path.length - 1];
  const siblings = [...siblingsAt(roots, path)];
  siblings.splice(index, 1, { ...node, children: nodeChildren }, sibling);

  return {
    roots: replaceChildren(roots, path.slice(0, -1), siblings),
    focus: focusStart(sibling.id),
  };
}

function splitToParentSibling(
  roots: TextNode[],
  nodeId: string,
  contentIndex: number,
  cursorPos: number,
  ids: IdSource,
): CommandResult {
  const path = findPath(roots, nodeId);
  if (!path || path.length < 2) return unfocused(roots); // root level: nothing to promote above
  const node = nodeAt(roots, path);
  const item = node.children[contentIndex];
  if (!isText(item)) return unfocused(roots);

  const parentPath = path.slice(0, -1);
  const parent = nodeAt(roots, parentPath);
  const nodeIndex = path[path.length - 1];
  const parentIndex = parentPath[parentPath.length - 1];

  // Before the cursor stays; everything after it in this node and in the
  // parent moves into the promoted node.
  const keptNode: TextNode = {
    ...node,
    children: [...node.children.slice(0, contentIndex), item.substring(0, cursorPos)],
  };
  const keptParent: TextNode = {
    ...parent,
    children: [...parent.children.slice(0, nodeIndex), keptNode],
  };
  const promoted: TextNode = {
    id: ids.nodeId(),
    label: '',
    children: [
      item.substring(cursorPos),
      ...node.children.slice(contentIndex + 1),
      ...parent.children.slice(nodeIndex + 1),
    ],
  };

  const grandparentChildren = [...siblingsAt(roots, parentPath)];
  grandparentChildren.splice(parentIndex, 1, keptParent, promoted);

  return {
    roots: replaceChildren(roots, parentPath.slice(0, -1), grandparentChildren),
    focus: focusStart(promoted.id),
  };
}

function mergeTranslations(into: string | undefined, from: string | undefined): string | undefined {
  if (!from?.trim()) return into;
  return into?.trim() ? into.trim() + '\n' + from.trim() : from.trim();
}

/** Copy `translation` onto `node` only if defined, so absent stays absent. */
function withTranslation(node: TextNode, translation: string | undefined): TextNode {
  return translation === undefined ? node : { ...node, translation };
}

function mergeWithParent(roots: TextNode[], nodeId: string): CommandResult {
  const path = findPath(roots, nodeId);
  if (!path || path.length < 2) return unfocused(roots);
  const node = nodeAt(roots, path);
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(roots, parentPath);
  const nodeIndex = path[path.length - 1];

  const spliced = [...parent.children];
  spliced.splice(nodeIndex, 1, ...node.children);
  const { items, position } = mergeAdjacentText(spliced, nodeIndex);

  const merged = withTranslation(
    { ...parent, children: items },
    mergeTranslations(parent.translation, node.translation),
  );

  return {
    roots: replaceNode(roots, parentPath, merged),
    focus: { nodeId: parent.id, contentIndex: position.index, offset: position.offset },
  };
}

function mergeWithPreviousSibling(roots: TextNode[], nodeId: string): CommandResult {
  const path = findPath(roots, nodeId);
  if (!path) return unfocused(roots);
  const siblings = siblingsAt(roots, path);
  const nodeIndex = path[path.length - 1];

  let prevIndex = nodeIndex - 1;
  while (prevIndex >= 0 && !isTextNode(siblings[prevIndex])) prevIndex--;
  if (prevIndex < 0) return unfocused(roots);

  const prev = siblings[prevIndex] as TextNode;
  const node = siblings[nodeIndex] as TextNode;

  // NOTE: text entries between `prev` and `node` are removed (existing behavior).
  const { items, position } = mergeAdjacentText([...prev.children, ...node.children], prev.children.length);
  const merged = withTranslation(
    { ...prev, children: items },
    mergeTranslations(prev.translation, node.translation),
  );

  const newSiblings: Content[] = [...siblings];
  newSiblings.splice(prevIndex, nodeIndex - prevIndex + 1, merged);

  return {
    roots: replaceChildren(roots, path.slice(0, -1), newSiblings),
    focus: { nodeId: prev.id, contentIndex: position.index, offset: position.offset },
  };
}

function deleteNode(roots: TextNode[], nodeId: string, ids: IdSource): TextNode[] {
  const path = findPath(roots, nodeId);
  let result = roots;
  if (path) {
    const siblings = [...siblingsAt(roots, path)];
    siblings.splice(path[path.length - 1], 1);
    result = replaceChildren(roots, path.slice(0, -1), siblings);
  }
  // The document always keeps at least one root node.
  return result.length > 0 ? result : [createNode(ids.nodeId())];
}

