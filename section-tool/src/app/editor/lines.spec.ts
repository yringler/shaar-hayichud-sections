import { describe, it, expect } from 'vitest';
import { Line } from '../models/text-node.model';
import {
  SAME_LINE_SIMILARITY,
  MAX_RETIRED,
  collectLineIds,
  collectLines,
  freshRun,
  lineContainment,
  lineSimilarity,
  reconcileLines,
  retireLines,
  splitLineIndex,
  splitLines,
  splitRun,
} from './lines';
import { deepFreeze, node, sequentialIds, t } from './testing';

const L = (id: string, text: string): Line => ({ id, text });

/** Reconcile and return "id:text" specs, for compact expectations. */
function edit(old: Line[], text: string, extraTaken: string[] = [], retired: Line[] = []): string[] {
  const taken = new Set([...old.map((l) => l.id), ...extraTaken]);
  return reconcileLines(deepFreeze(old), text, taken, sequentialIds('n', 'N'), deepFreeze(retired)).map(
    (l) => `${l.id}:${l.text}`,
  );
}

const verse = [
  L('a', 'הנה כבר מבואר באריכות בקונטרס מיוחד'),
  L('b', 'ומעתה יש לבאר היטב במהות גוף ענין ההתבוננות'),
  L('c', 'מה היא בעצם ובמה יתבונן'),
];
const verseText = verse.map((l) => l.text).join('\n');

describe('splitLines', () => {
  it('splits on newlines; empty text has no lines', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a')).toEqual(['a']);
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b', '']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('lineSimilarity', () => {
  it('is 1 for equal lines (ignoring surrounding whitespace) and 0 against blank', () => {
    expect(lineSimilarity('abc', ' abc ')).toBe(1);
    expect(lineSimilarity('abc', '')).toBe(0);
    expect(lineSimilarity('', '  ')).toBe(1);
  });

  it('is high for a typo fix and low for an unrelated line', () => {
    expect(lineSimilarity(verse[1].text, verse[1].text.replace('היטב', 'הייטב'))).toBeGreaterThan(0.85);
    expect(lineSimilarity(verse[0].text, verse[2].text)).toBeLessThan(SAME_LINE_SIMILARITY);
  });

  it('is symmetric', () => {
    expect(lineSimilarity('abcd', 'abxd')).toBe(lineSimilarity('abxd', 'abcd'));
  });
});

describe('reconcileLines', () => {
  it('keeps every id when nothing changed', () => {
    expect(edit(verse, verseText)).toEqual(['a:' + verse[0].text, 'b:' + verse[1].text, 'c:' + verse[2].text]);
  });

  it('typo fix: the edited line keeps its id', () => {
    const fixed = verseText.replace('היטב', 'הייטב');
    expect(edit(verse, fixed).map((s) => s.slice(0, 2))).toEqual(['a:', 'b:', 'c:']);
  });

  it('typing a character at a time keeps the id throughout', () => {
    let lines = [L('x', 'ומעתה יש')];
    for (const text of ['ומעתה יש ל', 'ומעתה יש לב', 'ומעתה יש לבא', 'ומעתה יש לבאר', 'ומעתה יש לבא', 'ומעתה יש']) {
      lines = reconcileLines(lines, text, new Set(['x']), sequentialIds());
    }
    expect(lines).toEqual([L('x', 'ומעתה יש')]);
  });

  it('a very short line is not "clearly the same" after an edit, so it gets a fresh id', () => {
    // Harmless while typing a brand-new line: its id was never saved.
    expect(edit([L('x', 'ab')], 'abc')).toEqual(['N1:abc']);
  });

  it('inserting a line gives only that line a new id', () => {
    const text = [verse[0].text, 'שורה חדשה לגמרי', verse[1].text, verse[2].text].join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['a', 'N1', 'b', 'c']);
  });

  it('inserting lines at the start and end', () => {
    const text = ['first', verseText, 'last'].join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['N1', 'a', 'b', 'c', 'N2']);
  });

  it('deleting a line drops its id and keeps the rest', () => {
    const text = [verse[0].text, verse[2].text].join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['a', 'c']);
  });

  it('deleting everything gives no lines', () => {
    expect(edit(verse, '')).toEqual([]);
  });

  it('replacing a line with an unrelated one gives a new id', () => {
    const text = [verse[0].text, 'something else entirely', verse[2].text].join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['a', 'N1', 'c']);
  });

  it('editing one line while inserting another next to it pairs the edit by similarity', () => {
    const text = [verse[0].text, 'brand new', verse[1].text + ' כו\'', verse[2].text].join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['a', 'N1', 'b', 'c']);
  });

  it('reorder: a moved line keeps its id', () => {
    const text = [verse[1].text, verse[2].text, verse[0].text].join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['b', 'c', 'a']);
  });

  it('swapping two lines keeps both ids', () => {
    const text = [verse[0].text, verse[2].text, verse[1].text].join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['a', 'c', 'b']);
  });

  it('pasting many lines into the middle keeps the surrounding ids', () => {
    const pasted = Array.from({ length: 50 }, (_, i) => `pasted line ${i}`);
    const text = [verse[0].text, ...pasted, verse[1].text, verse[2].text].join('\n');
    const result = edit(verse, text).map((s) => s.split(':')[0]);
    expect(result[0]).toBe('a');
    expect(result.slice(-2)).toEqual(['b', 'c']);
    expect(new Set(result).size).toBe(53);
  });

  it('replacing the whole text with unrelated text gives all new ids', () => {
    expect(edit(verse, 'one\ntwo').map((s) => s.split(':')[0])).toEqual(['N1', 'N2']);
  });

  it('a whole-text replace with lightly edited lines keeps their ids', () => {
    const text = verse.map((l) => l.text + '.').join('\n');
    expect(edit(verse, text).map((s) => s.split(':')[0])).toEqual(['a', 'b', 'c']);
  });

  it('large changed regions pair by position only (and still keep similar lines)', () => {
    const old = Array.from({ length: 250 }, (_, i) => L(`o${i}`, `old line number ${i} with some words`));
    const text = old.map((l) => l.text + '!').join('\n');
    const ids = reconcileLines(old, text, new Set(old.map((l) => l.id)), sequentialIds()).map((l) => l.id);
    expect(ids).toEqual(old.map((l) => l.id));
  });

  it('empty lines: inserting and removing blank lines keeps the other ids', () => {
    const old = [L('a', 'one'), L('b', 'two')];
    expect(edit(old, 'one\n\ntwo')).toEqual(['a:one', 'N1:', 'b:two']);
    expect(edit([L('a', 'one'), L('x', ''), L('b', 'two')], 'one\ntwo')).toEqual(['a:one', 'b:two']);
  });

  it('filling in a blank line gives it a fresh id (blank lines are never saved)', () => {
    expect(edit([L('a', 'one'), L('x', '')], 'one\nnew text')).toEqual(['a:one', 'N1:new text']);
  });

  it('duplicate identical lines keep their ids in order', () => {
    const old = [L('a', 'same'), L('b', 'same'), L('c', 'other')];
    expect(edit(old, 'same\nsame\nother')).toEqual(['a:same', 'b:same', 'c:other']);
    expect(edit(old, 'same\nother')).toEqual(['a:same', 'c:other']);
    expect(edit(old, 'same\nsame\nsame\nother')).toEqual(['a:same', 'b:same', 'N1:same', 'c:other']);
  });

  it('joining two lines is a delete plus an insert: a fresh id, both old ids dropped', () => {
    const old = [L('a', 'a long first line of text'), L('b', 'tail')];
    expect(edit(old, 'a long first line of text tail')).toEqual(['N1:a long first line of text tail']);
    expect(edit(old, 'a long first line of texttail')).toEqual(['N1:a long first line of texttail']);
    const three = [L('x', 'before'), ...old, L('y', 'after')];
    expect(edit(three, 'before\na long first line of text tail\nafter')).toEqual([
      'x:before',
      'N1:a long first line of text tail',
      'y:after',
    ]);
  });

  it('a joined line keeps its new id while it is edited further', () => {
    const joined = [L('N1', 'a long first line of text tail')];
    expect(edit(joined, 'a long first line of text tails')).toEqual(['N1:a long first line of text tails']);
  });

  it('deleting one line while editing its neighbour is not a join', () => {
    const old = [L('a', 'a long first line of text'), L('b', 'something unrelated')];
    expect(edit(old, 'a long first line of text!')).toEqual(['a:a long first line of text!']);
  });

  it('splitting a line in two keeps the id on the more similar half', () => {
    const old = [L('a', 'a long first line of text, tail')];
    expect(edit(old, 'a long first line of text,\ntail')).toEqual(['a:a long first line of text,', 'N1:tail']);
  });

  it('never hands out an id that is taken elsewhere in the document', () => {
    expect(edit([L('a', 'one')], 'one\ntwo', ['N1', 'N2'])).toEqual(['a:one', 'N3:two']);
  });

  it('adds fresh ids to `taken`', () => {
    const taken = new Set<string>();
    reconcileLines([], 'x\ny', taken, sequentialIds());
    expect([...taken]).toEqual(['L1', 'L2']);
  });

  it('every kept id appears at most once', () => {
    const old = [L('a', 'x y z'), L('b', 'x y z!')];
    const ids = edit(old, 'x y z!!\nx y z!!\nx y z!!').map((s) => s.split(':')[0]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('reconcileLines with retired lines', () => {
  const [a, b, c] = verse;

  it('cut then paste (two commands): the moved line gets its id back', () => {
    const afterCut = edit(verse, [b.text, c.text].join('\n'));
    expect(afterCut.map((s) => s.split(':')[0])).toEqual(['b', 'c']);
    const pasted = edit([b, c], [b.text, c.text, a.text].join('\n'), [], [a]);
    expect(pasted.map((s) => s.split(':')[0])).toEqual(['b', 'c', 'a']);
  });

  it('undo after deleting a line brings its id back', () => {
    expect(edit([a, c], verseText, [], [b]).map((s) => s.split(':')[0])).toEqual(['a', 'b', 'c']);
  });

  it('undo after a join restores both original ids', () => {
    const old = [L('a', 'a long first line of text'), L('b', 'tail')];
    expect(edit([L('N9', 'a long first line of text tail')], 'a long first line of text\ntail', [], old)).toEqual([
      'a:a long first line of text',
      'b:tail',
    ]);
  });

  it('a retired line that comes back edited keeps its id (similarity)', () => {
    expect(edit([a], [a.text, b.text + ' כו\''].join('\n'), [], [b])).toEqual(['a:' + a.text, 'b:' + b.text + ' כו\'']);
  });

  it('an unrelated new line does not take a retired id', () => {
    expect(edit([a], [a.text, 'brand new'].join('\n'), [], [b])).toEqual(['a:' + a.text, 'N1:brand new']);
  });

  it('a join never takes a retired id by similarity', () => {
    const old = [L('a', 'a long first line of text'), L('b', 'tail')];
    expect(edit([], 'a long first line of text tail', [], old)).toEqual(['N1:a long first line of text tail']);
  });

  it('the most recently retired copy of a text is reused first, and each id only once', () => {
    const retired = [L('r1', 'same'), L('r2', 'same')];
    expect(edit([], 'same', [], retired)).toEqual(['r2:same']);
    expect(edit([], 'same\nsame\nsame', [], retired)).toEqual(['r2:same', 'r1:same', 'N1:same']);
  });

  it('never reuses a retired id that is back in the document', () => {
    expect(edit([], b.text, ['b'], [b])).toEqual(['N1:' + b.text]);
  });
});

describe('lineContainment', () => {
  it('is the share of a line found inside another; short lines count as 0', () => {
    expect(lineContainment('tail', 'a long line tail')).toBe(1);
    expect(lineContainment('tail', 'unrelated')).toBe(0);
    expect(lineContainment('ab', 'ab')).toBe(0);
  });
});

describe('retireLines', () => {
  it('adds lines that left the document and drops those that came back', () => {
    const before = [node('n', t('a:x', 'b:y'))];
    const after = [node('n', t('a:x'))];
    expect(retireLines(before, after, [])).toEqual([L('b', 'y')]);
    expect(retireLines(after, before, [L('b', 'y')])).toEqual([]);
    expect(retireLines([node('n', t('a:x', 'e:'))], after, [])).toEqual([]);
  });

  it('keeps the newest entries only and is unchanged for an unchanged tree', () => {
    const many = Array.from({ length: MAX_RETIRED }, (_, i) => L(`r${i}`, `t${i}`));
    const before = [node('n', t('a:x'))];
    const result = retireLines(before, [node('n', t())], many);
    expect(result.length).toBe(MAX_RETIRED);
    expect(result[result.length - 1]).toEqual(L('a', 'x'));
    expect(result[0].id).toBe('r1');
    expect(retireLines(before, before, many)).toBe(many);
  });

  it('collectLines lists every line in document order', () => {
    expect(collectLines([node('a', t('1:x'), node('b', t('2:y')), t('3:z'))]).map((l) => l.id)).toEqual(['1', '2', '3']);
  });
});

describe('splitLineIndex', () => {
  // "Hello\nWorld": H=0 … end of Hello=5, W=6 … end=11
  const lines = [L('h', 'Hello'), L('w', 'World')];

  it.each([
    [0, 0, 'start of the first line: before it'],
    [3, 0, 'inside the first line: before it'],
    [5, 1, 'end of the first line: after it'],
    [6, 1, 'start of the second line: before it'],
    [8, 1, 'inside the second line: before it'],
    [11, 2, 'end of the text: after the last line'],
    [99, 2, 'past the end: after the last line'],
  ])('cursor %i splits at line %i (%s)', (pos, index) => {
    expect(splitLineIndex(lines, pos)).toBe(index);
  });

  it('an empty line counts as "at its start"', () => {
    // "a\n\nb": a=0, end of a=1, empty line at 2, b=3
    const withBlank = [L('a', 'a'), L('e', ''), L('b', 'b')];
    expect(splitLineIndex(withBlank, 1)).toBe(1);
    expect(splitLineIndex(withBlank, 2)).toBe(1);
    expect(splitLineIndex(withBlank, 3)).toBe(2);
  });

  it('an empty run splits at 0', () => {
    expect(splitLineIndex([], 0)).toBe(0);
    expect(splitLineIndex([], 4)).toBe(0);
  });
});

describe('splitRun', () => {
  it('splits a run into the lines before and from the boundary, keeping ids', () => {
    expect(splitRun(t('h:Hello', 'w:World'), 7)).toEqual([t('h:Hello'), t('w:World')]);
  });
});

describe('collectLineIds / freshRun', () => {
  it('collects line ids across the tree in document order', () => {
    const roots = [node('a', t('1:x', '2:y'), node('b', t('3:z')), t('4:w')), node('c', t())];
    expect([...collectLineIds(roots)]).toEqual(['1', '2', '3', '4']);
  });

  it('freshRun gives every line an id not used in the document', () => {
    const roots = [node('a', t('L1:x', 'L3:y'))];
    expect(freshRun('p\nq\nr', roots, sequentialIds())).toEqual(t('L2:p', 'L4:q', 'L5:r'));
    expect(freshRun('', roots, sequentialIds())).toEqual(t());
  });
});
