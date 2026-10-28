import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextNode } from '../models/text-node.model';
import { parseDocument, serializeDocument, toJson } from './serialization';
import { node, nodeWith, sequentialIds } from './testing';

const parse = (value: unknown): TextNode[] => parseDocument(JSON.stringify(value), sequentialIds('n'));

describe('parseDocument', () => {
  it('parses a node with text, giving it a fresh id', () => {
    expect(parse([{ children: ['Hello World'] }])).toEqual([node('n1', 'Hello World')]);
  });

  it('parses label and translation', () => {
    expect(parse([{ label: 'Chapter 1', children: ['Content'], translation: 'Hi' }])).toEqual([
      nodeWith('n1', { label: 'Chapter 1', translation: 'Hi' }, 'Content'),
    ]);
  });

  it('parses nested and interleaved content, ids in document order', () => {
    const nodes = parse([
      {
        label: 'Parent',
        children: ['Before', { label: 'Child', children: ['Child text'], translation: 'T' }, 'After'],
      },
      { children: ['Second'] },
    ]);
    expect(nodes).toEqual([
      nodeWith('n1', { label: 'Parent' }, 'Before', nodeWith('n2', { label: 'Child', translation: 'T' }, 'Child text'), 'After'),
      node('n3', 'Second'),
    ]);
  });

  it('leaves translation unset when absent, empty or not a string', () => {
    const nodes = parse([
      { children: ['a'] },
      { children: ['b'], translation: '' },
      { children: ['c'], translation: 5 },
    ]);
    expect(nodes.every((n) => !('translation' in n))).toBe(true);
  });

  it('drops empty strings and non-object children', () => {
    expect(parse([{ children: ['', 'a', null, 7, ''] }])).toEqual([node('n1', 'a')]);
  });

  it('gives a node without content one empty text entry, so it renders a textarea', () => {
    expect(parse([{ label: 'L' }, { children: [] }, { children: [''] }])).toEqual([
      nodeWith('n1', { label: 'L' }, ''),
      node('n2', ''),
      node('n3', ''),
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
  it('writes label, children, translation in that order', () => {
    const json = toJson([nodeWith('a', { label: 'L', translation: 'T' }, 'x')]);
    expect(JSON.stringify(json)).toBe('[{"label":"L","children":["x"],"translation":"T"}]');
  });

  it('omits an empty label and a blank translation', () => {
    expect(toJson([nodeWith('a', { translation: '  ' }, 'x')])).toEqual([{ children: ['x'] }]);
  });

  it('trims strings and translation', () => {
    expect(toJson([nodeWith('a', { translation: ' T\n' }, '  x \n')])).toEqual([
      { children: ['x'], translation: 'T' },
    ]);
  });

  it('drops empty and whitespace-only strings between nodes', () => {
    expect(toJson([node('a', '', node('b', 'x'), '  \n', node('c', 'y'), '')])).toEqual([
      { children: [{ children: ['x'] }, { children: ['y'] }] },
    ]);
  });

  it('keeps text before, between and after child nodes in order', () => {
    expect(toJson([node('a', 'one', node('b', 'two'), 'three')])).toEqual([
      { children: ['one', { children: ['two'] }, 'three'] },
    ]);
  });

  it('drops a node whose children array is empty', () => {
    expect(toJson([nodeWith('a', { label: 'L', translation: 'T' })])).toEqual([]);
  });

  it('drops a node with only blank text and no translation, losing its label', () => {
    expect(toJson([nodeWith('a', { label: 'L' }, ' ')])).toEqual([]);
  });

  it('keeps a node with blank text when it has a translation', () => {
    expect(toJson([nodeWith('a', { translation: 'T' }, '')])).toEqual([{ children: [], translation: 'T' }]);
  });

  it('keeps a node whose only content is a child node', () => {
    expect(toJson([node('a', node('b', 'x'))])).toEqual([{ children: [{ children: ['x'] }] }]);
  });

  it('keeps a parent whose only child node is itself dropped', () => {
    expect(toJson([node('a', node('b', ''))])).toEqual([{ children: [] }]);
  });

  it('keeps special characters as-is', () => {
    expect(toJson([node('a', 'a < b & "c"')])).toEqual([{ children: ['a < b & "c"'] }]);
  });
});

describe('serializeDocument', () => {
  it('returns "" for the blank starting document', () => {
    expect(serializeDocument([node('a', '')])).toBe('');
    expect(serializeDocument([node('a', ' \n')])).toBe('');
  });

  it('serializes a labeled blank node (and so returns not "")', () => {
    expect(serializeDocument([nodeWith('a', { label: 'L' }, '')])).toBe('[]');
  });

  it('serializes a single node with a child node', () => {
    expect(JSON.parse(serializeDocument([node('a', node('b', 'x'))]))).toEqual([
      { children: [{ children: ['x'] }] },
    ]);
  });

  it('pretty-prints with 2 spaces and no trailing newline', () => {
    expect(serializeDocument([node('a', 'x'), node('b', 'y')])).toBe(
      '[\n  {\n    "children": [\n      "x"\n    ]\n  },\n  {\n    "children": [\n      "y"\n    ]\n  }\n]',
    );
  });
});

/**
 * Golden round trip over every real chapter. The files on disk are not all
 * in the editor's output format: most are tab-indented with `children`
 * before `label`, and none end in a newline. So the contract is:
 * - load → save gives exactly the file re-printed in editor format
 *   (same values, 2-space indent, keys label/children/translation);
 * - save is idempotent: loading the saved text and saving again is
 *   byte-identical;
 * - files already in editor format round-trip byte-identically.
 */
describe('round trip over data/chapters', () => {
  const dir = resolve(process.cwd(), '../data/chapters');
  const files = readdirSync(dir).filter((f) => /^chapter_\d+\.json$/.test(f)).sort();

  const load = (json: string): string => serializeDocument(parseDocument(json, sequentialIds()));

  /** The file's own values, printed the way the editor prints them. */
  function editorFormat(json: string): string {
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object') {
        const { label, children, translation, ...rest } = value as Record<string, unknown>;
        expect(rest).toEqual({}); // no keys the editor would drop
        return {
          ...(label !== undefined ? { label } : {}),
          children: reorder(children),
          ...(translation !== undefined ? { translation } : {}),
        };
      }
      return value;
    };
    return JSON.stringify(reorder(JSON.parse(json)), null, 2);
  }

  it('finds all 54 chapters', () => {
    expect(files).toHaveLength(54);
  });

  it.each(files)('%s: load then save reproduces its content', (file) => {
    const original = readFileSync(resolve(dir, file), 'utf8');
    const saved = load(original);
    expect(saved).toBe(editorFormat(original));
    expect(load(saved)).toBe(saved);
    if (original === editorFormat(original)) {
      expect(saved).toBe(original);
    }
  });

  it('some files are already in editor format and round-trip byte-identically', () => {
    const identical = files.filter((f) => {
      const original = readFileSync(resolve(dir, f), 'utf8');
      return load(original) === original;
    });
    expect(identical.length).toBeGreaterThan(0);
  });
});
