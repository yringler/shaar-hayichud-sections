import { describe, it, expect } from 'vitest';
import { KeyContext, keyToCommand } from './keymap';

const ctx: KeyContext = { nodeId: 'n', contentIndex: 2, cursorPos: 7, translationMode: false };
const at = { nodeId: 'n', contentIndex: 2, cursorPos: 7 };
const press = (key: string, mods: { alt?: boolean; shift?: boolean } = {}) => ({
  key,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe('keyToCommand', () => {
  it.each([
    ['Enter', {}, { type: 'splitToChild', ...at }],
    ['Enter', { alt: true }, { type: 'splitToParentSibling', ...at }],
    ['Enter', { alt: true, shift: true }, { type: 'splitToParentSibling', ...at }],
    ['Enter', { shift: true }, { type: 'mergeWithParent', nodeId: 'n' }],
    ['Tab', {}, { type: 'splitToSibling', ...at }],
    ['Tab', { alt: true }, { type: 'splitToSibling', ...at }],
    ['Tab', { shift: true }, { type: 'mergeWithPreviousSibling', nodeId: 'n' }],
  ])('%s %o maps to %o', (key, mods, expected) => {
    expect(keyToCommand(press(key, mods), ctx)).toEqual(expected);
  });

  it('leaves other keys alone', () => {
    expect(keyToCommand(press('a'), ctx)).toBeNull();
    expect(keyToCommand(press('Backspace', { shift: true }), ctx)).toBeNull();
  });

  describe('in translation mode', () => {
    const tctx = { ...ctx, translationMode: true };

    it('leaves Enter (with any modifier) as a newline', () => {
      expect(keyToCommand(press('Enter'), tctx)).toBeNull();
      expect(keyToCommand(press('Enter', { alt: true }), tctx)).toBeNull();
      expect(keyToCommand(press('Enter', { shift: true }), tctx)).toBeNull();
    });

    it('still maps Tab and Shift+Tab', () => {
      expect(keyToCommand(press('Tab'), tctx)).toEqual({ type: 'splitToSibling', ...at });
      expect(keyToCommand(press('Tab', { shift: true }), tctx)).toEqual({ type: 'mergeWithPreviousSibling', nodeId: 'n' });
    });
  });
});
