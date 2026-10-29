import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { indexLineIds, type Chapter } from './chapter.js';
import { defaultPaths } from './pipeline.js';
import { applyRetimed, checkRetimed, retimedPath, transcriptSha, wordTimes, type RetimedFile } from './retimed.js';
import { defaultSourcePaths, validateSources } from './sources.js';
import type { SoferWord } from './transcripts.js';
import { SchemaSet } from './validate.js';

// Shared with data/retime/tests/test_retime.py: both implementations must give this hash.
const SHA_WORDS: SoferWord[] = [
  { word: 'Hello', start: 0.0, end: 0.4995 },
  { word: 'אור', start: 1.0005, end: 1.25 },
  { word: 'world.', start: 12.3456, end: 12.9 },
];
const SHA_EXPECTED = '80b8b21a5188e02272b99de4f58c64b30530c21053497be4a2b410b85ede886d';

const retimedFor = (words: SoferWord[], over: Partial<RetimedFile> = {}): RetimedFile => ({
  schemaVersion: 1,
  lectureId: 'b.mp3',
  transcript: 'transcripts/b.mp3.json',
  transcriptSha: transcriptSha(words),
  method: { name: 'mms-fa-ctc-windowed', version: 1 },
  stats: { words: words.length, anchors: 1 },
  words: words.map((_, i) => [10 + i, 10.5 + i, 0.9, 2]),
  ...over,
});

describe('transcriptSha', () => {
  it('hashes word, start ms and end ms per line (the Python tool gives the same)', () => {
    assert.equal(transcriptSha(SHA_WORDS), SHA_EXPECTED);
  });
  it('changes when a time changes by a millisecond, not by less', () => {
    const moved = SHA_WORDS.map((w, i) => (i === 2 ? { ...w, start: 12.3466 } : w));
    assert.notEqual(transcriptSha(moved), SHA_EXPECTED);
    const jitter = SHA_WORDS.map((w, i) => (i === 2 ? { ...w, start: 12.34561 } : w));
    assert.equal(transcriptSha(jitter), SHA_EXPECTED);
  });
  it('ignores fields other than word, start and end', () => {
    assert.equal(transcriptSha(SHA_WORDS.map((w) => ({ ...w, speaker: 'A' }))), SHA_EXPECTED);
  });
});

describe('checkRetimed / applyRetimed', () => {
  it('accepts a matching file and swaps in its times, keeping the other fields', () => {
    const words = SHA_WORDS.map((w) => ({ ...w, speaker: 'A' }));
    const r = retimedFor(words);
    assert.deepEqual(checkRetimed(r, words), []);
    assert.deepEqual(applyRetimed(words, r)[1], { word: 'אור', start: 11, end: 11.5, speaker: 'A' });
  });
  it('reports a stale hash, a word count mismatch and non-monotone times', () => {
    const r = retimedFor(SHA_WORDS);
    const changed = SHA_WORDS.map((w, i) => (i === 0 ? { ...w, word: 'Hullo' } : w));
    assert.match(checkRetimed(r, changed)[0]!, /^stale: /);
    assert.deepEqual(checkRetimed({ ...r, words: r.words.slice(1) }, SHA_WORDS), ['has 2 words, the transcript has 3']);
    const back = { ...r, words: [r.words[0]!, [9, 9.5, 0.9, 2], r.words[2]!] as RetimedFile['words'] };
    assert.deepEqual(checkRetimed(back, SHA_WORDS), ["word 1: start 9 is before the previous word's 10"]);
    const inverted = { ...r, words: [[1, 0.5, null, 0], ...r.words.slice(1)] as RetimedFile['words'] };
    assert.deepEqual(checkRetimed(inverted, SHA_WORDS), ['word 0: needs 0 <= start <= end (got 1, 0.5)']);
  });
});

describe('wordTimes', () => {
  const dataDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'retimed-'));
    mkdirSync(path.join(dir, 'retimed'));
    return dir;
  };
  it("falls back to Sofer's times when there is no file", () => {
    const t = wordTimes(dataDir(), 'b.mp3', SHA_WORDS);
    assert.equal(t.source, 'sofer');
    assert.equal(t.words, SHA_WORDS);
    assert.deepEqual(t.errors, []);
  });
  it('uses a matching file', () => {
    const dir = dataDir();
    writeFileSync(retimedPath(dir, 'b.mp3'), JSON.stringify(retimedFor(SHA_WORDS)));
    const t = wordTimes(dir, 'b.mp3', SHA_WORDS);
    assert.equal(t.source, 'retimed');
    assert.equal(t.file, 'retimed/b.mp3.json');
    assert.deepEqual(t.words.map((w) => w.start), [10, 11, 12]);
  });
  it('reports a stale or broken file instead of falling back silently', () => {
    const dir = dataDir();
    writeFileSync(retimedPath(dir, 'b.mp3'), JSON.stringify(retimedFor(SHA_WORDS, { transcriptSha: '0'.repeat(64) })));
    const t = wordTimes(dir, 'b.mp3', SHA_WORDS);
    assert.equal(t.source, 'sofer');
    assert.equal(t.errors.length, 1);
    assert.match(t.errors[0]!, /^retimed\/b\.mp3\.json: stale: .*uv run retime --lecture "b\.mp3"/);
    writeFileSync(retimedPath(dir, 'b.mp3'), '{');
    assert.match(wordTimes(dir, 'b.mp3', SHA_WORDS).errors[0]!, /invalid JSON/);
  });
});

describe('validateSources (retimed)', () => {
  const schemas = new SchemaSet(defaultPaths().schemaDir);
  const chapter: Chapter = [{ children: [{ id: 'aaaaaaaa', text: 'אור' }] }];
  const { index } = indexLineIds([{ key: 'chapter_10', data: chapter }]);
  const transcript = {
    schemaVersion: 1, lectureId: 'b.mp3', audioUrl: 'u', provider: 'sofer.ai',
    sofer: { transcriptionId: 't1', title: 'P [b.mp3]', folderPath: ['S'], request: {} },
    result: { text: '', info: {}, timestamps: SHA_WORDS },
  };
  const setup = (retimed: object | null, alignmentTimes?: 'retimed' | 'sofer') => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sources-'));
    const paths = { ...defaultSourcePaths(dir), sourceSchemaDir: defaultPaths().sources.sourceSchemaDir };
    for (const d of [paths.transcriptsDir, paths.retimedDir, paths.alignmentsDir]) mkdirSync(d);
    writeFileSync(path.join(paths.transcriptsDir, 'b.mp3.json'), JSON.stringify(transcript));
    if (retimed) writeFileSync(path.join(paths.retimedDir, 'b.mp3.json'), JSON.stringify(retimed));
    const seg = { startSeconds: 0, endSeconds: 1, chapter: 'chapter_10', lineId: 'aaaaaaaa', confidence: 1 };
    const method = { name: 'monotonic-dp', version: 1, options: {}, ...(alignmentTimes ? { times: alignmentTimes } : {}) };
    writeFileSync(
      path.join(paths.alignmentsDir, 'b.mp3.json'),
      JSON.stringify({ schemaVersion: 1, lectureId: 'b.mp3', transcript: 'transcripts/b.mp3.json', method, segments: [seg] }),
    );
    return paths;
  };
  const ids = new Set(['b.mp3']);

  it('accepts a current file with an alignment made from it', () => {
    assert.deepEqual(validateSources(setup(retimedFor(SHA_WORDS), 'retimed'), schemas, ids, index), []);
  });
  it('fails on a stale file, a wrong word count and a schema error', () => {
    const stale = validateSources(setup(retimedFor(SHA_WORDS, { transcriptSha: 'f'.repeat(64) }), 'retimed'), schemas, ids, index);
    assert.equal(stale.length, 1);
    assert.match(stale[0]!, /^retimed\/b\.mp3\.json: stale: /);
    const short = retimedFor(SHA_WORDS);
    short.words = short.words.slice(0, 2);
    assert.deepEqual(validateSources(setup(short, 'retimed'), schemas, ids, index), ['retimed/b.mp3.json: has 2 words, the transcript has 3']);
    const bad = validateSources(setup({ ...retimedFor(SHA_WORDS), words: [[1, 2, 0.5, 7]] }, 'retimed'), schemas, ids, index);
    assert.ok(bad.length > 0 && bad.every((e) => e.startsWith('retimed/b.mp3.json: /words/0/3')), bad.join('\n'));
  });
  it('fails when an alignment used other word times than the lecture has now', () => {
    assert.deepEqual(validateSources(setup(retimedFor(SHA_WORDS)), schemas, ids, index), [
      'alignments/b.mp3.json: made from sofer word times, but the lecture now has retimed times (rerun yarn align --lecture "b.mp3")',
    ]);
    assert.deepEqual(validateSources(setup(null, 'retimed'), schemas, ids, index), [
      'alignments/b.mp3.json: made from retimed word times, but the lecture now has sofer times (rerun yarn align --lecture "b.mp3")',
    ]);
    assert.deepEqual(validateSources(setup(null), schemas, ids, index), []);
  });
});
