/**
 * Test helpers for editor specs. Not imported by app code.
 */
import { Provider } from '@angular/core';
import { Content, Line, TextNode, TextRun } from '../models/text-node.model';
import { IdSource } from './ids';
import { ID_SOURCE } from './id-source.token';

/**
 * Deterministic ids: nodes `${prefix}1`, `${prefix}2`, ...; lines
 * `${linePrefix}1`, `${linePrefix}2`, ..., skipping any already taken.
 */
export function sequentialIds(prefix = 'new', linePrefix = 'L'): IdSource {
  let n = 0;
  let l = 0;
  return {
    nodeId: () => `${prefix}${++n}`,
    lineId: (taken) => {
      let id: string;
      do id = `${linePrefix}${++l}`;
      while (taken.has(id));
      return id;
    },
  };
}

/** Provide `sequentialIds(prefix)` as the editor's id source in TestBed. */
export function provideSequentialIds(prefix = 'new'): Provider {
  return { provide: ID_SOURCE, useFactory: () => sequentialIds(prefix) };
}

/**
 * A text run from `"id:text"` specs: `t('l1:Hello', 'l2:World')` is the run
 * whose textarea shows "Hello\nWorld". `t()` is an empty run.
 */
export function t(...specs: string[]): TextRun {
  return { lines: specs.map(lineOf) };
}

function lineOf(spec: string): Line {
  const colon = spec.indexOf(':');
  if (colon < 0) throw new Error(`line spec needs "id:text": ${spec}`);
  return { id: spec.slice(0, colon), text: spec.slice(colon + 1) };
}

/** Build a node: `node('a', t('l1:text'), node('b', t('l2:child text')))`. */
export function node(id: string, ...children: Content[]): TextNode {
  return { id, label: '', children };
}

/** Same as `node`, with label and/or translation. */
export function nodeWith(
  id: string,
  extra: { label?: string; translation?: string },
  ...children: Content[]
): TextNode {
  const built: TextNode = { ...node(id, ...children), label: extra.label ?? '' };
  if (extra.translation !== undefined) built.translation = extra.translation;
  return built;
}

/** Deep-freeze a tree so a test fails if any command mutates its input. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
