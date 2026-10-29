import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { indexLineIds, type Chapter } from './chapter.js';
import { parseClassesTxt } from './parse.js';
import { chooseSource, ensureFolderPath, pickExisting, SoferClient, type SoferFolder } from './sofer.js';
import { defaultSourcePaths, validateSources } from './sources.js';
import {
  chapterKeysFor,
  chapterKeysForTitle,
  parseChapterOverrides,
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
    assert.deepEqual(chapterKeysFor(b!), ['chapter_10']);
    assert.deepEqual(chapterKeysFor(a!), []);
    assert.deepEqual(chapterKeysFor(d!), []);
  });

  it('handles the Markel shape: titled lectures next to sub-headings get their own folder', () => {
    const markel = lectureContexts(
      parseClassesTxt(`
# Markel:37
## Part 1: Chapters 10-15:38
> m/p1
- Introduction
001 Intro.mp3
### Chapter 10:39
002 a.mp3
003 b.mp3
###
- Chapter 3
@ old-id.mp3
021 c.mp3
- End Chapter 15 and Chapter 16
022 d.mp3
## Part 5 Chapters 30-33:60
### Chapter 32 Part 2 to end:61
030 e.mp3
`).series,
    );
    const by = (id: string) => markel.find((c) => c.lecture.id === id)!;
    assert.deepEqual(folderPathFor(by('001 Intro.mp3')), ['Markel', 'Part 1: Chapters 10-15', 'Introduction']);
    assert.equal(soferTitleFor(by('001 Intro.mp3')), 'Introduction [001 Intro.mp3]');
    assert.deepEqual(chapterKeysFor(by('001 Intro.mp3')), []);
    assert.deepEqual(folderPathFor(by('002 a.mp3')), ['Markel', 'Part 1: Chapters 10-15', 'Chapter 10']);
    assert.equal(soferTitleFor(by('003 b.mp3')), 'Part 2 [003 b.mp3]');
    assert.deepEqual(chapterKeysFor(by('003 b.mp3')), ['chapter_10']);
    assert.deepEqual(folderPathFor(by('old-id.mp3')), ['Markel', 'Part 1: Chapters 10-15', 'Chapter 3']);
    assert.deepEqual(chapterKeysFor(by('old-id.mp3')), ['chapter_03']);
    assert.deepEqual(chapterKeysFor(by('022 d.mp3')), ['chapter_15', 'chapter_16']);
    assert.deepEqual(chapterKeysFor(by('030 e.mp3')), ['chapter_32']);
    // --section on the part takes the loose lectures and the ones under its sub-headings.
    assert.deepEqual(
      selectLectures(markel, [], ['38']).selected.map((c) => c.lecture.id),
      ['001 Intro.mp3', '002 a.mp3', '003 b.mp3', 'old-id.mp3', '022 d.mp3'],
    );
  });

  it('keeps untitled lectures and lectures in a leaf heading in the heading folder', () => {
    // Walters shape: "### Introduction" heading with untitled parts, titled addendum lectures in a leaf "##".
    const w = lectureContexts(
      parseClassesTxt(`
# Walters:0
> w
### Introduction:1
01.mp3
## First Addendum:20
- Tips
50.mp3
`).series,
    );
    assert.deepEqual(folderPathFor(w[0]!), ['Walters', 'Introduction']);
    assert.deepEqual(folderPathFor(w[1]!), ['Walters', 'First Addendum']);
    assert.equal(w.some((c) => c.standalone), false);
  });

  it('chapterKeysForTitle names the one or two chapters a title gives', () => {
    const cases: [string, string[]][] = [
      ['Chapter 10', ['chapter_10']],
      ['Ch 7', ['chapter_07']],
      ['Chapter 40 part 2 to End', ['chapter_40']],
      ['Chapter 42 Part 2', ['chapter_42']],
      ['End Chapter 50', ['chapter_50']],
      ['Chapters 15 and 16', ['chapter_15', 'chapter_16']],
      ['Chapters 41 and 42', ['chapter_41', 'chapter_42']],
      ['End Chapter 34 and Chapter 35', ['chapter_34', 'chapter_35']],
      ['End Chapter 29 and 30', ['chapter_29', 'chapter_30']],
    ];
    for (const [t, keys] of cases) assert.deepEqual(chapterKeysForTitle(t), keys, t);
    for (const t of ['Chapter 15 Q and A', 'More on Chapter 28', 'Chapter 46 Addendum', 'Ch 1-2', 'Introduction', 'Part 1: Chapters 10-15']) {
      assert.deepEqual(chapterKeysForTitle(t), [], t);
    }
  });

  it('an override names the chapters, or time ranges per chapter', () => {
    const ids = new Set(['a.mp3', 'b.mp3']);
    const chapters = new Set(['chapter_12', 'chapter_13']);
    const ok = parseChapterOverrides(
      {
        lectures: {
          'a.mp3': ['chapter_12', 'chapter_13'],
          'b.mp3': [
            { chapter: 'chapter_12', fromSeconds: 0 },
            { chapter: 'chapter_13', fromSeconds: 1262.5, evidence: 'Okay, י"ג. והנה', confidence: 'high' },
            { chapter: 'chapter_12', fromSeconds: 1500 },
          ],
        },
      },
      ids,
      chapters,
    );
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.overrides.get('a.mp3'), { chapters: ['chapter_12', 'chapter_13'] });
    assert.deepEqual(ok.overrides.get('b.mp3')!.chapters, ['chapter_12', 'chapter_13']);
    assert.equal(ok.overrides.get('b.mp3')!.ranges!.length, 3);
    // The override wins over the catalog.
    assert.deepEqual(chapterKeysFor(all[1]!, new Map([['b.mp3', { chapters: ['chapter_12'] }]])), ['chapter_12']);

    const bad = parseChapterOverrides(
      {
        lectures: {
          'x.mp3': ['chapter_12'],
          'a.mp3': ['chapter_99', 'chapter_12', 'chapter_12'],
          'b.mp3': [
            { chapter: 'chapter_12', fromSeconds: 5 },
            { chapter: 'chapter_13', fromSeconds: 2 },
          ],
        },
      },
      ids,
      chapters,
    );
    assert.deepEqual(bad.errors, [
      'x.mp3: not a lecture in classes.txt',
      'a.mp3: no chapter file chapter_99',
      'a.mp3: a chapter is listed twice',
      'b.mp3: the first range must start at 0',
      'b.mp3: ranges must start in increasing order',
    ]);
  });

  it('data/alignment-chapters.json names catalog lectures and chapter files', () => {
    const paths = defaultPaths();
    const real = lectureContexts(parseClassesTxt(readFileSync(paths.classesTxt, 'utf8')).series);
    const file = path.join(path.dirname(paths.classesTxt), 'alignment-chapters.json');
    const keys = new Set(readdirSync(paths.chaptersDir).map((f) => f.replace(/\.json$/, '')));
    const r = parseChapterOverrides(JSON.parse(readFileSync(file, 'utf8')), new Set(real.map((c) => c.lecture.id)), keys);
    assert.deepEqual(r.errors, []);
  });

  it('committed transcripts are in the Sofer folder the catalog gives them', () => {
    const paths = defaultPaths();
    const real = lectureContexts(parseClassesTxt(readFileSync(paths.classesTxt, 'utf8')).series);
    const dir = path.join(path.dirname(paths.classesTxt), 'transcripts');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const t = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as StoredTranscript;
      const ctx = real.find((c) => c.lecture.id === t.lectureId)!;
      assert.deepEqual(t.sofer.folderPath, folderPathFor(ctx), file);
      assert.equal(t.sofer.title, soferTitleFor(ctx), file);
    }
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

  it('chooseSource reuses folder, then account, and will not submit blind when the account list failed', () => {
    const a = { id: '1', title: 'Part 1 [a.mp3]', status: 'COMPLETED' };
    assert.deepEqual(chooseSource([a], null, '[a.mp3]'), { kind: 'folder', doc: a });
    assert.deepEqual(chooseSource([], [a], '[a.mp3]'), { kind: 'account', doc: a });
    assert.deepEqual(chooseSource([], [a], '[b.mp3]'), { kind: 'submit' });
    assert.throws(() => chooseSource([], null, '[b.mp3]'), /--allow-unlisted/);
    assert.deepEqual(chooseSource([], null, '[b.mp3]', true), { kind: 'submit' });
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

  it('falls back to walking every folder when the transcription list fails', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace('https://api', '')}`);
      if (url.endsWith('/v1/transcriptions/')) return new Response('"Internal Server Error"', { status: 500 });
      if (url.includes('/v1/folders/?')) {
        const folders = [
          { id: 'f1', name: 'Series', parent_id: null },
          { id: 'f2', name: 'Chapter 10', parent_id: 'f1' },
        ];
        return new Response(JSON.stringify({ folders, next_cursor: null }), { status: 200 });
      }
      const docs = url.includes('/f2/') ? [{ id: 'd1', type: 'transcript', title: 'Part 1 [a.mp3]', status: 'COMPLETED' }] : [];
      return new Response(JSON.stringify({ documents: docs, next_cursor: null }), { status: 200 });
    };
    const client = new SoferClient('k', fetchFn, 'https://api', 1, 0);
    const all = await client.listAllTranscriptions();
    assert.deepEqual(all, [{ id: 'd1', title: 'Part 1 [a.mp3]', folder_id: 'f2', status: 'COMPLETED' }]);
    assert.deepEqual(calls.slice(2), [
      'GET /v1/folders/?limit=100',
      'GET /v1/folders/f1/documents?limit=100&type=transcript',
      'GET /v1/folders/f2/documents?limit=100&type=transcript',
    ]);
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

  it('checks outlines against the schema and the transcript they were made from', () => {
    const paths = setup({ schemaVersion: 1, lectureId: 'b.mp3', segments: [seg('aaaaaaaa')] });
    mkdirSync(paths.transcriptsDir);
    mkdirSync(paths.outlinesDir);
    const transcript = {
      schemaVersion: 1, lectureId: 'b.mp3', audioUrl: 'u', provider: 'sofer.ai',
      sofer: { transcriptionId: 't2', title: 'P [b.mp3]', folderPath: ['S'], request: {} },
      result: { text: '', info: {}, timestamps: [] },
    };
    writeFileSync(path.join(paths.transcriptsDir, 'b.mp3.json'), JSON.stringify(transcript));
    const outline = {
      schemaVersion: 1, lectureId: 'b.mp3', provider: 'sofer.ai', transcriptionId: 't2', transcript: 'transcripts/b.mp3.json',
      fetchedAt: '2026-10-28T00:00:00.000Z', request: { monotone: true },
      topics: [{ title: 'T', starting_phrase: 's', matched_text: 's', score_norm: 0.9, confidence: 'HIGH', start_time_sec: 1 }],
    };
    const write = (o: object) => writeFileSync(path.join(paths.outlinesDir, 'b.mp3.json'), JSON.stringify(o));
    write(outline);
    assert.deepEqual(validateSources(paths, schemas, new Set(['b.mp3']), index), []);
    write({ ...outline, transcriptionId: 't1' });
    assert.deepEqual(validateSources(paths, schemas, new Set(['b.mp3']), index), [
      'outlines/b.mp3.json: made from transcription t1, but the transcript is now t2 (rerun yarn outline)',
    ]);
    write({ ...outline, topics: [{ title: 'T', confidence: 'SURE' }] });
    assert.equal(validateSources(paths, schemas, new Set(['b.mp3']), index).length, 4);
  });
});
