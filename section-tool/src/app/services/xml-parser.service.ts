import { Injectable } from '@angular/core';
import { TextNode } from '../models/text-node.model';

@Injectable({ providedIn: 'root' })
export class XmlParserService {
  /**
   * Parse a JSON string and convert to TextNode structure.
   * The JSON format is an array of TextNode objects with mixed children
   * (strings and nested TextNode objects), matching the internal model exactly.
   *
   * @param jsonString The JSON content to parse
   * @returns Array of root TextNode objects
   */
  parseXml(jsonString: string): TextNode[] {
    const trimmed = jsonString.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error('Expected a JSON array of nodes');
      }
      return parsed.map((node) => this.hydrateNode(node));
    } catch (error) {
      console.error('JSON parsing error:', error);
      throw error;
    }
  }

  private hydrateNode(raw: Record<string, unknown>): TextNode {
    const node: TextNode = {
      id: crypto.randomUUID(),
      label: (raw['label'] as string) || '',
      children: [],
    };

    if (raw['translation'] && typeof raw['translation'] === 'string') {
      node.translation = raw['translation'];
    }

    const rawChildren = raw['children'];
    if (Array.isArray(rawChildren)) {
      for (const child of rawChildren) {
        if (typeof child === 'string') {
          if (child) node.children.push(child);
        } else if (child && typeof child === 'object') {
          node.children.push(this.hydrateNode(child as Record<string, unknown>));
        }
      }
    }

    // Ensure at least one child (empty string) for proper rendering
    if (node.children.length === 0) {
      node.children.push('');
    }

    return node;
  }
}
