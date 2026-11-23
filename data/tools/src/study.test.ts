import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DATA_DIR } from './pipeline.js';
import {
  boldQuotes,
  chapterWordRange,
  checkStudy,
  checkStudyChapter,
  expandPhrases,
  formatStudyFile,
  gaps,
  loadStudy,
  loadStudyContext,
  mergeRanges,
  proseProblems,
  publicView,
  stampTimes,
  type StudyChapterFile,
} from './study.js';
import { dumpChapter, dumpWords, foldBackchannel, sentences } from './study-dump.js';
import type { StoredAlignment } from './transcripts.js';

/** A complete miniature data/ directory: data/tools/fixtures/study/. */
const FIXTURE = path.join(DATA_DIR, 'tools', 'fixtures', 'study');
const SCHEMAS = path.join(DATA_DIR, 'schema', 'study');
const REL = 'study/test-series/chapter_01.json';

const ctx = loadStudyContext(FIXTURE);
const loaded = loadStudy(FIXTURE, SCHEMAS);
const series = loaded.series[0]!.data!;
const gold = loaded.series[0]!.chapters[0]!.data!;

/** Issues of the fixture's study file after `change`, as "level: message". */
const check = (change: (f: StudyChapterFile) => void, opts: { gapWords?: number } = {}): string[] => {
  const file = structuredClone(gold);
  change(file);
  return checkStudyChapter(REL, file, series, loaded.translit, ctx, opts).issues.map((i) => `${i.level}: ${i.message}`);
};
const has = (issues: string[], pattern: RegExp) => assert.ok(issues.some((i) => pattern.test(i)), `no issue matches ${pattern} in ${JSON.stringify(issues)}`);

describe('study fixture', () => {
  it('is valid: schema, references, times, no warnings', () => {
    assert.deepEqual(loaded.issues, []);
    assert.deepEqual(checkStudy(FIXTURE, undefined, { schemaDir: SCHEMAS }).issues, []);
  });

  it('counts what it holds', () => {
    const { stats } = checkStudyChapter(REL, gold, series, loaded.translit, ctx);
    assert.equal(stats.passages, 3);
    assert.equal(stats.skipped, 1);
    assert.deepEqual(stats.byKind, { explanation: 1, mashal: 1, avodah: 1 });
    assert.equal(stats.flagged, 1);
    assert.deepEqual(stats.coverage, [{ lecture: 't1.mp3', words: 41, cited: 36, omitted: 5 }]);
  });

  it('is written in the standard formatting', () => {
    assert.equal(readFileSync(path.join(FIXTURE, REL), 'utf8'), formatStudyFile(gold));
  });
});

describe('checkStudyChapter: lines and phrases', () => {
  it('reports a line that is not in the chapter as stale', () => {
    has(check((f) => (f.sections[0]!.passages[0]!.lines = ['zzzzzzz2'])), /^stale: .*line "zzzzzzz2" is not a line of chapter_01/);
  });

  it('wants every line once, in order', () => {
    has(check((f) => f.sections[0]!.passages.pop()), /^stale: the passages stop at line 2 of 3: "ccccccc2"/);
    has(check((f) => f.sections[0]!.passages.reverse()), /^stale: .*is out of place: the next line of the chapter is "aaaaaaa2"/);
  });

  it('wants the phrases to spell out the text of the lines', () => {
    has(check((f) => (f.sections[0]!.passages[1]!.phrases![1]!.he = 'להקדים')), /^stale: .*the phrases' Hebrew is not the text of its lines/);
    // White space between phrases does not matter.
    assert.deepEqual(check((f) => (f.sections[0]!.passages[1]!.phrases![0]!.he = 'להיות  שצריך')), []);
  });

  it('wants blocks or a skip, and phrases unless there is no recording', () => {
    has(check((f) => delete f.sections[0]!.passages[2]!.skip), /^error: .*has no blocks; add a "skip"/);
    has(check((f) => delete f.sections[0]!.passages[0]!.phrases), /^error: .*has no "phrases"/);
    has(check((f) => (f.sections[0]!.passages[0]!.skip = { reason: 'read-only' })), /^error: .*has both "skip" and blocks/);
  });

  it('wants no phrases on a passage no class reads', () => {
    has(check((f) => (f.sections[0]!.passages[2]!.phrases = [{ he: 'וזה אינו אלא כך' }])), /^error: \/sections\/0\/passages\/2 is skipped as no-recording but has "phrases"/);
  });
});

describe('checkStudyChapter: the translation is the class\'s', () => {
  const phrase = (f: StudyChapterFile) => f.sections[0]!.passages[1]!.phrases![0]!;

  it('keeps a phrase he does not translate as Hebrew only', () => {
    // (Only the bold that quoted its English now warns.)
    assert.deepEqual(check((f) => { delete phrase(f).en; delete phrase(f).audio; }).filter((i) => !i.startsWith('warning')), []);
    has(check((f) => delete phrase(f).en), /^error: .*phrases\/0 has "audio" but no "en"/);
  });

  it('rejects English with no anchor in the class, unless the series names a published translation', () => {
    has(check((f) => delete phrase(f).audio), /^error: \/sections\/0\/passages\/1\/phrases\/0 has "en" but no "audio"/);
    const file = structuredClone(gold);
    delete phrase(file).audio;
    const published = { ...series, publishedTranslation: { title: 'A Translation', source: 'A book', license: 'CC-BY' } };
    assert.deepEqual(checkStudyChapter(REL, file, published, loaded.translit, ctx).issues, []);
  });

  it('checks the anchor like block audio: listed lecture, word range, times', () => {
    has(check((f) => (phrase(f).audio!.lecture = 'nope.mp3')), /^error: .*phrases\/0\/audio lecture "nope.mp3" is not in the file's "lectures"/);
    has(check((f) => (phrase(f).audio!.words = [30, 41])), /^error: .*phrases\/0\/audio words \[30, 41\]: the transcript has 41 words/);
    has(check((f) => (phrase(f).audio!.start = 3)), /^stale: .*phrases\/0\/audio start\/end 3–26.8 are not the times of words \[25, 26\]/);
  });

  it('warns when the anchor is outside the class\'s part on this chapter', () => {
    // Make the class's part on chapter_01 word 0 alone: chapter_02 starts at word 1.
    const far = structuredClone(ctx.alignment('t1.mp3')!);
    far.segments = [...far.segments.map((s) => ({ ...s, firstWord: 0 })), { ...far.segments[0]!, chapter: 'chapter_02', firstWord: 1 }];
    const moved = { ...ctx, alignment: (id: string) => (id === 't1.mp3' ? far : ctx.alignment(id)) };
    const issues = checkStudyChapter(REL, gold, series, loaded.translit, moved, { slackSeconds: 5 }).issues.map((i) => `${i.level}: ${i.message}`);
    has(issues, /^warning: .*phrases\/0\/audio words \[25, 26\] \(0:25\) lie outside class "t1.mp3"'s part on chapter_01 \(words \[0, 0\]/);
  });
});

describe('checkStudyChapter: lectures and audio', () => {
  const audio = (f: StudyChapterFile) => f.sections[0]!.passages[0]!.blocks[0]!.audio[0]!;

  it('rejects unknown lectures, other series and a re-made transcription', () => {
    has(check((f) => (f.lectures[0]!.id = 'nope.mp3')), /^error: lecture "nope.mp3" is not in classes.txt/);
    has(check((f) => (audio(f).lecture = 'nope.mp3')), /^error: .*lecture "nope.mp3" is not in the file's "lectures"/);
    has(check((f) => (f.lectures[0]!.transcriptionId = 'tid-0')), /^error: lecture "t1.mp3" was transcribed again \(tid-1\)/);
    const other = { ...series, catalogSeriesId: '9' };
    assert.ok(checkStudyChapter(REL, gold, other, loaded.translit, ctx).issues.some((i) => /is not in catalog series 9/.test(i.message)));
  });

  it('rejects word ranges outside the transcript', () => {
    has(check((f) => (audio(f).words = [0, 41])), /^error: .*words \[0, 41\]: the transcript has 41 words/);
    has(check((f) => (audio(f).words = [9, 3])), /^error: .*the first word is after the last/);
  });

  it('reports times that are not the words\' times as stale, and stampTimes mends them', () => {
    has(check((f) => (audio(f).start = 3)), /^stale: .*are not the times of words \[0, 13\] \(0–13.8\); run yarn study-fill/);
    has(check((f) => delete audio(f).end), /^stale: .*has no start\/end; run yarn study-fill/);
    const file = structuredClone(gold);
    audio(file).start = 3;
    delete file.sections[0]!.passages[0]!.blocks[1]!.audio[0]!.end;
    delete file.sections[0]!.passages[1]!.phrases![1]!.audio!.start;
    assert.deepEqual(stampTimes(file, ctx), { changed: 3, errors: [] });
    assert.deepEqual(file, gold);
    assert.deepEqual(stampTimes(file, ctx), { changed: 0, errors: [] });
  });

  it('expandPhrases fills the Hebrew of phrases written with "to"', () => {
    const file = structuredClone(gold);
    const passage = file.sections[0]!.passages[1]!;
    const [one, two] = gold.sections[0]!.passages[1]!.phrases!;
    passage.phrases = [{ to: 'שצריך', en: one!.en, audio: one!.audio }, { en: two!.en, audio: two!.audio }] as never;
    file.sections[0]!.passages[0]!.phrases = [{ to: 'והנה' }, structuredClone(gold.sections[0]!.passages[0]!.phrases![1]!)] as never;
    assert.deepEqual(expandPhrases(file, ctx), { changed: 3, errors: [] });
    assert.deepEqual(file, gold);
    passage.phrases = [{ to: 'איננו', en: 'x' }, { en: 'y' }] as never;
    assert.match(expandPhrases(file, ctx).errors[0]!, /"to": "איננו" is not a word of the passage/);
  });

  it('warns when a block is far from where the class reads its passage', () => {
    const far = (f: StudyChapterFile) => {
      const block = f.sections[0]!.passages[0]!.blocks.pop()!;
      f.sections[0]!.passages[2] = { lines: ['ccccccc2'], phrases: [{ he: 'וזה אינו אלא כך' }], blocks: [block] };
    };
    has(check(far), /^warning: .*class "t1.mp3" does not read this passage's lines; .*"outOfPlace"/);
    assert.deepEqual(check((f) => { far(f); f.sections[0]!.passages[2]!.blocks[0]!.outOfPlace = 'The example is given earlier.'; }), []);
  });

  it('warns about a stretch of class that is neither cited nor omitted', () => {
    has(check((f) => delete f.omitted, { gapWords: 5 }), /^warning: class "t1.mp3" words \[36, 40\] \(0:36–0:40, 5 words\) are neither cited/);
    assert.deepEqual(check(() => {}, { gapWords: 1 }), []);
  });
});

describe('checkStudyChapter: prose, terms and sensitivity', () => {
  const block = (f: StudyChapterFile) => f.sections[0]!.passages[0]!.blocks[0]!;

  it('allows inline Markdown only, and wants G-d', () => {
    has(check((f) => (block(f).text = 'See [here](x).')), /^error: .*text has a Markdown link/);
    has(check((f) => (block(f).text = '- a list')), /^error: .*text has a heading, list or block quote/);
    has(check((f) => (block(f).text = 'God is one.')), /^error: .*text spells the Name out/);
    has(check((f) => (block(f).text = 'An **unclosed bold.')), /^error: .*text has an unclosed \*\*/);
    has(check((f) => (block(f).text = 'The המאמר is known.')), /^warning: .*text has Hebrew script \("המאמר"\)/);
  });

  it('wants bold to quote the passage\'s translation', () => {
    has(check((f) => (block(f).text = '**It was known** long ago.')), /^warning: .*bold "It was known" is not in the passage's translation/);
    assert.deepEqual(check((f) => (block(f).text = '**It is known … the Zohar says**: a familiar one.')), []);
  });

  it('holds terms to the transliteration table', () => {
    has(check((f) => (f.terms[0]!.term = 'hachono')), /^error: .*"הכנה" is spelled "hachono" here but "hachana" in study\/translit.json/);
    has(check((f) => f.terms.push({ term: 'zohar-term', he: 'זוהר', gloss: 'x' })), /^warning: .*"zohar-term" does not appear in the file's prose/);
  });

  it('wants a question on question blocks and a title on a mashal', () => {
    has(check((f) => (block(f).kind = 'question')), /^error: .*is a question block without "question"/);
    has(check((f) => delete f.sections[0]!.passages[0]!.blocks[1]!.title), /^warning: .*is a mashal without a "title"/);
  });

  it('checks the sensitivity action, and publicView applies it', () => {
    const flagged = (f: StudyChapterFile) => f.sections[0]!.passages[1]!.blocks[0]!;
    has(check((f) => delete flagged(f).sensitivity!.publishable), /^error: .*action "replace" but no "publishable"/);
    has(check((f) => (flagged(f).sensitivity!.action = 'omit')), /^error: .*action "omit" and a publishable text/);
    assert.equal(flagged(gold).sensitivity!.reviewed, '2026-11-01'); // the fixture's flag has been reviewed

    const pub = publicView(gold);
    assert.equal(flagged(pub).text, '**one must prepare the soul first**. That is the whole work.');
    assert.equal(flagged(pub).sensitivity, undefined);
    assert.equal(pub.notes, undefined);
    assert.equal(pub.omitted, undefined);
    assert.match(flagged(gold).text, /fooling himself/); // the source is untouched

    const omit = structuredClone(gold);
    flagged(omit).sensitivity = { categories: ['other'], reason: 'r', action: 'omit' };
    assert.deepEqual(publicView(omit).sections[0]!.passages[1]!.blocks, []);
  });
});

describe('loadStudy (schema)', () => {
  it('rejects a file the schema does not accept, and a misnamed one', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'study-'));
    cpSync(FIXTURE, dir, { recursive: true });
    const bad = structuredClone(gold) as unknown as { sections: { passages: { blocks: { kind: string }[] }[] }[]; extra?: number };
    bad.sections[0]!.passages[0]!.blocks[0]!.kind = 'sermon';
    bad.extra = 1;
    writeFileSync(path.join(dir, REL), JSON.stringify(bad));
    writeFileSync(path.join(dir, 'study/test-series/ch1.json'), '{}');
    const issues = checkStudy(dir, undefined, { schemaDir: SCHEMAS }).issues.map((i) => `${i.file}: ${i.message}`);
    has(issues, /chapter_01\.json: \/ must NOT have additional properties/);
    has(issues, /chapter_01\.json: \/sections\/0\/passages\/0\/blocks\/0\/kind must be equal to one of the allowed values/);
    has(issues, /ch1\.json: study files must be named chapter_NN\.json/);
  });
});

describe('helpers', () => {
  it('mergeRanges and gaps', () => {
    assert.deepEqual(mergeRanges([[5, 9], [0, 2], [3, 4], [20, 30]]), [[0, 9], [20, 30]]);
    assert.deepEqual(gaps([0, 40], [[0, 9], [20, 30]]), [[10, 19], [31, 40]]);
    assert.deepEqual(gaps([10, 20], [[0, 40]]), []);
    assert.deepEqual(gaps([10, 20], []), [[10, 20]]);
  });

  it('chapterWordRange cuts a two-chapter class at the switch', () => {
    const seg = (chapter: string, firstWord: number) => ({ chapter, firstWord }) as StoredAlignment['segments'][number];
    const a = { segments: [seg('chapter_15', 50), seg('chapter_15', 400), seg('chapter_16', 900), seg('chapter_16', 1500)] } as StoredAlignment;
    assert.deepEqual(chapterWordRange(a, 2000, 'chapter_15'), [0, 899]);
    assert.deepEqual(chapterWordRange(a, 2000, 'chapter_16'), [900, 1999]);
    assert.equal(chapterWordRange(a, 2000, 'chapter_17'), null);
    assert.deepEqual(chapterWordRange(null, 2000, 'chapter_17'), [0, 1999]);
  });

  it('boldQuotes and proseProblems', () => {
    assert.deepEqual(boldQuotes('**one … two** and **contemplation (*Hitbonenut*)**.'), ['one', 'two', 'contemplation (Hitbonenut)']);
    assert.deepEqual(proseProblems('One paragraph.\n\nAnother, with *italics* and **bold**, of G-dliness.'), { errors: [], warnings: [] });
    assert.equal(proseProblems('Two lines\nin one paragraph.').errors.length, 1);
  });

  it('sentences carry their word ranges and break before a line', () => {
    const words = ctx.transcript('t1.mp3')!.words;
    const s = sentences(words, 0, 13, new Set([4]));
    assert.deepEqual(s.map((x) => x.words), [[0, 0], [1, 3], [4, 13]]);
    assert.equal(s[2]!.text, 'והנה ידוע המאמר, it is known what the Zohar says.');
    const folded = foldBackchannel([
      { words: [0, 5], start: 0, text: 'It is like that.' },
      { words: [6, 6], start: 3, text: 'Right.' },
      { words: [7, 9], start: 4, text: 'Right or wrong?' },
      { words: [10, 10], start: 5, text: 'Right.' },
    ], new Set([10]));
    assert.deepEqual(folded.map((x) => x.words), [[0, 6], [7, 9], [10, 10]]);
  });
});

describe('dumpChapter', () => {
  it('prints lines with ids, the classes, spellings and the marked transcript', () => {
    const text = dumpChapter(ctx, series, loaded.translit, 'chapter_01');
    assert.match(text, /- "t1\.mp3" transcriptionId tid-1: 41 words, 1:00, sofer times; chapter part words \[0, 40\]/);
    assert.match(text, /1\. aaaaaaa2: והנה ידוע המאמר\n\s+read: t1\.mp3 w4 0:04 conf 0\.9/);
    assert.match(text, /3\. ccccccc2: וזה אינו אלא כך\n\s+NOT READ in any class/);
    assert.match(text, /- הכנה = hachana \(preparation\)/);
    assert.match(text, /=== LINE 2 bbbbbbb2 \(conf 0\.9\): להיות שצריך להקדים הכנה\n\[w21-30 0:21\] להיות שצריך להקדים הכנה, one must prepare the soul first\./);
  });
});

describe('dumpWords', () => {
  it('prints each word with its index, a line per sentence', () => {
    assert.equal(dumpWords(ctx, 't1.mp3', 24, 31), '# "t1.mp3" words [24, 31]\n[0:24] 24:הכנה, 25:one 26:must 27:prepare 28:the 29:soul 30:first.\n[0:31] 31:That\n');
  });
});

describe('data/study', () => {
  it('has no errors and no stale references', () => {
    // Transitional errors are the guides not yet migrated to the class-only translation rule.
    const bad = checkStudy(DATA_DIR).issues.filter((i) => i.level !== 'warning');
    assert.deepEqual(bad, []);
  });
});
