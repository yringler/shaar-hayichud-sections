/**
 * Validation of the committed transcripts (data/transcripts/), alignments
 * (data/alignments/) and outlines (data/outlines/). They are source files: the build checks them but does
 * not publish them yet (the /data/v1 transcript and alignment collections
 * stay reserved until the alignment quality has been reviewed).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { checkAlignmentLineIds, type Alignment, type LineLocation } from './chapter.js';
import { checkRetimed, type RetimedFile } from './retimed.js';
import { lectureFileName, type SoferWord } from './transcripts.js';
import type { SchemaSet } from './validate.js';

export interface SourcePaths {
  dataDir: string;
  transcriptsDir: string;
  alignmentsDir: string;
  outlinesDir: string;
  retimedDir: string;
  sourceSchemaDir: string;
}

export function defaultSourcePaths(dataDir: string): SourcePaths {
  return {
    dataDir,
    transcriptsDir: path.join(dataDir, 'transcripts'),
    alignmentsDir: path.join(dataDir, 'alignments'),
    outlinesDir: path.join(dataDir, 'outlines'),
    retimedDir: path.join(dataDir, 'retimed'),
    sourceSchemaDir: path.join(dataDir, 'schema', 'sources'),
  };
}

function readJsonFiles(dir: string, errors: string[], label: string): { file: string; data: unknown }[] {
  if (!existsSync(dir)) return [];
  const out: { file: string; data: unknown }[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      out.push({ file, data: JSON.parse(readFileSync(path.join(dir, file), 'utf8')) });
    } catch (e) {
      errors.push(`${label}/${file}: invalid JSON (${(e as Error).message})`);
    }
  }
  return out;
}

const fileNameError = (label: string, file: string, lectureId: unknown, lectureIds: Set<string>): string[] => {
  if (typeof lectureId !== 'string') return [];
  const errors: string[] = [];
  if (!lectureIds.has(lectureId)) errors.push(`${label}/${file}: lecture id "${lectureId}" is not in classes.txt`);
  if (lectureFileName(lectureId) !== file) {
    errors.push(`${label}/${file}: file for lecture "${lectureId}" must be named ${lectureFileName(lectureId)}`);
  }
  return errors;
};

/**
 * Transcripts: source schema, file name matches the lecture id, lecture
 * exists. Alignments: v1 alignment schema, file name, lecture exists, the
 * transcript it names exists, and every lineId resolves in its chapter.
 * Outlines: source schema, file name, lecture exists, and they were made
 * from the transcription the lecture's transcript holds now.
 * Re-timed word times: source schema, file name, lecture exists, the
 * transcript it names exists, one entry per transcript word, monotone
 * times, and a transcriptSha that matches the transcript (a stale file is
 * an error: yarn align would otherwise silently use Sofer's times).
 */
export function validateSources(
  paths: SourcePaths,
  schemas: SchemaSet,
  lectureIds: Set<string>,
  lineIndex: Map<string, LineLocation>,
): string[] {
  const errors: string[] = [];

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const sourceSchema = (name: string): ValidateFunction =>
    ajv.compile(JSON.parse(readFileSync(path.join(paths.sourceSchemaDir, name), 'utf8')) as object);

  /** Transcript path (relative to data/) -> its Sofer transcription id. */
  const transcriptionIds = new Map<string, string>();
  /** Transcript path (relative to data/) -> its words. */
  const transcriptWords = new Map<string, SoferWord[]>();
  const transcripts = readJsonFiles(paths.transcriptsDir, errors, 'transcripts');
  if (transcripts.length > 0) {
    const validate = sourceSchema('sofer-transcript.schema.json');
    for (const { file, data } of transcripts) {
      if (!validate(data)) {
        for (const e of validate.errors ?? []) errors.push(`transcripts/${file}: ${e.instancePath || '/'} ${e.message}`);
        continue;
      }
      const t = data as { lectureId: string; sofer: { transcriptionId: string }; result: { timestamps?: SoferWord[] | null } };
      errors.push(...fileNameError('transcripts', file, t.lectureId, lectureIds));
      transcriptionIds.set(`transcripts/${file}`, t.sofer.transcriptionId);
      transcriptWords.set(`transcripts/${file}`, t.result.timestamps ?? []);
    }
  }

  const outlines = readJsonFiles(paths.outlinesDir, errors, 'outlines');
  if (outlines.length > 0) {
    const validate = sourceSchema('sofer-outline.schema.json');
    for (const { file, data } of outlines) {
      if (!validate(data)) {
        for (const e of validate.errors ?? []) errors.push(`outlines/${file}: ${e.instancePath || '/'} ${e.message}`);
        continue;
      }
      const o = data as { lectureId: string; transcript: string; transcriptionId: string };
      errors.push(...fileNameError('outlines', file, o.lectureId, lectureIds));
      const tid = transcriptionIds.get(o.transcript);
      if (tid === undefined) errors.push(`outlines/${file}: transcript "${o.transcript}" does not exist`);
      else if (tid !== o.transcriptionId) {
        errors.push(`outlines/${file}: made from transcription ${o.transcriptionId}, but the transcript is now ${tid} (rerun yarn outline)`);
      }
    }
  }

  const retimed = readJsonFiles(paths.retimedDir, errors, 'retimed');
  if (retimed.length > 0) {
    const validate = sourceSchema('retimed.schema.json');
    for (const { file, data } of retimed) {
      if (!validate(data)) {
        for (const e of (validate.errors ?? []).slice(0, 5)) errors.push(`retimed/${file}: ${e.instancePath || '/'} ${e.message}`);
        continue;
      }
      const r = data as RetimedFile;
      errors.push(...fileNameError('retimed', file, r.lectureId, lectureIds));
      if (r.transcript !== `transcripts/${file}`) {
        errors.push(`retimed/${file}: "transcript" must be transcripts/${file}`);
        continue;
      }
      const words = transcriptWords.get(r.transcript);
      if (words === undefined) {
        errors.push(`retimed/${file}: transcript "${r.transcript}" does not exist (or is invalid)`);
        continue;
      }
      errors.push(...checkRetimed(r, words).map((e) => `retimed/${file}: ${e}`));
    }
  }

  const alignments: { file: string; data: Alignment }[] = [];
  for (const { file, data } of readJsonFiles(paths.alignmentsDir, errors, 'alignments')) {
    const schemaErrors = schemas.validate('alignment', data);
    if (schemaErrors.length > 0) {
      errors.push(...schemaErrors.map((e) => `alignments/${file}: ${e}`));
      continue;
    }
    const a = data as Alignment & { transcript?: unknown; method?: { times?: unknown } };
    errors.push(...fileNameError('alignments', file, a.lectureId, lectureIds));
    // An alignment must use the word times the lecture has now: after a
    // tape is re-timed (or its re-timed file removed) it must be re-aligned.
    const used = a.method?.times ?? 'sofer';
    const have = existsSync(path.join(paths.retimedDir, file)) ? 'retimed' : 'sofer';
    if (used !== have) {
      errors.push(`alignments/${file}: made from ${used} word times, but the lecture now has ${have} times (rerun yarn align --lecture "${a.lectureId}")`);
    }
    if (typeof a.transcript === 'string' && !existsSync(path.join(paths.dataDir, a.transcript))) {
      errors.push(`alignments/${file}: transcript "${a.transcript}" does not exist`);
    }
    alignments.push({ file, data: a });
  }
  errors.push(...checkAlignmentLineIds(alignments, lineIndex).map((e) => `alignments/${e}`));
  return errors;
}
