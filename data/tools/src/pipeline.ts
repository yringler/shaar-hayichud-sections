/**
 * The whole data build: classes.txt + chapters/ -> dist/v1/.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, DEFAULT_CDN_BASE, type Catalog } from './catalog.js';
import { parseClassesTxt, type ParseResult } from './parse.js';
import { loadChapters, SchemaSet, validateStructure, type ChapterFile } from './validate.js';

/** data/ (this file compiles to data/tools/build/pipeline.js). */
export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface DataPaths {
  classesTxt: string;
  chaptersDir: string;
  schemaDir: string;
  distDir: string;
}

export function defaultPaths(dataDir = DATA_DIR): DataPaths {
  return {
    classesTxt: path.join(dataDir, 'classes.txt'),
    chaptersDir: path.join(dataDir, 'chapters'),
    schemaDir: path.join(dataDir, 'schema', 'v1'),
    distDir: path.join(dataDir, 'dist'),
  };
}

export interface CatalogResult {
  parsed: ParseResult;
  catalog: Catalog;
  /** Formatted "classes.txt:LINE: message" / schema errors. Empty when valid. */
  errors: string[];
}

export function loadCatalog(paths: DataPaths, schemas: SchemaSet, cdnBase = DEFAULT_CDN_BASE): CatalogResult {
  const name = path.basename(paths.classesTxt);
  const parsed = parseClassesTxt(readFileSync(paths.classesTxt, 'utf8'));
  const diagnostics = [...parsed.errors, ...validateStructure(parsed.series)].sort((a, b) => a.line - b.line);
  const errors = diagnostics.map((d) => `${name}:${d.line}: ${d.message}`);
  const catalog = buildCatalog(parsed.series, cdnBase);
  if (errors.length === 0) {
    errors.push(...schemas.validate('catalog', catalog).map((e) => `catalog.json: ${e}`));
  }
  return { parsed, catalog, errors };
}

export interface BuildResult {
  errors: string[];
  catalog?: Catalog;
  chapters?: ChapterFile[];
  outDir?: string;
}

const writeJson = (file: string, data: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
};

/**
 * Validates everything and, only if valid, writes dist/v1/. Nothing is written
 * on error so a broken source can never be published.
 */
export function build(paths: DataPaths, cdnBase = DEFAULT_CDN_BASE): BuildResult {
  const schemas = new SchemaSet(paths.schemaDir);
  const { catalog, errors } = loadCatalog(paths, schemas, cdnBase);
  const loaded = loadChapters(paths.chaptersDir, schemas);
  errors.push(...loaded.errors.map((e) => `chapters/${e}`));
  if (errors.length > 0) return { errors };

  const outDir = path.join(paths.distDir, 'v1');
  rmSync(outDir, { recursive: true, force: true });

  writeJson(path.join(outDir, 'catalog.json'), catalog);

  for (const ch of loaded.chapters) writeJson(path.join(outDir, 'chapters', ch.file), ch.data);
  writeJson(path.join(outDir, 'chapters', 'index.json'), {
    schemaVersion: 1,
    items: loaded.chapters.map((ch) => ({ id: ch.key, path: `chapters/${ch.file}`, schema: 'schema/chapter.schema.json' })),
  });

  // Reserved collections: published empty so the URLs and shape exist.
  for (const dir of ['alignments', 'transcripts']) {
    writeJson(path.join(outDir, dir, 'index.json'), { schemaVersion: 1, items: [] });
  }

  mkdirSync(path.join(outDir, 'schema'), { recursive: true });
  for (const file of schemas.files()) copyFileSync(path.join(paths.schemaDir, file), path.join(outDir, 'schema', file));

  writeJson(path.join(outDir, 'index.json'), {
    schemaVersion: 1,
    items: [
      { id: 'catalog', path: 'catalog.json', schema: 'schema/catalog.schema.json' },
      { id: 'chapters', path: 'chapters/index.json', schema: 'schema/index.schema.json' },
      { id: 'alignments', path: 'alignments/index.json', schema: 'schema/index.schema.json' },
      { id: 'transcripts', path: 'transcripts/index.json', schema: 'schema/index.schema.json' },
    ],
  });

  return { errors: [], catalog, chapters: loaded.chapters, outDir };
}
