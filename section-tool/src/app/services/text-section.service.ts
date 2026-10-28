import { Injectable, computed, inject, signal } from '@angular/core';
import { TextNode } from '../models/text-node.model';
import { EditorCommand, Focus, applyCommand } from '../editor/commands';
import { ID_SOURCE } from '../editor/id-source.token';
import { serializeDocument } from '../editor/serialization';
import { createNode } from '../editor/tree';

/**
 * Owns the document being edited. The tree is read-only from outside; the
 * only way to change it is `dispatch(command)`, which runs the pure
 * `applyCommand` and stores the new (immutable) tree.
 */
@Injectable({ providedIn: 'root' })
export class TextSectionService {
  private readonly ids = inject(ID_SOURCE);
  private readonly roots = signal<TextNode[]>([createNode(this.ids.nodeId())]);

  readonly rootNodes = this.roots.asReadonly();

  /** The chapter JSON to save ('' for the blank starting document). */
  readonly jsonOutput = computed(() => serializeDocument(this.roots()));

  /**
   * Apply a command and return where the caret should go next (null: leave
   * it). Throws, leaving the document unchanged, if a `loadJson` command's
   * JSON is invalid.
   */
  dispatch(command: EditorCommand): Focus | null {
    const { roots, focus } = applyCommand(this.roots(), command, this.ids);
    this.roots.set(roots);
    return focus;
  }
}
