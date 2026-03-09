import { TestBed } from '@angular/core/testing';
import { XmlParserService } from './xml-parser.service';

describe('XmlParserService', () => {
  let service: XmlParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(XmlParserService);
  });

  describe('parseXml (JSON)', () => {
    it('should parse simple node with text', () => {
      const json = JSON.stringify([{ children: ['Hello World'] }]);
      const nodes = service.parseXml(json);

      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('');
      expect(nodes[0].children).toEqual(['Hello World']);
    });

    it('should parse node with label', () => {
      const json = JSON.stringify([{ label: 'Chapter 1', children: ['Content'] }]);
      const nodes = service.parseXml(json);

      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('Chapter 1');
      expect(nodes[0].children).toEqual(['Content']);
    });

    it('should parse nested nodes', () => {
      const json = JSON.stringify([{
        label: 'Parent',
        children: [
          'Parent text',
          { label: 'Child', children: ['Child text'] },
        ],
      }]);
      const nodes = service.parseXml(json);

      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('Parent');
      expect(nodes[0].children.length).toBe(2);
      expect(nodes[0].children[0]).toBe('Parent text');

      const child = nodes[0].children[1] as any;
      expect(child.label).toBe('Child');
      expect(child.children).toEqual(['Child text']);
    });

    it('should parse translation', () => {
      const json = JSON.stringify([{ label: 'Chapter 1', children: ['Hebrew text'], translation: 'English translation' }]);
      const nodes = service.parseXml(json);

      expect(nodes[0].label).toBe('Chapter 1');
      expect(nodes[0].translation).toBe('English translation');
    });

    it('should parse translation in nested section', () => {
      const json = JSON.stringify([{
        label: 'Parent',
        children: [{ label: 'Child', children: ['Child text'], translation: 'Child translation' }],
      }]);
      const nodes = service.parseXml(json);

      const child = nodes[0].children[0] as any;
      expect(child.label).toBe('Child');
      expect(child.translation).toBe('Child translation');
    });

    it('should not set translation when absent', () => {
      const json = JSON.stringify([{ children: ['Hebrew text'] }]);
      const nodes = service.parseXml(json);

      expect(nodes[0].translation).toBeUndefined();
    });

    it('should handle empty JSON gracefully', () => {
      const nodes = service.parseXml('');
      expect(nodes).toEqual([]);
    });

    it('should throw error on invalid JSON', () => {
      expect(() => service.parseXml('not json')).toThrow();
    });

    it('should ensure at least one child in empty sections', () => {
      const json = JSON.stringify([{ label: 'Empty', children: [] }]);
      const nodes = service.parseXml(json);

      expect(nodes[0].children).toEqual(['']);
    });

    it('should generate unique IDs for each node', () => {
      const json = JSON.stringify([
        { children: ['First'] },
        { children: ['Second'] },
      ]);
      const nodes = service.parseXml(json);

      expect(nodes[0].id).toBeTruthy();
      expect(nodes[1].id).toBeTruthy();
      expect(nodes[0].id).not.toBe(nodes[1].id);
    });

    it('should handle multiple root nodes', () => {
      const json = JSON.stringify([
        { children: ['First'] },
        { children: ['Second'] },
      ]);
      const nodes = service.parseXml(json);

      expect(nodes.length).toBe(2);
      expect(nodes[0].children).toEqual(['First']);
      expect(nodes[1].children).toEqual(['Second']);
    });

    it('should handle mixed children (text and nodes)', () => {
      const json = JSON.stringify([{
        label: 'Parent',
        children: [
          'Before text',
          { label: 'Child', children: ['Child text'] },
          'After text',
        ],
      }]);
      const nodes = service.parseXml(json);

      expect(nodes[0].children.length).toBe(3);
      expect(nodes[0].children[0]).toBe('Before text');
      expect(typeof nodes[0].children[1]).toBe('object');
      expect(nodes[0].children[2]).toBe('After text');
    });

    it('should handle roundtrip: parse output of nodesToJson', () => {
      const original = [
        { children: ['First'], label: 'A' },
        { children: ['Second'], label: 'B' },
      ];
      const json = JSON.stringify(original);
      const nodes = service.parseXml(json);

      expect(nodes.length).toBe(2);
      expect(nodes[0].label).toBe('A');
      expect(nodes[0].children).toEqual(['First']);
      expect(nodes[1].label).toBe('B');
      expect(nodes[1].children).toEqual(['Second']);
    });
  });
});
