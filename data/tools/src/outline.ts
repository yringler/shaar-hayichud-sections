/**
 * Stored Sofer.ai topic outlines (data/outlines/<encoded lecture id>.json,
 * schema/sources/sofer-outline.schema.json): POST /v1/timestamps/outline
 * wrapped with the lecture, the transcription it was made from, the request
 * and the fetch time.
 */
import path from 'node:path';
import type { OutlineTopic } from './sofer.js';
import { lectureFileName, type StoredTranscript } from './transcripts.js';

/**
 * The outline request for a lecture. `monotone`: a class runs through the
 * text in order, so each topic is searched after the previous one.
 * `conclusion_bias` stays off: it sends any topic whose title contains
 * "conclusion" to the last third of the audio, but in a class that reads a
 * chapter phrase by phrase, "the conclusion of the argument" can come
 * anywhere, and monotone search already keeps a closing topic last.
 */
export const OUTLINE_REQUEST = { monotone: true, conclusion_bias: false } as const;

export interface StoredOutline {
  schemaVersion: 1;
  lectureId: string;
  provider: 'sofer.ai';
  /** Sofer transcription the outline was made from (the transcript's sofer.transcriptionId). */
  transcriptionId: string;
  /** Path of the stored transcript, relative to data/. */
  transcript: string;
  /** ISO 8601 fetch time. */
  fetchedAt: string;
  /** Request body sent, without transcription_id. */
  request: { monotone?: boolean; conclusion_bias?: boolean };
  /** Raw response, in order. */
  topics: OutlineTopic[];
}

export function outlinePath(dataDir: string, lectureId: string): string {
  return path.join(dataDir, 'outlines', lectureFileName(lectureId));
}

/**
 * Why an outline should be (re)fetched, or null to skip: none stored, it was
 * made from another transcription (the lecture was re-transcribed), or forced.
 */
export function outlineNeeded(transcript: StoredTranscript, existing: StoredOutline | null, force: boolean): string | null {
  if (!existing) return 'no outline yet';
  if (existing.transcriptionId !== transcript.sofer.transcriptionId) {
    return `stale: made from ${existing.transcriptionId}, transcript is now ${transcript.sofer.transcriptionId}`;
  }
  return force ? 'forced' : null;
}

export function buildStoredOutline(
  transcript: StoredTranscript,
  transcriptRelPath: string,
  topics: OutlineTopic[],
  request: StoredOutline['request'],
  fetchedAt: Date,
): StoredOutline {
  if (!Array.isArray(topics)) throw new Error(`unexpected outline response: ${JSON.stringify(topics).slice(0, 200)}`);
  return {
    schemaVersion: 1,
    lectureId: transcript.lectureId,
    provider: 'sofer.ai',
    transcriptionId: transcript.sofer.transcriptionId,
    transcript: transcriptRelPath,
    fetchedAt: fetchedAt.toISOString(),
    request: { ...request },
    topics,
  };
}

/** Two-space JSON with one topic per line. */
export function formatOutline(o: StoredOutline): string {
  const marker = '__TOPICS__';
  const body = JSON.stringify({ ...o, topics: marker }, null, 2);
  const inner = o.topics.length === 0 ? '[]' : `[\n${o.topics.map((t) => `    ${JSON.stringify(t)}`).join(',\n')}\n  ]`;
  return `${body.replace(`"${marker}"`, inner)}\n`;
}
