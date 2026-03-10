import { Injectable, signal, computed, inject } from '@angular/core';
import { TextNode } from '../models/text-node.model';
import { XmlParserService } from './xml-parser.service';

@Injectable({ providedIn: 'root' })
export class TextSectionService {
  private xmlParser = inject(XmlParserService);

  readonly rootNodes = signal<TextNode[]>([this.createNode('')]);

  readonly jsonOutput = computed(() => {
    const roots = this.rootNodes();

    // If there's only one root with no label and only empty text, return blank
    if (roots.length === 1 && !roots[0].label) {
      const onlyChild = roots[0].children.length === 1 && roots[0].children[0];
      if (typeof onlyChild === 'string' && !onlyChild.trim()) {
        return '';
      }
    }

    return JSON.stringify(this.nodesToJson(roots), null, 2);
  });

  createNode(text: string = '', label = ''): TextNode {
    return {
      id: crypto.randomUUID(),
      label,
      children: [text],  // Always include text to ensure textarea renders
    };
  }

  updateNodeText(nodeId: string, contentIndex: number, text: string): void {
    this.mutateNode(nodeId, (node) => {
      // Ensure the content index exists and is a string
      if (contentIndex < node.children.length && typeof node.children[contentIndex] === 'string') {
        node.children[contentIndex] = text;
      } else if (contentIndex === node.children.length) {
        // Adding new text at the end
        node.children.push(text);
      }
    });
  }

  updateNodeLabel(nodeId: string, label: string): void {
    this.mutateNode(nodeId, (node) => (node.label = label));
  }

  updateNodeTranslation(nodeId: string, translation: string): void {
    this.mutateNode(nodeId, (node) => (node.translation = translation));
  }

  /** Split text from cursor to end into a new child of this node */
  splitToChild(nodeId: string, contentIndex: number, cursorPos: number): string | null {
    let newId: string | null = null;
    this.mutateNode(nodeId, (node) => {
      const item = node.children[contentIndex];

      if (typeof item === 'string') {
        // Splitting text
        const beforeCursor = item.substring(0, cursorPos);
        const afterCursor = item.substring(cursorPos);

        // Create new child - use createNode but ensure it has the text (even if empty)
        const newChild: TextNode = {
          id: crypto.randomUUID(),
          label: '',
          children: [afterCursor],  // Always include the text, even if empty
        };
        newId = newChild.id;

        // Replace the original text with beforeCursor, then insert newChild
        // Keep the beforeCursor even if empty to maintain structure
        node.children.splice(contentIndex, 1, beforeCursor, newChild);
      } else {
        // Cursor is on a child node - insert new child after it
        const newChild = this.createNode('');
        newId = newChild.id;
        node.children.splice(contentIndex + 1, 0, newChild);
      }
    });
    return newId;
  }

  /** Split text from cursor to end into a new sibling after this node */
  splitToSibling(nodeId: string, contentIndex: number, cursorPos: number): string | null {
    let newId: string | null = null;
    const roots = this.rootNodes();
    const parent = this.findParent(nodeId, roots);

    this.mutateNode(nodeId, (node) => {
      const item = node.children[contentIndex];

      if (typeof item === 'string') {
        // Split text in current node
        const beforeCursor = item.substring(0, cursorPos);
        const afterCursor = item.substring(cursorPos);

        node.children[contentIndex] = beforeCursor;

        // Create new sibling with remaining text
        const sibling = this.createNode('');
        sibling.children = [afterCursor];
        newId = sibling.id;

        // Insert sibling after current node
        const siblings = parent ? parent.children : roots;
        const nodeIndex = siblings.findIndex(c => this.isTextNode(c) && c.id === nodeId);
        if (nodeIndex !== -1) {
          siblings.splice(nodeIndex + 1, 0, sibling);
        }
      }
    });

    this.rootNodes.set([...roots]);
    return newId;
  }

  /** Split text from cursor to end into a new sibling of this node's parent (promote one level) */
  splitToParentSibling(nodeId: string, contentIndex: number, cursorPos: number): string | null {
    const roots = this.rootNodes();
    const parent = this.findParent(nodeId, roots);
    if (!parent) return null; // Node is root-level, can't promote above root

    const grandparent = this.findParent(parent.id, roots);
    const grandparentChildren = grandparent ? grandparent.children : roots;

    const node = this.findNode(nodeId, roots);
    if (!node) return null;

    const item = node.children[contentIndex];
    if (typeof item !== 'string') return null;

    // Split text at cursor
    const beforeCursor = item.substring(0, cursorPos);
    const afterCursor = item.substring(cursorPos);

    // Keep beforeCursor in current node
    node.children[contentIndex] = beforeCursor;

    // Collect trailing content (everything after contentIndex in this node)
    const trailingContent = node.children.splice(contentIndex + 1);

    // Collect later siblings from parent (everything after this node in the parent)
    const nodeIndexInParent = parent.children.findIndex(
      c => this.isTextNode(c) && c.id === nodeId
    );
    const laterSiblings = nodeIndexInParent !== -1
      ? parent.children.splice(nodeIndexInParent + 1)
      : [];

    // Create new node with afterCursor + trailing content + later siblings
    const newNode: TextNode = {
      id: crypto.randomUUID(),
      label: '',
      children: [afterCursor, ...trailingContent, ...laterSiblings],
    };

    // Insert new node after parent in grandparent's children
    const parentIndex = grandparentChildren.findIndex(
      c => this.isTextNode(c) && c.id === parent.id
    );
    if (parentIndex !== -1) {
      grandparentChildren.splice(parentIndex + 1, 0, newNode);
    }

    this.rootNodes.set([...roots]);
    return newNode.id;
  }

  /** Merge this node's text back into its parent */
  mergeWithParent(nodeId: string): string | null {
    const roots = this.rootNodes();
    const parent = this.findParent(nodeId, roots);
    if (!parent) return null;

    const nodeIndex = parent.children.findIndex(
      c => this.isTextNode(c) && c.id === nodeId
    );
    if (nodeIndex === -1) return null;

    const node = parent.children[nodeIndex] as TextNode;

    // Remove node and splice in its children at same position
    parent.children.splice(nodeIndex, 1, ...node.children);

    // Merge adjacent text strings
    this.mergeAdjacentStrings(parent.children);

    // Preserve translation: concatenate if both have one, keep whichever exists
    if (node.translation?.trim()) {
      parent.translation = parent.translation?.trim()
        ? parent.translation.trim() + '\n' + node.translation.trim()
        : node.translation.trim();
    }

    this.rootNodes.set([...roots]);
    return parent.id;
  }

  /** Merge this node's text into the previous sibling */
  mergeWithPreviousSibling(nodeId: string): string | null {
    const roots = this.rootNodes();
    const parent = this.findParent(nodeId, roots);
    const siblings = parent ? parent.children : roots;

    const nodeIndex = siblings.findIndex(
      c => this.isTextNode(c) && c.id === nodeId
    );
    if (nodeIndex <= 0) return null;

    // Find previous node (skip text strings)
    let prevIndex = nodeIndex - 1;
    while (prevIndex >= 0 && typeof siblings[prevIndex] === 'string') {
      prevIndex--;
    }
    if (prevIndex < 0) return null;

    const prev = siblings[prevIndex] as TextNode;
    const node = siblings[nodeIndex] as TextNode;

    // Append current node's children to previous sibling
    prev.children.push(...node.children);

    // Merge adjacent text strings in the previous sibling
    this.mergeAdjacentStrings(prev.children);

    // Preserve translation: concatenate if both have one, keep whichever exists
    if (node.translation?.trim()) {
      prev.translation = prev.translation?.trim()
        ? prev.translation.trim() + '\n' + node.translation.trim()
        : node.translation.trim();
    }

    // Remove current node (and any text between prev and current)
    siblings.splice(prevIndex + 1, nodeIndex - prevIndex);

    this.rootNodes.set([...roots]);
    return prev.id;
  }

  deleteNode(nodeId: string): void {
    const roots = this.rootNodes();
    const parent = this.findParent(nodeId, roots);
    const siblings = parent ? parent.children : roots;
    const index = siblings.findIndex((c) => this.isTextNode(c) && c.id === nodeId);
    if (index !== -1) {
      siblings.splice(index, 1);
    }
    // Ensure at least one root node
    const hasNodeChildren = roots.some(c => this.isTextNode(c));
    if (!hasNodeChildren) {
      roots.push(this.createNode(''));
    }
    this.rootNodes.set([...roots]);
  }

  clearAll(): void {
    this.rootNodes.set([this.createNode('')]);
  }

  loadFromText(text: string): void {
    const node = this.createNode(text.trim());
    this.rootNodes.set([node]);
  }

  loadFromJson(jsonString: string): void {
    try {
      const nodes = this.xmlParser.parseXml(jsonString);
      if (nodes.length > 0) {
        this.rootNodes.set(nodes);
      } else {
        // If parsing resulted in no nodes, reset to default
        this.rootNodes.set([this.createNode('')]);
      }
    } catch (error) {
      console.error('Failed to load JSON:', error);
      throw error;
    }
  }

  private isTextNode(item: TextNode | string): item is TextNode {
    return typeof item !== 'string';
  }

  private mergeAdjacentStrings(items: (TextNode | string)[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      if (typeof items[i] === 'string' && typeof items[i - 1] === 'string') {
        // Merge items[i] into items[i-1] and remove items[i]
        items[i - 1] = (items[i - 1] as string) + (items[i] as string);
        items.splice(i, 1);
      }
    }
  }

  private mutateNode(
    nodeId: string,
    mutator: (node: TextNode) => void
  ): void {
    const roots = this.rootNodes();
    const node = this.findNode(nodeId, roots);
    if (node) {
      mutator(node);
      this.rootNodes.set([...roots]);
    }
  }

  private findNode(id: string, nodes: (TextNode | string)[]): TextNode | null {
    for (const item of nodes) {
      if (this.isTextNode(item)) {
        if (item.id === id) return item;
        const found = this.findNode(id, item.children);
        if (found) return found;
      }
    }
    return null;
  }

  private findParent(id: string, nodes: (TextNode | string)[], parent: TextNode | null = null): TextNode | null {
    for (const item of nodes) {
      if (this.isTextNode(item)) {
        if (item.id === id) return parent;
        const found = this.findParent(id, item.children, item);
        if (found) return found;
      }
    }
    return null;
  }

  private nodesToJson(nodes: (TextNode | string)[]): unknown[] {
    const result: unknown[] = [];

    for (const item of nodes) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed) result.push(trimmed);
      } else {
        // TextNode
        const node = item;
        const hasChildren = node.children.length > 0;
        if (!hasChildren) continue; // skip empty nodes

        const jsonNode: Record<string, unknown> = {};
        if (node.label) jsonNode['label'] = node.label;
        jsonNode['children'] = this.nodesToJson(node.children);
        if (node.translation?.trim()) jsonNode['translation'] = node.translation.trim();

        // Skip nodes that have no meaningful content
        const childrenArr = jsonNode['children'] as unknown[];
        const allText = node.children.filter(c => typeof c === 'string').map(s => (s as string).trim()).join('');
        const hasChildNodes = node.children.some(c => typeof c !== 'string');
        if (!allText && !hasChildNodes && !jsonNode['translation']) continue;

        result.push(jsonNode);
      }
    }

    return result;
  }
}
