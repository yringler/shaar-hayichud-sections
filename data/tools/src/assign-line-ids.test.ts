import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assignLineIds, collectLineIds, formatLike, hasAllLineIds, type LegacyNode } from './assign-line-ids.js';
import { LINE_ID_PATTERN } from './line-id.js';

/** Deterministic ids: aaaaaaaa, bbbbbbbb, ... */
const counter = () => {
  let n = 0;
  return () => new Uint8Array(8).fill(n++);
};

describe('assignLineIds', () => {
  it('splits legacy strings into lines, keeping text, labels and translations', () => {
    const legacy: LegacyNode[] = [
      {
        label: 'L',
        children: ['one,\nשתיים (2)\n  \nthree ', { children: ['inner'], translation: 'T\n<i>x</i>' }],
        translation: 'top',
      },
    ];
    const { chapter, assigned } = assignLineIds(legacy, new Set(), counter());
    assert.equal(assigned, 4);
    assert.deepEqual(chapter, [
      {
        label: 'L',
        children: [
          { id: 'aaaaaaaa', text: 'one,' },
          { id: 'bbbbbbbb', text: 'שתיים (2)' },
          { id: 'cccccccc', text: 'three ' },
          { children: [{ id: 'dddddddd', text: 'inner' }], translation: 'T\n<i>x</i>' },
        ],
        translation: 'top',
      },
    ]);
    assert.deepEqual(Object.keys(chapter[0]!), ['label', 'children', 'translation']);
    assert.ok(hasAllLineIds(chapter));
    assert.equal(hasAllLineIds(legacy), false);
  });

  it('is idempotent and only fills in missing or invalid ids', () => {
    const first = assignLineIds([{ children: ['a\nb'] }], new Set()).chapter;
    const again = assignLineIds(first, collectLineIds(first));
    assert.equal(again.assigned, 0);
    assert.deepEqual(again.chapter, first);

    const mixed: LegacyNode[] = [{ children: [{ id: 'kkkkkkkk', text: 'keep' }, { text: 'new' }, { id: 'BAD', text: 'fix' }] }];
    const taken = collectLineIds(mixed);
    assert.deepEqual([...taken], ['kkkkkkkk']);
    const { chapter, assigned } = assignLineIds(mixed, taken);
    assert.equal(assigned, 2);
    const lines = chapter[0]!.children as { id: string; text: string }[];
    assert.equal(lines[0]!.id, 'kkkkkkkk');
    assert.ok(lines.every((l) => LINE_ID_PATTERN.test(l.id)));
    assert.equal(new Set(lines.map((l) => l.id)).size, 3);
  });

  it('splits a line object containing a newline; the first part keeps the id', () => {
    const { chapter } = assignLineIds([{ children: [{ id: 'kkkkkkkk', text: 'a\nb' }] }], new Set(['kkkkkkkk']), counter());
    assert.deepEqual(chapter[0]!.children, [
      { id: 'kkkkkkkk', text: 'a' },
      { id: 'aaaaaaaa', text: 'b' },
    ]);
  });

  it('never reuses an id already taken elsewhere in the corpus', () => {
    const { chapter } = assignLineIds([{ children: ['x'] }], new Set(['aaaaaaaa']), counter());
    assert.deepEqual(chapter[0]!.children, [{ id: 'bbbbbbbb', text: 'x' }]);
  });
});

describe('assignLineIds duplicates', () => {
  it('gives a fresh id to a later copy of an id within a chapter', () => {
    const dup: LegacyNode[] = [{ children: [{ id: 'kkkkkkkk', text: 'a' }, { children: [{ id: 'kkkkkkkk', text: 'b' }] }] }];
    const { chapter, assigned } = assignLineIds(dup, collectLineIds(dup), counter());
    assert.equal(assigned, 1);
    assert.deepEqual(chapter, [{ children: [{ id: 'kkkkkkkk', text: 'a' }, { children: [{ id: 'aaaaaaaa', text: 'b' }] }] }]);
  });

  it('with a shared kept set, a copied chapter gets fresh ids and the first keeps its own', () => {
    const ch: LegacyNode[] = [{ children: [{ id: 'kkkkkkkk', text: 'a' }] }];
    const taken = collectLineIds(ch);
    const kept = new Set<string>();
    const first = assignLineIds(ch, taken, counter(), kept);
    const copy = assignLineIds(structuredClone(ch), taken, counter(), kept);
    assert.equal(first.assigned, 0);
    assert.deepEqual(first.chapter, ch);
    assert.equal(copy.assigned, 1);
    assert.deepEqual(copy.chapter, [{ children: [{ id: 'aaaaaaaa', text: 'a' }] }]);
  });
});

describe('formatLike', () => {
  it('keeps tab vs 2-space indent and the trailing newline', () => {
    assert.equal(formatLike('[\n\t{}\n]\n', [1]), '[\n\t1\n]\n');
    assert.equal(formatLike('[\n  {}\n]', [1]), '[\n  1\n]');
  });
});
