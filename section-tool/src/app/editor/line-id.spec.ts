import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LINE_ID_ALPHABET, LINE_ID_LENGTH, LINE_ID_PATTERN, freshLineId, isLineId, randomLineId } from './line-id';
import { randomIds } from './ids';

describe('line ids', () => {
  it('random ids match the pattern', () => {
    for (let i = 0; i < 200; i++) expect(randomLineId()).toMatch(LINE_ID_PATTERN);
    expect(randomIds.lineId(new Set())).toMatch(LINE_ID_PATTERN);
  });

  it('maps bytes onto the alphabet with & 31', () => {
    expect(randomLineId(() => new Uint8Array([0, 1, 25, 26, 31, 32, 255, 7]))).toBe('abz27a7h');
  });

  it('isLineId accepts only 8 base32 lowercase characters', () => {
    expect(isLineId('abcdefg2')).toBe(true);
    for (const bad of ['abcdefg', 'abcdefg22', 'ABCDEFGH', 'abcdefg1', 'abcdefg8', 7, null]) {
      expect(isLineId(bad)).toBe(false);
    }
  });

  it('freshLineId retries on collision and does not add to `taken`', () => {
    const queue = [new Uint8Array(8).fill(0), new Uint8Array(8).fill(1)];
    const taken = new Set(['aaaaaaaa']);
    expect(freshLineId(taken, () => queue.shift()!)).toBe('bbbbbbbb');
    expect([...taken]).toEqual(['aaaaaaaa']);
  });

  it('freshLineId gives up on a broken random source', () => {
    expect(() => freshLineId(new Set(['aaaaaaaa']), (n) => new Uint8Array(n))).toThrow();
  });

  it('matches the format the data build enforces (data/tools/src/line-id.ts)', () => {
    const source = readFileSync(resolve(process.cwd(), '../data/tools/src/line-id.ts'), 'utf8');
    expect(source).toContain(`LINE_ID_ALPHABET = '${LINE_ID_ALPHABET}'`);
    expect(source).toContain(`LINE_ID_LENGTH = ${LINE_ID_LENGTH}`);
    expect(source).toContain(`LINE_ID_PATTERN = ${LINE_ID_PATTERN}`);
  });
});
