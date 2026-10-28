import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TextSectionService } from './text-section.service';
import { node, provideSequentialIds, t } from '../editor/testing';

describe('TextSectionService', () => {
  let service: TextSectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideSequentialIds('n')] });
    service = TestBed.inject(TextSectionService);
  });

  it('starts with one blank root node and blank JSON', () => {
    expect(service.rootNodes()).toEqual([node('n1', t())]);
    expect(service.jsonOutput()).toBe('');
  });

  it('exposes the document read-only', () => {
    expect('set' in service.rootNodes).toBe(false);
  });

  it('dispatch applies the command and returns its focus', () => {
    service.dispatch({ type: 'updateText', nodeId: 'n1', contentIndex: 0, text: 'Hello\nWorld' });
    const focus = service.dispatch({ type: 'splitToChild', nodeId: 'n1', contentIndex: 0, cursorPos: 6 });

    expect(focus).toEqual({ nodeId: 'n2', contentIndex: 0, offset: 0 });
    expect(service.rootNodes()).toEqual([node('n1', t('L1:Hello'), node('n2', t('L2:World')))]);
  });

  it('dispatch returns null for commands that do not move focus', () => {
    expect(service.dispatch({ type: 'updateLabel', nodeId: 'n1', label: 'L' })).toBeNull();
  });

  it('never mutates a tree it has already published', () => {
    service.dispatch({ type: 'updateText', nodeId: 'n1', contentIndex: 0, text: 'a\nb' });
    const before = service.rootNodes();
    const snapshot = structuredClone(before);
    service.dispatch({ type: 'splitToSibling', nodeId: 'n1', contentIndex: 0, cursorPos: 1 });
    service.dispatch({ type: 'mergeWithPreviousSibling', nodeId: 'n2' });
    expect(before).toEqual(snapshot);
  });

  it('gives a changed nested node a new reference (works with OnPush inputs)', () => {
    service.dispatch({
      type: 'loadJson',
      json: '[{"children":[{"id":"aaaaaaaa","text":"a"},{"children":[{"id":"bbbbbbbb","text":"b"}]}]}]',
    });
    const child = service.rootNodes()[0].children[1];
    service.dispatch({ type: 'updateText', nodeId: 'n3', contentIndex: 0, text: 'B' });
    expect(service.rootNodes()[0].children[1]).not.toBe(child);
  });

  it('jsonOutput follows every change', () => {
    service.dispatch({ type: 'updateText', nodeId: 'n1', contentIndex: 0, text: 'x' });
    expect(JSON.parse(service.jsonOutput())).toEqual([{ children: [{ id: 'L1', text: 'x' }] }]);
    service.dispatch({ type: 'updateLabel', nodeId: 'n1', label: 'L' });
    expect(JSON.parse(service.jsonOutput())).toEqual([{ label: 'L', children: [{ id: 'L1', text: 'x' }] }]);
    service.dispatch({ type: 'clearAll' });
    expect(service.jsonOutput()).toBe('');
  });

  it('loadJson then jsonOutput round-trips, keeping line ids', () => {
    const doc = [
      { label: 'A', children: [{ id: 'aaaaaaaa', text: 'x' }, { children: [{ id: 'bbbbbbbb', text: 'y' }], translation: 'T' }] },
    ];
    for (const json of [JSON.stringify(doc, null, 2), JSON.stringify(doc, null, '\t') + '\n']) {
      service.dispatch({ type: 'loadJson', json });
      expect(service.jsonOutput()).toBe(json);
    }
  });

  it('saves in the loaded file\'s format until a new document starts', () => {
    service.dispatch({ type: 'loadJson', json: '[\n\t{\n\t\t"children": [{"id": "aaaaaaaa", "text": "x"}]\n\t}\n]\n' });
    service.dispatch({ type: 'updateLabel', nodeId: 'n2', label: 'L' });
    expect(service.jsonOutput()).toMatch(/^\[\n\t\{\n\t\t"label": "L",[\s\S]*\n\]\n$/);
    service.dispatch({ type: 'loadText', text: 'y' });
    expect(service.jsonOutput()).toMatch(/^\[\n {2}\{[\s\S]*\]$/);
  });

  it('a failed loadJson keeps the current format', () => {
    service.dispatch({ type: 'loadJson', json: '[{"children":[{"id":"aaaaaaaa","text":"x"}]}]\n' });
    expect(() => service.dispatch({ type: 'loadJson', json: 'oops' })).toThrow();
    expect(service.jsonOutput().endsWith('\n')).toBe(true);
  });

  it('an edit keeps line ids and mints fresh ones only for new lines', () => {
    service.dispatch({ type: 'loadJson', json: '[{"children":[{"id":"aaaaaaaa","text":"one"},{"id":"bbbbbbbb","text":"two"}]}]' });
    service.dispatch({ type: 'updateText', nodeId: 'n2', contentIndex: 0, text: 'one!\nnew\ntwo' });
    expect(JSON.parse(service.jsonOutput())[0].children).toEqual([
      { id: 'aaaaaaaa', text: 'one!' },
      { id: 'L1', text: 'new' },
      { id: 'bbbbbbbb', text: 'two' },
    ]);
  });

  it('a failed loadJson throws and keeps the current document', () => {
    service.dispatch({ type: 'loadText', text: 'keep me' });
    const before = service.rootNodes();
    expect(() => service.dispatch({ type: 'loadJson', json: 'not json' })).toThrow();
    expect(service.rootNodes()).toBe(before);
  });

  describe('line ids across several commands', () => {
    const json = JSON.stringify([
      {
        children: [
          { id: 'aaaaaaaa', text: 'first line of the section' },
          { id: 'bbbbbbbb', text: 'second line of the section' },
          { id: 'cccccccc', text: 'third line of the section' },
          { children: [{ id: 'dddddddd', text: 'a line in the child section' }] },
        ],
      },
    ]);
    const ids = (nodeId = 0) =>
      (JSON.parse(service.jsonOutput())[nodeId].children as { id?: string }[]).filter((c) => c.id).map((c) => c.id);
    const text = (...lines: string[]) => lines.join('\n');

    beforeEach(() => service.dispatch({ type: 'loadJson', json }));

    it('cut and paste within a textarea (two input events) keeps the moved line id', () => {
      service.dispatch({
        type: 'updateText',
        nodeId: 'n2',
        contentIndex: 0,
        text: text('second line of the section', 'third line of the section'),
      });
      service.dispatch({
        type: 'updateText',
        nodeId: 'n2',
        contentIndex: 0,
        text: text('second line of the section', 'third line of the section', 'first line of the section'),
      });
      expect(ids()).toEqual(['bbbbbbbb', 'cccccccc', 'aaaaaaaa']);
    });

    it('undo after deleting a line restores its id', () => {
      const all = text('first line of the section', 'second line of the section', 'third line of the section');
      service.dispatch({ type: 'updateText', nodeId: 'n2', contentIndex: 0, text: text('first line of the section', 'third line of the section') });
      service.dispatch({ type: 'updateText', nodeId: 'n2', contentIndex: 0, text: all });
      expect(ids()).toEqual(['aaaaaaaa', 'bbbbbbbb', 'cccccccc']);
    });

    it('moving a line to another section keeps its id', () => {
      service.dispatch({ type: 'updateText', nodeId: 'n2', contentIndex: 0, text: text('first line of the section', 'second line of the section') });
      service.dispatch({
        type: 'updateText',
        nodeId: 'n3',
        contentIndex: 0,
        text: text('a line in the child section', 'third line of the section'),
      });
      const doc = JSON.parse(service.jsonOutput());
      expect(doc[0].children[2].children.map((l: { id: string }) => l.id)).toEqual(['dddddddd', 'cccccccc']);
    });

    it('loading a document forgets retired lines', () => {
      service.dispatch({ type: 'updateText', nodeId: 'n2', contentIndex: 0, text: 'first line of the section' });
      service.dispatch({ type: 'loadText', text: 'x' });
      service.dispatch({ type: 'updateText', nodeId: 'n4', contentIndex: 0, text: text('x', 'second line of the section') });
      expect(ids()).toEqual(['L1', 'L2']);
    });
  });

  it('remintedOnLoad counts lines that got a fresh id on load', () => {
    expect(service.remintedOnLoad()).toBe(0);
    service.dispatch({ type: 'loadJson', json: '[{"children":["legacy\\ntext",{"id":"aaaaaaaa","text":"ok"},{"id":"aaaaaaaa","text":"dup"}]}]' });
    expect(service.remintedOnLoad()).toBe(3);
    service.dispatch({ type: 'updateText', nodeId: 'n2', contentIndex: 0, text: 'edited' });
    expect(service.remintedOnLoad()).toBe(3);
    service.dispatch({ type: 'loadJson', json: '[{"children":[{"id":"aaaaaaaa","text":"ok"}]}]' });
    expect(service.remintedOnLoad()).toBe(0);
    service.dispatch({ type: 'loadJson', json: '[{"children":["legacy"]}]' });
    service.dispatch({ type: 'clearAll' });
    expect(service.remintedOnLoad()).toBe(0);
  });
});
