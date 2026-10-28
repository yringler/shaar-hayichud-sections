import { Injectable, computed, inject, signal } from '@angular/core';
import { Line, TextNode } from '../models/text-node.model';
import { EditorCommand, Focus, applyCommand, formatAfter } from '../editor/commands';
import { ID_SOURCE } from '../editor/id-source.token';
import { DEFAULT_FORMAT, JsonFormat, serializeDocument } from '../editor/serialization';
import { retireLines } from '../editor/lines';
import { createNode } from '../editor/tree';

/**
 * Owns the document being edited. The tree is read-only from outside; the
 * only way to change it is `dispatch(command)`, which runs the pure
 * `applyCommand` and stores the new (immutable) tree.
 *
 * It also remembers lines that commands removed (see `retireLines`), so a
 * line that comes back in a later command (undo, cut and paste, drag and
 * drop, a move to another section) gets its id back. Loading or starting a
 * new document forgets them.
 */
@Injectable({ providedIn: 'root' })
export class TextSectionService {
  private readonly ids = inject(ID_SOURCE);
  private readonly roots = signal<TextNode[]>([createNode(this.ids.nodeId())]);
  /** Layout of the loaded file, so a save rewrites only what changed. */
  private readonly format = signal<JsonFormat>(DEFAULT_FORMAT);

  private retired: Line[] = [];
  private readonly reminted = signal(0);

  readonly rootNodes = this.roots.asReadonly();

  /**
   * How many lines of the last loaded file got a fresh id on load (missing,
   * invalid or duplicate ids, or legacy plain-string text). Non-zero means
   * a save replaces persisted line ids. 0 for documents not loaded from JSON.
   */
  readonly remintedOnLoad = this.reminted.asReadonly();

  /** The chapter JSON to save ('' for the blank starting document). */
  readonly jsonOutput = computed(() => serializeDocument(this.roots(), this.format()));

  /**
   * Apply a command and return where the caret should go next (null: leave
   * it). Throws, leaving the document unchanged, if a `loadJson` command's
   * JSON is invalid.
   */
  dispatch(command: EditorCommand): Focus | null {
    const before = this.roots();
    const { roots, focus, reminted } = applyCommand(before, command, this.ids, this.retired);
    const fresh = command.type === 'loadJson' || command.type === 'loadText' || command.type === 'clearAll';
    this.retired = fresh ? [] : retireLines(before, roots, this.retired);
    if (fresh) this.reminted.set(reminted ?? 0);
    this.roots.set(roots);
    this.format.set(formatAfter(command, this.format()));
    return focus;
  }
}
