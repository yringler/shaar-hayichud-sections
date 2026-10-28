import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { indexLineIds, type Chapter } from './chapter.js';
import { parseClassesTxt } from './parse.js';
import { ensureFolderPath, pickExisting, SoferClient, type SoferFolder } from './sofer.js';
import { defaultSourcePaths, validateSources } from './sources.js';
import {
  chapterKeyFor,
  folderPathFor,
  formatTranscript,
  lectureContexts,
  lectureFileName,
  selectLectures,
  soferTitleFor,
  type StoredTranscript,
} from './transcripts.js';
import { SchemaSet } from './validate.js';
import { defaultPaths } from './pipeline.js';

const src = `
# Series:1
> f
### Intro:2
a.mp3
## Chapters 10-11:3
### Chapter 10:4
- First
b.mp3
c.mp3
### Chapter 10 Q and A:5
d.mp3
`;
const all = lectureContexts(parseClassesTxt(src).series);

describe('lecture contexts', () => {
  it('carries the heading path, catalog title and chapter', () => {
    const [a, b, c, d] = all;
    assert.deepEqual(folderPathFor(b!), ['Series', 'Chapters 10-11', 'Chapter 10']);
    assert.equal(soferTitleFor(b!), 'First [b.mp3]');
    assert.equal(soferTitleFor(c!), 'Part 2 [c.mp3]');
    assert.equal(chapterKeyFor(b!), 'chapter_10');
    assert.equal(chapterKeyFor(a!), null);
    assert.equal(chapterKeyFor(d!), null);
  });

  it('selectLectures takes ids and headings in order without repeats', () => {
    const r = selectLectures(all, ['c.mp3'], ['4', '9']);
    assert.deepEqual(
      r.selected.map((x) => x.lecture.id),
      ['c.mp3', 'b.mp3'],
    );
    assert.deepEqual(r.errors, ['no lectures under section id 9']);
  });

  it('file names use the published URL encoding', () => {
    assert.equal(lectureFileName('07 - Chap- 10-1 (M).mp3'), '07%20-%20Chap-%2010-1%20%28M%29.mp3.json');
  });
});

describe('formatTranscript', () => {
  it('round-trips and puts one word per line', () => {
    const t: StoredTranscript = {
      schemaVersion: 1,
      lectureId: 'b.mp3',
      audioUrl: 'https://x/b.mp3',
      provider: 'sofer.ai',
      sofer: { transcriptionId: 'id', title: 'First [b.mp3]', folderPath: ['Series'], request: {} },
      result: { text: 'אור', info: {}, timestamps: [{ word: 'אור', start: 0, end: 1 }, { word: 'x', start: 1, end: 2 }] },
    };
    const s = formatTranscript(t);
    assert.deepEqual(JSON.parse(s), t);
    assert.ok(s.includes('\n      {"word":"אור","start":0,"end":1},\n'));
  });
});

describe('Sofer folders and dedup', () => {
  it('ensureFolderPath reuses existing folders (case-insensitively) and creates only missing ones', async () => {
    const folders: SoferFolder[] = [{ id: 'r', name: 'series', parent_id: null }];
    const created: string[] = [];
    const client = {
      listFolders: async (parent: string | null) => folders.filter((f) => f.parent_id === parent),
      createFolder: async (name: string, parent: string | null) => {
        const f = { id: `id${folders.length}`, name, parent_id: parent };
        folders.push(f);
        created.push(name);
        return f;
      },
    };
    const cache = new Map<string, string>();
    const id = await ensureFolderPath(client, ['Series', 'Chapters 10-15', 'Chapter 10'], cache);
    assert.deepEqual(created, ['Chapters 10-15', 'Chapter 10']);
    assert.equal(await ensureFolderPath(client, ['Series', 'Chapters 10-15', 'Chapter 10'], new Map()), id);
    assert.deepEqual(created, ['Chapters 10-15', 'Chapter 10']);
  });

  it('pickExisting matches the id suffix and prefers completed, then live, transcriptions', () => {
    const items = [
      { id: '1', title: 'Part 1 [a.mp3]', status: 'FAILED' },
      { id: '2', title: 'Part 1 [a.mp3]', status: 'PROCESSING' },
      { id: '3', title: 'Part 2 [b.mp3]', status: 'COMPLETED' },
    ];
    assert.equal(pickExisting(items, '[a.mp3]')?.id, '2');
    assert.equal(pickExisting(items, '[b.mp3]')?.id, '3');
    assert.equal(pickExisting(items.slice(0, 1), '[a.mp3]'), undefined);
    assert.equal(pickExisting(items, '[c.mp3]'), undefined);
  });
});

describe('SoferClient', () => {
  const fakeFetch = (statuses: number[], calls: string[]) => async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? JSON.stringify({ status: 'COMPLETED' }) : 'oops', { status });
  };

  it('retries GETs on transient server errors', async () => {
    const calls: string[] = [];
    const client = new SoferClient('k', fakeFetch([500, 502], calls), 'https://api', 3, 0);
    assert.equal(await client.status('x'), 'COMPLETED');
    assert.equal(calls.length, 3);
  });

  it('never retries a create, so a transcription is not submitted twice', async () => {
    const calls: string[] = [];
    const client = new SoferClient('k', fakeFetch([500], calls), 'https://api', 3, 0);
    await assert.rejects(client.createTranscription('https://a/b.mp3', {}), /HTTP 500/);
    assert.deepEqual(calls, ['POST https://api/v1/transcriptions/']);
  });
});

describe('validateSources', () => {
  const schemas = new SchemaSet(defaultPaths().schemaDir);
  const chapter: Chapter = [{ children: [{ id: 'aaaaaaaa', text: 'אור' }] }];
  const { index } = indexLineIds([{ key: 'chapter_10', data: chapter }]);

  const setup = (alignment: object) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sources-'));
    const paths = { ...defaultSourcePaths(dir), sourceSchemaDir: defaultPaths().sources.sourceSchemaDir };
    mkdirSync(paths.alignmentsDir);
    writeFileSync(path.join(paths.alignmentsDir, 'b.mp3.json'), JSON.stringify(alignment));
    return paths;
  };
  const seg = (lineId: string) => ({ startSeconds: 0, endSeconds: 1, chapter: 'chapter_10', lineId, confidence: 1 });

  it('accepts a valid alignment and reports unknown line ids, lectures and transcripts', () => {
    const ok = setup({ schemaVersion: 1, lectureId: 'b.mp3', segments: [seg('aaaaaaaa')] });
    assert.deepEqual(validateSources(ok, schemas, new Set(['b.mp3']), index), []);

    const bad = setup({ schemaVersion: 1, lectureId: 'b.mp3', transcript: 'transcripts/b.mp3.json', segments: [seg('zzzzzzzz')] });
    assert.deepEqual(validateSources(bad, schemas, new Set(), index), [
      'alignments/b.mp3.json: lecture id "b.mp3" is not in classes.txt',
      'alignments/b.mp3.json: transcript "transcripts/b.mp3.json" does not exist',
      'alignments/b.mp3.json: /segments/0 line id "zzzzzzzz" does not exist',
    ]);
  });
});
