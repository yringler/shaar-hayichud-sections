import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { checkAudioEdits, editsSha, type AudioEditsFile } from './audio-edits.js';
import { indexLineIds, type Chapter } from './chapter.js';
import { defaultPaths } from './pipeline.js';
import { transcriptSha } from './retimed.js';
import { defaultSourcePaths, validateSources } from './sources.js';
import type { SoferWord } from './transcripts.js';
import { SchemaSet } from './validate.js';

// Shared with data/retime/tests/test_backchannel.py: both implementations must give this hash.
const SHA_EDITS = [
  { start: 1.0, end: 1.4, action: 'fill' as const },
  { start: 5.1, end: 5.3, action: 'partial-fill' as const },
  { start: 1234.56, end: 1235.07, action: 'fill' as const },
];
const SHA_EXPECTED = 'f79145335ab6a50e1c4480a51073a161d944188705ce1eceabe14bc8fecfe1d6';

const WORDS: SoferWord[] = [
  { word: 'So.', start: 0.5, end: 0.9 },
  { word: 'Right.', start: 1.0, end: 1.4 },
  { word: 'Next', start: 1.6, end: 2.0 },
];

const editsFor = (over: Partial<AudioEditsFile> = {}): AudioEditsFile => {
  const edits: AudioEditsFile['edits'] = [
    { start: 1.0, end: 1.4, class: 'isolated', action: 'fill', src: 'audio', scores: { spk: 0.4 } },
    { start: 5.1, end: 5.3, class: 'overlap', action: 'partial-fill', src: 'tx', scores: {} },
  ];
  return {
    schemaVersion: 1,
    lectureId: 'b.mp3',
    mode: 'fill',
    transcript: 'transcripts/b.mp3.json',
    transcriptSha: transcriptSha(WORDS),
    wordTimes: 'sofer',
    method: { name: 'audio-led-listener', version: 1, thresholds: {} },
    source: { url: 'https://x/b.mp3', sha256: 'a'.repeat(64), sampleRate: 16000, channels: 1, durationSeconds: 10, bitrate: 24000 },
    stats: {},
    edits,
    kept: [{ start: 7, end: 7.2, reason: 'audio:low-P:?' }],
    output: {
      filename: 'b (edited).mp3', sha256: 'b'.repeat(64), durationSeconds: 10, bitrate: 32000, sampleRate: 16000, channels: 1,
      encoder: 'libmp3lame', editsSha: editsSha(edits), verify: { ok: true },
    },
    ...over,
  };
};

describe('editsSha', () => {
  it('hashes start, end (2 decimals) and action per edit (the Python tool gives the same)', () => {
    assert.equal(editsSha(SHA_EDITS), SHA_EXPECTED);
  });
});

describe('checkAudioEdits', () => {
  it('accepts a current list', () => {
    assert.deepEqual(checkAudioEdits(editsFor(), WORDS), []);
    assert.deepEqual(checkAudioEdits(editsFor({ output: null }), WORDS), []);
  });
  it('reports a stale transcript, overlapping or out-of-range edits and a render of other edits', () => {
    const changed = WORDS.map((w, i) => (i === 0 ? { ...w, word: 'Sol.' } : w));
    assert.match(checkAudioEdits(editsFor(), changed)[0]!, /^stale: .*backchannel detect --lecture "b\.mp3"/);
    const d = editsFor();
    d.edits[1] = { ...d.edits[1]!, start: 1.2 };
    const errs = checkAudioEdits(d, WORDS);
    assert.ok(errs.some((e) => /edit 1: starts at 1\.2 s, before the previous edit ends/.test(e)), errs.join('\n'));
    assert.ok(errs.some((e) => /rendered from other edits/.test(e)), errs.join('\n'));
    const late = editsFor({ output: null });
    late.edits[1] = { ...late.edits[1]!, start: 11, end: 11.3 };
    assert.match(checkAudioEdits(late, WORDS)[0]!, /edit 1: ends at 11\.3 s, after the audio/);
  });
});

describe('validateSources (edits)', () => {
  const schemas = new SchemaSet(defaultPaths().schemaDir);
  const chapter: Chapter = [{ children: [{ id: 'aaaaaaaa', text: 'אור' }] }];
  const { index } = indexLineIds([{ key: 'chapter_10', data: chapter }]);
  const transcript = {
    schemaVersion: 1, lectureId: 'b.mp3', audioUrl: 'u', provider: 'sofer.ai',
    sofer: { transcriptionId: 't1', title: 'P [b.mp3]', folderPath: ['S'], request: {} },
    result: { text: '', info: {}, timestamps: WORDS },
  };
  const setup = (edits: object, name = 'b.mp3.json') => {
    const dir = mkdtempSync(path.join(tmpdir(), 'edits-'));
    const paths = { ...defaultSourcePaths(dir), sourceSchemaDir: defaultPaths().sources.sourceSchemaDir };
    for (const d of [paths.transcriptsDir, paths.editsDir]) mkdirSync(d);
    writeFileSync(path.join(paths.transcriptsDir, 'b.mp3.json'), JSON.stringify(transcript));
    writeFileSync(path.join(paths.editsDir, name), JSON.stringify(edits));
    return paths;
  };
  const ids = new Set(['b.mp3']);

  it('accepts a valid file', () => {
    assert.deepEqual(validateSources(setup(editsFor()), schemas, ids, index), []);
  });
  it('fails on a stale transcriptSha, an unknown lecture and schema errors', () => {
    const stale = validateSources(setup(editsFor({ transcriptSha: 'f'.repeat(64) })), schemas, ids, index);
    assert.equal(stale.length, 1);
    assert.match(stale[0]!, /^edits\/b\.mp3\.json: stale: /);
    const unknown = validateSources(setup(editsFor({ lectureId: 'c.mp3' }), 'c.mp3.json'), schemas, ids, index);
    assert.ok(unknown.some((e) => e === 'edits/c.mp3.json: lecture id "c.mp3" is not in classes.txt'), unknown.join('\n'));
    const bad = validateSources(setup({ ...editsFor(), mode: 'cut' }), schemas, ids, index);
    assert.ok(bad.length > 0 && bad.every((e) => e.startsWith('edits/b.mp3.json: /mode')), bad.join('\n'));
    const unverified = editsFor();
    (unverified.output as { verify: object }).verify = { ok: false };
    const uv = validateSources(setup(unverified), schemas, ids, index);
    assert.ok(uv.length > 0 && uv.every((e) => e.startsWith('edits/b.mp3.json: /output')), uv.join('\n'));
  });
});
