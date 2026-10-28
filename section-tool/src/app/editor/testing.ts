/**
 * Test helpers for editor specs. Not imported by app code.
 */
import { Provider } from '@angular/core';
import { Content, TextNode } from '../models/text-node.model';
import { IdSource } from './ids';
import { ID_SOURCE } from './id-source.token';

/** Deterministic ids: `${prefix}1`, `${prefix}2`, ... */
export function sequentialIds(prefix = 'new'): IdSource {
  let n = 0;
  return { nodeId: () => `${prefix}${++n}` };
}

/** Provide `sequentialIds(prefix)` as the editor's id source in TestBed. */
export function provideSequentialIds(prefix = 'new'): Provider {
  return { provide: ID_SOURCE, useFactory: () => sequentialIds(prefix) };
}

/** Build a node: `node('a', 'text', node('b', 'child text'))`. */
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
