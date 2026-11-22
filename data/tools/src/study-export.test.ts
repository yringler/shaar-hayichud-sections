import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DATA_DIR } from './pipeline.js';
import { continuesIn, exportStudyBeta, phraseLines, studyBetaChapter } from './study-export.js';
import { checkStudy, loadStudy, loadStudyContext, type StudyChapterFile } from './study.js';
import type { StoredAlignment } from './transcripts.js';

const FIXTURE = path.join(DATA_DIR, 'tools', 'fixtures', 'study');
const SCHEMAS = path.join(DATA_DIR, 'schema', 'study');
const REL = 'study/test-series/chapter_01.json';
const GENERATED = '2026-01-01T00:00:00.000Z';

const run = (dir: string) => {
  const ctx = loadStudyContext(dir);
  const { issues } = checkStudy(dir, ctx, { schemaDir: SCHEMAS });
  return exportStudyBeta(dir, ctx, issues, GENERATED, SCHEMAS);
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

describe('exportStudyBeta', () => {
  it('writes the index: series, chapter file, status and each class part in seconds', () => {
    const out = run(FIXTURE);
    assert.deepEqual(out.skipped, []);
    assert.deepEqual(out.index, {
      schemaVersion: 1,
      generated: GENERATED,
      series: [
        {
          id: 'test-series',
          catalogSeriesId: '1',
          teacher: loadStudy(FIXTURE, SCHEMAS).series[0]!.data!.teacher,
          title: loadStudy(FIXTURE, SCHEMAS).series[0]!.data!.title,
          chapters: {
            chapter_01: { file: 'test-series/chapter_01.json', status: 'draft', lectures: [{ id: 't1.mp3', start: 0, end: 40.8 }] },
          },
        },
      ],
    });
    assert.deepEqual([...out.files.keys()], ['test-series/chapter_01.json']);
  });

  it('trims the guide: no words, transcription ids, terms, questions, omissions, notes or provenance details', () => {
    const ch = run(FIXTURE).files.get('test-series/chapter_01.json')!;
    assert.deepEqual(Object.keys(ch), ['schemaVersion', 'series', 'chapter', 'title', 'status', 'provenance', 'overview', 'sections']);
    assert.deepEqual(ch.provenance, { method: 'hand' });
    const json = JSON.stringify(ch);
    for (const gone of ['"words"', 'transcriptionId', '"terms"', 'reviewQuestions', '"omitted"']) assert.ok(!json.includes(gone), `${gone} is still in the export`);
    const blocks = ch.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks));
    for (const b of blocks) for (const a of b.audio) assert.deepEqual(Object.keys(a), ['lecture', 'start', 'end']);
    // Kept: sensitivity, phrase notes, skips, and every phrase knows its lines.
    assert.ok(blocks.some((b) => b.sensitivity !== undefined));
    assert.ok(ch.sections.some((s) => s.passages.some((p) => p.skip !== undefined)));
    const first = ch.sections[0]!.passages[0]!;
    assert.deepEqual(first.phrases, [{ he: 'והנה ידוע המאמר', en: 'It is known what the *Zohar* says', notes: ["A translator's footnote."], lines: ['aaaaaaa2'] }]);
  });

  it('does not copy a field the app does not read', () => {
    const file = structuredClone(loadStudy(FIXTURE, SCHEMAS).series[0]!.chapters[0]!.data!);
    (file.sections[0]!.passages[0]!.blocks[0] as unknown as Record<string, unknown>).draftNote = 'x';
    const ch = studyBetaChapter(file, loadStudyContext(FIXTURE).chapterLines('chapter_01')!, false);
    assert.ok(!JSON.stringify(ch).includes('draftNote'));
  });

  it('exports a stale file, marked stale', () => {
    const dir = fixtureWith((f) => {
      f.sections[0]!.passages[0]!.phrases![0]!.he = 'והנה ידוע המאמר הזה';
    });
    const out = run(dir);
    assert.equal(out.index.series[0]!.chapters.chapter_01!.stale, true);
    assert.equal(out.files.get('test-series/chapter_01.json')!.stale, true);
  });

  it('leaves out a file with an error', () => {
    const dir = fixtureWith((f) => {
      f.chapter = 'chapter_02';
    });
    const out = run(dir);
    assert.deepEqual(out.skipped, [REL]);
    assert.equal(out.files.size, 0);
    assert.deepEqual(out.index.series[0]!.chapters, {});
  });
});

describe('build', () => {
  it('writes dist/study-beta/ beside dist/v1/, never inside it', () => {
    const dist = path.join(DATA_DIR, 'dist');
    if (!existsSync(path.join(dist, 'study-beta', 'index.json'))) return; // run `yarn build-data` first
    assert.ok(!existsSync(path.join(dist, 'v1', 'study-beta')));
    const index = JSON.parse(readFileSync(path.join(dist, 'study-beta', 'index.json'), 'utf8'));
    assert.equal(index.schemaVersion, 1);
    for (const s of index.series) for (const c of Object.values(s.chapters) as { file: string }[]) assert.ok(existsSync(path.join(dist, 'study-beta', c.file)));
  });
});
