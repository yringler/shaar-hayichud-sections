import { TestBed } from '@angular/core/testing';
import { XmlParserService } from './xml-parser.service';

describe('XmlParserService', () => {
  let service: XmlParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(XmlParserService);
  });

  describe('parseXml', () => {
    it('should parse simple section with text', () => {
      const xml = '<section>Hello World</section>';
      const nodes = service.parseXml(xml);

      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('');
      expect(nodes[0].children).toEqual(['Hello World']);
    });

    it('should parse section with label', () => {
      const xml = '<section label="Chapter 1">Content</section>';
      const nodes = service.parseXml(xml);

      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('Chapter 1');
      expect(nodes[0].children).toEqual(['Content']);
    });

    it('should parse nested sections', () => {
      const xml = `<section label="Parent">
        Parent text
        <section label="Child">Child text</section>
      </section>`;
      const nodes = service.parseXml(xml);

      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('Parent');
      expect(nodes[0].children.length).toBe(2);
      expect(nodes[0].children[0]).toBe('Parent text');
      expect(typeof nodes[0].children[1]).toBe('object');

      const child = nodes[0].children[1] as any;
      expect(child.label).toBe('Child');
      expect(child.children).toEqual(['Child text']);
    });

    it('should unwrap wrapper root section without label or text', () => {
      const xml = `<section>
        <section>First</section>
        <section>Second</section>
      </section>`;
      const nodes = service.parseXml(xml);

      expect(nodes.length).toBe(2);
      expect(nodes[0].children).toEqual(['First']);
      expect(nodes[1].children).toEqual(['Second']);
    });

    it('should NOT unwrap root section with label', () => {
      const xml = `<section label="Root">
        <section>Child</section>
      </section>`;
      const nodes = service.parseXml(xml);

      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('Root');
    });

    it('should NOT unwrap root section with text content', () => {
      const xml = `<section>
        Root text
        <section>Child</section>
      </section>`;
      const nodes = service.parseXml(xml);

      expect(nodes.length).toBe(1);
      expect(nodes[0].children.length).toBe(2);
      expect(nodes[0].children[0]).toBe('Root text');
    });

    it('should unescape XML entities', () => {
      const xml = '<section>Text with &lt;tag&gt; &amp; &quot;quotes&quot;</section>';
      const nodes = service.parseXml(xml);

      expect(nodes[0].children).toEqual(['Text with <tag> & "quotes"']);
    });

    it('should handle empty XML gracefully', () => {
      const nodes = service.parseXml('');
      expect(nodes).toEqual([]);
    });

    it('should throw error on invalid XML', () => {
      const invalidXml = '<section>Unclosed';
      expect(() => service.parseXml(invalidXml)).toThrow();
    });

    it('should handle multiple root sections', () => {
      const xml = `<root>
        <section>First</section>
        <section>Second</section>
      </root>`;
      const nodes = service.parseXml(xml);

      expect(nodes.length).toBe(2);
      expect(nodes[0].children).toEqual(['First']);
      expect(nodes[1].children).toEqual(['Second']);
    });

    it('should parse translation element', () => {
      const xml = '<section label="Chapter 1">Hebrew text<translation>English translation</translation></section>';
      const nodes = service.parseXml(xml);

      expect(nodes[0].label).toBe('Chapter 1');
      expect(nodes[0].translation).toBe('English translation');
    });

    it('should parse translation in nested section', () => {
      const xml = `<section label="Parent"><section label="Child">Child text<translation>Child translation</translation></section></section>`;
      const nodes = service.parseXml(xml);

      const child = nodes[0].children[0] as any;
      expect(child.label).toBe('Child');
      expect(child.translation).toBe('Child translation');
    });

    it('should not set translation when no translation element', () => {
      const xml = '<section>Hebrew text</section>';
      const nodes = service.parseXml(xml);

      expect(nodes[0].translation).toBeUndefined();
    });

    it('should convert p tags in translation back to newlines', () => {
      const xml = '<section>Hebrew text<translation><![CDATA[<p>First paragraph</p><p>Second paragraph</p>]]></translation></section>';
      const nodes = service.parseXml(xml);

      expect(nodes[0].translation).toBe('First paragraph\nSecond paragraph');
    });

    it('should leave translation without p tags unchanged', () => {
      const xml = '<section>Hebrew text<translation><![CDATA[Single paragraph]]></translation></section>';
      const nodes = service.parseXml(xml);

      expect(nodes[0].translation).toBe('Single paragraph');
    });

    it('should ensure at least one child in empty sections', () => {
      const xml = '<section label="Empty"></section>';
      const nodes = service.parseXml(xml);

      expect(nodes[0].children).toEqual(['']);
    });

    it('should handle roundtrip with generated XML (wrapper root)', () => {
      // Simulate XML output from the service (wrapped in root section)
      const xml = `<section>
  <section>First</section>
  <section>Second</section>
</section>`;
      const nodes = service.parseXml(xml);

      // Should unwrap the outer section since it has no label/text
      expect(nodes.length).toBe(2);
      expect(nodes[0].children).toEqual(['First']);
      expect(nodes[1].children).toEqual(['Second']);
    });
  });
});
