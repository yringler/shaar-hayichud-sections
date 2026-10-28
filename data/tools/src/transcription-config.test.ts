import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildStoredOutline, formatOutline, OUTLINE_REQUEST, outlineNeeded } from './outline.js';
import { parseClassesTxt } from './parse.js';
import { defaultPaths } from './pipeline.js';
import {
  estimateCents,
  partitionByScope,
  seriesConfigFor,
  speakerFields,
  speakerSettingFor,
  TRANSCRIPTION_SERIES,
} from './transcription-config.js';
import { lectureContexts, type StoredTranscript } from './transcripts.js';

const parsed = parseClassesTxt(readFileSync(defaultPaths().classesTxt, 'utf8'));
const all = lectureContexts(parsed.series);
const byId = (id: string) => all.find((c) => c.lecture.id === id)!;

describe('transcription config', () => {
  it('names real series by id and title', () => {
    for (const c of TRANSCRIPTION_SERIES) {
      const s = parsed.series.find((x) => x.id === c.seriesId);
      assert.ok(s, `series :${c.seriesId} is in classes.txt`);
      assert.equal(s.title, c.title);
    }
  });

  it('allows only Walters Original and Markel Advanced', () => {
    assert.deepEqual(TRANSCRIPTION_SERIES.map((s) => s.title).sort(), [
      'Rabbi Benyamin Walters Original Class',
      'Rabbi Markel Series (Advanced)',
    ]);
    const { inScope, outOfScope } = partitionByScope(all);
    const titles = (xs: typeof all) => [...new Set(xs.map((c) => c.ancestors[0]!.title))].sort();
    assert.deepEqual(titles(inScope), ['Rabbi Benyamin Walters Original Class', 'Rabbi Markel Series (Advanced)']);
    assert.deepEqual(titles(outOfScope), ['Rabbi Benyamin Walters New Class (2020)', 'Rabbi Benyamin Walters Other Classes']);
  });

  it('labels no speakers for Walters or Markel (Markel auto-detect did not separate the students)', () => {
    const markel = byId('002 Tape016-Side1-Ch10.mp3');
    const walters = byId('07 - Chap- 10-1 Atmus Ohr Ein Sof (M).mp3');
    assert.equal(seriesConfigFor(markel)?.seriesId, '37');
    assert.deepEqual(speakerFields(speakerSettingFor(markel)), { num_speakers: 1 });
    assert.deepEqual(speakerFields({ mode: 'auto' }), { auto_detect_speakers: true });
    assert.deepEqual(speakerFields(speakerSettingFor(walters)), { num_speakers: 1 });
    assert.deepEqual(speakerFields({ mode: 'count', count: 3 }), { num_speakers: 3 });
    assert.throws(() => speakerFields({ mode: 'count', count: 1 }), /> 1/);
    const outside = all.find((c) => !seriesConfigFor(c))!;
    assert.deepEqual(speakerSettingFor(outside), { mode: 'off' });
  });

  it('estimates at the batch price plus the speaker surcharge', () => {
    assert.equal(estimateCents(3600, { mode: 'off' }, 'v1', 'batch'), 100);
    assert.equal(estimateCents(3600, { mode: 'auto' }, 'v1', 'batch'), 130);
    assert.equal(estimateCents(3600, { mode: 'off' }, 'v1', 'single'), 150);
    assert.equal(estimateCents(null, { mode: 'auto' }, 'v1', 'single'), 180);
    // The two Markel Part 1 classes: 722.997 s + 1804.218667 s.
    assert.equal(estimateCents(722.997, { mode: 'auto' }, 'v1', 'batch') + estimateCents(1804.218667, { mode: 'auto' }, 'v1', 'batch'), 93);
  });
});

describe('outlines', () => {
  const transcript = { lectureId: 'a.mp3', sofer: { transcriptionId: 't2' } } as StoredTranscript;
  const topic = { title: 'Intro', starting_phrase: 'so', matched_text: 'so', score_norm: 1, confidence: 'HIGH' as const, start_time_sec: 3 };

  it('fetches when missing, stale or forced, and skips otherwise', () => {
    const stored = buildStoredOutline(transcript, 'transcripts/a.mp3.json', [topic], OUTLINE_REQUEST, new Date('2026-10-28T00:00:00Z'));
    assert.equal(outlineNeeded(transcript, null, false), 'no outline yet');
    assert.equal(outlineNeeded(transcript, stored, false), null);
    assert.equal(outlineNeeded(transcript, stored, true), 'forced');
    assert.match(outlineNeeded(transcript, { ...stored, transcriptionId: 't1' }, false)!, /stale/);
  });

  it('wraps the raw response and writes one topic per line', () => {
    const stored = buildStoredOutline(transcript, 'transcripts/a.mp3.json', [topic, topic], OUTLINE_REQUEST, new Date('2026-10-28T00:00:00Z'));
    assert.deepEqual(stored.request, { monotone: true, conclusion_bias: false });
    assert.equal(stored.fetchedAt, '2026-10-28T00:00:00.000Z');
    const text = formatOutline(stored);
    assert.deepEqual(JSON.parse(text), stored);
    assert.equal(text.split('\n').filter((l) => l.includes('"starting_phrase"')).length, 2);
    assert.throws(() => buildStoredOutline(transcript, 'x', { detail: 'no' } as never, OUTLINE_REQUEST, new Date()), /unexpected/);
  });
});
