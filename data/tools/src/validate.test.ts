import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildCatalog } from './catalog.js';
import { parseClassesTxt } from './parse.js';
import { defaultPaths } from './pipeline.js';
import { loadChapters, SchemaSet, validateStructure } from './validate.js';

const schemas = new SchemaSet(defaultPaths().schemaDir);
const structure = (text: string) => {
  const parsed = parseClassesTxt(text);
  assert.deepEqual(parsed.errors, []);
  return validateStructure(parsed.series).map((d) => `${d.line}: ${d.message}`);
};

describe('validateStructure', () => {
  it('accepts a clean file', () => {
    assert.deepEqual(structure('# S:1\n> f\na.mp3\n## P:2\nb.mp3\n'), []);
  });

  it('rejects duplicate section ids', () => {
    const errs = structure('# S:1\n> f\n## P:1\n');
    assert.equal(errs.length, 1);
    assert.match(errs[0]!, /^3: section id 1 is already used on line 1/);
  });

  it('rejects the same file twice in one section', () => {
    const errs = structure('# S:1\n> f\na.mp3\na.mp3:3\n');
    assert.ok(errs.some((e) => /^4: file "a.mp3" is listed twice/.test(e)));
    assert.ok(errs.some((e) => /^4: lecture id "a.mp3" is already used on line 3 \(add an '@ id'/.test(e)));
  });

  it('rejects duplicate lecture ids across sections, and allows fixing them with @ id', () => {
    assert.equal(structure('# S:1\n> f\na.mp3\n# T:2\n> g\na.mp3\n').length, 1);
    assert.deepEqual(structure('# S:1\n> f\na.mp3\n# T:2\n> g\n@ g-a\na.mp3\n'), []);
    const errs = structure('# S:1\n> f\n@ x\na.mp3\n@ x\nb.mp3\n');
    assert.deepEqual(errs, ['6: lecture id "x" is already used on line 4']);
  });

  it('rejects lecture ids that collide with section ids', () => {
    const errs = structure('# S:7\n> f\n@ 7\na.mp3\n');
    assert.deepEqual(errs, ['4: lecture id "7" collides with the section id on line 1']);
  });
});

describe('validateStructure: extra', () => {
  it('accepts extra series and sections beside default ones', () => {
    assert.deepEqual(structure('# S:1\n> f\na.mp3\n# T:2\nextra\nb.mp3\n## P:3\nc.mp3\n# U:4\n## Q:5\nextra\nd.mp3\n'), []);
  });

  it('rejects extra under an extra ancestor', () => {
    assert.deepEqual(structure('# S:1\n> f\na.mp3\n# T:2\nextra\n## P:3\n### Q:4\nextra\nb.mp3\n'), [
      '7: section 4 is marked extra, but it is already inside extra section 2 (line 4)',
    ]);
  });

  it('rejects a catalog where every series is extra', () => {
    assert.deepEqual(structure('# S:1\nextra\n> f\na.mp3\n# T:2\nextra\nb.mp3\n'), [
      '1: every series is marked extra; at least one series must be offered by default',
    ]);
  });
});

describe('SchemaSet', () => {
  it('accepts a generated catalog and rejects a broken one', () => {
    const catalog = buildCatalog(parseClassesTxt('# S:1\n> f\n- T\na.mp3:3\n').series);
    assert.deepEqual(schemas.validate('catalog', catalog), []);
    const broken = structuredClone(catalog) as unknown as { series: { items: { url?: string }[] }[] };
    delete broken.series[0]!.items[0]!.url;
    assert.ok(schemas.validate('catalog', broken).some((e) => /url/.test(e)));
  });

  it('accepts a boolean extra on sections and lectures, nothing else', () => {
    const catalog = buildCatalog(parseClassesTxt('# S:1\n> f\na.mp3\n# T:2\nextra\nb.mp3\n').series);
    assert.equal(catalog.series[1]!.extra, true);
    assert.deepEqual(schemas.validate('catalog', catalog), []);
    const withLecture = structuredClone(catalog) as unknown as { series: { items: { extra?: unknown }[] }[] };
    withLecture.series[0]!.items[0]!.extra = true;
    assert.deepEqual(schemas.validate('catalog', withLecture), []);
    withLecture.series[0]!.items[0]!.extra = 'yes';
    assert.notDeepEqual(schemas.validate('catalog', withLecture), []);
  });

  it('validates chapter TextNode trees', () => {
    const line = (id: string, text = 'x') => ({ id, text });
    assert.deepEqual(
      schemas.validate('chapter', [
        { label: 'a', children: [line('abcdefgh'), { children: [line('ijklmn23')] }, line('opqr4567')], translation: 't' },
      ]),
      [],
    );
    assert.notDeepEqual(schemas.validate('chapter', [{ label: 'a' }]), []);
    assert.notDeepEqual(schemas.validate('chapter', [{ children: [1] }]), []);
    assert.notDeepEqual(schemas.validate('chapter', { children: [] }), []);
    // Lines: plain strings, missing/invalid ids, newlines and blank text are rejected.
    assert.notDeepEqual(schemas.validate('chapter', [{ children: ['x'] }]), []);
    assert.notDeepEqual(schemas.validate('chapter', [{ children: [{ text: 'x' }] }]), []);
    for (const id of ['ABCDEFGH', 'abcdefg', 'abcdefg1', 'abcdefghi']) {
      assert.notDeepEqual(schemas.validate('chapter', [{ children: [line(id)] }]), [], id);
    }
    for (const text of ['a\nb', '', '  ']) {
      assert.notDeepEqual(schemas.validate('chapter', [{ children: [line('abcdefgh', text)] }]), [], JSON.stringify(text));
    }
    assert.notDeepEqual(schemas.validate('chapter', [{ children: [{ ...line('abcdefgh'), extra: 1 }] }]), []);
    // Sections have no persisted id, and the deprecated `text` field is gone.
    assert.notDeepEqual(schemas.validate('chapter', [{ id: 'n1', children: [] }]), []);
    assert.notDeepEqual(schemas.validate('chapter', [{ text: 't', children: [] }]), []);
  });

  it('keeps the alignment shape compilable', () => {
    assert.deepEqual(
      schemas.validate('alignment', {
        schemaVersion: 1,
        lectureId: 'a.mp3',
        segments: [{ startSeconds: 0, endSeconds: 5, chapter: 'chapter_01', lineId: 'abcdefgh' }],
      }),
      [],
    );
  });
});

describe('loadChapters', () => {
  it('reports bad names, bad JSON and schema errors per file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'chapters-'));
    writeFileSync(path.join(dir, 'chapter_01.json'), '[{"children":[{"id":"abcdefgh","text":"ok"}]}]');
    writeFileSync(path.join(dir, 'chapter_02.json'), '[{"children":"nope"}]');
    writeFileSync(path.join(dir, 'chapter_03.json'), '{oops');
    writeFileSync(path.join(dir, 'notes.json'), '[]');
    const { chapters, errors } = loadChapters(dir, schemas);
    assert.deepEqual(chapters.map((c) => c.key), ['chapter_01', 'chapter_02']);
    assert.equal(errors.length, 3);
    assert.ok(errors.some((e) => e.startsWith('chapter_02.json: /0/children')));
    assert.ok(errors.some((e) => e.startsWith('chapter_03.json: invalid JSON')));
    assert.ok(errors.some((e) => e.startsWith('notes.json:')));
  });
});
