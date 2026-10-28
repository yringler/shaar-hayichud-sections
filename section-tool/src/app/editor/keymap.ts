import { EditorCommand } from './commands';

/** The parts of a KeyboardEvent the keymap looks at. */
export interface KeyPress {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
}

/** Where the key was pressed: a text entry of a node, and the caret in it. */
export interface KeyContext {
  nodeId: string;
  contentIndex: number;
  cursorPos: number;
  /** In translation mode, Enter in the Hebrew text inserts a newline instead. */
  translationMode: boolean;
}

/**
 * Map a key press in a node's Hebrew textarea to an editor command. Returns
 * null when the key should keep its default browser behavior. Any non-null
 * result means the caller must preventDefault().
 */
export function keyToCommand(press: KeyPress, ctx: KeyContext): EditorCommand | null {
  const { nodeId, contentIndex, cursorPos } = ctx;
  const at = { nodeId, contentIndex, cursorPos };

  if (press.key === 'Enter') {
    if (ctx.translationMode) return null;
    if (press.altKey) return { type: 'splitToParentSibling', ...at };
    if (press.shiftKey) return { type: 'mergeWithParent', nodeId };
    return { type: 'splitToChild', ...at };
  }
  if (press.key === 'Tab') {
    if (press.shiftKey) return { type: 'mergeWithPreviousSibling', nodeId };
    return { type: 'splitToSibling', ...at };
  }
  return null;
}
