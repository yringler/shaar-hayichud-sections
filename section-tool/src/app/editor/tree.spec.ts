import { describe, it, expect } from 'vitest';
import { findPath, mergeAdjacentText, nodeAt, replaceChildren, siblingsAt } from './tree';
import { deepFreeze, node } from './testing';

const tree = deepFreeze([node('a', 'x', node('b', 'y', node('c', 'z'))), node('d', 'w')]);

describe('tree helpers', () => {
  it('findPath returns child indices to the node, or null', () => {
    expect(findPath(tree, 'a')).toEqual([0]);
    expect(findPath(tree, 'c')).toEqual([0, 1, 1]);
    expect(findPath(tree, 'd')).toEqual([1]);
    expect(findPath(tree, '?')).toBeNull();
  });

  it('nodeAt and siblingsAt read a path', () => {
    expect(nodeAt(tree, [0, 1, 1]).id).toBe('c');
    expect(siblingsAt(tree, [1])).toBe(tree);
    expect(siblingsAt(tree, [0, 1])).toBe(tree[0].children);
  });

  it('nodeAt throws on a path that does not lead to a node', () => {
    expect(() => nodeAt(tree, [0, 0])).toThrow();
    expect(() => nodeAt(tree, [])).toThrow();
  });

  it('replaceChildren with an empty path replaces the root array', () => {
    const roots = [node('n', 'x')];
    expect(replaceChildren(tree, [], roots)).toBe(roots);
  });

  it('replaceChildren copies only the ancestors', () => {
    const next = replaceChildren(tree, [0, 1], ['new']);
    expect(next[1]).toBe(tree[1]);
    expect(next[0].children[0]).toBe('x');
    expect(nodeAt(next, [0, 1]).children).toEqual(['new']);
  });

  describe('mergeAdjacentText', () => {
    it('joins runs of strings and tracks where an entry went', () => {
      const child = node('c', 'c');
      const items = ['a', 'b', child, 'd', 'e', 'f'];
      expect(mergeAdjacentText(items, 1)).toEqual({ items: ['ab', child, 'def'], position: { index: 0, offset: 1 } });
      expect(mergeAdjacentText(items, 2).position).toEqual({ index: 1, offset: 0 });
      expect(mergeAdjacentText(items, 5).position).toEqual({ index: 2, offset: 2 });
    });

    it('tracks past the end as the end of the last entry', () => {
      expect(mergeAdjacentText(['ab'], 1).position).toEqual({ index: 0, offset: 2 });
      expect(mergeAdjacentText([node('c', 'c')], 1).position).toEqual({ index: 0, offset: 0 });
      expect(mergeAdjacentText([], 0)).toEqual({ items: [], position: { index: 0, offset: 0 } });
    });
  });
});
