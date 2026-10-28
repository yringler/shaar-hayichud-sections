/**
 * Which catalog series `yarn transcribe` may transcribe, and with which
 * per-series Sofer.ai settings. This is the one place to change either.
 *
 * Keyed by the series' catalog id (the `:N` on its `#` line in classes.txt),
 * which never changes; `title` must match classes.txt and is checked by the
 * tests, so a renamed or renumbered series cannot silently drop out.
 *
 * A series that is not listed here is out of scope: `yarn transcribe`
 * refuses its lectures unless `--allow-out-of-scope` is passed (and then
 * transcribes them with speaker labeling off).
 */
import type { LectureContext } from './transcripts.js';

/**
 * Speaker labeling (diarization). `off` sends `num_speakers: 1` (no
 * surcharge); `auto` sends `auto_detect_speakers: true`; `count` sends
 * `num_speakers: N` (N > 1). Both labeling modes cost +$0.30 per audio hour.
 */
export type SpeakerSetting = { mode: 'off' } | { mode: 'auto' } | { mode: 'count'; count: number };

export interface SeriesTranscriptionConfig {
  /** Catalog id of the `#` series heading. */
  seriesId: string;
  /** The series title in classes.txt (checked by the tests). */
  title: string;
  speakers: SpeakerSetting;
  /** Why these settings. */
  note: string;
}

export const TRANSCRIPTION_SERIES: readonly SeriesTranscriptionConfig[] = [
  {
    seriesId: '0',
    title: 'Rabbi Benyamin Walters Original Class',
    speakers: { mode: 'off' },
    note: 'Only Rabbi Walters is audible on the recordings, even in Q and A.',
  },
  {
    seriesId: '37',
    title: 'Rabbi Markel Series (Advanced)',
    // Off despite the students being audible: auto-detect was tried on Part 1
    // (001, 002) and found one speaker, or a spurious second one made of the
    // teacher's own phrases, never the students. Not worth +$0.30/h.
    speakers: { mode: 'off' },
    note: 'Students are audible, but Sofer speaker labeling did not separate them on these tape recordings.',
  },
  // Not yet in scope (need cleanup first): "Rabbi Benyamin Walters New Class
  // (2020)" (:75) and "Rabbi Benyamin Walters Other Classes" (:73).
];

/** The series config for a lecture (by its top-level heading), or undefined when out of scope. */
export function seriesConfigFor(
  ctx: LectureContext,
  config: readonly SeriesTranscriptionConfig[] = TRANSCRIPTION_SERIES,
): SeriesTranscriptionConfig | undefined {
  const series = ctx.ancestors[0];
  return series ? config.find((c) => c.seriesId === series.id) : undefined;
}

/** Splits lectures into those in an allowed series and those outside it. */
export function partitionByScope(
  contexts: LectureContext[],
  config: readonly SeriesTranscriptionConfig[] = TRANSCRIPTION_SERIES,
): { inScope: LectureContext[]; outOfScope: LectureContext[] } {
  const inScope: LectureContext[] = [];
  const outOfScope: LectureContext[] = [];
  for (const c of contexts) (seriesConfigFor(c, config) ? inScope : outOfScope).push(c);
  return { inScope, outOfScope };
}

/** The speaker setting for a lecture: its series', or off for an out-of-scope lecture let through by override. */
export function speakerSettingFor(
  ctx: LectureContext,
  config: readonly SeriesTranscriptionConfig[] = TRANSCRIPTION_SERIES,
): SpeakerSetting {
  return seriesConfigFor(ctx, config)?.speakers ?? { mode: 'off' };
}

/** The Sofer request fields for a speaker setting (they go on each manifest item, or in `info` for a single file). */
export function speakerFields(s: SpeakerSetting): { num_speakers: number } | { auto_detect_speakers: true } {
  switch (s.mode) {
    case 'off':
      return { num_speakers: 1 };
    case 'auto':
      return { auto_detect_speakers: true };
    case 'count':
      if (!Number.isInteger(s.count) || s.count < 2) throw new Error(`num_speakers must be an integer > 1, got ${s.count}`);
      return { num_speakers: s.count };
  }
}

export function speakerLabelingOn(s: SpeakerSetting): boolean {
  return s.mode !== 'off';
}

/**
 * USD per audio hour, from the Sofer docs; used only for the pre-submit
 * balance check. Standard-mode batches cost $1.00/h with model v1, single
 * files (and express batches) $1.50/h; v0 is $1.00/h either way. Speaker
 * labeling adds $0.30/h.
 */
export const PRICE_PER_HOUR = {
  batch: { v1: 1.0, v0: 1.0 } as Record<string, number>,
  single: { v1: 1.5, v0: 1.0 } as Record<string, number>,
  speakers: 0.3,
};

/** Estimated cost in cents (rounded up) of one lecture; an unknown duration counts as one hour. */
export function estimateCents(
  durationSeconds: number | null,
  speakers: SpeakerSetting,
  model: string,
  mode: 'batch' | 'single',
): number {
  const hours = (durationSeconds ?? 3600) / 3600;
  const base = PRICE_PER_HOUR[mode][model] ?? PRICE_PER_HOUR.single['v1']!;
  const perHour = base + (speakerLabelingOn(speakers) ? PRICE_PER_HOUR.speakers : 0);
  return Math.ceil(hours * perHour * 100);
}
