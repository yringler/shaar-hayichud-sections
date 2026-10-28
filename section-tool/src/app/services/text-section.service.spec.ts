import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TextSectionService } from './text-section.service';
import { node, provideSequentialIds } from '../editor/testing';

describe('TextSectionService', () => {
  let service: TextSectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideSequentialIds('n')] });
    service = TestBed.inject(TextSectionService);
  });

  it('starts with one blank root node and blank JSON', () => {
    expect(service.rootNodes()).toEqual([node('n1', '')]);
    expect(service.jsonOutput()).toBe('');
  });

  it('exposes the document read-only', () => {
    expect('set' in service.rootNodes).toBe(false);
  });

  it('dispatch applies the command and returns its focus', () => {
    service.dispatch({ type: 'updateText', nodeId: 'n1', contentIndex: 0, text: 'Hello World' });
    const focus = service.dispatch({ type: 'splitToChild', nodeId: 'n1', contentIndex: 0, cursorPos: 5 });

    expect(focus).toEqual({ nodeId: 'n2', contentIndex: 0, offset: 0 });
    expect(service.rootNodes()).toEqual([node('n1', 'Hello', node('n2', ' World'))]);
  });

  it('dispatch returns null for commands that do not move focus', () => {
    expect(service.dispatch({ type: 'updateLabel', nodeId: 'n1', label: 'L' })).toBeNull();
  });

  it('never mutates a tree it has already published', () => {
    service.dispatch({ type: 'updateText', nodeId: 'n1', contentIndex: 0, text: 'ab' });
    const before = service.rootNodes();
    const snapshot = structuredClone(before);
    service.dispatch({ type: 'splitToSibling', nodeId: 'n1', contentIndex: 0, cursorPos: 1 });
    service.dispatch({ type: 'mergeWithPreviousSibling', nodeId: 'n2' });
    expect(before).toEqual(snapshot);
  });

  it('gives a changed nested node a new reference (works with OnPush inputs)', () => {
    service.dispatch({ type: 'loadJson', json: '[{"children":["a",{"children":["b"]}]}]' });
    const child = service.rootNodes()[0].children[1];
    service.dispatch({ type: 'updateText', nodeId: 'n3', contentIndex: 0, text: 'B' });
    expect(service.rootNodes()[0].children[1]).not.toBe(child);
  });

  it('jsonOutput follows every change', () => {
    service.dispatch({ type: 'updateText', nodeId: 'n1', contentIndex: 0, text: 'x' });
    expect(JSON.parse(service.jsonOutput())).toEqual([{ children: ['x'] }]);
    service.dispatch({ type: 'updateLabel', nodeId: 'n1', label: 'L' });
    expect(JSON.parse(service.jsonOutput())).toEqual([{ label: 'L', children: ['x'] }]);
    service.dispatch({ type: 'clearAll' });
    expect(service.jsonOutput()).toBe('');
  });

  it('loadJson then jsonOutput round-trips', () => {
    const json = JSON.stringify([{ label: 'A', children: ['x', { children: ['y'], translation: 'T' }] }], null, 2);
    service.dispatch({ type: 'loadJson', json });
    expect(service.jsonOutput()).toBe(json);
  });

  it('a failed loadJson throws and keeps the current document', () => {
    service.dispatch({ type: 'loadText', text: 'keep me' });
    const before = service.rootNodes();
    expect(() => service.dispatch({ type: 'loadJson', json: 'not json' })).toThrow();
    expect(service.rootNodes()).toBe(before);
  });
});
