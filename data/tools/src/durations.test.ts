import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fillDurations } from './durations.js';
import { parseClassesTxt } from './parse.js';

describe('fillDurations', () => {
  const text = ['// c', '# S:1', '> f', '- T', '@ keep-id', '  a.mp3', 'b.mp3:9', 'c.mp3', 'd.mp3', ''].join('\n');

  it('appends durations to file lines that lack one and leaves everything else alone', async () => {
    const probed: string[] = [];
    const result = await fillDurations(
      parseClassesTxt(text),
      (l) => `u:${l.folder}/${l.filename}`,
      async (l, url) => {
        probed.push(url);
        return l.filename === 'c.mp3' ? 1477 : l.filename === 'd.mp3' ? null : 61.5;
      },
      { concurrency: 2 },
    );
    assert.deepEqual(probed.sort(), ['u:f/a.mp3', 'u:f/c.mp3', 'u:f/d.mp3']);
    assert.equal(
      result.text,
      ['// c', '# S:1', '> f', '- T', '@ keep-id', '  a.mp3:61.5', 'b.mp3:9', 'c.mp3:1477', 'd.mp3', ''].join('\n'),
    );
    assert.deepEqual(result.updates.map((u) => u.line), [6, 8]);
    assert.deepEqual(result.failures, ['d.mp3: could not determine duration']);

    const reparsed = parseClassesTxt(result.text);
    assert.deepEqual(reparsed.errors, []);
    assert.equal(reparsed.lectures[0]!.id, 'keep-id');
    assert.equal(reparsed.lectures[0]!.durationSeconds, 61.5);
  });

  it('records probe exceptions as failures', async () => {
    const result = await fillDurations(parseClassesTxt('# S:1\n> f\na.mp3\n'), () => 'u', async () => {
      throw new Error('boom');
    });
    assert.deepEqual(result.failures, ['a.mp3: boom']);
    assert.equal(result.text, '# S:1\n> f\na.mp3\n');
  });
});
