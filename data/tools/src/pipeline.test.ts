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
    // Lectures whose file was renamed on the CDN keep their old id via an `@ id` line.
    const renamed = new Map([["84 - The Rebbe's Shaar Hayichud.mp3", '84 - The Rebbes Shaar Hayichud.mp3']]);
    assert.ok(lectures.every((l) => l.id === (renamed.get(l.filename) ?? l.filename)));
    assert.ok(lectures.some((l) => l.id === '84 - The Rebbes Shaar Hayichud.mp3'));
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

  it('writes nothing when a line id is used twice across chapters', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'data-'));
    for (const d of ['schema', 'chapters']) cpSync(path.join(DATA_DIR, d), path.join(dir, d), { recursive: true });
    cpSync(path.join(DATA_DIR, 'classes.txt'), path.join(dir, 'classes.txt'));
    type Node = { children: ({ id: string; text: string } | Node)[] };
    const file = (n: string) => path.join(dir, 'chapters', `chapter_${n}.json`);
    const ch1 = readJson(file('01')) as Node[];
    const ch2 = readJson(file('02')) as Node[];
    const firstId = (ch1[0]!.children[0] as { id: string }).id;
    (ch2[0]!.children[0] as { id: string }).id = firstId;
    writeFileSync(file('02'), JSON.stringify(ch2));
    const paths = defaultPaths(dir);
    const result = build(paths);
    assert.deepEqual(result.errors, [
      `chapters/chapter_02.json: /0/children/0 line id "${firstId}" is already used at chapter_01.json /0/children/0`,
    ]);
    assert.equal(existsSync(paths.distDir), false);
  });
});
