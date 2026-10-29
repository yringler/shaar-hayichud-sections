import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alignTokens,
  alignTranscript,
  alignTranscriptByRanges,
  alignTranscriptToChapters,
  chapterTokens,
  DEFAULT_ALIGN_OPTIONS,
  linesFromMatches,
  normalizeHebrew,
  tokenizeLine,
  transcriptTokens,
  wordSimilarity,
} from './align.js';
import type { Chapter } from './chapter.js';
import type { SoferWord } from './transcripts.js';

/** Words at one per second from `start`. */
function words(text: string, start = 0): SoferWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({ word, start: start + i, end: start + i + 0.8 }));
}

describe('normalizeHebrew', () => {
  it('strips nikud, cantillation and punctuation', () => {
    assert.equal(normalizeHebrew('בְּרֵאשִׁ֖ית,'), 'בראשית');
    assert.equal(normalizeHebrew('(י)'), 'י');
    assert.equal(normalizeHebrew('הָעֶלְיוֹן.'), 'העליונ');
  });

  it('folds final letters and gershayim', () => {
    assert.equal(normalizeHebrew('דאבי"ע'), 'דאביע');
    assert.equal(normalizeHebrew("דאבי''ע"), 'דאביע');
    assert.equal(normalizeHebrew('דאבי״ע'), 'דאביע');
    assert.equal(normalizeHebrew('ארץ'), normalizeHebrew('ארצ'));
    assert.equal(normalizeHebrew('סוף'), 'סופ');
  });

  it('expands Yiddish ligatures and drops Latin', () => {
    assert.equal(normalizeHebrew('ײדיש'), 'יידיש');
    assert.equal(normalizeHebrew('hello'), '');
  });
});

describe('wordSimilarity', () => {
  it('is 1 for equal words and 0 for unrelated ones', () => {
    assert.equal(wordSimilarity('אור', 'אור'), 1);
    assert.equal(wordSimilarity('אור', 'כלים'), 0);
  });

  it('accepts spelling with or without vowel letters', () => {
    assert.equal(wordSimilarity(normalizeHebrew('קיצור'), normalizeHebrew('קצור')), 0.9);
  });

  it('accepts one attached prefix letter', () => {
    assert.equal(wordSimilarity('שהוא', 'הוא'), 0.8);
    assert.equal(wordSimilarity('כו', 'וכו'), 0.8);
  });

  it('tolerates a small transcription error in longer words', () => {
    const s = wordSimilarity(normalizeHebrew('וכהאי'), normalizeHebrew('וכאי'));
    assert.ok(s >= 0.6, String(s));
    // Short words must match exactly (or by prefix / vowel letters).
    assert.equal(wordSimilarity('של', 'שמ'), 0);
  });
});

describe('tokenizeLine', () => {
  it('marks abbreviations and parenthesized markers as optional', () => {
    assert.deepEqual(tokenizeLine("(י) ומעתה בכל ד' עולמות דאבי''ע, כו'"), [
      { norm: 'י', optional: true },
      { norm: 'ומעתה', optional: false },
      { norm: 'בכל', optional: false },
      { norm: 'ד', optional: true },
      { norm: 'עולמות', optional: false },
      { norm: 'דאביע', optional: true },
      { norm: 'כו', optional: true },
    ]);
  });

  it('splits on maqaf', () => {
    assert.deepEqual(
      tokenizeLine('אין־סוף').map((t) => t.norm),
      ['אינ', 'סופ'],
    );
  });
});

describe('transcriptTokens', () => {
  it('keeps Hebrew words and records the run length; Latin breaks runs, punctuation does not', () => {
    const toks = transcriptTokens(words('and the אור of אין סוף — הוא ושמו בלבד ok'));
    assert.deepEqual(
      toks.map((t) => [t.norm, t.run, t.wordIndex]),
      [
        ['אור', 1, 2],
        ['אינ', 5, 4],
        ['סופ', 5, 5],
        ['הוא', 5, 7],
        ['ושמו', 5, 8],
        ['בלבד', 5, 9],
      ],
    );
  });
});

const chapter: Chapter = [
  {
    children: [
      { id: 'aaaaaaaa', text: 'אך הנה מתחלה יש לכל מתבונן להתבונן במקור הראשון' },
      { id: 'bbbbbbbb', text: 'שהוא בבחינת עצמות אור אין סוף שלפני הצמצום' },
    ],
  },
  {
    children: [
      { id: 'cccccccc', text: 'גם שם דרך פרט דוקא' },
      { id: 'dddddddd', text: 'והוא הנקרא מאריך באחד באחדות הפשוטה דוקא' },
      { id: 'eeeeeeee', text: 'ונחלק לג׳ מדריגות דרך כלל' },
    ],
  },
];

describe('alignTokens', () => {
  it('is monotonic and ignores a Hebrew term in the explanation that appears later in the text', () => {
    const { tokens } = chapterTokens(chapter);
    // Reads line 1, explains mentioning "דוקא" (from line 3/4), reads line 2.
    const w = [
      ...words('אך הנה מתחלה יש לכל מתבונן להתבונן במקור הראשון', 0),
      ...words('so this is דוקא in a way', 20),
      ...words('שהוא בבחינת עצמות אור אין סוף שלפני הצמצום', 40),
    ];
    const t = transcriptTokens(w);
    const matches = alignTokens(t, tokens);
    for (let k = 1; k < matches.length; k++) {
      assert.ok(matches[k]!.t > matches[k - 1]!.t && matches[k]!.c > matches[k - 1]!.c);
    }
    const lines = new Set(matches.map((m) => tokens[m.c]!.lineIndex));
    assert.deepEqual([...lines], [0, 1]);
    assert.ok(!matches.some((m) => t[m.t]!.norm === 'דוקא'));
  });

  it('returns nothing for empty input', () => {
    assert.deepEqual(alignTokens([], chapterTokens(chapter).tokens), []);
  });
});

describe('linesFromMatches', () => {
  it('keeps the heaviest time cluster of a line', () => {
    const { tokens, lines } = chapterTokens([{ children: [{ id: 'aaaaaaaa', text: 'אחד שנים שלשה ארבעה' }] }]);
    const t = transcriptTokens([
      { word: 'אחד', start: 0, end: 0.5 },
      { word: 'שנים', start: 500, end: 500.5 },
      { word: 'שלשה', start: 501, end: 501.5 },
      { word: 'ארבעה', start: 502, end: 502.5 },
    ]);
    const matches = [0, 1, 2, 3].map((k) => ({ t: k, c: k, similarity: 1 }));
    const [line] = linesFromMatches(matches, t, tokens, lines, DEFAULT_ALIGN_OPTIONS);
    assert.ok(line);
    assert.equal(line.startSeconds, 500);
    assert.equal(line.endSeconds, 502.5);
    assert.equal(line.matchedWords, 3);
    assert.equal(line.confidence, 0.75);
  });
});

describe('alignTranscript', () => {
  it('maps a read-and-explain transcript to line ids with times; unread lines are absent', () => {
    const w = [
      ...words('Chapter ten. Last time we said something', 0),
      ...words('גם שם דרך', 10),
      ...words('even there in detail', 14),
      ...words('פרט דוקא', 18),
      ...words('which means that the עצמות is also detailed', 21),
      ...words('והוא הנקרא מאריך באחד באחדות הפשוטה דוקא', 40),
      ...words('and that is called מאריך באחד', 50),
    ];
    const { lines } = alignTranscript(w, chapter);
    assert.deepEqual(
      lines.map((l) => l.lineId),
      ['cccccccc', 'dddddddd'],
    );
    const [c, d] = lines;
    assert.equal(c!.startSeconds, 10);
    assert.equal(c!.endSeconds, 19.8);
    assert.equal(c!.confidence, 1);
    assert.equal(d!.startSeconds, 40);
    assert.equal(d!.endSeconds, 46.8);
  });

  it('copes with transcription errors and dropped words', () => {
    const w = words('אך הנה מתחילה יש לכל מתבונן להתבוננ במקורר', 0);
    const { lines } = alignTranscript(w, chapter);
    assert.equal(lines[0]?.lineId, 'aaaaaaaa');
    assert.ok(lines[0]!.confidence > 0.6 && lines[0]!.confidence < 1, String(lines[0]!.confidence));
  });

  it('startLine excludes earlier lines', () => {
    const w = words('אך הנה מתחלה יש לכל מתבונן להתבונן במקור הראשון גם שם דרך פרט דוקא', 0);
    const { lines } = alignTranscript(w, chapter, { startLine: 2 });
    assert.deepEqual(
      lines.map((l) => l.lineId),
      ['cccccccc'],
    );
  });
});

const nextChapter: Chapter = [
  {
    children: [
      { id: 'ffffffff', text: 'ומעתה יש להבין בענין שרש האותיות דמחשבה' },
      { id: 'gggggggg', text: 'שהן בחינת לבושים ולא כלים כלל' },
    ],
  },
];

describe('alignTranscriptToChapters', () => {
  const parts = [
    { key: 'chapter_10', chapter },
    { key: 'chapter_11', chapter: nextChapter },
  ];

  it('finds where a class that ends one chapter moves on to the next', () => {
    const w = [
      ...words('והוא הנקרא מאריך באחד באחדות הפשוטה דוקא', 0),
      ...words('ונחלק לג׳ מדריגות דרך כלל', 10),
      // Explanation that mentions a term of the next chapter before reading it.
      ...words('that is the end of the chapter and the לבושים come next okay go ahead', 20),
      ...words('ומעתה יש להבין בענין שרש האותיות דמחשבה', 60),
      ...words('שהן בחינת לבושים ולא כלים כלל', 70),
    ];
    const r = alignTranscriptToChapters(w, parts);
    assert.deepEqual(
      r.lines.map((l) => [l.chapter, l.lineId]),
      [
        ['chapter_10', 'dddddddd'],
        ['chapter_10', 'eeeeeeee'],
        ['chapter_11', 'ffffffff'],
        ['chapter_11', 'gggggggg'],
      ],
    );
    assert.equal(r.lines[2]!.startSeconds, 60);
    assert.equal(r.lines[2]!.lineIndex, 5, 'line indexes count across the concatenation');
    assert.deepEqual(r.lineChapters, [...Array(5).fill('chapter_10'), 'chapter_11', 'chapter_11']);
  });

  it('gives a chapter the class does not read no lines', () => {
    const w = words('אך הנה מתחלה יש לכל מתבונן להתבונן במקור הראשון גם שם דרך פרט דוקא', 0);
    const r = alignTranscriptToChapters(w, parts);
    assert.ok(r.lines.length > 0);
    assert.ok(r.lines.every((l) => l.chapter === 'chapter_10'));
  });
});

describe('alignTranscriptByRanges', () => {
  it('aligns each time range to its own chapter, with word indexes into the whole transcript', () => {
    const w = [
      ...words('גם שם דרך פרט דוקא', 0),
      ...words('ומעתה יש להבין בענין שרש האותיות דמחשבה', 30),
      // Goes back to the first chapter and reads a line again, less clearly.
      ...words('גם שם דרך', 60),
    ];
    const r = alignTranscriptByRanges(w, [
      { key: 'chapter_10', chapter, fromSeconds: 0 },
      { key: 'chapter_11', chapter: nextChapter, fromSeconds: 25 },
      { key: 'chapter_10', chapter, fromSeconds: 55 },
    ]);
    assert.deepEqual(
      r.lines.map((l) => [l.chapter, l.lineId, l.startSeconds]),
      [
        ['chapter_10', 'cccccccc', 0],
        ['chapter_11', 'ffffffff', 30],
      ],
    );
    const f = r.lines[1]!;
    assert.equal(f.lineIndex, 0, 'index within its own chapter');
    assert.equal(w[f.firstWord]!.word, 'ומעתה');
  });
});
