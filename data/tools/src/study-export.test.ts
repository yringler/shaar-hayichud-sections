import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DATA_DIR } from './pipeline.js';
import { continuesIn, exportChapter, exportStudy, phraseLines, STUDY_INDEX_PATHS } from './study-export.js';
import { checkStudy, loadStudy, loadStudyContext, type StudyChapterFile, type StudySeriesFile, type StudyTier } from './study.js';
import { SchemaSet } from './validate.js';
import type { StoredAlignment } from './transcripts.js';

const FIXTURE = path.join(DATA_DIR, 'tools', 'fixtures', 'study');
const SCHEMAS = path.join(DATA_DIR, 'schema', 'study');
const REL = 'study/test-series/chapter_01.json';

/** A copy of the fixture with its series.json changed. */
const seriesWith = (change: (s: StudySeriesFile) => void, from = FIXTURE): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'study-tier-'));
  cpSync(from, dir, { recursive: true });
  const file = path.join(dir, 'study', 'test-series', 'series.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as StudySeriesFile;
  change(data);
  writeFileSync(file, JSON.stringify(data));
  return dir;
};
const PUBLIC = (s: StudySeriesFile) => {
  s.public = { permission: 'The teacher allowed it.', date: '2026-11-22' };
};
const ADVANCED = (s: StudySeriesFile) => {
  s.advanced = { note: 'Published unlisted.', date: '2026-11-25' };
};
/** The fixture with its series public. */
const PUBLIC_FIXTURE = seriesWith(PUBLIC);

const checked = (dir: string) => {
  const ctx = loadStudyContext(dir);
  return { ctx, issues: checkStudy(dir, ctx, { schemaDir: SCHEMAS }).issues };
};
const run = (dir: string, tier: StudyTier = 'public') => {
  const { ctx, issues } = checked(dir);
  return exportStudy(dir, ctx, issues, tier, SCHEMAS);
};
/** A copy of the (public) fixture with its study file changed. */
const fixtureWith = (change: (f: StudyChapterFile) => void): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'study-export-'));
  cpSync(PUBLIC_FIXTURE, dir, { recursive: true });
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

describe('exportStudy', () => {
  it('writes the index of a public series: chapter path, status and each class part in seconds', () => {
    const out = run(PUBLIC_FIXTURE);
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

  it('is valid against the v1 schemas', () => {
    const out = run(PUBLIC_FIXTURE);
    const schemas = new SchemaSet(path.join(DATA_DIR, 'schema', 'v1'));
    assert.deepEqual(schemas.validate('studyIndex', out.index), []);
    assert.deepEqual(schemas.validate('study', out.files.get(REL)!), []);
  });

  it('trims the guide: no words, transcription ids, terms, questions, omissions, notes or provenance details', () => {
    const ch = run(PUBLIC_FIXTURE).files.get(REL)!;
    assert.deepEqual(Object.keys(ch), ['schemaVersion', 'series', 'chapter', 'title', 'status', 'provenance', 'overview', 'sections']);
    assert.deepEqual(ch.provenance, { method: 'hand' });
    const json = JSON.stringify(ch);
    for (const gone of ['"words"', 'transcriptionId', '"terms"', 'reviewQuestions', '"omitted"']) assert.ok(!json.includes(gone), `${gone} is still in the export`);
    const blocks = ch.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks));
    for (const b of blocks) for (const a of b.audio) assert.deepEqual(Object.keys(a), ['lecture', 'start', 'end']);
    // Gone: every trace of the sensitivity flags (the public edition applied them).
    for (const gone of ['"sensitivity"', '"reviewed"', '"recommend"', '"judgmentNote"']) assert.ok(!json.includes(gone), `${gone} reached the export`);
    // Kept: phrase notes, skips, and every phrase knows its lines.
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

const flaggedOf = (dir: string) =>
  loadStudy(dir, SCHEMAS).series[0]!.chapters[0]!.data!.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks)).filter((b) => b.sensitivity);

describe('exportStudy, tiers', () => {
  it('exports nothing, in either tier, for a series with neither public nor advanced', () => {
    for (const tier of ['public', 'advanced'] as const) {
      const out = run(FIXTURE, tier);
      assert.deepEqual(out.index, { schemaVersion: 1, series: [] });
      assert.equal(out.files.size, 0);
    }
  });

  it('exports a public series in the public tier only, in its public edition', () => {
    assert.equal(run(PUBLIC_FIXTURE, 'advanced').index.series.length, 0);
    const out = run(PUBLIC_FIXTURE, 'public');
    assert.deepEqual(out.index.series[0]!.chapters, [
      { chapter: 'chapter_01', path: 'study/test-series/chapter_01.json', status: 'draft', lectures: [{ id: 't1.mp3', start: 0, end: 40.8 }] },
    ]);
    assert.ok(!('generated' in out.index) && !('tier' in out.index) && !('tier' in out.index.series[0]!));
  });

  it('exports an advanced series in the advanced tier only, in the same public edition and shape', () => {
    const dir = seriesWith(ADVANCED);
    assert.equal(run(dir, 'public').index.series.length, 0);
    const out = run(dir, 'advanced');
    const pub = run(PUBLIC_FIXTURE, 'public');
    // The same guide and index entry as if the series were public: the index file is the tier.
    assert.deepEqual(out.index, pub.index);
    assert.deepEqual([...out.files], [...pub.files]);
    const ch = out.files.get(REL)!;
    const blocks = ch.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks));
    assert.ok(!JSON.stringify(ch).includes('"sensitivity"'), 'a sensitivity flag reached the advanced export');
    const flagged = flaggedOf(dir);
    assert.ok(flagged.length > 0);
    for (const f of flagged) {
      assert.ok(!blocks.some((b) => b.text === f.text), 'the flagged text is still published');
      if (f.sensitivity!.action === 'replace') assert.ok(blocks.some((b) => b.text === f.sensitivity!.publishable));
    }
    const schemas = new SchemaSet(path.join(DATA_DIR, 'schema', 'v1'));
    assert.deepEqual(schemas.validate('studyIndex', out.index), []);
    assert.deepEqual(schemas.validate('study', ch), []);
  });

  it('warns about an unreviewed flag in an advanced series (and only there)', () => {
    const unreviewed = (dir: string) => checked(dir).issues.filter((i) => i.level === 'warning' && /not "reviewed" in an advanced series/.test(i.message));
    assert.equal(unreviewed(PUBLIC_FIXTURE).length, 0);
    // The fixture's flag is reviewed: no warning.
    assert.equal(unreviewed(seriesWith(ADVANCED)).length, 0);
    const dir = seriesWith(ADVANCED);
    const file = path.join(dir, REL);
    const data = JSON.parse(readFileSync(file, 'utf8')) as StudyChapterFile;
    for (const s of data.sections) for (const p of s.passages) for (const b of p.blocks) delete b.sensitivity?.reviewed;
    writeFileSync(file, JSON.stringify(data));
    assert.ok(flaggedOf(dir).length > 0);
    assert.equal(unreviewed(dir).length, flaggedOf(dir).length);
    assert.ok(!checked(dir).issues.some((i) => i.level === 'error'));
    // Still exported, with the flag's action applied.
    assert.equal(run(dir, 'advanced').files.size, 1);
    // A public series with the same unreviewed flag gets no such warning.
    assert.equal(unreviewed(seriesWith(PUBLIC, dir)).length, 0);
  });

  it('rejects a series that is both public and advanced, and exports it in neither tier', () => {
    const dir = seriesWith((s) => {
      PUBLIC(s);
      ADVANCED(s);
    });
    const errors = checked(dir).issues.filter((i) => i.level === 'error');
    assert.ok(errors.some((e) => e.file === 'study/test-series/series.json' && /both "public" and "advanced"/.test(e.message)), JSON.stringify(errors));
    for (const tier of ['public', 'advanced'] as const) assert.equal(run(dir, tier).index.series.length, 0);
  });
});

describe('build', () => {
  it('writes no study-beta export', () => {
    if (!existsSync(path.join(DATA_DIR, 'dist', 'v1', 'study', 'index.json'))) return; // run `yarn build-data` first
    assert.ok(!existsSync(path.join(DATA_DIR, 'dist', 'study-beta')));
    assert.ok(!existsSync(path.join(DATA_DIR, 'dist', 'v1', 'study-beta')));
  });

  it('writes both tiers under dist/v1/study/: index.json (public) and index-advanced.json, valid, no series in both, no sensitivity', () => {
    const v1 = path.join(DATA_DIR, 'dist', 'v1');
    if (!existsSync(path.join(v1, 'study', 'index.json'))) return; // run `yarn build-data` first
    const top = JSON.parse(readFileSync(path.join(v1, 'index.json'), 'utf8')) as { items: { id: string; path: string }[] };
    assert.ok(top.items.some((i) => i.id === 'study'));
    // The advanced index is unlisted: not in the root index.
    assert.ok(!top.items.some((i) => i.path.includes('index-advanced')));
    const schemas = new SchemaSet(path.join(DATA_DIR, 'schema', 'v1'));
    const ids: Record<string, string[]> = {};
    for (const [tier, rel] of Object.entries(STUDY_INDEX_PATHS)) {
      const index = JSON.parse(readFileSync(path.join(v1, rel), 'utf8')) as { series: { id: string; chapters: { path: string }[] }[] };
      assert.deepEqual(schemas.validate('studyIndex', index), [], rel);
      ids[tier] = index.series.map((s) => s.id);
      for (const s of index.series) {
        const series = JSON.parse(readFileSync(path.join(DATA_DIR, 'study', s.id, 'series.json'), 'utf8')) as StudySeriesFile;
        assert.ok(tier === 'public' ? series.public && !series.advanced : series.advanced && !series.public, `${s.id} in ${rel}`);
        for (const c of s.chapters) {
          const text = readFileSync(path.join(v1, c.path), 'utf8');
          assert.ok(!text.includes('"sensitivity"'), c.path);
          assert.deepEqual(schemas.validate('study', JSON.parse(text)), [], c.path);
        }
      }
    }
    assert.ok(ids['advanced']!.includes('markel-advanced'));
    assert.ok(!ids['public']!.includes('markel-advanced'));
    assert.deepEqual(ids['public']!.filter((id) => ids['advanced']!.includes(id)), []);
  });
});
