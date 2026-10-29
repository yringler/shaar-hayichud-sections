/**
 * Re-timed word times (data/retimed/, written by the Python tool in
 * data/retime/): forced alignment of a Sofer transcript's words to the audio,
 * which fixes Sofer's piles of words sharing one start time. `yarn align`
 * and the published transcripts use them instead of Sofer's times when a
 * file exists and matches the transcript; a file that no longer matches is
 * an error, never a silent fallback.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { lectureFileName, type SoferWord } from './transcripts.js';

/** [startSeconds, endSeconds, score or null, kind: 2 anchor, 1 soft anchor, 0 interpolated]. */
export type RetimedWord = [number, number, number | null, 0 | 1 | 2];

/** data/retimed/<encoded lecture id>.json (schema/sources/retimed.schema.json). */
export interface RetimedFile {
  schemaVersion: 1;
  lectureId: string;
  /** Transcript path relative to data/. */
  transcript: string;
  transcriptSha: string;
  method: { name: string; version: number; [k: string]: unknown };
  stats: { words: number; anchors: number; [k: string]: unknown };
  words: RetimedWord[];
}

/** Which word times a lecture's alignment / published transcript used. */
export type TimeSource = 'retimed' | 'sofer';

export function retimedPath(dataDir: string, lectureId: string): string {
  return path.join(dataDir, 'retimed', lectureFileName(lectureId));
}

const ms = (x: number) => String(Math.floor(x * 1000 + 0.5));

/**
 * SHA-256 (lowercase hex) of the UTF-8 bytes of, for each word in order,
 * `word TAB ms(start) TAB ms(end) LF` with ms(x) = floor(x * 1000 + 0.5).
 * Must match data/retime/src/retime/files.py (transcript_sha).
 */
export function transcriptSha(words: readonly Pick<SoferWord, 'word' | 'start' | 'end'>[]): string {
  const h = createHash('sha256');
  for (const w of words) h.update(`${w.word}\t${ms(w.start)}\t${ms(w.end)}\n`, 'utf8');
  return h.digest('hex');
}

/**
 * Problems with a re-timed file against the transcript's current words:
 * stale hash, word count, non-monotone or negative times. Empty when usable.
 */
export function checkRetimed(r: RetimedFile, words: readonly SoferWord[]): string[] {
  const errors: string[] = [];
  const sha = transcriptSha(words);
  if (r.transcriptSha !== sha) {
    errors.push(
      `stale: made from a transcript with transcriptSha ${r.transcriptSha.slice(0, 12)}…, the transcript is now ${sha.slice(0, 12)}… ` +
        `(rerun data/retime: uv run retime --lecture "${r.lectureId}", or delete the file)`,
    );
  }
  if (r.words.length !== words.length) {
    errors.push(`has ${r.words.length} words, the transcript has ${words.length}`);
    return errors;
  }
  for (let i = 0; i < r.words.length; i++) {
    const [s, e] = r.words[i]!;
    if (!(s >= 0) || !(e >= s)) {
      errors.push(`word ${i}: needs 0 <= start <= end (got ${s}, ${e})`);
      break;
    }
    if (i > 0 && s < r.words[i - 1]![0]) {
      errors.push(`word ${i}: start ${s} is before the previous word's ${r.words[i - 1]![0]}`);
      break;
    }
  }
  return errors;
}

/** The transcript's words with the re-timed start/end (everything else kept). */
export function applyRetimed<W extends SoferWord>(words: readonly W[], r: RetimedFile): W[] {
  return words.map((w, i) => ({ ...w, start: r.words[i]![0], end: r.words[i]![1] }));
}

export interface WordTimes<W extends SoferWord> {
  words: W[];
  source: TimeSource;
  /** The re-timed file's path relative to data/, when used. */
  file?: string;
  retimed?: RetimedFile;
  /** Non-empty when a re-timed file exists but cannot be used: callers must not fall back silently. */
  errors: string[];
}

/**
 * The word times to use for a lecture: data/retimed/'s when the file exists
 * and matches `words`, else Sofer's (`words` as given). A file that exists
 * but is stale or malformed gives `errors` (and Sofer's words).
 */
export function wordTimes<W extends SoferWord>(dataDir: string, lectureId: string, words: W[]): WordTimes<W> {
  const file = retimedPath(dataDir, lectureId);
  if (!existsSync(file)) return { words, source: 'sofer', errors: [] };
  const rel = path.relative(dataDir, file).split(path.sep).join('/');
  let r: RetimedFile;
  try {
    r = JSON.parse(readFileSync(file, 'utf8')) as RetimedFile;
  } catch (e) {
    return { words, source: 'sofer', errors: [`${rel}: invalid JSON (${(e as Error).message})`] };
  }
  if (!Array.isArray(r?.words) || typeof r.transcriptSha !== 'string') {
    return { words, source: 'sofer', errors: [`${rel}: not a re-timed file (needs words and transcriptSha)`] };
  }
  const errors = checkRetimed(r, words).map((e) => `${rel}: ${e}`);
  if (errors.length > 0) return { words, source: 'sofer', errors };
  return { words: applyRetimed(words, r), source: 'retimed', file: rel, retimed: r, errors: [] };
}
