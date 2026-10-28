/**
 * Cross-entry rules for classes.txt plus JSON Schema validation of the
 * generated catalog and of every chapter file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { Diagnostic, ParsedSection } from './parse.js';

export const SCHEMA_FILES = {
  catalog: 'catalog.schema.json',
  chapter: 'chapter.schema.json',
  alignment: 'alignment.schema.json',
  transcript: 'transcript.schema.json',
  index: 'index.schema.json',
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

/** Duplicate / colliding ids and duplicate files inside one section. */
export function validateStructure(series: ParsedSection[]): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const sectionIds = new Map<string, number>();
  const lectureIds = new Map<string, number>();

  const visit = (section: ParsedSection) => {
    const seenSection = sectionIds.get(section.id);
    if (seenSection !== undefined) {
      errors.push({
        line: section.line + 1,
        message: `section id ${section.id} is already used on line ${seenSection + 1}`,
      });
    } else {
      sectionIds.set(section.id, section.line);
    }

    const filesHere = new Map<string, number>();
    for (const item of section.items) {
      if (item.kind === 'section') {
        visit(item);
        continue;
      }
      const seenId = lectureIds.get(item.id);
      if (seenId !== undefined) {
        errors.push({
          line: item.line + 1,
          message: `lecture id "${item.id}" is already used on line ${seenId + 1}${
            item.explicitId ? '' : " (add an '@ id' line to give this lecture a distinct id)"
          }`,
        });
      } else {
        lectureIds.set(item.id, item.line);
      }

      const fileKey = `${item.folder ?? ''}\u0000${item.filename}`;
      const seenFile = filesHere.get(fileKey);
      if (seenFile !== undefined) {
        errors.push({
          line: item.line + 1,
          message: `file "${item.filename}" is listed twice in section "${section.title}" (also line ${seenFile + 1})`,
        });
      } else {
        filesHere.set(fileKey, item.line);
      }
    }
  };
  series.forEach(visit);

  for (const [id, line] of lectureIds) {
    const sectionLine = sectionIds.get(id);
    if (sectionLine !== undefined) {
      errors.push({
        line: line + 1,
        message: `lecture id "${id}" collides with the section id on line ${sectionLine + 1}`,
      });
    }
  }

  return errors.sort((a, b) => a.line - b.line);
}

export class SchemaSet {
  private readonly ajv: Ajv2020;
  private readonly validators = new Map<SchemaName, ValidateFunction>();

  constructor(readonly schemaDir: string) {
    this.ajv = new Ajv2020({ allErrors: true, strict: true });
    this.ajv.addKeyword('x-status');
    for (const [name, file] of Object.entries(SCHEMA_FILES) as [SchemaName, string][]) {
      const schema = JSON.parse(readFileSync(path.join(schemaDir, file), 'utf8')) as object;
      this.validators.set(name, this.ajv.compile(schema));
    }
  }

  /** Returns human-readable errors (empty when valid). */
  validate(name: SchemaName, data: unknown): string[] {
    const fn = this.validators.get(name);
    if (!fn) throw new Error(`unknown schema ${name}`);
    if (fn(data)) return [];
    return (fn.errors ?? []).map(formatAjvError);
  }

  /** Schema file names, for publishing alongside the data. */
  files(): string[] {
    return Object.values(SCHEMA_FILES);
  }
}

function formatAjvError(e: ErrorObject): string {
  return `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`;
}

export const CHAPTER_FILE = /^chapter_(\d+)\.json$/;

export interface ChapterFile {
  /** e.g. "chapter_01" */
  key: string;
  number: number;
  file: string;
  data: unknown;
}

/** Loads and schema-validates every chapter_NN.json in a directory. */
export function loadChapters(dir: string, schemas: SchemaSet): { chapters: ChapterFile[]; errors: string[] } {
  const errors: string[] = [];
  const chapters: ChapterFile[] = [];
  const numbers = new Map<number, string>();

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const m = CHAPTER_FILE.exec(file);
    if (!m) {
      errors.push(`${file}: chapter files must be named chapter_NN.json`);
      continue;
    }
    const number = Number(m[1]);
    const clash = numbers.get(number);
    if (clash) errors.push(`${file}: chapter ${number} is also in ${clash}`);
    numbers.set(number, file);

    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      errors.push(`${file}: invalid JSON (${(e as Error).message})`);
      continue;
    }
    for (const err of schemas.validate('chapter', data)) errors.push(`${file}: ${err}`);
    chapters.push({ key: file.replace(/\.json$/, ''), number, file, data });
  }

  if (chapters.length === 0 && errors.length === 0) errors.push(`no chapter_NN.json files found in ${dir}`);
  return { chapters, errors };
}
