import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLineId, LINE_ID_PATTERN, newLineId, randomLineId } from './line-id.js';

describe('line ids', () => {
  it('are 8 lowercase base32 characters', () => {
    for (let i = 0; i < 500; i++) assert.match(randomLineId(), LINE_ID_PATTERN);
    assert.equal(randomLineId(() => new Uint8Array(8)), 'aaaaaaaa');
    assert.equal(randomLineId(() => new Uint8Array(8).fill(255)), '77777777');
    assert.equal(randomLineId(() => Uint8Array.from([0, 25, 26, 31, 32, 57, 58, 63])), 'az27az27');
  });

  it('isLineId', () => {
    assert.ok(isLineId('abcd2345'));
    for (const bad of ['ABCD2345', 'abcd234', 'abcd23456', 'abcd2341', 'abcd 345', 7, null]) {
      assert.equal(isLineId(bad), false, String(bad));
    }
  });

  it('newLineId retries on collision and records the id', () => {
    const taken = new Set(['aaaaaaaa']);
    const seq = [new Uint8Array(8), new Uint8Array(8), new Uint8Array(8).fill(1)];
    const id = newLineId(taken, () => seq.shift()!);
    assert.equal(id, 'bbbbbbbb');
    assert.deepEqual([...taken], ['aaaaaaaa', 'bbbbbbbb']);
  });

  it('newLineId gives up on a broken random source', () => {
    assert.throws(() => newLineId(new Set(['aaaaaaaa']), () => new Uint8Array(8)), /free id/);
  });

  it('newLineId is unique over many draws', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 5000; i++) newLineId(taken);
    assert.equal(taken.size, 5000);
  });
});
