import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DATA_DIR } from './pipeline.js';
import { continuesIn, exportChapter, exportStudy, phraseLines } from './study-export.js';
import { checkStudy, loadStudy, loadStudyContext, type StudyChapterFile, type StudySeriesFile } from './study.js';
import { SchemaSet } from './validate.js';
import type { StoredAlignment } from './transcripts.js';

const FIXTURE = path.join(DATA_DIR, 'tools', 'fixtures', 'study');
const SCHEMAS = path.join(DATA_DIR, 'schema', 'study');
const REL = 'study/test-series/chapter_01.json';

const run = (dir: string) => {
  const ctx = loadStudyContext(dir);
  const { issues } = checkStudy(dir, ctx, { schemaDir: SCHEMAS });
  return exportStudy(dir, ctx, issues, 'beta', SCHEMAS);
};
/** A copy of the fixture with its study file changed. */
const fixtureWith = (change: (f: StudyChapterFile) => void): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'study-beta-'));
  cpSync(FIXTURE, dir, { recursive: true });
  const file = path.join(dir, REL);
  const data = JSON.parse(readFileSync(file, 'utf8')) as StudyChapterFile;
  change(data);
  writeFileSync(file, JSON.stringify(data));
  return dir;
};

const L = (id: string, text: string) => ({ id, text });

describe('phraseLines', () => {
  const lines = [L('a', 'והנה ידוע  המאמר'), L('b', 'להיות שצריך'), L('c', 'להקדים הכנה')];

  it('maps phrases inside one line, across lines, and several to one line', () => {
    assert.deepEqual(phraseLines(lines, [{ he: 'והנה ידוע' }, { he: 'המאמר להיות' }, { he: 'שצריך' }, { he: 'להקדים הכנה' }]), [['a'], ['a', 'b'], ['b'], ['c']]);
  });

  it('ignores whitespace differences and empty lines', () => {
    assert.deepEqual(phraseLines([L('a', ' והנה\nידוע '), L('e', '  '), L('b', 'המאמר')], [{ he: 'והנה ידוע   המאמר' }]), [['a', 'b']]);
  });

  it('places a repeated phrase after the previous one, not at its first occurrence', () => {
    assert.deepEqual(phraseLines([L('a', 'כו׳ כו׳'), L('b', 'כו׳')], [{ he: 'כו׳' }, { he: 'כו׳' }, { he: 'כו׳' }]), [['a'], ['a'], ['b']]);
  });

  it('keeps going when a stale phrase no longer matches the text', () => {
    // "ידוע" was edited to "נודע" in the chapter: the phrase falls back to where
    // it should be, and the next one finds its text again.
    assert.deepEqual(phraseLines(lines, [{ he: 'והנה ידוע המאמר' }, { he: 'להיות שצריך' }, { he: 'להקדים הכנה' }].map((p, i) => (i === 0 ? { he: 'והנה נודע המאמר' } : p))), [['a'], ['b'], ['c']]);
  });

  it('names no line for a phrase past the end of the text', () => {
    assert.deepEqual(phraseLines([L('a', 'אחד')], [{ he: 'אחד' }, { he: 'שנים' }]), [['a'], []]);
  });
});

describe('continuesIn', () => {
  const seg = (chapter: string, firstWord: number) => ({ chapter, firstWord }) as StoredAlignment['segments'][number];
  const al = (...segments: StoredAlignment['segments']) => ({ segments }) as StoredAlignment;

  it('is the chapter read after this one', () => {
    const a = al(seg('chapter_09', 10), seg('chapter_09', 50), seg('chapter_10', 90), seg('chapter_10', 120));
    assert.equal(continuesIn(a, 'chapter_09'), 'chapter_10');
    assert.equal(continuesIn(a, 'chapter_10'), null);
  });

  it('is null without an alignment or without this chapter', () => {
    assert.equal(continuesIn(null, 'chapter_09'), null);
    assert.equal(continuesIn(al(seg('chapter_10', 0)), 'chapter_09'), null);
  });
});

describe('exportStudy, beta edition', () => {
  it('writes the index of every series, permitted or not: chapter path, status and each class part in seconds', () => {
    const out = run(FIXTURE);
    assert.deepEqual(out.skipped, []);
    assert.deepEqual(out.index, {
      schemaVersion: 1,
      series: [
        {
          id: 'test-series',
          catalogSeriesId: '1',
          teacher: loadStudy(FIXTURE, SCHEMAS).series[0]!.data!.teacher,
          title: loadStudy(FIXTURE, SCHEMAS).series[0]!.data!.title,
          chapters: [{ chapter: 'chapter_01', path: REL, status: 'draft', lectures: [{ id: 't1.mp3', start: 0, end: 40.8 }] }],
        },
      ],
    });
    assert.deepEqual([...out.files.keys()], [REL]);
  });

  it("writes a 'keep' flag as it is, without the review stamp", () => {
    const dir = fixtureWith((f) => {
      const b = f.sections[0]!.passages[1]!.blocks[0]!;
      b.sensitivity = { categories: ['other-religions'], reason: 'r', action: 'keep', reviewed: '2026-11-23' };
    });
    const ch = run(dir).files.get(REL)!;
    const b = ch.sections[0]!.passages[1]!.blocks[0]!;
    assert.deepEqual(b.sensitivity, { categories: ['other-religions'], reason: 'r', action: 'keep' });
    assert.deepEqual(new SchemaSet(path.join(DATA_DIR, 'schema', 'v1')).validate('study', ch), []);
  });

  it('is valid against the v1 schemas, sensitivity and all', () => {
    const out = run(FIXTURE);
    const schemas = new SchemaSet(path.join(DATA_DIR, 'schema', 'v1'));
    assert.deepEqual(schemas.validate('studyIndex', out.index), []);
    assert.deepEqual(schemas.validate('study', out.files.get(REL)!), []);
  });

  it('trims the guide: no words, transcription ids, terms, questions, omissions, notes or provenance details', () => {
    const ch = run(FIXTURE).files.get(REL)!;
    assert.deepEqual(Object.keys(ch), ['schemaVersion', 'series', 'chapter', 'title', 'status', 'provenance', 'overview', 'sections']);
    assert.deepEqual(ch.provenance, { method: 'hand' });
    const json = JSON.stringify(ch);
    for (const gone of ['"words"', 'transcriptionId', '"terms"', 'reviewQuestions', '"omitted"']) assert.ok(!json.includes(gone), `${gone} is still in the export`);
    const blocks = ch.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks));
    for (const b of blocks) for (const a of b.audio) assert.deepEqual(Object.keys(a), ['lecture', 'start', 'end']);
    // Kept: sensitivity, phrase notes, skips, and every phrase knows its lines.
    assert.ok(blocks.some((b) => b.sensitivity !== undefined));
    assert.ok(!json.includes('"reviewed"'), 'the review stamp reached the beta export');
    assert.ok(ch.sections.some((s) => s.passages.some((p) => p.skip !== undefined)));
    const first = ch.sections[0]!.passages[0]!;
    // A phrase he translates carries his English and where he says it; one he only reads, its Hebrew.
    assert.deepEqual(first.phrases, [
      { he: 'והנה', lines: ['aaaaaaa2'] },
      { he: 'ידוע המאמר', en: 'It is known what the *Zohar* says', lecture: 't1.mp3', start: 7, end: 13.8, notes: ["A translator's footnote."], lines: ['aaaaaaa2'] },
    ]);
    for (const p of ch.sections.flatMap((s) => s.passages.flatMap((x) => x.phrases ?? []))) assert.ok(!('audio' in p), 'a phrase keeps its audio object');
  });

  it('does not copy a field the app does not read', () => {
    const file = structuredClone(loadStudy(FIXTURE, SCHEMAS).series[0]!.chapters[0]!.data!);
    (file.sections[0]!.passages[0]!.blocks[0] as unknown as Record<string, unknown>).draftNote = 'x';
    const ch = exportChapter(file, loadStudyContext(FIXTURE).chapterLines('chapter_01')!, false);
    assert.ok(!JSON.stringify(ch).includes('draftNote'));
  });

  it('keeps where the class sums the chapter up, as { lecture, start, end }', () => {
    const file = structuredClone(loadStudy(FIXTURE, SCHEMAS).series[0]!.chapters[0]!.data!);
    const lines = loadStudyContext(FIXTURE).chapterLines('chapter_01')!;
    assert.ok(!('overviewAudio' in exportChapter(file, lines, false)), 'no overviewAudio when the guide cites none');
    file.overviewAudio = [{ lecture: 't1.mp3', words: [0, 3], start: 0.5, end: 4.25 }];
    const ch = exportChapter(file, lines, false);
    assert.deepEqual(ch.overviewAudio, [{ lecture: 't1.mp3', start: 0.5, end: 4.25 }]);
    assert.deepEqual(Object.keys(ch).slice(6, 9), ['overview', 'overviewAudio', 'sections']);
  });

  it('exports a stale file, marked stale', () => {
    const dir = fixtureWith((f) => {
      f.sections[0]!.passages[0]!.phrases![1]!.he = 'ידוע המאמר הזה';
    });
    const out = run(dir);
    assert.equal(out.index.series[0]!.chapters[0]!.stale, true);
    assert.equal(out.files.get(REL)!.stale, true);
  });

  it('leaves out a file with an error', () => {
    const dir = fixtureWith((f) => {
      f.chapter = 'chapter_02';
    });
    const out = run(dir);
    assert.deepEqual(out.skipped, [REL]);
    assert.equal(out.files.size, 0);
    assert.deepEqual(out.index.series[0]!.chapters, []);
  });
});

/** A copy of the fixture with its series.json changed. */
const seriesWith = (change: (s: StudySeriesFile) => void): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'study-public-'));
  cpSync(FIXTURE, dir, { recursive: true });
  const file = path.join(dir, 'study', 'test-series', 'series.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as StudySeriesFile;
  change(data);
  writeFileSync(file, JSON.stringify(data));
  return dir;
};
const runPublic = (dir: string) => {
  const ctx = loadStudyContext(dir);
  const { issues } = checkStudy(dir, ctx, { schemaDir: SCHEMAS });
  return exportStudy(dir, ctx, issues, 'public', SCHEMAS);
};
const PUBLIC = (s: StudySeriesFile) => {
  s.public = { permission: 'The teacher allowed it.', date: '2026-11-22' };
};

describe('exportStudy, public edition', () => {
  it('exports nothing for a series without permission', () => {
    const out = runPublic(FIXTURE);
    assert.deepEqual(out.index, { schemaVersion: 1, series: [] });
    assert.equal(out.files.size, 0);
  });

  it('exports a public series in its public edition, valid against the v1 schemas', () => {
    const out = runPublic(seriesWith(PUBLIC));
    assert.deepEqual(out.index.series[0]!.chapters, [
      { chapter: 'chapter_01', path: 'study/test-series/chapter_01.json', status: 'draft', lectures: [{ id: 't1.mp3', start: 0, end: 40.8 }] },
    ]);
    assert.ok(!('generated' in out.index));
    const ch = out.files.get('study/test-series/chapter_01.json')!;
    const blocks = ch.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks));
    assert.ok(blocks.every((b) => b.sensitivity === undefined), 'a sensitivity flag reached the public edition');
    // The flagged block's publishable text replaced it (or it was omitted).
    const source = loadStudy(FIXTURE, SCHEMAS).series[0]!.chapters[0]!.data!;
    const flagged = source.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks)).filter((b) => b.sensitivity);
    assert.ok(flagged.length > 0);
    for (const f of flagged) {
      assert.ok(!blocks.some((b) => b.text === f.text), 'the flagged text is still published');
      if (f.sensitivity!.action === 'replace') assert.ok(blocks.some((b) => b.text === f.sensitivity!.publishable));
    }
    const schemas = new SchemaSet(path.join(DATA_DIR, 'schema', 'v1'));
    assert.deepEqual(schemas.validate('studyIndex', out.index), []);
    assert.deepEqual(schemas.validate('study', ch), []);
  });
});

describe('build', () => {
  it('writes the beta export to dist/study-beta/v1/study/ beside dist/v1/, never inside it', () => {
    const beta = path.join(DATA_DIR, 'dist', 'study-beta', 'v1');
    if (!existsSync(path.join(beta, 'study', 'index.json'))) return; // run `yarn build-data` first
    assert.ok(!existsSync(path.join(DATA_DIR, 'dist', 'v1', 'study-beta')));
    assert.ok(!existsSync(path.join(DATA_DIR, 'dist', 'study-beta', 'index.json')), 'the old beta index is still written');
    const index = JSON.parse(readFileSync(path.join(beta, 'study', 'index.json'), 'utf8')) as { series: { chapters: { path: string }[] }[] };
    for (const s of index.series) for (const c of s.chapters) assert.ok(existsSync(path.join(beta, c.path)), c.path);
  });

  it('writes the public study guides under dist/v1/study/, listed in index.json, with no sensitivity flag', () => {
    const v1 = path.join(DATA_DIR, 'dist', 'v1');
    if (!existsSync(path.join(v1, 'study', 'index.json'))) return; // run `yarn build-data` first
    const top = JSON.parse(readFileSync(path.join(v1, 'index.json'), 'utf8')) as { items: { id: string }[] };
    assert.ok(top.items.some((i) => i.id === 'study'));
    const index = JSON.parse(readFileSync(path.join(v1, 'study', 'index.json'), 'utf8')) as { series: { chapters: { path: string }[] }[] };
    for (const s of index.series) {
      for (const c of s.chapters) assert.ok(!readFileSync(path.join(v1, c.path), 'utf8').includes('"sensitivity"'), c.path);
    }
  });
});
