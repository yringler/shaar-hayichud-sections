import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TextSectionService } from './text-section.service';
import { TextNode } from '../models/text-node.model';

describe('TextSectionService', () => {
  let service: TextSectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TextSectionService],
    });
    service = TestBed.inject(TextSectionService);
  });

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should initialize with one empty root node', () => {
      const roots = service.rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0].label).toBe('');
      expect(roots[0].children).toEqual(['']);  // Always has one empty text field
    });
  });

  describe('createNode', () => {
    it('should create a node with text', () => {
      const node = service.createNode('test text');
      expect(node.children).toHaveLength(1);
      expect(node.children[0]).toBe('test text');
      expect(node.label).toBe('');
      expect(node.id).toBeTruthy();
    });

    it('should create a node with text and label', () => {
      const node = service.createNode('test text', 'test label');
      expect(node.children).toHaveLength(1);
      expect(node.children[0]).toBe('test text');
      expect(node.label).toBe('test label');
    });

    it('should generate unique IDs for each node', () => {
      const node1 = service.createNode('text1');
      const node2 = service.createNode('text2');
      expect(node1.id).not.toBe(node2.id);
    });
  });

  describe('updateNodeText', () => {
    it('should update text of root node', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeText(nodeId, 0, 'updated text');
      expect(service.rootNodes()[0].children[0]).toBe('updated text');
    });

    it('should update text of nested node', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('child text');
      root.children = [child];  // Replace empty text with child
      service.rootNodes.set([root]);

      service.updateNodeText(child.id, 0, 'new child text');
      expect((service.rootNodes()[0].children[0] as TextNode).children[0]).toBe('new child text');
    });

    it('should do nothing if node ID not found', () => {
      const initialRoots = service.rootNodes();
      service.updateNodeText('non-existent-id', 0, 'text');
      expect(service.rootNodes()).toEqual(initialRoots);
    });
  });

  describe('updateNodeLabel', () => {
    it('should update label of root node', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeLabel(nodeId, 'new label');
      expect(service.rootNodes()[0].label).toBe('new label');
    });

    it('should update label of nested node', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('child text');
      root.children = [child];  // Replace empty text with child
      service.rootNodes.set([root]);

      service.updateNodeLabel(child.id, 'child label');
      expect((service.rootNodes()[0].children[0] as TextNode).label).toBe('child label');
    });
  });

  describe('splitToChild', () => {
    it('should split text at cursor position into child', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeText(nodeId, 0, 'Hello World');

      const newId = service.splitToChild(nodeId, 0, 5);

      const root = service.rootNodes()[0];
      expect(root.children[0]).toBe('Hello');
      expect(root.children).toHaveLength(2);
      expect((root.children[1] as TextNode).children[0]).toBe(' World');
      expect((root.children[1] as TextNode).id).toBe(newId);
    });

    it('should split at beginning (empty parent text)', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeText(nodeId, 0, 'Hello World');

      service.splitToChild(nodeId, 0, 0);

      const root = service.rootNodes()[0];
      expect(root.children[0]).toBe('');
      expect((root.children[1] as TextNode).children[0]).toBe('Hello World');
    });

    it('should split at end (empty child text)', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeText(nodeId, 0, 'Hello World');

      service.splitToChild(nodeId, 0, 11);

      const root = service.rootNodes()[0];
      expect(root.children[0]).toBe('Hello World');
      expect((root.children[1] as TextNode).children[0]).toBe('');
    });

    it('should return the new child ID', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeText(nodeId, 0, 'Hello World');

      const newId = service.splitToChild(nodeId, 0, 5);

      expect(newId).toBeTruthy();
      expect((service.rootNodes()[0].children[1] as TextNode).id).toBe(newId);
    });
  });

  describe('splitToSibling', () => {
    it('should split root node into sibling', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeText(nodeId, 0, 'Hello World');

      const newId = service.splitToSibling(nodeId, 0, 5);

      const roots = service.rootNodes();
      expect(roots).toHaveLength(2);
      expect(roots[0].children[0]).toBe('Hello');
      expect(roots[1].children[0]).toBe(' World');
      expect(roots[1].id).toBe(newId);
    });

    it('should split child node into sibling', () => {
      const root = service.rootNodes()[0];
      const child1 = service.createNode('First child');
      root.children = [child1];  // Replace empty text with child
      service.rootNodes.set([root]);

      const newId = service.splitToSibling(child1.id, 0, 5);

      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children).toHaveLength(2);
      expect((updatedRoot.children[0] as TextNode).children[0]).toBe('First');
      expect((updatedRoot.children[1] as TextNode).children[0]).toBe(' child');
      expect((updatedRoot.children[1] as TextNode).id).toBe(newId);
    });

    it('should return null if node not found', () => {
      const newId = service.splitToSibling('non-existent-id', 0, 5);
      expect(newId).toBeNull();
    });

    it('should insert sibling at correct position', () => {
      service.clearAll();
      const root1 = service.createNode('First');
      const root2 = service.createNode('Second');
      const root3 = service.createNode('Third');
      service.rootNodes.set([root1, root2, root3]);

      service.splitToSibling(root2.id, 0, 3);

      const roots = service.rootNodes();
      expect(roots).toHaveLength(4);
      expect(roots[0].children[0]).toBe('First');
      expect(roots[1].children[0]).toBe('Sec');
      expect(roots[2].children[0]).toBe('ond');
      expect(roots[3].children[0]).toBe('Third');
    });
  });

  describe('mergeWithParent', () => {
    it('should merge child text into parent', () => {
      const root = service.rootNodes()[0];
      service.updateNodeText(root.id, 0, 'Parent text');
      const child = service.createNode('Child text');
      root.children.push(child);
      service.rootNodes.set([root]);

      const parentId = service.mergeWithParent(child.id);

      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children[0]).toBe('Parent textChild text');
      expect(updatedRoot.children).toHaveLength(1);
      expect(parentId).toBe(root.id);
    });

    it('should move child\'s children to parent', () => {
      const root = service.rootNodes()[0];
      service.updateNodeText(root.id, 0, 'Root');
      const child = service.createNode('Child');
      const grandchild = service.createNode('Grandchild');
      child.children.push(grandchild);
      root.children.push(child);
      service.rootNodes.set([root]);

      service.mergeWithParent(child.id);

      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children[0]).toBe('RootChild');
      expect(updatedRoot.children).toHaveLength(2);
      expect((updatedRoot.children[1] as TextNode).children[0]).toBe('Grandchild');
    });

    it('should return null if node has no parent', () => {
      const rootId = service.rootNodes()[0].id;
      const result = service.mergeWithParent(rootId);
      expect(result).toBeNull();
    });

    it('should return null if node not found', () => {
      const result = service.mergeWithParent('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('mergeWithPreviousSibling', () => {
    it('should merge root nodes', () => {
      const root1 = service.createNode('First');
      const root2 = service.createNode('Second');
      service.rootNodes.set([root1, root2]);

      const prevId = service.mergeWithPreviousSibling(root2.id);

      const roots = service.rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0].children[0]).toBe('FirstSecond');
      expect(prevId).toBe(root1.id);
    });

    it('should merge child nodes', () => {
      const root = service.rootNodes()[0];
      const child1 = service.createNode('Child 1');
      const child2 = service.createNode('Child 2');
      root.children = [child1, child2];  // Replace empty text with children
      service.rootNodes.set([root]);

      const prevId = service.mergeWithPreviousSibling(child2.id);

      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children).toHaveLength(1);
      expect((updatedRoot.children[0] as TextNode).children[0]).toBe('Child 1Child 2');
      expect(prevId).toBe(child1.id);
    });

    it('should move children to previous sibling', () => {
      const root = service.rootNodes()[0];
      const child1 = service.createNode('Child 1');
      const child2 = service.createNode('Child 2');
      const grandchild = service.createNode('Grandchild');
      child2.children.push(grandchild);
      root.children = [child1, child2];  // Replace empty text with children
      service.rootNodes.set([root]);

      service.mergeWithPreviousSibling(child2.id);

      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children).toHaveLength(1);
      expect((updatedRoot.children[0] as TextNode).children).toHaveLength(2);
      expect(((updatedRoot.children[0] as TextNode).children[1] as TextNode).children[0]).toBe('Grandchild');
    });

    it('should return null if node is first sibling', () => {
      const root1 = service.createNode('First');
      const root2 = service.createNode('Second');
      service.rootNodes.set([root1, root2]);

      const result = service.mergeWithPreviousSibling(root1.id);
      expect(result).toBeNull();
    });

    it('should return null if node not found', () => {
      const result = service.mergeWithPreviousSibling('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('splitToParentSibling', () => {
    it('should split text and promote after-cursor to grandparent level', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('Hello World');
      root.children = ['', child];
      service.rootNodes.set([root]);

      const newId = service.splitToParentSibling(child.id, 0, 5);

      expect(newId).toBeTruthy();
      // Child should keep "Hello"
      const updatedRoot = service.rootNodes()[0];
      expect((updatedRoot.children[1] as TextNode).children[0]).toBe('Hello');
      // New node should be a sibling of root with " World"
      const roots = service.rootNodes();
      expect(roots).toHaveLength(2);
      expect((roots[1] as TextNode).children[0]).toBe(' World');
    });

    it('should return null when node is at root level', () => {
      const root = service.rootNodes()[0];
      service.updateNodeText(root.id, 0, 'Some text');

      const result = service.splitToParentSibling(root.id, 0, 4);

      expect(result).toBeNull();
    });

    it('should handle cursor at start (all text moves up)', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('All text moves');
      root.children = ['', child];
      service.rootNodes.set([root]);

      const newId = service.splitToParentSibling(child.id, 0, 0);

      expect(newId).toBeTruthy();
      const updatedRoot = service.rootNodes()[0];
      expect((updatedRoot.children[1] as TextNode).children[0]).toBe('');
      const roots = service.rootNodes();
      expect((roots[1] as TextNode).children[0]).toBe('All text moves');
    });

    it('should handle cursor at end (empty node created at parent level)', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('Keep this');
      root.children = ['', child];
      service.rootNodes.set([root]);

      const newId = service.splitToParentSibling(child.id, 0, 9);

      expect(newId).toBeTruthy();
      const updatedRoot = service.rootNodes()[0];
      expect((updatedRoot.children[1] as TextNode).children[0]).toBe('Keep this');
      const roots = service.rootNodes();
      expect((roots[1] as TextNode).children[0]).toBe('');
    });

    it('should carry trailing content into the new node', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('First segment');
      const grandchild = service.createNode('Grandchild text');
      child.children.push(grandchild, 'Trailing text');
      root.children = ['', child];
      service.rootNodes.set([root]);

      const newId = service.splitToParentSibling(child.id, 0, 5);

      expect(newId).toBeTruthy();
      // Child should keep "First" only
      const updatedRoot = service.rootNodes()[0];
      const updatedChild = updatedRoot.children[1] as TextNode;
      expect(updatedChild.children).toHaveLength(1);
      expect(updatedChild.children[0]).toBe('First');

      // New node should have " segment", grandchild, and trailing text
      const roots = service.rootNodes();
      const newNode = roots[1] as TextNode;
      expect(newNode.children).toHaveLength(3);
      expect(newNode.children[0]).toBe(' segment');
      expect((newNode.children[1] as TextNode).children[0]).toBe('Grandchild text');
      expect(newNode.children[2]).toBe('Trailing text');
    });

    it('should work with deeply nested nodes (parent is not root-level)', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('');
      const grandchild = service.createNode('Deep text');
      child.children = ['', grandchild];
      root.children = ['', child];
      service.rootNodes.set([root]);

      const newId = service.splitToParentSibling(grandchild.id, 0, 4);

      expect(newId).toBeTruthy();
      // Grandchild keeps "Deep"
      const updatedChild = service.rootNodes()[0].children[1] as TextNode;
      expect((updatedChild.children[1] as TextNode).children[0]).toBe('Deep');
      // New node " text" should be inserted after child in root's children
      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children).toHaveLength(3);
      expect((updatedRoot.children[2] as TextNode).children[0]).toBe(' text');
    });

    it('should move later siblings from parent into the new promoted node', () => {
      const root = service.rootNodes()[0];
      const child1 = service.createNode('Promote me');
      const child2 = service.createNode('Later sibling');
      const child3 = service.createNode('Another sibling');
      root.children = ['', child1, child2, child3];
      service.rootNodes.set([root]);

      const newId = service.splitToParentSibling(child1.id, 0, 7);

      expect(newId).toBeTruthy();
      // child1 keeps "Promote"
      const updatedRoot = service.rootNodes()[0];
      expect((updatedRoot.children[1] as TextNode).children[0]).toBe('Promote');
      // child2 and child3 should no longer be in root
      expect(updatedRoot.children).toHaveLength(2); // '' and child1

      // New promoted node should contain " me" + child2 + child3
      const roots = service.rootNodes();
      expect(roots).toHaveLength(2);
      const newNode = roots[1] as TextNode;
      expect(newNode.children[0]).toBe(' me');
      expect((newNode.children[1] as TextNode).children[0]).toBe('Later sibling');
      expect((newNode.children[2] as TextNode).children[0]).toBe('Another sibling');
    });

    it('should move later siblings including text strings from parent into promoted node', () => {
      const root = service.rootNodes()[0];
      const child1 = service.createNode('Split here');
      const child2 = service.createNode('Later child');
      root.children = ['Before', child1, 'Between', child2, 'After'];
      service.rootNodes.set([root]);

      const newId = service.splitToParentSibling(child1.id, 0, 5);

      expect(newId).toBeTruthy();
      // root keeps 'Before' and child1 with "Split"
      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children).toHaveLength(2); // 'Before', child1
      expect(updatedRoot.children[0]).toBe('Before');
      expect((updatedRoot.children[1] as TextNode).children[0]).toBe('Split');

      // New node gets " here", "Between", child2, "After"
      const roots = service.rootNodes();
      const newNode = roots[1] as TextNode;
      expect(newNode.children[0]).toBe(' here');
      expect(newNode.children[1]).toBe('Between');
      expect((newNode.children[2] as TextNode).children[0]).toBe('Later child');
      expect(newNode.children[3]).toBe('After');
    });
  });

  describe('deleteNode', () => {
    it('should delete root node', () => {
      const root1 = service.createNode('First');
      const root2 = service.createNode('Second');
      service.rootNodes.set([root1, root2]);

      service.deleteNode(root1.id);

      const roots = service.rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0].children[0]).toBe('Second');
    });

    it('should delete child node', () => {
      const root = service.rootNodes()[0];
      const child1 = service.createNode('Child 1');
      const child2 = service.createNode('Child 2');
      root.children = [child1, child2];  // Replace empty text with children
      service.rootNodes.set([root]);

      service.deleteNode(child1.id);

      const updatedRoot = service.rootNodes()[0];
      expect(updatedRoot.children).toHaveLength(1);
      expect((updatedRoot.children[0] as TextNode).children[0]).toBe('Child 2');
    });

    it('should ensure at least one root node exists', () => {
      const root = service.rootNodes()[0];
      service.deleteNode(root.id);

      const roots = service.rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0].children).toEqual(['']);  // Always has one empty text field
    });

    it('should do nothing if node not found', () => {
      const initialRoots = [...service.rootNodes()];
      service.deleteNode('non-existent-id');
      expect(service.rootNodes()).toHaveLength(initialRoots.length);
    });
  });

  describe('updateNodeTranslation', () => {
    it('should set translation on root node', () => {
      const nodeId = service.rootNodes()[0].id;
      service.updateNodeTranslation(nodeId, 'Hello in English');
      expect(service.rootNodes()[0].translation).toBe('Hello in English');
    });

    it('should update translation of nested node', () => {
      const root = service.rootNodes()[0];
      const child = service.createNode('child text');
      root.children = [child];
      service.rootNodes.set([root]);

      service.updateNodeTranslation(child.id, 'child translation');
      expect((service.rootNodes()[0].children[0] as TextNode).translation).toBe('child translation');
    });

    it('should do nothing if node not found', () => {
      service.updateNodeTranslation('non-existent-id', 'translation');
      expect(service.rootNodes()[0].translation).toBeUndefined();
    });
  });

  describe('translation behavior during section operations', () => {
    describe('splitToChild', () => {
      it('should keep translation on original node after split', () => {
        const nodeId = service.rootNodes()[0].id;
        service.updateNodeText(nodeId, 0, 'Hello World');
        service.updateNodeTranslation(nodeId, 'My translation');

        service.splitToChild(nodeId, 0, 5);

        expect(service.rootNodes()[0].translation).toBe('My translation');
      });

      it('should not give translation to the new child node', () => {
        const nodeId = service.rootNodes()[0].id;
        service.updateNodeText(nodeId, 0, 'Hello World');
        service.updateNodeTranslation(nodeId, 'My translation');

        const newId = service.splitToChild(nodeId, 0, 5);

        const newChild = service.rootNodes()[0].children[1] as TextNode;
        expect(newChild.id).toBe(newId);
        expect(newChild.translation).toBeUndefined();
      });
    });

    describe('splitToSibling', () => {
      it('should keep translation on original node after split', () => {
        const nodeId = service.rootNodes()[0].id;
        service.updateNodeText(nodeId, 0, 'Hello World');
        service.updateNodeTranslation(nodeId, 'My translation');

        service.splitToSibling(nodeId, 0, 5);

        expect(service.rootNodes()[0].translation).toBe('My translation');
      });

      it('should not give translation to the new sibling node', () => {
        const nodeId = service.rootNodes()[0].id;
        service.updateNodeText(nodeId, 0, 'Hello World');
        service.updateNodeTranslation(nodeId, 'My translation');

        const newId = service.splitToSibling(nodeId, 0, 5);

        const newSibling = service.rootNodes()[1];
        expect(newSibling.id).toBe(newId);
        expect(newSibling.translation).toBeUndefined();
      });
    });

    describe('splitToParentSibling', () => {
      it('should keep translation on original node after split', () => {
        const root = service.rootNodes()[0];
        const child = service.createNode('Hello World');
        child.translation = 'My translation';
        root.children = ['', child];
        service.rootNodes.set([root]);

        service.splitToParentSibling(child.id, 0, 5);

        const updatedChild = service.rootNodes()[0].children[1] as TextNode;
        expect(updatedChild.translation).toBe('My translation');
      });

      it('should not give translation to the promoted new node', () => {
        const root = service.rootNodes()[0];
        const child = service.createNode('Hello World');
        child.translation = 'My translation';
        root.children = ['', child];
        service.rootNodes.set([root]);

        const newId = service.splitToParentSibling(child.id, 0, 5);

        const promoted = service.rootNodes()[1];
        expect(promoted.id).toBe(newId);
        expect(promoted.translation).toBeUndefined();
      });
    });

    describe('mergeWithParent', () => {
      it('should keep child translation on parent when parent has none', () => {
        const root = service.rootNodes()[0];
        service.updateNodeText(root.id, 0, 'Parent text');
        const child = service.createNode('Child text');
        child.translation = 'Child translation';
        root.children.push(child);
        service.rootNodes.set([root]);

        service.mergeWithParent(child.id);

        expect(service.rootNodes()[0].translation).toBe('Child translation');
      });

      it('should keep parent translation when child has none', () => {
        const root = service.rootNodes()[0];
        root.translation = 'Parent translation';
        service.updateNodeText(root.id, 0, 'Parent text');
        const child = service.createNode('Child text');
        root.children.push(child);
        service.rootNodes.set([root]);

        service.mergeWithParent(child.id);

        expect(service.rootNodes()[0].translation).toBe('Parent translation');
      });

      it('should concatenate translations when both parent and child have one', () => {
        const root = service.rootNodes()[0];
        root.translation = 'Parent translation';
        service.updateNodeText(root.id, 0, 'Parent text');
        const child = service.createNode('Child text');
        child.translation = 'Child translation';
        root.children.push(child);
        service.rootNodes.set([root]);

        service.mergeWithParent(child.id);

        expect(service.rootNodes()[0].translation).toBe('Parent translation\nChild translation');
      });

      it('should leave parent translation undefined when neither has one', () => {
        const root = service.rootNodes()[0];
        service.updateNodeText(root.id, 0, 'Parent text');
        const child = service.createNode('Child text');
        root.children.push(child);
        service.rootNodes.set([root]);

        service.mergeWithParent(child.id);

        expect(service.rootNodes()[0].translation).toBeUndefined();
      });
    });

    describe('mergeWithPreviousSibling', () => {
      it('should keep current node translation on previous sibling when previous has none', () => {
        const prev = service.createNode('First');
        const curr = service.createNode('Second');
        curr.translation = 'Second translation';
        service.rootNodes.set([prev, curr]);

        service.mergeWithPreviousSibling(curr.id);

        expect(service.rootNodes()[0].translation).toBe('Second translation');
      });

      it('should keep previous sibling translation when current node has none', () => {
        const prev = service.createNode('First');
        prev.translation = 'First translation';
        const curr = service.createNode('Second');
        service.rootNodes.set([prev, curr]);

        service.mergeWithPreviousSibling(curr.id);

        expect(service.rootNodes()[0].translation).toBe('First translation');
      });

      it('should concatenate translations when both siblings have one', () => {
        const prev = service.createNode('First');
        prev.translation = 'First translation';
        const curr = service.createNode('Second');
        curr.translation = 'Second translation';
        service.rootNodes.set([prev, curr]);

        service.mergeWithPreviousSibling(curr.id);

        expect(service.rootNodes()[0].translation).toBe('First translation\nSecond translation');
      });

      it('should leave previous sibling translation undefined when neither has one', () => {
        const prev = service.createNode('First');
        const curr = service.createNode('Second');
        service.rootNodes.set([prev, curr]);

        service.mergeWithPreviousSibling(curr.id);

        expect(service.rootNodes()[0].translation).toBeUndefined();
      });
    });
  });

  describe('clearAll', () => {
    it('should reset to single empty root node', () => {
      const root1 = service.createNode('First');
      const root2 = service.createNode('Second');
      service.rootNodes.set([root1, root2]);

      service.clearAll();

      const roots = service.rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0].label).toBe('');
      expect(roots[0].children).toEqual(['']);  // Always has one empty text field
    });
  });

  describe('jsonOutput', () => {
    it('should generate JSON for single node', () => {
      service.clearAll();
      const root = service.createNode('Hello World');
      service.rootNodes.set([root]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].children).toContain('Hello World');
    });

    it('should generate JSON with label', () => {
      service.clearAll();
      const root = service.createNode('Content', 'Chapter 1');
      service.rootNodes.set([root]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed[0].label).toBe('Chapter 1');
      expect(parsed[0].children).toContain('Content');
    });

    it('should generate nested JSON', () => {
      service.clearAll();
      const root = service.createNode('Parent text', 'Parent');
      const child = service.createNode('Child text', 'Child');
      root.children.push(child);
      service.rootNodes.set([root]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed[0].label).toBe('Parent');
      expect(parsed[0].children).toContain('Parent text');
      const childNode = parsed[0].children.find((c: any) => typeof c === 'object');
      expect(childNode.label).toBe('Child');
      expect(childNode.children).toContain('Child text');
    });

    it('should skip empty nodes', () => {
      service.clearAll();
      const root1 = service.createNode('Content');
      const root2 = service.createNode('');
      service.rootNodes.set([root1, root2]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].children).toContain('Content');
    });

    it('should trim whitespace in text nodes', () => {
      service.clearAll();
      const root = service.createNode('  Text with spaces  ');
      service.rootNodes.set([root]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed[0].children).toContain('Text with spaces');
    });

    it('should include translation when node has translation', () => {
      service.clearAll();
      const root = service.createNode('Hebrew text', 'Chapter 1');
      root.translation = 'English translation';
      service.rootNodes.set([root]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed[0].translation).toBe('English translation');
      expect(parsed[0].children).toContain('Hebrew text');
    });

    it('should not include translation when translation is empty', () => {
      service.clearAll();
      const root = service.createNode('Hebrew text');
      root.translation = '';
      service.rootNodes.set([root]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed[0].translation).toBeUndefined();
    });

    it('should handle special characters in text (JSON handles natively)', () => {
      service.clearAll();
      const root = service.createNode('Text with <tag> & "quotes"');
      service.rootNodes.set([root]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed[0].children).toContain('Text with <tag> & "quotes"');
    });

    it('should handle multiple root nodes', () => {
      service.clearAll();
      const root1 = service.createNode('First');
      const root2 = service.createNode('Second');
      service.rootNodes.set([root1, root2]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].children).toContain('First');
      expect(parsed[1].children).toContain('Second');
    });

    it('should preserve order: text before child nodes', () => {
      service.clearAll();
      const parent = service.createNode('Parent text', 'Parent');
      const child1 = service.createNode('Child 1', 'C1');
      const child2 = service.createNode('Child 2', 'C2');
      parent.children.push(child1, child2);
      service.rootNodes.set([parent]);

      const json = service.jsonOutput();
      const parsed = JSON.parse(json);
      const children = parsed[0].children;
      const textIndex = children.indexOf('Parent text');
      const child1Index = children.findIndex((c: any) => typeof c === 'object' && c.label === 'C1');
      expect(textIndex).toBeLessThan(child1Index);
    });
  });

  describe('jsonOutput reactivity', () => {
    it('should update JSON when nodes change', () => {
      service.clearAll();
      const root = service.createNode('Initial');
      service.rootNodes.set([root]);

      const json1 = JSON.parse(service.jsonOutput());
      expect(json1[0].children).toContain('Initial');

      service.updateNodeText(root.id, 0, 'Updated');
      const json2 = JSON.parse(service.jsonOutput());
      expect(json2[0].children).toContain('Updated');
    });

    it('should return blank string for default empty state', () => {
      service.clearAll();
      expect(service.jsonOutput()).toBe('');
    });

    it('should return JSON once content is added to default node', () => {
      service.clearAll();
      const root = service.rootNodes()[0];

      expect(service.jsonOutput()).toBe('');

      service.updateNodeText(root.id, 0, 'Hello');
      const parsed = JSON.parse(service.jsonOutput());
      expect(parsed[0].children).toContain('Hello');
    });
  });
});
