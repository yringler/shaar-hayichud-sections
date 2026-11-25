import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildCatalog } from './catalog.js';
import type { Chapter } from './chapter.js';
import { parseClassesTxt } from './parse.js';
import { build, DATA_DIR, defaultPaths, loadCatalog } from './pipeline.js';
import { loadChapters, SchemaSet } from './validate.js';
import {
  alignmentChapters,
  applyChapterStarts,
  CHAPTER_LEAD_SECONDS,
  chapterAlignments,
  chapterStarts,
  lectureInfos,
  parseChapterStarts,
  parsePublishPolicy,
  publishAlignment,
  publishAudio,
  publishOutline,
  reverentSpelling,
  retimeTopics,
  sourceTopics,
  selectPublished,
} from './publish.js';

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
/** An index `path` (URL-encoded per segment) as a file path; decodeURI would leave e.g. %26 (&) encoded. */
const decodePath = (p: string) => p.split('/').map(decodeURIComponent).join('/');

const CLASSES = `
# Series A:1
## Chapters:2
> folder
- Intro
intro.mp3
### Chapter 3:3
a.mp3
b.mp3
# Series B:4
### Chapter 3:5
> other
c.mp3
`;
const catalog = buildCatalog(parseClassesTxt(CLASSES).series);
const infos = lectureInfos(catalog);

describe('parsePublishPolicy', () => {
  it('accepts the shape and reports unknown keys and bad values', () => {
    assert.deepEqual(parsePublishPolicy({ minConfidence: 0.5, sections: ['3'] }), {
      policy: { minConfidence: 0.5, sections: ['3'], lectures: [] },
      errors: [],
    });
    assert.deepEqual(parsePublishPolicy({ minConfidence: 2, lectures: [1], extra: true }).errors, [
      'unknown key "extra"',
      '"minConfidence" must be a number from 0 to 1',
      '"lectures" must be an array of strings',
    ]);
  });
});

describe('selectPublished', () => {
  it('selects lectures under listed headings plus listed lectures, and reports unknown ids', () => {
    const r = selectPublished({ minConfidence: 0, sections: ['3', '99'], lectures: ['c.mp3', 'nope.mp3'] }, infos);
    assert.deepEqual([...r.ids].sort(), ['a.mp3', 'b.mp3', 'c.mp3']);
    assert.deepEqual(r.errors, ['section id "99" is not in classes.txt', 'lecture id "nope.mp3" is not in classes.txt']);
  });

  it('a series id selects the whole series', () => {
    assert.deepEqual([...selectPublished({ minConfidence: 0, sections: ['1'], lectures: [] }, infos).ids], ['intro.mp3', 'a.mp3', 'b.mp3']);
  });
});

describe('reverentSpelling', () => {
  it('writes God and its forms as G-d', () => {
    assert.equal(
      reverentSpelling("God, God's will. Godliness and godliness, Godly and godly. GOD. God-fearing \"God?\""),
      "G-d, G-d's will. G-dliness and g-dliness, G-dly and g-dly. G-D. G-d-fearing \"G-d?\"",
    );
  });

  it('leaves lower-case god, plurals and other words alone', () => {
    const s = 'their god is science, other gods, Gods, Godel, good, Godzilla, ungodly';
    assert.equal(reverentSpelling(s), s);
  });
});

describe('publishAlignment', () => {
  it('keeps the v1 fields and drops segments below the confidence floor', () => {
    const seg = (lineId: string, confidence: number) => ({
      startSeconds: 1,
      endSeconds: 2,
      chapter: 'chapter_03',
      lineId,
      confidence,
      matchedWords: 3,
      lineWords: 3,
      firstWord: 0,
      lastWord: 2,
    });
    const a = publishAlignment(
      { lectureId: 'a.mp3', chapter: 'chapter_03', segments: [seg('aaaaaaaa', 0.9), seg('bbbbbbbb', 0.4)] },
      0.6,
    );
    assert.deepEqual(a, {
      schemaVersion: 1,
      lectureId: 'a.mp3',
      chapter: 'chapter_03',
      segments: [{ startSeconds: 1, endSeconds: 2, chapter: 'chapter_03', lineId: 'aaaaaaaa', confidence: 0.9 }],
    });
  });
});

describe('chapterAlignments', () => {
  const chapter: Chapter = [
    { children: [{ id: 'aaaaaaaa', text: 'x' }, { id: 'bbbbbbbb', text: 'y' }, { children: [{ id: 'cccccccc', text: 'z' }] }] },
  ];
  const seg = (lineId: string, startSeconds: number, confidence: number) => ({
    startSeconds,
    endSeconds: startSeconds + 5,
    chapter: 'chapter_03',
    lineId,
    confidence,
  });
  const al = (lectureId: string, segments: ReturnType<typeof seg>[]) => ({
    schemaVersion: 1 as const,
    lectureId,
    chapter: 'chapter_03',
    segments,
  });

  it('lists lectures in catalog order and lines in document order, best ref first', () => {
    const r = chapterAlignments(
      'chapter_03',
      chapter,
      [al('c.mp3', [seg('cccccccc', 30, 0.9), seg('aaaaaaaa', 3, 0.8)]), al('a.mp3', [seg('aaaaaaaa', 10, 0.8)]), al('b.mp3', [])],
      infos,
      new Set(['a.mp3']),
    );
    assert.deepEqual(
      r.lectures.map((l) => [l.id, l.seriesId, l.series, l.part, l.outline ?? null]),
      [
        ['a.mp3', '1', 'Series A', 'Chapters / Chapter 3', 'outlines/a.mp3.json'],
        ['c.mp3', '4', 'Series B', 'Chapter 3', null],
      ],
    );
    // Transcripts are not published, so a lecture never names one.
    assert.ok(r.lectures.every((l) => !('transcript' in l)));
    assert.equal(r.lectures[0]!.url, 'https://media.shaarhayichudresources.com/folder/a.mp3');
    assert.deepEqual(r.lines, [
      {
        lineId: 'aaaaaaaa',
        refs: [
          { lecture: 0, startSeconds: 10, endSeconds: 15, confidence: 0.8 },
          { lecture: 1, startSeconds: 3, endSeconds: 8, confidence: 0.8 },
        ],
      },
      { lineId: 'cccccccc', refs: [{ lecture: 1, startSeconds: 30, endSeconds: 35, confidence: 0.9 }] },
    ]);
  });

  it('a class that reads two chapters contributes only its own chapter\'s segments to each index', () => {
    const two = al('a.mp3', [seg('aaaaaaaa', 10, 0.8), { ...seg('zzzzzzzz', 300, 0.9), chapter: 'chapter_04' }]);
    assert.deepEqual(alignmentChapters(two), ['chapter_03', 'chapter_04']);
    assert.deepEqual(alignmentChapters(al('b.mp3', [])), ['chapter_03']);
    const r = chapterAlignments('chapter_03', chapter, [two], infos, new Set());
    assert.deepEqual(r.lines.map((l) => l.lineId), ['aaaaaaaa']);
    assert.deepEqual(r.lectures.map((l) => l.id), ['a.mp3']);
  });
});

describe('chapter starts', () => {
  const chapter: Chapter = [{ children: [{ id: 'aaaaaaaa', text: 'x' }] }];
  const s = (chapter: string, startSeconds: number, endSeconds = startSeconds + 5) => ({ chapter, startSeconds, endSeconds });
  const al = (segments: ReturnType<typeof s>[]) => ({
    schemaVersion: 1 as const,
    lectureId: 'a.mp3',
    chapter: 'chapter_03',
    segments: segments.map((x) => ({ ...x, lineId: 'aaaaaaaa', confidence: 1 })),
  });

  it('starts the first chapter at 0 and a later one shortly before its first line', () => {
    assert.equal(CHAPTER_LEAD_SECONDS, 3);
    const r = chapterStarts([s('chapter_03', 64), s('chapter_03', 200), s('chapter_04', 900.1234), s('chapter_04', 950)]);
    assert.deepEqual([...r], [['chapter_03', 0], ['chapter_04', 897.123]]);
  });

  it('never starts a later chapter inside the previous chapter\'s last line', () => {
    const r = chapterStarts([s('chapter_03', 10, 899), s('chapter_04', 900)]);
    assert.equal(r.get('chapter_04'), 899);
    // A line of the previous chapter that runs past the next one's start: the first line itself.
    assert.equal(chapterStarts([s('chapter_03', 10, 950), s('chapter_04', 900)]).get('chapter_04'), 900);
  });

  it('starts a chapter the class opens with at 0 even after a recap of another chapter in the same class', () => {
    // A class that opens with a recap of chapter 3, then reads chapter 4.
    const r = chapterStarts([s('chapter_03', 5, 60), s('chapter_04', 272.7), s('chapter_03', 280)]);
    assert.deepEqual([...r], [['chapter_03', 0], ['chapter_04', 269.7]]);
  });

  it('parses data/chapter-starts.json and rejects bad entries', () => {
    const ok = parseChapterStarts({ $comment: 'x', lectures: { 'a.mp3': { chapter_04: { startSeconds: 872, note: 'n' } } } });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.starts.get('a.mp3')?.get('chapter_04'), 872);
    const bad = parseChapterStarts({ lectures: { 'a.mp3': { ch4: { startSeconds: -1, x: 1 } } }, extra: 1 });
    assert.equal(bad.errors.length, 4, bad.errors.join('\n'));
    assert.deepEqual(parseChapterStarts([]).errors, ['must be an object']);
  });

  it('applies overrides, which must not start after the class\'s first line on the chapter', () => {
    const a = al([s('chapter_03', 10), s('chapter_04', 892.5)]);
    assert.deepEqual([...applyChapterStarts(a, new Map([['chapter_04', 872]]), 1500).starts], [['chapter_03', 0], ['chapter_04', 872]]);
    // At the first line itself: allowed (nothing earlier is offered).
    assert.deepEqual(applyChapterStarts(a, new Map([['chapter_04', 892.5]]), 1500).errors, []);
    assert.match(applyChapterStarts(a, new Map([['chapter_04', 893]]), 1500).errors[0]!, /after the class's first line/);
    assert.match(applyChapterStarts(a, new Map([['chapter_05', 1]]), 1500).errors[0]!, /no published line/);
    // Defaults are kept where there is no override.
    assert.equal(applyChapterStarts(a, undefined, null).starts.get('chapter_04'), 889.5);
  });

  it('publishes chapterStartSeconds on each lecture of a chapter index', () => {
    const r = chapterAlignments('chapter_03', chapter, [al([s('chapter_03', 10)])], infos, new Set(), new Map([['a.mp3', new Map([['chapter_03', 0]])]]));
    assert.equal(r.lectures[0]!.chapterStartSeconds, 0);
    const none = chapterAlignments('chapter_03', chapter, [al([s('chapter_03', 10)])], infos, new Set());
    assert.equal('chapterStartSeconds' in none.lectures[0]!, false);
  });
});

describe('retimeTopics', () => {
  it('moves topics to the re-timed time of their first word, by token_span or by Sofer start; drops the rest', () => {
    const sofer = [0, 5, 5, 5, 9];
    const retimed = [0, 5, 11, 17, 30];
    const topics = [
      { title: 'span', start_time_sec: 5, confidence: 'HIGH', token_span: [3, 4] },
      { title: 'by time', start_time_sec: 9, confidence: 'HIGH' },
      { title: 'lost', start_time_sec: 7, confidence: 'HIGH' },
    ];
    assert.deepEqual(
      retimeTopics(topics, sofer, retimed).map((t) => [t.title, t.start_time_sec]),
      [['span', 17], ['by time', 30]],
    );
  });
});

describe('publishOutline', () => {
  it('keeps located HIGH/MEDIUM topics in time order and drops the rest', () => {
    const topics = sourceTopics({
      lectureId: 'a.mp3',
      transcriptionId: 'x',
      topics: [
        { title: ' Second ', starting_phrase: 'p', start_time_sec: 90.123, matched_text: 'p', score_norm: 0.9, confidence: 'MEDIUM' },
        { title: 'First', starting_phrase: 'p', start_time_sec: 3, matched_text: 'p', score_norm: 1, confidence: 'HIGH' },
        { title: 'Unsure', starting_phrase: 'p', start_time_sec: 50, matched_text: 'p', score_norm: 0.3, confidence: 'LOW' },
        { title: 'Not found', starting_phrase: 'p', matched_text: '', score_norm: 0, confidence: 'NONE' },
        { title: 'No time', starting_phrase: 'p', start_time_sec: null, matched_text: '', score_norm: 1, confidence: 'HIGH' },
      ],
    });
    assert.equal(topics.length, 5);
    assert.deepEqual(publishOutline('a.mp3', topics), {
      schemaVersion: 1,
      lectureId: 'a.mp3',
      generatedBy: 'sofer.ai',
      topics: [
        { title: 'First', startSeconds: 3, confidence: 'HIGH' },
        { title: 'Second', startSeconds: 90.12, confidence: 'MEDIUM' },
      ],
    });
    assert.deepEqual(sourceTopics([{ title: 't', confidence: 'HIGH' }]).length, 1);
    assert.deepEqual(sourceTopics({ nothing: true }), []);
  });

  it('spells God as G-d in topic titles', () => {
    const topics = [{ title: 'Knowing God', start_time_sec: 1, confidence: 'HIGH' }];
    assert.equal(publishOutline('a.mp3', topics).topics[0]!.title, 'Knowing G-d');
  });
});

describe('build (audio publishing)', () => {
  it('publishes the selected lectures from the real data/', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'dist-'));
    const result = build({ ...defaultPaths(), distDir: out });
    assert.deepEqual(result.errors, []);
    const policy = readJson(path.join(DATA_DIR, 'audio-publish.json')) as { minConfidence: number };
    const index = readJson(path.join(out, 'v1/alignments/index.json')) as { items: { id: string; path: string }[] };
    for (const item of index.items) {
      const a = readJson(path.join(out, 'v1', decodePath(item.path))) as { segments: { confidence: number }[] };
      assert.ok(a.segments.every((s) => s.confidence >= policy.minConfidence));
    }
    // Transcripts are never published: no directory, no index entry, no `transcript` path on a chapter's classes.
    assert.equal(existsSync(path.join(out, 'v1', 'transcripts')), false);
    assert.equal(existsSync(path.join(out, 'v1', 'schema', 'transcript.schema.json')), false);
    const top = readJson(path.join(out, 'v1/index.json')) as { items: { id: string }[] };
    assert.ok(top.items.some((i) => i.id === 'chapter-alignments'));
    assert.ok(!top.items.some((i) => i.id === 'transcripts'));
    const chapters = readJson(path.join(out, 'v1/alignments/chapters/index.json')) as { items: { path: string }[] };
    assert.ok(chapters.items.length > 0);
    for (const item of chapters.items) {
      const c = readJson(path.join(out, 'v1', item.path)) as { lectures: Record<string, unknown>[] };
      assert.ok(c.lectures.every((l) => !('transcript' in l)), item.path);
    }
  });

  it('still fails on a stale data/retimed/ file of a published lecture', () => {
    const retimedDir = path.join(DATA_DIR, 'retimed');
    const file = existsSync(retimedDir) ? readdirSync(retimedDir).find((f) => f.endsWith('.json')) : undefined;
    assert.ok(file, 'data/retimed/ has a file');
    const dir = mkdtempSync(path.join(tmpdir(), 'data-'));
    for (const d of ['schema', 'chapters', 'transcripts', 'alignments', 'outlines', 'retimed', 'edits']) {
      if (existsSync(path.join(DATA_DIR, d))) cpSync(path.join(DATA_DIR, d), path.join(dir, d), { recursive: true });
    }
    for (const f of ['classes.txt', 'audio-publish.json', 'alignment-chapters.json', 'chapter-starts.json']) {
      if (existsSync(path.join(DATA_DIR, f))) cpSync(path.join(DATA_DIR, f), path.join(dir, f));
    }
    const r = readJson(path.join(dir, 'retimed', file)) as Record<string, unknown>;
    writeFileSync(path.join(dir, 'retimed', file), JSON.stringify({ ...r, transcriptSha: '0'.repeat(64) }));
    const paths = defaultPaths(dir);
    const errors = build(paths).errors;
    assert.ok(errors.some((e) => e.includes(file) || e.includes(String(r['lectureId']))), errors.join('\n'));
    assert.equal(existsSync(paths.distDir), false);
    // publishAudio itself reports it too (not only the source checks before it), when the lecture is published.
    const schemas = new SchemaSet(paths.schemaDir);
    const { catalog } = loadCatalog(paths, schemas);
    const lectureId = String(r['lectureId']);
    writeFileSync(paths.audioPolicy, JSON.stringify({ minConfidence: 0.45, sections: [], lectures: [lectureId] }));
    const audio = publishAudio({
      dataDir: dir,
      policyFile: paths.audioPolicy,
      catalog,
      chapters: loadChapters(paths.chaptersDir, schemas).chapters.map((ch) => ({ key: ch.key, data: ch.data as Chapter })),
      schemas,
    });
    assert.ok(audio.errors.some((e) => e.includes(file)), audio.errors.join('\n'));
  });

  it('fails on a policy that names an unknown heading, writing nothing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'data-'));
    for (const d of ['schema', 'chapters']) cpSync(path.join(DATA_DIR, d), path.join(dir, d), { recursive: true });
    cpSync(path.join(DATA_DIR, 'classes.txt'), path.join(dir, 'classes.txt'));
    writeFileSync(path.join(dir, 'audio-publish.json'), JSON.stringify({ minConfidence: 0.5, sections: ['999999'] }));
    const paths = defaultPaths(dir);
    assert.deepEqual(build(paths).errors, ['audio-publish.json: section id "999999" is not in classes.txt']);
    assert.equal(existsSync(paths.distDir), false);
  });
});
