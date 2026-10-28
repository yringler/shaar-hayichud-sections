import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextNode } from '../models/text-node.model';
import { DEFAULT_FORMAT, detectFormat, parseDocument, serializeDocument, toJson } from './serialization';
import { node, nodeWith, sequentialIds, t } from './testing';

const parse = (value: unknown): TextNode[] => parseDocument(JSON.stringify(value), sequentialIds('n'));
const line = (id: string, text: string) => ({ id, text });

// Valid line ids for fixtures.
const A = 'aaaaaaaa';
const B = 'bbbbbbbb';
const C = 'cccccccc';

describe('parseDocument', () => {
  it('parses a node with lines, keeping line ids and giving the node a fresh id', () => {
    expect(parse([{ children: [line(A, 'Hello'), line(B, 'World')] }])).toEqual([node('n1', t(`${A}:Hello`, `${B}:World`))]);
  });

  it('parses label and translation', () => {
    expect(parse([{ label: 'Chapter 1', children: [line(A, 'Content')], translation: 'Hi' }])).toEqual([
      nodeWith('n1', { label: 'Chapter 1', translation: 'Hi' }, t(`${A}:Content`)),
    ]);
  });

  it('groups consecutive lines into runs around nested sections, ids in document order', () => {
    const nodes = parse([
      {
        label: 'Parent',
        children: [line(A, 'Before'), { label: 'Child', children: [line(B, 'Child text')], translation: 'T' }, line(C, 'After')],
      },
      { children: [line('dddddddd', 'Second')] },
    ]);
    expect(nodes).toEqual([
      nodeWith(
        'n1',
        { label: 'Parent' },
        t(`${A}:Before`),
        nodeWith('n2', { label: 'Child', translation: 'T' }, t(`${B}:Child text`)),
        t(`${C}:After`),
      ),
      node('n3', t('dddddddd:Second')),
    ]);
  });

  it('leaves translation unset when absent, empty or not a string', () => {
    const nodes = parse([
      { children: [line(A, 'a')] },
      { children: [line(B, 'b')], translation: '' },
      { children: [line(C, 'c')], translation: 5 },
    ]);
    expect(nodes.every((n) => !('translation' in n))).toBe(true);
  });

  it('gives legacy plain-string text fresh ids, one per non-blank line', () => {
    expect(parse([{ children: ['one\n\ntwo', ''] }])).toEqual([node('n1', t('L1:one', 'L2:two'))]);
  });

  it('gives missing, malformed and duplicate ids fresh ones that clash with no kept id', () => {
    const D = 'dddddddd';
    const nodes = parseDocument(
      JSON.stringify([{ children: [{ text: 'x' }, line('NOT-AN-ID', 'y'), line(A, 'z'), line(A, 'dup')] }]),
      // Hands out the first of A, B, C, D not taken: A is kept from the file
      // even though it comes later, so the first fresh id must be B.
      { nodeId: () => 'n', lineId: (taken) => [A, B, C, D].find((id) => !taken.has(id))! },
    );
    expect(nodes).toEqual([node('n', t(`${B}:x`, `${C}:y`, `${A}:z`, `${D}:dup`))]);
  });

  it('splits text containing newlines; the first part keeps the id', () => {
    expect(parse([{ children: [line(A, 'one\ntwo')] }])).toEqual([node('n1', t(`${A}:one`, 'L1:two'))]);
  });

  it('drops blank lines and non-object children', () => {
    expect(parse([{ children: [line(A, ' '), line(B, 'a'), null, 7, ''] }])).toEqual([node('n1', t(`${B}:a`))]);
  });

  it('gives a node without content one empty run, so it renders a textarea', () => {
    expect(parse([{ label: 'L' }, { children: [] }, { children: [''] }])).toEqual([
      nodeWith('n1', { label: 'L' }, t()),
      node('n2', t()),
      node('n3', t()),
    ]);
  });

  it('returns [] for blank input', () => {
    expect(parseDocument('  \n ', sequentialIds())).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDocument('not json', sequentialIds())).toThrow();
  });

  it('throws when the JSON is not an array', () => {
    expect(() => parseDocument('{"children": []}', sequentialIds())).toThrow('Expected a JSON array of nodes');
  });
});

describe('toJson', () => {
  it('writes label, children, translation in that order, and lines as id, text', () => {
    const json = toJson([nodeWith('a', { label: 'L', translation: 'T' }, t('l1:x'))]);
    expect(JSON.stringify(json)).toBe('[{"label":"L","children":[{"id":"l1","text":"x"}],"translation":"T"}]');
  });

  it('omits an empty label and a blank translation', () => {
    expect(toJson([nodeWith('a', { translation: '  ' }, t('l1:x'))])).toEqual([{ children: [line('l1', 'x')] }]);
  });

  it('trims each line and the translation', () => {
    expect(toJson([nodeWith('a', { translation: ' T\n' }, t('l1:  x ', 'l2: y'))])).toEqual([
      { children: [line('l1', 'x'), line('l2', 'y')], translation: 'T' },
    ]);
  });

  it('drops blank lines and empty runs between nodes', () => {
    expect(toJson([node('a', t(), node('b', t('l1:x')), t('l2:  ', 'l3:'), node('c', t('l4:y')), t())])).toEqual([
      { children: [{ children: [line('l1', 'x')] }, { children: [line('l4', 'y')] }] },
    ]);
  });

  it('keeps text before, between and after child nodes in order', () => {
    expect(toJson([node('a', t('l1:one'), node('b', t('l2:two')), t('l3:three'))])).toEqual([
      { children: [line('l1', 'one'), { children: [line('l2', 'two')] }, line('l3', 'three')] },
    ]);
  });

  it('drops a node whose children array is empty', () => {
    expect(toJson([nodeWith('a', { label: 'L', translation: 'T' })])).toEqual([]);
  });

  it('drops a node with only blank text and no translation, losing its label', () => {
    expect(toJson([nodeWith('a', { label: 'L' }, t('l1: '))])).toEqual([]);
  });

  it('keeps a node with blank text when it has a translation', () => {
    expect(toJson([nodeWith('a', { translation: 'T' }, t())])).toEqual([{ children: [], translation: 'T' }]);
  });

  it('keeps a node whose only content is a child node', () => {
    expect(toJson([node('a', node('b', t('l1:x')))])).toEqual([{ children: [{ children: [line('l1', 'x')] }] }]);
  });

  it('keeps a parent whose only child node is itself dropped', () => {
    expect(toJson([node('a', node('b', t()))])).toEqual([{ children: [] }]);
  });

  it('keeps special characters as-is', () => {
    expect(toJson([node('a', t('l1:a < b & "c"'))])).toEqual([{ children: [line('l1', 'a < b & "c"')] }]);
  });
});

describe('serializeDocument', () => {
  it('returns "" for the blank starting document', () => {
    expect(serializeDocument([node('a', t())])).toBe('');
    expect(serializeDocument([node('a', t('l1: ', 'l2:'))])).toBe('');
  });

  it('serializes a labeled blank node (and so returns not "")', () => {
    expect(serializeDocument([nodeWith('a', { label: 'L' }, t())])).toBe('[]');
  });

  it('serializes a single node with a child node', () => {
    expect(JSON.parse(serializeDocument([node('a', node('b', t('l1:x')))]))).toEqual([
      { children: [{ children: [line('l1', 'x')] }] },
    ]);
  });

  it('pretty-prints with 2 spaces and no trailing newline by default', () => {
    expect(serializeDocument([node('a', t('l1:x'))])).toBe(
      '[\n  {\n    "children": [\n      {\n        "id": "l1",\n        "text": "x"\n      }\n    ]\n  }\n]',
    );
  });

  it('prints in a given format', () => {
    expect(serializeDocument([node('a', t('l1:x'))], { indent: '\t', trailingNewline: true })).toBe(
      '[\n\t{\n\t\t"children": [\n\t\t\t{\n\t\t\t\t"id": "l1",\n\t\t\t\t"text": "x"\n\t\t\t}\n\t\t]\n\t}\n]\n',
    );
  });
});

describe('detectFormat', () => {
  it('detects tab or 2-space indent and a trailing newline', () => {
    expect(detectFormat('[\n\t{}\n]\n')).toEqual({ indent: '\t', trailingNewline: true });
    expect(detectFormat('[\n  {}\n]')).toEqual({ indent: 2, trailingNewline: false });
    expect(detectFormat('[]')).toEqual(DEFAULT_FORMAT);
  });
});

/**
 * Golden round trip over every real chapter: loading a file and saving it in
 * its own format (what the editor does) reproduces it byte for byte, line
 * ids included. Chapter files are JSON.stringify output with keys label,
 * children, translation (id, text for lines), tab or 2-space indent, with
 * or without a trailing newline.
 */
describe('round trip over data/chapters', () => {
  const dir = resolve(process.cwd(), '../data/chapters');
  const files = readdirSync(dir).filter((f) => /^chapter_\d+\.json$/.test(f)).sort();

  it('finds all 54 chapters', () => {
    expect(files).toHaveLength(54);
  });

  it.each(files)('%s: load then save is byte-identical', (file) => {
    const original = readFileSync(resolve(dir, file), 'utf8');
    const saved = serializeDocument(parseDocument(original, sequentialIds()), detectFormat(original));
    expect(saved).toBe(original);
  });

  it('keeps every line id: no fresh ids are needed to load the corpus', () => {
    let fresh = 0;
    const ids = { nodeId: () => 'n', lineId: () => `fresh${++fresh}` };
    for (const file of files) parseDocument(readFileSync(resolve(dir, file), 'utf8'), ids);
    expect(fresh).toBe(0);
  });
});
