import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { catalogLectures, type Catalog } from './catalog.js';
import { build, DATA_DIR, defaultPaths } from './pipeline.js';

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

describe('build (real data/)', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'dist-'));
  const result = build({ ...defaultPaths(), distDir: out });

  it('the checked-in classes.txt and chapters are valid', () => {
    assert.deepEqual(result.errors, []);
  });

  it('writes the versioned layout', () => {
    for (const f of [
      'v1/index.json',
      'v1/catalog.json',
      'v1/chapters/index.json',
      'v1/chapters/chapter_01.json',
      'v1/alignments/index.json',
      'v1/transcripts/index.json',
      'v1/schema/catalog.schema.json',
    ]) {
      assert.ok(existsSync(path.join(out, f)), f);
    }
    assert.deepEqual(readJson(path.join(out, 'v1/alignments/index.json')), { schemaVersion: 1, items: [] });
  });

  it('keeps the ids lessons2 clients persist (lecture id = filename, section id = ":N")', () => {
    const catalog = readJson(path.join(out, 'v1/catalog.json')) as Catalog;
    assert.deepEqual(
      catalog.series.map((s) => [s.id, s.title]),
      [
        ['0', 'Rabbi Benyamin Walters Original Class'],
        ['37', 'Rabbi Markel Series (Advanced)'],
        ['75', 'Rabbi Benyamin Walters New Class (2020)'],
        ['73', 'Rabbi Benyamin Walters Other Classes'],
      ],
    );
    const lectures = [...catalogLectures(catalog.series)];
    assert.ok(lectures.every((l) => l.id === l.filename));
    const first2020 = lectures.find((l) => l.id === 'Shaar HaYichud 001.m4a')!;
    assert.equal(first2020.folder, 'Walters Shaar HaYichud Recordings 2020');
    assert.equal(lectures.filter((l) => l.id === '003 Tape016-Side2-Ch10.mp3').length, 1);
  });
});

describe('build (invalid input)', () => {
  it('writes nothing when classes.txt has errors', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'data-'));
    cpSync(path.join(DATA_DIR, 'schema'), path.join(dir, 'schema'), { recursive: true });
    cpSync(path.join(DATA_DIR, 'chapters'), path.join(dir, 'chapters'), { recursive: true });
    writeFileSync(path.join(dir, 'classes.txt'), '# S:1\na.mp3\n');
    const paths = defaultPaths(dir);
    const result = build(paths);
    assert.deepEqual(result.errors, ['classes.txt:2: file "a.mp3" has no CDN folder (add a \'>\' line above it)']);
    assert.equal(existsSync(paths.distDir), false);
  });
});
