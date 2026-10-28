/**
 * Fills in missing ':seconds' durations in classes.txt. The probing itself is
 * injected so the line-rewriting logic is testable without ffprobe/network.
 */
import { formatFileLine, type ParsedLecture, type ParseResult } from './parse.js';

export type Probe = (lecture: ParsedLecture & { folder: string }, url: string) => Promise<number | null>;

export interface DurationUpdate {
  line: number;
  filename: string;
  durationSeconds: number;
}

/**
 * Probes every lecture that has no duration (bounded concurrency) and returns
 * the rewritten source text plus what changed. Lines are rewritten in place,
 * so comments, blank lines and '@ id' / '- title' lines are untouched.
 */
export async function fillDurations(
  parsed: ParseResult,
  urlFor: (lecture: ParsedLecture & { folder: string }) => string,
  probe: Probe,
  { concurrency = 4, onProgress }: { concurrency?: number; onProgress?: (msg: string) => void } = {},
): Promise<{ text: string; updates: DurationUpdate[]; failures: string[] }> {
  const lines = [...parsed.lines];
  const updates: DurationUpdate[] = [];
  const failures: string[] = [];
  const todo = parsed.lectures.filter(
    (l): l is ParsedLecture & { folder: string } => l.durationSeconds === null && l.folder !== null,
  );

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const lecture = todo[next++]!;
      const url = urlFor(lecture);
      try {
        const seconds = await probe(lecture, url);
        if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
          failures.push(`${lecture.filename}: could not determine duration`);
          continue;
        }
        const indent = /^\s*/.exec(lines[lecture.line] ?? '')?.[0] ?? '';
        lines[lecture.line] = indent + formatFileLine(lecture.filename, seconds);
        updates.push({ line: lecture.line + 1, filename: lecture.filename, durationSeconds: seconds });
        onProgress?.(`${lecture.filename}: ${seconds}s`);
      } catch (e) {
        failures.push(`${lecture.filename}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  updates.sort((a, b) => a.line - b.line);
  return { text: lines.join('\n'), updates, failures };
}
