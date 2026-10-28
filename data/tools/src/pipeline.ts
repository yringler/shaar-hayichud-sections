/**
 * The whole data build: classes.txt + chapters/ -> dist/v1/.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, catalogLectures, DEFAULT_CDN_BASE, type Catalog } from './catalog.js';
import { indexLineIds, type Chapter } from './chapter.js';
import { parseClassesTxt, type ParseResult } from './parse.js';
import { publishAudio } from './publish.js';
import { defaultSourcePaths, validateSources, type SourcePaths } from './sources.js';
import { loadChapters, SchemaSet, validateStructure, type ChapterFile } from './validate.js';

/** data/ (this file compiles to data/tools/build/pipeline.js). */
export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface DataPaths {
  classesTxt: string;
  chaptersDir: string;
  schemaDir: string;
  distDir: string;
  /** Committed transcripts / alignments and their source schemas. */
  sources: SourcePaths;
  /** Which transcripts / alignments are published (data/audio-publish.json). */
  audioPolicy: string;
}

export function defaultPaths(dataDir = DATA_DIR): DataPaths {
  return {
    classesTxt: path.join(dataDir, 'classes.txt'),
    chaptersDir: path.join(dataDir, 'chapters'),
    schemaDir: path.join(dataDir, 'schema', 'v1'),
    distDir: path.join(dataDir, 'dist'),
    sources: defaultSourcePaths(dataDir),
    audioPolicy: path.join(dataDir, 'audio-publish.json'),
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
  if (loaded.errors.length === 0) {
    // Only walk trees the schema accepted.
    const lines = indexLineIds(loaded.chapters.map((ch) => ({ key: ch.key, data: ch.data as Chapter })));
    errors.push(...lines.errors.map((e) => `chapters/${e}`));
    // Committed transcripts and alignments are checked (schema, names,
    // line ids); the ones audio-publish.json selects are published below.
    const lectureIds = new Set([...catalog.series.flatMap((s) => [...catalogLectures(s.items)])].map((l) => l.id));
    errors.push(...validateSources(paths.sources, schemas, lectureIds, lines.index));
  }
  if (errors.length > 0) return { errors };
  const audio = publishAudio({
    dataDir: paths.sources.dataDir,
    policyFile: paths.audioPolicy,
    catalog,
    chapters: loaded.chapters.map((ch) => ({ key: ch.key, data: ch.data as Chapter })),
    schemas,
  });
  if (audio.errors.length > 0) return { errors: audio.errors };

  const outDir = path.join(paths.distDir, 'v1');
  rmSync(outDir, { recursive: true, force: true });

  writeJson(path.join(outDir, 'catalog.json'), catalog);

  for (const ch of loaded.chapters) writeJson(path.join(outDir, 'chapters', ch.file), ch.data);
  writeJson(path.join(outDir, 'chapters', 'index.json'), {
    schemaVersion: 1,
    items: loaded.chapters.map((ch) => ({ id: ch.key, path: `chapters/${ch.file}`, schema: 'schema/chapter.schema.json' })),
  });

  // Audio: per-lecture alignments and transcripts, plus one alignment index
  // per chapter. The index files always exist, even when empty.
  // `p` is the URL path (lecture ids percent-encoded, as index.json lists
  // it); the file on disk has the decoded name, so a web server that decodes
  // the request path finds it.
  for (const [p, data] of audio.files) writeJson(path.join(outDir, ...p.split('/').map(decodeURIComponent)), data);
  writeJson(path.join(outDir, 'alignments', 'index.json'), { schemaVersion: 1, items: audio.alignmentItems });
  writeJson(path.join(outDir, 'alignments', 'chapters', 'index.json'), { schemaVersion: 1, items: audio.chapterItems });
  writeJson(path.join(outDir, 'transcripts', 'index.json'), { schemaVersion: 1, items: audio.transcriptItems });
  writeJson(path.join(outDir, 'outlines', 'index.json'), { schemaVersion: 1, items: audio.outlineItems });

  mkdirSync(path.join(outDir, 'schema'), { recursive: true });
  for (const file of schemas.files()) copyFileSync(path.join(paths.schemaDir, file), path.join(outDir, 'schema', file));

  writeJson(path.join(outDir, 'index.json'), {
    schemaVersion: 1,
    items: [
      { id: 'catalog', path: 'catalog.json', schema: 'schema/catalog.schema.json' },
      { id: 'chapters', path: 'chapters/index.json', schema: 'schema/index.schema.json' },
      { id: 'alignments', path: 'alignments/index.json', schema: 'schema/index.schema.json' },
      { id: 'chapter-alignments', path: 'alignments/chapters/index.json', schema: 'schema/index.schema.json' },
      { id: 'transcripts', path: 'transcripts/index.json', schema: 'schema/index.schema.json' },
      { id: 'outlines', path: 'outlines/index.json', schema: 'schema/index.schema.json' },
    ],
  });

  return { errors: [], catalog, chapters: loaded.chapters, outDir };
}
