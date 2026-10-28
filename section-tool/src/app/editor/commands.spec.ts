import { describe, it, expect } from 'vitest';
import { TextNode } from '../models/text-node.model';
import { CommandResult, EditorCommand, applyCommand } from './commands';
import { deepFreeze, node, nodeWith, sequentialIds } from './testing';

/**
 * Runs a command on a frozen tree, so any in-place mutation throws. New ids
 * come out as new1, new2, ...
 */
function run(roots: TextNode[], cmd: EditorCommand): CommandResult {
  return applyCommand(deepFreeze(roots), cmd, sequentialIds());
}

describe('applyCommand', () => {
  describe('immutability', () => {
    it('copies only the path to the change and shares everything else', () => {
      const untouched = node('u', 'keep');
      const sibling = node('s', 'keep too');
      const target = node('t', 'old');
      const roots = [node('r', 'root text', untouched, node('p', target, sibling))];

      const { roots: next } = run(roots, { type: 'updateText', nodeId: 't', contentIndex: 0, text: 'new' });

      expect(next).not.toBe(roots);
      expect(next[0]).not.toBe(roots[0]);
      expect(next[0].children[1]).toBe(untouched);
      const p = next[0].children[2] as TextNode;
      expect(p.children[0]).toEqual(node('t', 'new'));
      expect(p.children[1]).toBe(sibling);
      expect(roots[0]).toEqual(node('r', 'root text', untouched, node('p', node('t', 'old'), sibling)));
    });
  });

  describe('updateText', () => {
    it('replaces the text entry at contentIndex', () => {
      const { roots, focus } = run([node('a', 'x', node('b', 'y'), 'z')], {
        type: 'updateText', nodeId: 'a', contentIndex: 2, text: 'Z',
      });
      expect(roots).toEqual([node('a', 'x', node('b', 'y'), 'Z')]);
      expect(focus).toBeNull();
    });

    it('updates a nested node', () => {
      const { roots } = run([node('a', node('b', 'old'))], {
        type: 'updateText', nodeId: 'b', contentIndex: 0, text: 'new',
      });
      expect(roots).toEqual([node('a', node('b', 'new'))]);
    });

    it('appends a text entry when contentIndex is one past the end', () => {
      const { roots } = run([node('a', 'x', node('b', 'y'))], {
        type: 'updateText', nodeId: 'a', contentIndex: 2, text: 'tail',
      });
      expect(roots).toEqual([node('a', 'x', node('b', 'y'), 'tail')]);
    });

    it('ignores an index that points at a child node', () => {
      const before = [node('a', 'x', node('b', 'y'))];
      const { roots } = run(before, { type: 'updateText', nodeId: 'a', contentIndex: 1, text: '!' });
      expect(roots).toEqual([node('a', 'x', node('b', 'y'))]);
    });

    it('ignores an index further past the end', () => {
      const { roots } = run([node('a', 'x')], { type: 'updateText', nodeId: 'a', contentIndex: 5, text: '!' });
      expect(roots).toEqual([node('a', 'x')]);
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', 'x')];
      expect(run(before, { type: 'updateText', nodeId: '?', contentIndex: 0, text: '!' }).roots).toBe(before);
    });
  });

  describe('updateLabel', () => {
    it('sets the label of a nested node', () => {
      const { roots, focus } = run([node('a', node('b', 'x'))], { type: 'updateLabel', nodeId: 'b', label: 'L' });
      expect(roots).toEqual([node('a', nodeWith('b', { label: 'L' }, 'x'))]);
      expect(focus).toBeNull();
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', 'x')];
      expect(run(before, { type: 'updateLabel', nodeId: '?', label: 'L' }).roots).toBe(before);
    });
  });

  describe('updateTranslation', () => {
    it('sets the translation of a root and a nested node', () => {
      let roots = run([node('a', 'x', node('b', 'y'))], { type: 'updateTranslation', nodeId: 'a', translation: 'A' }).roots;
      roots = run(roots, { type: 'updateTranslation', nodeId: 'b', translation: 'B' }).roots;
      expect(roots).toEqual([nodeWith('a', { translation: 'A' }, 'x', nodeWith('b', { translation: 'B' }, 'y'))]);
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', 'x')];
      expect(run(before, { type: 'updateTranslation', nodeId: '?', translation: 'T' }).roots).toBe(before);
    });
  });

  describe('splitToChild', () => {
    const split = (roots: TextNode[], contentIndex: number, cursorPos: number, nodeId = 'a') =>
      run(roots, { type: 'splitToChild', nodeId, contentIndex, cursorPos });

    it('moves the text after the cursor into a new child and focuses its start', () => {
      const { roots, focus } = split([node('a', 'Hello World')], 0, 5);
      expect(roots).toEqual([node('a', 'Hello', node('new1', ' World'))]);
      expect(focus).toEqual({ nodeId: 'new1', contentIndex: 0, offset: 0 });
    });

    it('keeps an empty text entry when splitting at the start', () => {
      expect(split([node('a', 'Hello')], 0, 0).roots).toEqual([node('a', '', node('new1', 'Hello'))]);
    });

    it('creates a child with empty text when splitting at the end', () => {
      expect(split([node('a', 'Hello')], 0, 5).roots).toEqual([node('a', 'Hello', node('new1', ''))]);
    });

    it('splits a later text entry and keeps the rest in place', () => {
      const { roots } = split([node('a', 'one', node('b', 'two'), 'three four')], 2, 5);
      expect(roots).toEqual([node('a', 'one', node('b', 'two'), 'three', node('new1', ' four'))]);
    });

    it('inserts an empty child after a child node when contentIndex points at one', () => {
      const { roots, focus } = split([node('a', 'x', node('b', 'y'), 'z')], 1, 0);
      expect(roots).toEqual([node('a', 'x', node('b', 'y'), node('new1', ''), 'z')]);
      expect(focus?.nodeId).toBe('new1');
    });

    it('keeps the translation on the original node only', () => {
      const { roots } = split([nodeWith('a', { translation: 'T' }, 'Hello World')], 0, 5);
      expect(roots).toEqual([nodeWith('a', { translation: 'T' }, 'Hello', node('new1', ' World'))]);
    });

    it('splits a nested node', () => {
      expect(split([node('a', node('b', 'xy'))], 0, 1, 'b').roots).toEqual([
        node('a', node('b', 'x', node('new1', 'y'))),
      ]);
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', 'x')];
      expect(split(before, 0, 0, '?')).toEqual({ roots: before, focus: null });
    });
  });

  describe('splitToSibling', () => {
    const split = (roots: TextNode[], nodeId: string, contentIndex: number, cursorPos: number) =>
      run(roots, { type: 'splitToSibling', nodeId, contentIndex, cursorPos });

    it('splits a root node into two roots and focuses the new one', () => {
      const { roots, focus } = split([node('a', 'Hello World')], 'a', 0, 5);
      expect(roots).toEqual([node('a', 'Hello'), node('new1', ' World')]);
      expect(focus).toEqual({ nodeId: 'new1', contentIndex: 0, offset: 0 });
    });

    it('inserts the new sibling right after the node, before later siblings', () => {
      const { roots } = split([node('p', node('a', 'xy'), 'mid', node('c', 'z'))], 'a', 0, 1);
      expect(roots).toEqual([node('p', node('a', 'x'), node('new1', 'y'), 'mid', node('c', 'z'))]);
    });

    it('splits a later text entry; other entries stay in the original node', () => {
      const { roots } = split([node('a', 'one', node('b', 'two'), 'three four', node('c', 'five'))], 'a', 2, 5);
      expect(roots).toEqual([
        node('a', 'one', node('b', 'two'), 'three', node('c', 'five')),
        node('new1', ' four'),
      ]);
    });

    it('keeps the translation on the original node only', () => {
      const { roots } = split([nodeWith('a', { translation: 'T' }, 'xy')], 'a', 0, 1);
      expect(roots).toEqual([nodeWith('a', { translation: 'T' }, 'x'), node('new1', 'y')]);
    });

    it('does nothing when contentIndex points at a child node', () => {
      const before = [node('a', 'x', node('b', 'y'))];
      expect(split(before, 'a', 1, 0)).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', 'x')];
      expect(split(before, '?', 0, 0)).toEqual({ roots: before, focus: null });
    });
  });

  describe('splitToParentSibling', () => {
    const promote = (roots: TextNode[], nodeId: string, contentIndex: number, cursorPos: number) =>
      run(roots, { type: 'splitToParentSibling', nodeId, contentIndex, cursorPos });

    it('moves the text after the cursor into a new node after the parent', () => {
      const { roots, focus } = promote([node('p', 'intro', node('c', 'Hello World'))], 'c', 0, 5);
      expect(roots).toEqual([node('p', 'intro', node('c', 'Hello')), node('new1', ' World')]);
      expect(focus).toEqual({ nodeId: 'new1', contentIndex: 0, offset: 0 });
    });

    it('moves all text up when the cursor is at the start', () => {
      expect(promote([node('p', node('c', 'Hi'))], 'c', 0, 0).roots).toEqual([
        node('p', node('c', '')),
        node('new1', 'Hi'),
      ]);
    });

    it('creates a node with empty text when the cursor is at the end', () => {
      expect(promote([node('p', node('c', 'Hi'))], 'c', 0, 2).roots).toEqual([
        node('p', node('c', 'Hi')),
        node('new1', ''),
      ]);
    });

    it('carries the node\'s trailing content into the new node', () => {
      const { roots } = promote([node('p', node('c', 'ab', node('g', 'x'), 'tail'))], 'c', 0, 1);
      expect(roots).toEqual([node('p', node('c', 'a')), node('new1', 'b', node('g', 'x'), 'tail')]);
    });

    it('moves later siblings in the parent, text included, into the new node', () => {
      const { roots } = promote([node('p', node('c', 'ab'), 'between', node('d', 'later'))], 'c', 0, 1);
      expect(roots).toEqual([node('p', node('c', 'a')), node('new1', 'b', 'between', node('d', 'later'))]);
    });

    it('inserts after the parent inside the grandparent when nested deeper', () => {
      const { roots } = promote([node('g', node('p', node('c', 'ab')), node('q', 'q'))], 'c', 0, 1);
      expect(roots).toEqual([node('g', node('p', node('c', 'a')), node('new1', 'b'), node('q', 'q'))]);
    });

    it('keeps the translation on the original node only', () => {
      const { roots } = promote([node('p', nodeWith('c', { translation: 'T' }, 'ab'))], 'c', 0, 1);
      expect(roots).toEqual([node('p', nodeWith('c', { translation: 'T' }, 'a')), node('new1', 'b')]);
    });

    it('does nothing for a root-level node', () => {
      const before = [node('a', 'xy')];
      expect(promote(before, 'a', 0, 1)).toEqual({ roots: before, focus: null });
    });

    it('does nothing when contentIndex points at a child node', () => {
      const before = [node('p', node('c', 'x', node('g', 'y')))];
      expect(promote(before, 'c', 1, 0)).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('p', node('c', 'x'))];
      expect(promote(before, '?', 0, 0)).toEqual({ roots: before, focus: null });
    });
  });

  describe('mergeWithParent', () => {
    const merge = (roots: TextNode[], nodeId: string) => run(roots, { type: 'mergeWithParent', nodeId });

    it('glues the child\'s text onto the parent\'s (no separator) and focuses the join', () => {
      const { roots, focus } = merge([node('p', 'Parent', node('c', 'Child'))], 'c');
      expect(roots).toEqual([node('p', 'ParentChild')]);
      expect(focus).toEqual({ nodeId: 'p', contentIndex: 0, offset: 6 });
    });

    it('splices the child\'s content in place, joining text on both sides', () => {
      const { roots, focus } = merge(
        [node('p', 'a', node('c', 'x', node('g', 'y'), 'z'), 'b', node('d', 'd'))],
        'c',
      );
      expect(roots).toEqual([node('p', 'ax', node('g', 'y'), 'zb', node('d', 'd'))]);
      expect(focus).toEqual({ nodeId: 'p', contentIndex: 0, offset: 1 });
    });

    it('focuses the child\'s first entry when no text precedes it', () => {
      const { roots, focus } = merge([node('p', node('b', 'b'), node('c', node('g', 'g'), 'x'))], 'c');
      expect(roots).toEqual([node('p', node('b', 'b'), node('g', 'g'), 'x')]);
      expect(focus).toEqual({ nodeId: 'p', contentIndex: 1, offset: 0 });
    });

    it('works on a nested parent', () => {
      expect(merge([node('g', node('p', 'a', node('c', 'b')))], 'c').roots).toEqual([node('g', node('p', 'ab'))]);
    });

    it('keeps the child\'s translation when the parent has none', () => {
      expect(merge([node('p', 'a', nodeWith('c', { translation: ' C ' }, 'b'))], 'c').roots).toEqual([
        nodeWith('p', { translation: 'C' }, 'ab'),
      ]);
    });

    it('keeps the parent\'s translation as-is when the child has none', () => {
      expect(merge([nodeWith('p', { translation: 'P ' }, 'a', nodeWith('c', { translation: ' ' }, 'b'))], 'c').roots)
        .toEqual([nodeWith('p', { translation: 'P ' }, 'ab')]);
    });

    it('joins both translations with a newline', () => {
      expect(merge([nodeWith('p', { translation: 'P' }, 'a', nodeWith('c', { translation: 'C' }, 'b'))], 'c').roots)
        .toEqual([nodeWith('p', { translation: 'P\nC' }, 'ab')]);
    });

    it('leaves translation unset when neither has one', () => {
      const [p] = merge([node('p', 'a', node('c', 'b'))], 'c').roots;
      expect('translation' in p).toBe(false);
    });

    it('does nothing for a root-level node', () => {
      const before = [node('a', 'x')];
      expect(merge(before, 'a')).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', 'x')];
      expect(merge(before, '?')).toEqual({ roots: before, focus: null });
    });
  });

  describe('mergeWithPreviousSibling', () => {
    const merge = (roots: TextNode[], nodeId: string) => run(roots, { type: 'mergeWithPreviousSibling', nodeId });

    it('glues root text onto the previous root (no separator) and focuses the join', () => {
      const { roots, focus } = merge([node('a', 'First'), node('b', 'Second'), node('c', 'Third')], 'b');
      expect(roots).toEqual([node('a', 'FirstSecond'), node('c', 'Third')]);
      expect(focus).toEqual({ nodeId: 'a', contentIndex: 0, offset: 5 });
    });

    it('merges nested siblings and moves child nodes along', () => {
      const { roots, focus } = merge([node('p', node('a', 'x', node('g', 'g')), node('b', 'y', node('h', 'h')))], 'b');
      expect(roots).toEqual([node('p', node('a', 'x', node('g', 'g'), 'y', node('h', 'h')))]);
      expect(focus).toEqual({ nodeId: 'a', contentIndex: 2, offset: 0 });
    });

    it('skips text entries to find the previous node and moves that text along, in order', () => {
      const { roots, focus } = merge([node('p', node('a', 'x', node('g', 'g')), 'between', node('b', 'y'))], 'b');
      expect(roots).toEqual([node('p', node('a', 'x', node('g', 'g'), 'betweeny'))]);
      expect(focus).toEqual({ nodeId: 'a', contentIndex: 2, offset: 0 });
    });

    it('does nothing when only text precedes the node', () => {
      const before = [node('p', 'text', node('b', 'y'))];
      expect(merge(before, 'b')).toEqual({ roots: before, focus: null });
    });

    it('does nothing for the first sibling', () => {
      const before = [node('a', 'x'), node('b', 'y')];
      expect(merge(before, 'a')).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', 'x'), node('b', 'y')];
      expect(merge(before, '?')).toEqual({ roots: before, focus: null });
    });

    it('keeps the current node\'s translation when the previous has none', () => {
      expect(merge([node('a', 'x'), nodeWith('b', { translation: 'B' }, 'y')], 'b').roots).toEqual([
        nodeWith('a', { translation: 'B' }, 'xy'),
      ]);
    });

    it('keeps the previous node\'s translation when the current has none', () => {
      expect(merge([nodeWith('a', { translation: 'A' }, 'x'), node('b', 'y')], 'b').roots).toEqual([
        nodeWith('a', { translation: 'A' }, 'xy'),
      ]);
    });

    it('joins both translations with a newline', () => {
      expect(merge([nodeWith('a', { translation: 'A' }, 'x'), nodeWith('b', { translation: 'B' }, 'y')], 'b').roots)
        .toEqual([nodeWith('a', { translation: 'A\nB' }, 'xy')]);
    });

    it('leaves translation unset when neither has one', () => {
      const [a] = merge([node('a', 'x'), node('b', 'y')], 'b').roots;
      expect('translation' in a).toBe(false);
    });
  });

  describe('deleteNode', () => {
    const del = (roots: TextNode[], nodeId: string) => run(roots, { type: 'deleteNode', nodeId });

    it('deletes a root node', () => {
      expect(del([node('a', 'x'), node('b', 'y')], 'a')).toEqual({ roots: [node('b', 'y')], focus: null });
    });

    it('deletes a nested node with its subtree, keeping surrounding text', () => {
      expect(del([node('p', 'x', node('c', 'y', node('g', 'z')), 'w')], 'c').roots).toEqual([node('p', 'x', 'w')]);
    });

    it('replaces the last root with a blank node', () => {
      expect(del([node('a', 'x')], 'a').roots).toEqual([node('new1', '')]);
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', 'x')];
      expect(del(before, '?').roots).toBe(before);
    });
  });

  describe('clearAll', () => {
    it('resets to one blank root node', () => {
      expect(run([node('a', 'x'), node('b', 'y')], { type: 'clearAll' })).toEqual({
        roots: [node('new1', '')],
        focus: null,
      });
    });
  });

  describe('loadText', () => {
    it('replaces the document with one node holding the trimmed text', () => {
      expect(run([node('a', 'x')], { type: 'loadText', text: '\n  line one\nline two \n' }).roots).toEqual([
        node('new1', 'line one\nline two'),
      ]);
    });
  });

  describe('loadJson', () => {
    it('replaces the document with the parsed nodes', () => {
      const json = JSON.stringify([{ label: 'L', children: ['x', { children: ['y'] }] }]);
      expect(run([node('a', 'old')], { type: 'loadJson', json }).roots).toEqual([
        nodeWith('new1', { label: 'L' }, 'x', node('new2', 'y')),
      ]);
    });

    it('resets to one blank node when the JSON holds no nodes', () => {
      expect(run([node('a', 'old')], { type: 'loadJson', json: '[]' }).roots).toEqual([node('new1', '')]);
      expect(run([node('a', 'old')], { type: 'loadJson', json: '  ' }).roots).toEqual([node('new1', '')]);
    });

    it('throws on invalid JSON', () => {
      expect(() => run([node('a', 'old')], { type: 'loadJson', json: '{oops' })).toThrow();
    });
  });
});
