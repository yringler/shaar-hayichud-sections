/**
 * Validation of the committed transcripts (data/transcripts/) and alignments
 * (data/alignments/). They are source files: the build checks them but does
 * not publish them yet (the /data/v1 transcript and alignment collections
 * stay reserved until the alignment quality has been reviewed).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { checkAlignmentLineIds, type Alignment, type LineLocation } from './chapter.js';
import { lectureFileName } from './transcripts.js';
import type { SchemaSet } from './validate.js';

export interface SourcePaths {
  dataDir: string;
  transcriptsDir: string;
  alignmentsDir: string;
  sourceSchemaDir: string;
}

export function defaultSourcePaths(dataDir: string): SourcePaths {
  return {
    dataDir,
    transcriptsDir: path.join(dataDir, 'transcripts'),
    alignmentsDir: path.join(dataDir, 'alignments'),
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
 */
export function validateSources(
  paths: SourcePaths,
  schemas: SchemaSet,
  lectureIds: Set<string>,
  lineIndex: Map<string, LineLocation>,
): string[] {
  const errors: string[] = [];

  const transcripts = readJsonFiles(paths.transcriptsDir, errors, 'transcripts');
  if (transcripts.length > 0) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const schemaFile = path.join(paths.sourceSchemaDir, 'sofer-transcript.schema.json');
    const validate: ValidateFunction = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')) as object);
    for (const { file, data } of transcripts) {
      if (!validate(data)) {
        for (const e of validate.errors ?? []) errors.push(`transcripts/${file}: ${e.instancePath || '/'} ${e.message}`);
        continue;
      }
      errors.push(...fileNameError('transcripts', file, (data as { lectureId: string }).lectureId, lectureIds));
    }
  }

  const alignments: { file: string; data: Alignment }[] = [];
  for (const { file, data } of readJsonFiles(paths.alignmentsDir, errors, 'alignments')) {
    const schemaErrors = schemas.validate('alignment', data);
    if (schemaErrors.length > 0) {
      errors.push(...schemaErrors.map((e) => `alignments/${file}: ${e}`));
      continue;
    }
    const a = data as Alignment & { transcript?: unknown };
    errors.push(...fileNameError('alignments', file, a.lectureId, lectureIds));
    if (typeof a.transcript === 'string' && !existsSync(path.join(paths.dataDir, a.transcript))) {
      errors.push(`alignments/${file}: transcript "${a.transcript}" does not exist`);
    }
    alignments.push({ file, data: a });
  }
  errors.push(...checkAlignmentLineIds(alignments, lineIndex).map((e) => `alignments/${e}`));
  return errors;
}
