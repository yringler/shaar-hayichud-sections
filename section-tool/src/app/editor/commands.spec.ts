import { describe, it, expect } from 'vitest';
import { TextNode, isText } from '../models/text-node.model';
import { CommandResult, EditorCommand, applyCommand, formatAfter } from './commands';
import { collectLineIds } from './lines';
import { DEFAULT_FORMAT } from './serialization';
import { deepFreeze, node, nodeWith, sequentialIds, t } from './testing';

/**
 * Runs a command on a frozen tree, so any in-place mutation throws. New node
 * ids come out as new1, new2, ...; new line ids as L1, L2, ...
 */
function run(roots: TextNode[], cmd: EditorCommand): CommandResult {
  return applyCommand(deepFreeze(roots), cmd, sequentialIds());
}

/** Line ids of the whole document in order. */
const lineIds = (roots: TextNode[]) => [...collectLineIds(roots)];

describe('applyCommand', () => {
  describe('immutability', () => {
    it('copies only the path to the change and shares everything else', () => {
      const untouched = node('u', t('u1:keep'));
      const sibling = node('s', t('s1:keep too'));
      const target = node('t', t('t1:old text'));
      const roots = [node('r', t('r1:root text'), untouched, node('p', target, sibling))];

      const { roots: next } = run(roots, { type: 'updateText', nodeId: 't', contentIndex: 0, text: 'old text!' });

      expect(next).not.toBe(roots);
      expect(next[0]).not.toBe(roots[0]);
      expect(next[0].children[0]).toBe(roots[0].children[0]);
      expect(next[0].children[1]).toBe(untouched);
      const p = next[0].children[2] as TextNode;
      expect(p.children[0]).toEqual(node('t', t('t1:old text!')));
      expect(p.children[1]).toBe(sibling);
      expect(roots[0]).toEqual(node('r', t('r1:root text'), untouched, node('p', node('t', t('t1:old text')), sibling)));
    });
  });

  describe('updateText', () => {
    const update = (roots: TextNode[], nodeId: string, contentIndex: number, text: string) =>
      run(roots, { type: 'updateText', nodeId, contentIndex, text });

    it('updates the run at contentIndex; an edited line keeps its id', () => {
      const { roots, focus } = update([node('a', t('x:one'), node('b', t('y:two')), t('z:three'))], 'a', 2, 'Three');
      expect(roots).toEqual([node('a', t('x:one'), node('b', t('y:two')), t('z:Three'))]);
      expect(focus).toBeNull();
    });

    it('updates a nested node', () => {
      const { roots } = update([node('a', node('b', t('l:old line')))], 'b', 0, 'old line.');
      expect(roots).toEqual([node('a', node('b', t('l:old line.')))]);
    });

    it('gives an inserted line a fresh id and keeps the others', () => {
      const { roots } = update([node('a', t('l1:first', 'l2:second'))], 'a', 0, 'first\nnew\nsecond');
      expect(roots).toEqual([node('a', t('l1:first', 'L1:new', 'l2:second'))]);
    });

    it('drops the id of a deleted line', () => {
      const { roots } = update([node('a', t('l1:first', 'l2:second', 'l3:third'))], 'a', 0, 'first\nthird');
      expect(roots).toEqual([node('a', t('l1:first', 'l3:third'))]);
    });

    it('a fresh id never repeats an id used elsewhere in the document', () => {
      const { roots } = update([node('a', t('L1:x')), node('b', t('b1:y'))], 'b', 0, 'y\nz');
      expect(roots[1]).toEqual(node('b', t('b1:y', 'L2:z')));
      expect(new Set(lineIds(roots)).size).toBe(3);
    });

    it('typing into an empty run creates its first line', () => {
      const { roots } = update([node('a', t())], 'a', 0, 'h');
      expect(roots).toEqual([node('a', t('L1:h'))]);
    });

    it('keeps blank lines in memory so the textarea shows what was typed', () => {
      const { roots } = update([node('a', t('l1:one'))], 'a', 0, 'one\n');
      expect(roots).toEqual([node('a', t('l1:one', 'L1:'))]);
    });

    it('appends a run when contentIndex is one past the end', () => {
      const { roots } = update([node('a', t('x:x'), node('b', t('y:y')))], 'a', 2, 'tail');
      expect(roots).toEqual([node('a', t('x:x'), node('b', t('y:y')), t('L1:tail'))]);
    });

    it('ignores an index that points at a child node', () => {
      const { roots } = update([node('a', t('x:x'), node('b', t('y:y')))], 'a', 1, '!');
      expect(roots).toEqual([node('a', t('x:x'), node('b', t('y:y')))]);
    });

    it('ignores an index further past the end', () => {
      const { roots } = update([node('a', t('x:x'))], 'a', 5, '!');
      expect(roots).toEqual([node('a', t('x:x'))]);
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', t('x:x'))];
      expect(update(before, '?', 0, '!').roots).toBe(before);
    });
  });

  describe('updateLabel', () => {
    it('sets the label of a nested node', () => {
      const { roots, focus } = run([node('a', node('b', t('x:x')))], { type: 'updateLabel', nodeId: 'b', label: 'L' });
      expect(roots).toEqual([node('a', nodeWith('b', { label: 'L' }, t('x:x')))]);
      expect(focus).toBeNull();
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', t('x:x'))];
      expect(run(before, { type: 'updateLabel', nodeId: '?', label: 'L' }).roots).toBe(before);
    });
  });

  describe('updateTranslation', () => {
    it('sets the translation of a root and a nested node', () => {
      let roots = run([node('a', t('x:x'), node('b', t('y:y')))], { type: 'updateTranslation', nodeId: 'a', translation: 'A' }).roots;
      roots = run(roots, { type: 'updateTranslation', nodeId: 'b', translation: 'B' }).roots;
      expect(roots).toEqual([nodeWith('a', { translation: 'A' }, t('x:x'), nodeWith('b', { translation: 'B' }, t('y:y')))]);
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', t('x:x'))];
      expect(run(before, { type: 'updateTranslation', nodeId: '?', translation: 'T' }).roots).toBe(before);
    });
  });

  // Run text used by the split tests: "Hello\nWorld" (offsets: H=0, end of
  // Hello=5, W=6, end=11).
  const hw = () => t('h:Hello', 'w:World');

  describe('splitToChild', () => {
    const split = (roots: TextNode[], contentIndex: number, cursorPos: number, nodeId = 'a') =>
      run(roots, { type: 'splitToChild', nodeId, contentIndex, cursorPos });

    it('moves the lines from the cursor on into a new child, keeping ids, and focuses its start', () => {
      const { roots, focus } = split([node('a', hw())], 0, 6);
      expect(roots).toEqual([node('a', t('h:Hello'), node('new1', t('w:World')))]);
      expect(focus).toEqual({ nodeId: 'new1', contentIndex: 0, offset: 0 });
    });

    it('splits after a line when the cursor is at its end', () => {
      expect(split([node('a', hw())], 0, 5).roots).toEqual([node('a', t('h:Hello'), node('new1', t('w:World')))]);
    });

    it('never cuts a line: a cursor inside a line splits before it', () => {
      expect(split([node('a', hw())], 0, 8).roots).toEqual([node('a', t('h:Hello'), node('new1', t('w:World')))]);
      expect(split([node('a', hw())], 0, 2).roots).toEqual([node('a', t(), node('new1', hw()))]);
    });

    it('keeps an empty run when splitting at the start', () => {
      expect(split([node('a', hw())], 0, 0).roots).toEqual([node('a', t(), node('new1', hw()))]);
    });

    it('creates a child with an empty run when splitting at the end', () => {
      expect(split([node('a', hw())], 0, 11).roots).toEqual([node('a', hw(), node('new1', t()))]);
    });

    it('splits a later run and keeps the rest in place', () => {
      const { roots } = split([node('a', t('o:one'), node('b', t('tw:two')), t('th:three', 'f:four'))], 2, 6);
      expect(roots).toEqual([node('a', t('o:one'), node('b', t('tw:two')), t('th:three'), node('new1', t('f:four')))]);
    });

    it('inserts an empty child after a child node when contentIndex points at one', () => {
      const { roots, focus } = split([node('a', t('x:x'), node('b', t('y:y')), t('z:z'))], 1, 0);
      expect(roots).toEqual([node('a', t('x:x'), node('b', t('y:y')), node('new1', t()), t('z:z'))]);
      expect(focus?.nodeId).toBe('new1');
    });

    it('keeps the translation on the original node only', () => {
      const { roots } = split([nodeWith('a', { translation: 'T' }, hw())], 0, 6);
      expect(roots).toEqual([nodeWith('a', { translation: 'T' }, t('h:Hello'), node('new1', t('w:World')))]);
    });

    it('splits a nested node', () => {
      expect(split([node('a', node('b', hw()))], 0, 6, 'b').roots).toEqual([
        node('a', node('b', t('h:Hello'), node('new1', t('w:World')))),
      ]);
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', t('x:x'))];
      expect(split(before, 0, 0, '?')).toEqual({ roots: before, focus: null });
    });
  });

  describe('splitToSibling', () => {
    const split = (roots: TextNode[], nodeId: string, contentIndex: number, cursorPos: number) =>
      run(roots, { type: 'splitToSibling', nodeId, contentIndex, cursorPos });

    it('splits a root node into two roots at a line boundary and focuses the new one', () => {
      const { roots, focus } = split([node('a', hw())], 'a', 0, 6);
      expect(roots).toEqual([node('a', t('h:Hello')), node('new1', t('w:World'))]);
      expect(focus).toEqual({ nodeId: 'new1', contentIndex: 0, offset: 0 });
    });

    it('snaps a cursor inside a line to before that line', () => {
      expect(split([node('a', hw())], 'a', 0, 9).roots).toEqual([node('a', t('h:Hello')), node('new1', t('w:World'))]);
    });

    it('inserts the new sibling right after the node, before later siblings', () => {
      const { roots } = split([node('p', node('a', hw()), t('m:mid'), node('c', t('z:z')))], 'a', 0, 5);
      expect(roots).toEqual([node('p', node('a', t('h:Hello')), node('new1', t('w:World')), t('m:mid'), node('c', t('z:z')))]);
    });

    it('splits a later run; other entries stay in the original node', () => {
      const { roots } = split([node('a', t('o:one'), node('b', t('tw:two')), t('th:three', 'f:four'), node('c', t('fi:five')))], 'a', 2, 6);
      expect(roots).toEqual([
        node('a', t('o:one'), node('b', t('tw:two')), t('th:three'), node('c', t('fi:five'))),
        node('new1', t('f:four')),
      ]);
    });

    it('keeps the translation on the original node only', () => {
      const { roots } = split([nodeWith('a', { translation: 'T' }, hw())], 'a', 0, 6);
      expect(roots).toEqual([nodeWith('a', { translation: 'T' }, t('h:Hello')), node('new1', t('w:World'))]);
    });

    it('does nothing when contentIndex points at a child node', () => {
      const before = [node('a', t('x:x'), node('b', t('y:y')))];
      expect(split(before, 'a', 1, 0)).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', t('x:x'))];
      expect(split(before, '?', 0, 0)).toEqual({ roots: before, focus: null });
    });
  });

  describe('splitToParentSibling', () => {
    const promote = (roots: TextNode[], nodeId: string, contentIndex: number, cursorPos: number) =>
      run(roots, { type: 'splitToParentSibling', nodeId, contentIndex, cursorPos });

    it('moves the lines from the cursor on into a new node after the parent', () => {
      const { roots, focus } = promote([node('p', t('i:intro'), node('c', hw()))], 'c', 0, 6);
      expect(roots).toEqual([node('p', t('i:intro'), node('c', t('h:Hello'))), node('new1', t('w:World'))]);
      expect(focus).toEqual({ nodeId: 'new1', contentIndex: 0, offset: 0 });
    });

    it('snaps a cursor inside a line to before that line', () => {
      expect(promote([node('p', node('c', hw()))], 'c', 0, 3).roots).toEqual([
        node('p', node('c', t())),
        node('new1', hw()),
      ]);
    });

    it('creates a node with an empty run when the cursor is at the end', () => {
      expect(promote([node('p', node('c', hw()))], 'c', 0, 11).roots).toEqual([
        node('p', node('c', hw())),
        node('new1', t()),
      ]);
    });

    it('carries the node\'s trailing content into the new node', () => {
      const { roots } = promote([node('p', node('c', hw(), node('g', t('x:x')), t('tl:tail')))], 'c', 0, 6);
      expect(roots).toEqual([node('p', node('c', t('h:Hello'))), node('new1', t('w:World'), node('g', t('x:x')), t('tl:tail'))]);
    });

    it('moves later siblings in the parent, text included, into the new node', () => {
      const { roots } = promote([node('p', node('c', hw()), t('b:between'), node('d', t('l:later')))], 'c', 0, 6);
      expect(roots).toEqual([
        node('p', node('c', t('h:Hello'))),
        node('new1', t('w:World'), t('b:between'), node('d', t('l:later'))),
      ]);
    });

    it('inserts after the parent inside the grandparent when nested deeper', () => {
      const { roots } = promote([node('g', node('p', node('c', hw())), node('q', t('q:q')))], 'c', 0, 6);
      expect(roots).toEqual([node('g', node('p', node('c', t('h:Hello'))), node('new1', t('w:World')), node('q', t('q:q')))]);
    });

    it('keeps the translation on the original node only', () => {
      const { roots } = promote([node('p', nodeWith('c', { translation: 'T' }, hw()))], 'c', 0, 6);
      expect(roots).toEqual([node('p', nodeWith('c', { translation: 'T' }, t('h:Hello'))), node('new1', t('w:World'))]);
    });

    it('does nothing for a root-level node', () => {
      const before = [node('a', hw())];
      expect(promote(before, 'a', 0, 6)).toEqual({ roots: before, focus: null });
    });

    it('does nothing when contentIndex points at a child node', () => {
      const before = [node('p', node('c', t('x:x'), node('g', t('y:y'))))];
      expect(promote(before, 'c', 1, 0)).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('p', node('c', t('x:x')))];
      expect(promote(before, '?', 0, 0)).toEqual({ roots: before, focus: null });
    });
  });

  describe('mergeWithParent', () => {
    const merge = (roots: TextNode[], nodeId: string) => run(roots, { type: 'mergeWithParent', nodeId });

    it('appends the child\'s lines to the parent\'s run, keeping ids, and focuses the join', () => {
      const { roots, focus } = merge([node('p', t('p:Parent'), node('c', t('c:Child')))], 'c');
      expect(roots).toEqual([node('p', t('p:Parent', 'c:Child'))]);
      // "Parent\nChild": the child's first line starts at 7.
      expect(focus).toEqual({ nodeId: 'p', contentIndex: 0, offset: 7 });
    });

    it('splices the child\'s content in place, joining runs on both sides', () => {
      const { roots, focus } = merge(
        [node('p', t('a:a'), node('c', t('x:x'), node('g', t('y:y')), t('z:z')), t('b:b'), node('d', t('d:d')))],
        'c',
      );
      expect(roots).toEqual([node('p', t('a:a', 'x:x'), node('g', t('y:y')), t('z:z', 'b:b'), node('d', t('d:d')))]);
      expect(focus).toEqual({ nodeId: 'p', contentIndex: 0, offset: 2 });
    });

    it('focuses the child\'s first entry when no text precedes it', () => {
      const { roots, focus } = merge([node('p', node('b', t('b:b')), node('c', node('g', t('g:g')), t('x:x')))], 'c');
      expect(roots).toEqual([node('p', node('b', t('b:b')), node('g', t('g:g')), t('x:x'))]);
      expect(focus).toEqual({ nodeId: 'p', contentIndex: 1, offset: 0 });
    });

    it('focuses the end of the parent\'s text when the child\'s run is empty', () => {
      const { roots, focus } = merge([node('p', t('p:ab'), node('c', t()))], 'c');
      expect(roots).toEqual([node('p', t('p:ab'))]);
      expect(focus).toEqual({ nodeId: 'p', contentIndex: 0, offset: 2 });
    });

    it('works on a nested parent', () => {
      expect(merge([node('g', node('p', t('a:a'), node('c', t('b:b'))))], 'c').roots).toEqual([
        node('g', node('p', t('a:a', 'b:b'))),
      ]);
    });

    it('keeps the child\'s translation when the parent has none', () => {
      expect(merge([node('p', t('a:a'), nodeWith('c', { translation: ' C ' }, t('b:b')))], 'c').roots).toEqual([
        nodeWith('p', { translation: 'C' }, t('a:a', 'b:b')),
      ]);
    });

    it('keeps the parent\'s translation as-is when the child has none', () => {
      expect(merge([nodeWith('p', { translation: 'P ' }, t('a:a'), nodeWith('c', { translation: ' ' }, t('b:b')))], 'c').roots)
        .toEqual([nodeWith('p', { translation: 'P ' }, t('a:a', 'b:b'))]);
    });

    it('joins both translations with a newline', () => {
      expect(merge([nodeWith('p', { translation: 'P' }, t('a:a'), nodeWith('c', { translation: 'C' }, t('b:b')))], 'c').roots)
        .toEqual([nodeWith('p', { translation: 'P\nC' }, t('a:a', 'b:b'))]);
    });

    it('leaves translation unset when neither has one', () => {
      const [p] = merge([node('p', t('a:a'), node('c', t('b:b')))], 'c').roots;
      expect('translation' in p).toBe(false);
    });

    it('does nothing for a root-level node', () => {
      const before = [node('a', t('x:x'))];
      expect(merge(before, 'a')).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', t('x:x'))];
      expect(merge(before, '?')).toEqual({ roots: before, focus: null });
    });
  });

  describe('mergeWithPreviousSibling', () => {
    const merge = (roots: TextNode[], nodeId: string) => run(roots, { type: 'mergeWithPreviousSibling', nodeId });

    it('appends root lines to the previous root, keeping ids, and focuses the join', () => {
      const { roots, focus } = merge([node('a', t('f:First')), node('b', t('s:Second')), node('c', t('t:Third'))], 'b');
      expect(roots).toEqual([node('a', t('f:First', 's:Second')), node('c', t('t:Third'))]);
      expect(focus).toEqual({ nodeId: 'a', contentIndex: 0, offset: 6 });
    });

    it('merges nested siblings and moves child nodes along', () => {
      const { roots, focus } = merge([node('p', node('a', t('x:x'), node('g', t('g:g'))), node('b', t('y:y'), node('h', t('h:h'))))], 'b');
      expect(roots).toEqual([node('p', node('a', t('x:x'), node('g', t('g:g')), t('y:y'), node('h', t('h:h'))))]);
      expect(focus).toEqual({ nodeId: 'a', contentIndex: 2, offset: 0 });
    });

    it('skips runs to find the previous node and moves those lines along, in order', () => {
      const { roots, focus } = merge([node('p', node('a', t('x:x'), node('g', t('g:g'))), t('bt:between'), node('b', t('y:y')))], 'b');
      expect(roots).toEqual([node('p', node('a', t('x:x'), node('g', t('g:g')), t('bt:between', 'y:y')))]);
      expect(focus).toEqual({ nodeId: 'a', contentIndex: 2, offset: 0 });
    });

    it('does nothing when only text precedes the node', () => {
      const before = [node('p', t('x:text'), node('b', t('y:y')))];
      expect(merge(before, 'b')).toEqual({ roots: before, focus: null });
    });

    it('does nothing for the first sibling', () => {
      const before = [node('a', t('x:x')), node('b', t('y:y'))];
      expect(merge(before, 'a')).toEqual({ roots: before, focus: null });
    });

    it('does nothing for an unknown node', () => {
      const before = [node('a', t('x:x')), node('b', t('y:y'))];
      expect(merge(before, '?')).toEqual({ roots: before, focus: null });
    });

    it('keeps the current node\'s translation when the previous has none', () => {
      expect(merge([node('a', t('x:x')), nodeWith('b', { translation: 'B' }, t('y:y'))], 'b').roots).toEqual([
        nodeWith('a', { translation: 'B' }, t('x:x', 'y:y')),
      ]);
    });

    it('keeps the previous node\'s translation when the current has none', () => {
      expect(merge([nodeWith('a', { translation: 'A' }, t('x:x')), node('b', t('y:y'))], 'b').roots).toEqual([
        nodeWith('a', { translation: 'A' }, t('x:x', 'y:y')),
      ]);
    });

    it('joins both translations with a newline', () => {
      expect(merge([nodeWith('a', { translation: 'A' }, t('x:x')), nodeWith('b', { translation: 'B' }, t('y:y'))], 'b').roots)
        .toEqual([nodeWith('a', { translation: 'A\nB' }, t('x:x', 'y:y'))]);
    });

    it('leaves translation unset when neither has one', () => {
      const [a] = merge([node('a', t('x:x')), node('b', t('y:y'))], 'b').roots;
      expect('translation' in a).toBe(false);
    });
  });

  describe('deleteNode', () => {
    const del = (roots: TextNode[], nodeId: string) => run(roots, { type: 'deleteNode', nodeId });

    it('deletes a root node', () => {
      expect(del([node('a', t('x:x')), node('b', t('y:y'))], 'a')).toEqual({ roots: [node('b', t('y:y'))], focus: null });
    });

    it('deletes a nested node with its subtree and its line ids, keeping surrounding text', () => {
      expect(del([node('p', t('x:x'), node('c', t('y:y'), node('g', t('z:z'))), t('w:w'))], 'c').roots).toEqual([
        node('p', t('x:x'), t('w:w')),
      ]);
    });

    it('replaces the last root with a blank node', () => {
      expect(del([node('a', t('x:x'))], 'a').roots).toEqual([node('new1', t())]);
    });

    it('returns the same tree for an unknown node', () => {
      const before = [node('a', t('x:x'))];
      expect(del(before, '?').roots).toBe(before);
    });
  });

  describe('line ids survive structure edits', () => {
    it('split then merge back restores the same lines and ids', () => {
      const start = [node('p', t('a:one', 'b:two', 'c:three'), node('q', t('d:four')))];
      let roots = run(start, { type: 'splitToChild', nodeId: 'p', contentIndex: 0, cursorPos: 4 }).roots;
      roots = run(roots, { type: 'mergeWithParent', nodeId: 'new1' }).roots;
      expect(roots).toEqual(start);
    });

    it('indent and outdent (split to sibling, merge back) keep every id', () => {
      const start = [node('a', t('a:one', 'b:two')), node('z', t('z:end'))];
      let roots = run(start, { type: 'splitToSibling', nodeId: 'a', contentIndex: 0, cursorPos: 4 }).roots;
      expect(lineIds(roots)).toEqual(['a', 'b', 'z']);
      roots = run(roots, { type: 'mergeWithPreviousSibling', nodeId: 'new1' }).roots;
      expect(roots).toEqual(start);
    });
  });

  describe('clearAll', () => {
    it('resets to one blank root node', () => {
      expect(run([node('a', t('x:x')), node('b', t('y:y'))], { type: 'clearAll' })).toEqual({
        roots: [node('new1', t())],
        focus: null,
      });
    });
  });

  describe('loadText', () => {
    it('replaces the document with one node holding the trimmed text, one fresh id per line', () => {
      expect(run([node('a', t('x:x'))], { type: 'loadText', text: '\n  line one\nline two \n' }).roots).toEqual([
        node('new1', t('L1:line one', 'L2:line two')),
      ]);
    });

    it('loads blank text as an empty run', () => {
      const [root] = run([node('a', t('x:x'))], { type: 'loadText', text: ' \n ' }).roots;
      expect(root).toEqual(node('new1', t()));
    });

    it('gives duplicate lines distinct ids', () => {
      const [root] = run([], { type: 'loadText', text: 'same\nsame' }).roots;
      const run0 = root.children[0];
      expect(isText(run0) && run0.lines.map((l) => l.id)).toEqual(['L1', 'L2']);
    });
  });

  describe('loadJson', () => {
    it('replaces the document with the parsed nodes, keeping line ids', () => {
      const json = JSON.stringify([
        { label: 'L', children: [{ id: 'aaaaaaaa', text: 'x' }, { children: [{ id: 'bbbbbbbb', text: 'y' }] }] },
      ]);
      expect(run([node('a', t('x:old'))], { type: 'loadJson', json }).roots).toEqual([
        nodeWith('new1', { label: 'L' }, t('aaaaaaaa:x'), node('new2', t('bbbbbbbb:y'))),
      ]);
    });

    it('resets to one blank node when the JSON holds no nodes', () => {
      expect(run([node('a', t('x:old'))], { type: 'loadJson', json: '[]' }).roots).toEqual([node('new1', t())]);
      expect(run([node('a', t('x:old'))], { type: 'loadJson', json: '  ' }).roots).toEqual([node('new1', t())]);
    });

    it('throws on invalid JSON', () => {
      expect(() => run([node('a', t('x:old'))], { type: 'loadJson', json: '{oops' })).toThrow();
    });
  });
});

describe('formatAfter', () => {
  const tabbed = { indent: '\t' as const, trailingNewline: true };

  it('adopts a loaded file\'s format', () => {
    expect(formatAfter({ type: 'loadJson', json: '[\n\t{}\n]\n' }, DEFAULT_FORMAT)).toEqual(tabbed);
  });

  it('resets to the default for a new document', () => {
    expect(formatAfter({ type: 'loadText', text: 'x' }, tabbed)).toEqual(DEFAULT_FORMAT);
    expect(formatAfter({ type: 'clearAll' }, tabbed)).toEqual(DEFAULT_FORMAT);
  });

  it('keeps the format for edits', () => {
    expect(formatAfter({ type: 'updateLabel', nodeId: 'a', label: 'L' }, tabbed)).toBe(tabbed);
    expect(formatAfter({ type: 'deleteNode', nodeId: 'a' }, tabbed)).toBe(tabbed);
  });
});
