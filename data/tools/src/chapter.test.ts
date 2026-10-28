import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkAlignmentLineIds, indexLineIds, isLine, walkLines, type Chapter } from './chapter.js';

const ch1: Chapter = [
  { label: 'a', children: [{ id: 'aaaaaaaa', text: 'x' }, { children: [{ id: 'bbbbbbbb', text: 'y' }] }] },
  { children: [{ id: 'cccccccc', text: 'z' }] },
];

describe('chapter helpers', () => {
  it('isLine tells lines from sections', () => {
    assert.ok(isLine({ id: 'aaaaaaaa', text: 'x' }));
    assert.equal(isLine({ children: [] }), false);
    assert.equal(isLine({ label: 'l', children: [], text: 'old' }), false);
    assert.equal(isLine('x'), false);
  });

  it('walkLines yields lines in document order with pointers', () => {
    assert.deepEqual(
      [...walkLines(ch1)].map((r) => [r.line.id, r.pointer]),
      [
        ['aaaaaaaa', '/0/children/0'],
        ['bbbbbbbb', '/0/children/1/children/0'],
        ['cccccccc', '/1/children/0'],
      ],
    );
  });

  it('indexLineIds rejects duplicate ids across the corpus', () => {
    const ok = indexLineIds([{ key: 'chapter_01', data: ch1 }]);
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.index.get('bbbbbbbb'), { chapter: 'chapter_01', pointer: '/0/children/1/children/0' });

    const ch2: Chapter = [{ children: [{ id: 'dddddddd', text: 'w' }, { id: 'bbbbbbbb', text: 'v' }] }];
    const dup = indexLineIds([
      { key: 'chapter_01', data: ch1 },
      { key: 'chapter_02', data: ch2 },
    ]);
    assert.deepEqual(dup.errors, [
      'chapter_02.json: /0/children/1 line id "bbbbbbbb" is already used at chapter_01.json /0/children/1/children/0',
    ]);

    const within = indexLineIds([{ key: 'chapter_03', data: [{ children: [ch1[1]!, ch1[1]!] }] }]);
    assert.equal(within.errors.length, 1);
  });

  it('checkAlignmentLineIds requires each lineId to exist in the named chapter', () => {
    const { index } = indexLineIds([{ key: 'chapter_01', data: ch1 }]);
    assert.deepEqual(checkAlignmentLineIds([], index), []);
    const errors = checkAlignmentLineIds(
      [
        {
          file: 'a.json',
          data: {
            lectureId: 'a.mp3',
            segments: [
              { chapter: 'chapter_01', lineId: 'aaaaaaaa' },
              { chapter: 'chapter_01', lineId: 'zzzzzzzz' },
              { chapter: 'chapter_02', lineId: 'cccccccc' },
            ],
          },
        },
      ],
      index,
    );
    assert.deepEqual(errors, [
      'a.json: /segments/1 line id "zzzzzzzz" does not exist',
      'a.json: /segments/2 line id "cccccccc" is in chapter_01, not chapter_02',
    ]);
  });
});
