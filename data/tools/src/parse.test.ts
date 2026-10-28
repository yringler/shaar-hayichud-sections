import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatFileLine, parseClassesTxt, type ParsedLecture, type ParsedSection } from './parse.js';

const SAMPLE = `﻿// comment
# Series A:1
> Folder One
### Intro:2
- Welcome
001 Intro.mp3:12.5
002 Next.mp3
###
- Loose
003 Loose.mp3

## Part:3
> Folder/Two
### Ch 1:4
@ old-id.mp3
- Renamed
004 Renamed.m4a:7
##
### Under top:5
005 Five.mp3
# Series B:6
006 Six.mp3
`;

describe('parseClassesTxt', () => {
  const r = parseClassesTxt(SAMPLE);

  it('parses without errors and strips the BOM', () => {
    assert.deepEqual(r.errors, []);
    assert.equal(r.lines[0], '// comment');
  });

  it('builds the section tree like the lessons2 parser', () => {
    const [a, b] = r.series;
    assert.equal(r.series.length, 2);
    assert.equal(a!.id, '1');
    assert.deepEqual(
      a!.items.map((i) => (i.kind === 'section' ? `${i.level}:${i.id}` : i.id)),
      ['3:2', '003 Loose.mp3', '2:3', '3:5'],
    );
    const part = a!.items[2] as ParsedSection;
    assert.deepEqual(part.items.map((i) => i.id), ['4']);
    assert.equal(b!.items[0]!.id, '006 Six.mp3');
  });

  it('reads titles, durations, folders and explicit ids', () => {
    const byFile = new Map<string, ParsedLecture>(r.lectures.map((l) => [l.filename, l]));
    assert.deepEqual(
      { ...byFile.get('001 Intro.mp3') },
      {
        kind: 'lecture',
        id: '001 Intro.mp3',
        explicitId: false,
        title: 'Welcome',
        filename: '001 Intro.mp3',
        durationSeconds: 12.5,
        folder: 'Folder One',
        line: 5,
      },
    );
    assert.equal(byFile.get('002 Next.mp3')!.durationSeconds, null);
    assert.equal(byFile.get('002 Next.mp3')!.title, null);
    const renamed = byFile.get('004 Renamed.m4a')!;
    assert.equal(renamed.id, 'old-id.mp3');
    assert.equal(renamed.explicitId, true);
    assert.equal(renamed.title, 'Renamed');
    assert.equal(renamed.folder, 'Folder/Two');
    // The folder persists across headings until the next '>'.
    assert.equal(byFile.get('006 Six.mp3')!.folder, 'Folder/Two');
  });

  it('accepts the title and id lines in either order', () => {
    const x = parseClassesTxt('# S:1\n> f\n- T\n@ the-id\na.mp3\n@ id2\n- T2\nb.mp3\n');
    assert.deepEqual(x.errors, []);
    assert.deepEqual(x.lectures.map((l) => [l.id, l.title]), [['the-id', 'T'], ['id2', 'T2']]);
  });

  it('reports structural errors with 1-based line numbers', () => {
    const bad = parseClassesTxt(
      ['a.mp3', '# No id', '# S:1', 'b.mp3', '> f', '- dangling', '## X:2', 'what is this', '#'].join('\n'),
    );
    assert.deepEqual(
      bad.errors.map((e) => e.line),
      [1, 2, 4, 6, 8, 9],
    );
    assert.match(bad.errors[0]!.message, /before any '#'/);
    assert.match(bad.errors[1]!.message, /stable id/);
    assert.match(bad.errors[2]!.message, /no CDN folder/);
    assert.match(bad.errors[3]!.message, /not followed by a file line/);
    assert.match(bad.errors[4]!.message, /unrecognised/);
  });

  it('flags an id line that never reaches a file', () => {
    const bad = parseClassesTxt('# S:1\n> f\n@ lost\n');
    assert.equal(bad.errors.length, 1);
    assert.match(bad.errors[0]!.message, /"lost" is not followed/);
  });
});

describe('formatFileLine', () => {
  it('round-trips through the parser', () => {
    const line = formatFileLine('x y.mp3', 1477.25);
    assert.equal(line, 'x y.mp3:1477.25');
    const r = parseClassesTxt(`# S:1\n> f\n${line}\n`);
    assert.equal(r.lectures[0]!.durationSeconds, 1477.25);
    assert.equal(formatFileLine('x.mp3', null), 'x.mp3');
  });
});

describe('data/README.md grammar example', () => {
  it('parses cleanly and keeps the old id of the renamed file', async () => {
    const { readFileSync } = await import('node:fs');
    const { DATA_DIR } = await import('./pipeline.js');
    const readme = readFileSync(`${DATA_DIR}/README.md`, 'utf8');
    const example = /## `classes.txt` grammar[\s\S]*?```\n([\s\S]*?)```/.exec(readme)?.[1];
    assert.ok(example, 'example block not found');
    const r = parseClassesTxt(example);
    assert.deepEqual(r.errors, []);
    assert.equal(r.lectures.at(-1)!.id, '021 Tape004-Side1-Ch3.mp3');
    assert.equal(r.lectures.at(-1)!.title, 'Chapter 3');
  });
});
