import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildCatalog } from './catalog.js';
import type { Chapter } from './chapter.js';
import { parseClassesTxt } from './parse.js';
import { build, DATA_DIR, defaultPaths } from './pipeline.js';
import {
  alignmentChapters,
  chapterAlignments,
  chapterKeyOf,
  lectureInfos,
  paragraphs,
  parsePublishPolicy,
  publishAlignment,
  publishOutline,
  sourceTopics,
  selectPublished,
  speakerLabelsOn,
  type TimedWord,
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

/** Words `n` apart, `dur` long, with the given texts. */
const words = (texts: string[], step = 0.5, dur = 0.4): TimedWord[] =>
  texts.map((word, i) => ({ word, start: i * step, end: i * step + dur }));

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

describe('chapterKeyOf', () => {
  it('only a "Chapter N" parent heading teaches a chapter', () => {
    assert.equal(chapterKeyOf(infos.get('a.mp3')!), 'chapter_03');
    assert.equal(chapterKeyOf(infos.get('intro.mp3')!), null);
  });
});

describe('paragraphs', () => {
  it('splits at a long pause once the paragraph has enough words', () => {
    const w = words(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);
    // A 2.5 s pause after the ninth word.
    w[8]!.end = 4;
    w[9]!.start = 6.5;
    w[9]!.end = 7;
    const p = paragraphs(w);
    assert.deepEqual(
      p.map((x) => x.text),
      ['one two three four five six seven eight nine', 'ten'],
    );
    assert.deepEqual([p[0]!.startSeconds, p[0]!.endSeconds, p[1]!.startSeconds, p[1]!.endSeconds], [0, 4, 6.5, 7]);
  });

  it('does not split a short paragraph at a pause', () => {
    const w = words(['a', 'b', 'c']);
    w[2]!.start = 10;
    w[2]!.end = 10.5;
    assert.equal(paragraphs(w).length, 1);
  });

  it('splits at a sentence end once the paragraph reaches the target length', () => {
    const texts = Array.from({ length: 80 }, (_, i) => (i === 69 ? 'end.' : `w${i}`));
    const p = paragraphs(words(texts));
    assert.equal(p.length, 2);
    assert.equal(p[0]!.text.split(' ').length, 70);
    assert.ok(p[0]!.text.endsWith('end.'));
  });

  it('splits at a sentence end followed by a short pause after enough words', () => {
    const texts = Array.from({ length: 40 }, (_, i) => (i === 29 ? 'done?' : `w${i}`));
    const w = words(texts);
    for (const x of w.slice(30)) {
      x.start += 1;
      x.end += 1;
    }
    assert.deepEqual(paragraphs(w).map((x) => x.text.split(' ').length), [30, 10]);
  });

  it('splits at every speaker change and labels the paragraphs', () => {
    const w = words(['Rabbi', 'speaks.', 'A', 'question?', 'Answer']);
    const who = ['S0', 'S0', 'S1', 'S1', 'S0'];
    w.forEach((x, i) => (x.speaker = who[i]!));
    assert.deepEqual(
      paragraphs(w).map((p) => [p.speaker, p.text]),
      [
        ['S0', 'Rabbi speaks.'],
        ['S1', 'A question?'],
        ['S0', 'Answer'],
      ],
    );
  });

  it('has no speaker field when the words have none (null)', () => {
    const w = words(['a', 'b']).map((x) => ({ ...x, speaker: null }));
    assert.deepEqual(Object.keys(paragraphs(w)[0]!), ['startSeconds', 'endSeconds', 'text']);
  });

  it('caps paragraph length and skips blank words', () => {
    const texts = Array.from({ length: 450 }, (_, i) => (i === 3 ? ' ' : `w${i}`));
    assert.deepEqual(paragraphs(words(texts)).map((x) => x.text.split(' ').length), [200, 200, 49]);
  });
});

describe('speakerLabelsOn', () => {
  it('follows the series speaker setting; unknown series are off', () => {
    const config = [
      { seriesId: '1', title: 'A', speakers: { mode: 'auto' as const }, note: '' },
      { seriesId: '2', title: 'B', speakers: { mode: 'off' as const }, note: '' },
    ];
    assert.equal(speakerLabelsOn('1', config), true);
    assert.equal(speakerLabelsOn('2', config), false);
    assert.equal(speakerLabelsOn('3', config), false);
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
      r.lectures.map((l) => [l.id, l.seriesId, l.series, l.part, l.transcript ?? null]),
      [
        ['a.mp3', '1', 'Series A', 'Chapters / Chapter 3', 'transcripts/a.mp3.json'],
        ['c.mp3', '4', 'Series B', 'Chapter 3', null],
      ],
    );
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
    const transcripts = readJson(path.join(out, 'v1/transcripts/index.json')) as { items: { path: string }[] };
    for (const item of transcripts.items) {
      const t = readJson(path.join(out, 'v1', decodePath(item.path))) as Record<string, unknown>;
      assert.ok(!('result' in t) && !('sofer' in t), 'raw Sofer data is not published');
      // No in-scope series labels speakers today, so stored labels (Markel 002) are dropped.
      assert.ok(!(t['segments'] as Record<string, unknown>[]).some((seg) => 'speaker' in seg), 'speaker labels are not published');
    }
    const top = readJson(path.join(out, 'v1/index.json')) as { items: { id: string }[] };
    assert.ok(top.items.some((i) => i.id === 'chapter-alignments'));
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
