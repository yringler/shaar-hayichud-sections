/**
 * The whole data build: classes.txt + chapters/ -> dist/v1/.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, catalogLectures, DEFAULT_CDN_BASE, type Catalog } from './catalog.js';
import { indexLineIds, type Chapter } from './chapter.js';
import { parseClassesTxt, type ParseResult } from './parse.js';
import { publishAudio } from './publish.js';
import { defaultSourcePaths, validateSources, type SourcePaths } from './sources.js';
import { exportStudy, STUDY_INDEX_PATHS, type StudyExport } from './study-export.js';
import { checkStudy, loadStudyContext, type StudyTier } from './study.js';

const STUDY_TIERS: readonly StudyTier[] = ['public', 'advanced'];
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
  /** Hand-set starts of a class's part on a chapter (data/chapter-starts.json). */
  chapterStarts: string;
}

export function defaultPaths(dataDir = DATA_DIR): DataPaths {
  return {
    classesTxt: path.join(dataDir, 'classes.txt'),
    chaptersDir: path.join(dataDir, 'chapters'),
    schemaDir: path.join(dataDir, 'schema', 'v1'),
    distDir: path.join(dataDir, 'dist'),
    sources: defaultSourcePaths(dataDir),
    audioPolicy: path.join(dataDir, 'audio-publish.json'),
    chapterStarts: path.join(dataDir, 'chapter-starts.json'),
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
  /** Problems that do not stop the build (stale or doubtful study guide references). */
  warnings?: string[];
  catalog?: Catalog;
  chapters?: ChapterFile[];
  outDir?: string;
  /** How many study guides dist/v1/study/ holds, per tier (study/index.json, study/index-advanced.json). */
  studyFiles?: Record<StudyTier, number>;
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
  // Study guides (data/study/) are checked, not published. Only an error in
  // a file itself fails the build: a reference gone stale because a chapter
  // was edited or a tape re-timed is a warning here (`yarn study-check` is
  // the strict check), so that editing a chapter never blocks a deploy.
  const warnings: string[] = [];
  const studyOut: Partial<Record<StudyTier, StudyExport>> = {};
  if (errors.length === 0) {
    const dataDir = paths.sources.dataDir;
    const studyCtx = existsSync(path.join(dataDir, 'study')) ? loadStudyContext(dataDir) : undefined;
    const study = checkStudy(dataDir, studyCtx);
    for (const i of study.issues) {
      if (i.level === 'error') errors.push(`${i.file}: ${i.message}`);
      else warnings.push(`${i.file}: (${i.level}) ${i.message}`);
    }
    // Both tiers in the public edition, files with no error (stale ones
    // marked), side by side in dist/v1/study/: the series whose teacher
    // allowed publication (study/index.json) and the ones published
    // unlisted (study/index-advanced.json).
    if (studyCtx) {
      for (const tier of STUDY_TIERS) {
        const out = exportStudy(dataDir, studyCtx, study.issues, tier);
        studyOut[tier] = out;
        errors.push(...schemas.validate('studyIndex', out.index).map((e) => `v1/${STUDY_INDEX_PATHS[tier]}: ${e}`));
        for (const [rel, data] of out.files) errors.push(...schemas.validate('study', data).map((e) => `v1/${rel}: ${e}`));
      }
    }
  }
  if (errors.length > 0) return { errors };
  const audio = publishAudio({
    dataDir: paths.sources.dataDir,
    policyFile: paths.audioPolicy,
    chapterStartsFile: paths.chapterStarts,
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

  // Audio: per-lecture alignments and outlines, plus one alignment index
  // per chapter. The index files always exist, even when empty.
  // `p` is the URL path (lecture ids percent-encoded, as index.json lists
  // it); the file on disk has the decoded name, so a web server that decodes
  // the request path finds it.
  for (const [p, data] of audio.files) writeJson(path.join(outDir, ...p.split('/').map(decodeURIComponent)), data);
  writeJson(path.join(outDir, 'alignments', 'index.json'), { schemaVersion: 1, items: audio.alignmentItems });
  writeJson(path.join(outDir, 'alignments', 'chapters', 'index.json'), { schemaVersion: 1, items: audio.chapterItems });
  writeJson(path.join(outDir, 'outlines', 'index.json'), { schemaVersion: 1, items: audio.outlineItems });

  // Study guides: both tiers' files, and always both indexes, even when empty.
  for (const tier of STUDY_TIERS) {
    for (const [rel, data] of studyOut[tier]?.files ?? []) writeJson(path.join(outDir, ...rel.split('/')), data);
    writeJson(path.join(outDir, ...STUDY_INDEX_PATHS[tier].split('/')), studyOut[tier]?.index ?? { schemaVersion: 1, series: [] });
  }

  mkdirSync(path.join(outDir, 'schema'), { recursive: true });
  for (const file of schemas.files()) copyFileSync(path.join(paths.schemaDir, file), path.join(outDir, 'schema', file));

  writeJson(path.join(outDir, 'index.json'), {
    schemaVersion: 1,
    items: [
      { id: 'catalog', path: 'catalog.json', schema: 'schema/catalog.schema.json' },
      { id: 'chapters', path: 'chapters/index.json', schema: 'schema/index.schema.json' },
      { id: 'alignments', path: 'alignments/index.json', schema: 'schema/index.schema.json' },
      { id: 'chapter-alignments', path: 'alignments/chapters/index.json', schema: 'schema/index.schema.json' },
      { id: 'outlines', path: 'outlines/index.json', schema: 'schema/index.schema.json' },
      { id: 'study', path: 'study/index.json', schema: 'schema/study-index.schema.json' },
    ],
  });

  // The study-beta export (dist/study-beta/) is gone; remove a stale copy
  // from an older build so nothing can publish it.
  rmSync(path.join(paths.distDir, 'study-beta'), { recursive: true, force: true });

  const studyFiles = { public: studyOut.public?.files.size ?? 0, advanced: studyOut.advanced?.files.size ?? 0 };
  return { errors: [], warnings, catalog, chapters: loaded.chapters, outDir, studyFiles };
}
