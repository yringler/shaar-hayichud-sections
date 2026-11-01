/**
 * Listener back-channel edit lists (data/edits/, written by `backchannel` in
 * data/retime/): spans of a class recording that are replaced by room tone in
 * the edited mp3 uploaded next to the original. Duration never changes, so
 * transcripts, retimed words and alignments stay valid for the edited file.
 * The build only checks them; nothing here is published.
 */
import { createHash } from 'node:crypto';
import { transcriptSha } from './retimed.js';
import type { SoferWord } from './transcripts.js';

export interface AudioEdit {
  start: number;
  end: number;
  class: 'isolated' | 'overlap';
  action: 'fill' | 'partial-fill';
  src?: string;
  scores?: Record<string, unknown>;
}

/** data/edits/<encoded lecture id>.json (schema/sources/audio-edits.schema.json). */
export interface AudioEditsFile {
  schemaVersion: 1;
  lectureId: string;
  mode: 'fill';
  /** Transcript path relative to data/. */
  transcript: string;
  transcriptSha: string;
  wordTimes: 'retimed' | 'sofer';
  method: { name: string; version: number; [k: string]: unknown };
  source: { url: string; sha256: string; sampleRate: number; channels: number; durationSeconds: number; bitrate?: number | null };
  stats: Record<string, unknown>;
  edits: AudioEdit[];
  kept: { start: number; end: number; reason: string }[];
  output: null | {
    filename: string;
    sha256: string;
    durationSeconds: number;
    editsSha: string;
    verify: { ok: true; [k: string]: unknown };
    [k: string]: unknown;
  };
}

/**
 * sha256 of each edit's `start.toFixed(2) TAB end.toFixed(2) TAB action LF`:
 * what a render depends on. Must match data/retime/src/retime/backchannel/editlist.py (edits_sha).
 */
export function editsSha(edits: readonly Pick<AudioEdit, 'start' | 'end' | 'action'>[]): string {
  const h = createHash('sha256');
  for (const e of edits) h.update(`${e.start.toFixed(2)}\t${e.end.toFixed(2)}\t${e.action}\n`, 'utf8');
  return h.digest('hex');
}

/** Problems with an edit list against the transcript's current words. Empty when fine. */
export function checkAudioEdits(d: AudioEditsFile, words: readonly SoferWord[]): string[] {
  const errors: string[] = [];
  const sha = transcriptSha(words);
  if (d.transcriptSha !== sha) {
    errors.push(
      `stale: made from a transcript with transcriptSha ${d.transcriptSha.slice(0, 12)}…, the transcript is now ${sha.slice(0, 12)}… ` +
        `(rerun data/retime: uv run backchannel detect --lecture "${d.lectureId}", or delete the file)`,
    );
  }
  const dur = d.source.durationSeconds;
  for (let i = 0; i < d.edits.length; i++) {
    const { start, end } = d.edits[i]!;
    if (!(end > start)) {
      errors.push(`edit ${i}: needs start < end (got ${start}, ${end})`);
      break;
    }
    if (end > dur + 0.05) {
      errors.push(`edit ${i}: ends at ${end} s, after the audio (${dur} s)`);
      break;
    }
    if (i > 0 && start < d.edits[i - 1]!.end) {
      errors.push(`edit ${i}: starts at ${start} s, before the previous edit ends (${d.edits[i - 1]!.end} s)`);
      break;
    }
  }
  if (d.output && d.output.editsSha !== editsSha(d.edits)) {
    errors.push('output was rendered from other edits (rerun: uv run backchannel render --lecture …)');
  }
  return errors;
}
