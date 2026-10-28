import { Injectable, computed, inject, signal } from '@angular/core';
import { TextNode } from '../models/text-node.model';
import { EditorCommand, Focus, applyCommand, formatAfter } from '../editor/commands';
import { ID_SOURCE } from '../editor/id-source.token';
import { DEFAULT_FORMAT, JsonFormat, serializeDocument } from '../editor/serialization';
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
  /** Layout of the loaded file, so a save rewrites only what changed. */
  private readonly format = signal<JsonFormat>(DEFAULT_FORMAT);

  readonly rootNodes = this.roots.asReadonly();

  /** The chapter JSON to save ('' for the blank starting document). */
  readonly jsonOutput = computed(() => serializeDocument(this.roots(), this.format()));

  /**
   * Apply a command and return where the caret should go next (null: leave
   * it). Throws, leaving the document unchanged, if a `loadJson` command's
   * JSON is invalid.
   */
  dispatch(command: EditorCommand): Focus | null {
    const { roots, focus } = applyCommand(this.roots(), command, this.ids);
    this.roots.set(roots);
    this.format.set(formatAfter(command, this.format()));
    return focus;
  }
}
