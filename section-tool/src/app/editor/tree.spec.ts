import { describe, it, expect } from 'vitest';
import { createNode, findPath, mergeAdjacentText, nodeAt, replaceChildren, siblingsAt } from './tree';
import { deepFreeze, node, t } from './testing';

const tree = deepFreeze([node('a', t('x:x'), node('b', t('y:y'), node('c', t('z:z')))), node('d', t('w:w'))]);

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
    const roots = [node('n', t('x:x'))];
    expect(replaceChildren(tree, [], roots)).toBe(roots);
  });

  it('replaceChildren copies only the ancestors', () => {
    const next = replaceChildren(tree, [0, 1], [t('n:new')]);
    expect(next[1]).toBe(tree[1]);
    expect(next[0].children[0]).toBe(tree[0].children[0]);
    expect(nodeAt(next, [0, 1]).children).toEqual([t('n:new')]);
  });

  describe('mergeAdjacentText', () => {
    it('joins adjacent runs, keeping every line, and tracks where an entry went', () => {
      const child = node('c', t('c:c'));
      const items = [t('a:a'), t('b:b'), child, t('d:dd'), t('e:e'), t('f:f')];
      expect(mergeAdjacentText(items, 1)).toEqual({
        items: [t('a:a', 'b:b'), child, t('d:dd', 'e:e', 'f:f')],
        // "a\nb": b starts at 2
        position: { index: 0, offset: 2 },
      });
      expect(mergeAdjacentText(items, 2).position).toEqual({ index: 1, offset: 0 });
      // "dd\ne\nf": f starts at 5
      expect(mergeAdjacentText(items, 5).position).toEqual({ index: 2, offset: 5 });
    });

    it('an empty run adds no offset and an empty tracked run lands at the end', () => {
      expect(mergeAdjacentText([t(), t('b:b')], 1).position).toEqual({ index: 0, offset: 0 });
      expect(mergeAdjacentText([t('a:ab'), t()], 1)).toEqual({ items: [t('a:ab')], position: { index: 0, offset: 2 } });
    });

    it('tracks past the end as the end of the last entry', () => {
      expect(mergeAdjacentText([t('a:ab')], 1).position).toEqual({ index: 0, offset: 2 });
      expect(mergeAdjacentText([node('c', t('c:c'))], 1).position).toEqual({ index: 0, offset: 0 });
      expect(mergeAdjacentText([], 0)).toEqual({ items: [], position: { index: 0, offset: 0 } });
    });
  });

  it('createNode gives a node one run so it renders a textarea', () => {
    expect(createNode('n')).toEqual(node('n', t()));
    expect(createNode('n', [{ id: 'a', text: 'x' }], 'L')).toEqual({ id: 'n', label: 'L', children: [t('a:x')] });
  });
});
