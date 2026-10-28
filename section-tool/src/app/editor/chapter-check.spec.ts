import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkChapterJson } from './chapter-check';

const check = (value: unknown) => checkChapterJson(JSON.stringify(value));
const line = (id: string, text = 'text') => ({ id, text });

describe('checkChapterJson', () => {
  it('accepts a valid chapter', () => {
    expect(
      check([{ label: 'L', children: [line('aaaaaaaa'), { children: [line('bbbbbbbb')] }], translation: 'T' }]),
    ).toEqual([]);
  });

  it('rejects invalid JSON and non-arrays', () => {
    expect(checkChapterJson('{')).toEqual(['content is not valid JSON']);
    expect(check({ children: [] })).toEqual(['chapter must be a JSON array of sections']);
  });

  it('rejects plain strings (text without line ids)', () => {
    expect(check([{ children: ['old style'] }])).toEqual([
      '/0/children/0: text must be a line object {id, text}, not a string',
    ]);
  });

  it('rejects missing, malformed and duplicate line ids', () => {
    expect(check([{ children: [{ text: 'x' }, line('BAD'), line('aaaaaaaa'), { children: [line('aaaaaaaa')] }] }])).toEqual([
      '/0/children/0: line id must match [a-z2-7]{8}',
      '/0/children/1: line id must match [a-z2-7]{8}',
      '/0/children/3/children/0: line id "aaaaaaaa" is already used at /0/children/2',
    ]);
  });

  it('rejects blank or multi-line text and extra keys', () => {
    expect(check([{ children: [line('aaaaaaaa', ' '), line('bbbbbbbb', 'a\nb'), { ...line('cccccccc'), x: 1 }] }])).toEqual([
      '/0/children/0: line text must be a non-blank string without newlines',
      '/0/children/1: line text must be a non-blank string without newlines',
      '/0/children/2: unexpected key "x" on a line',
    ]);
  });

  it('rejects malformed sections', () => {
    expect(check([{ id: 'x', label: 3, children: [], translation: false }, { label: 'no children' }, 5])).toEqual([
      '/0: unexpected key "id"',
      '/0: label must be a string',
      '/0: translation must be a string',
      '/1: children must be an array',
      '/2: expected a section object',
    ]);
  });

  it('stops after `limit` problems', () => {
    expect(check([{ children: Array.from({ length: 50 }, () => 'x') }])).toHaveLength(20);
  });

  it('accepts every chapter in data/chapters', () => {
    const dir = resolve(process.cwd(), '../data/chapters');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      expect([file, checkChapterJson(readFileSync(resolve(dir, file), 'utf8'))]).toEqual([file, []]);
    }
  });
});
