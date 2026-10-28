import { Component, input, output, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { Content, TextNode, isText } from '../../models/text-node.model';
import { EditorCommand } from '../../editor/commands';
import { keyToCommand } from '../../editor/keymap';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';

/**
 * Renders one node and, recursively, its child nodes. Presentational only:
 * every user action becomes an `EditorCommand` emitted on `command`, which
 * bubbles up to the container that dispatches it.
 */
@Component({
  selector: 'app-text-node',
  standalone: true,
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './text-node.component.html',
  styleUrl: './text-node.component.css',
})
export class TextNodeComponent {
  node = input.required<TextNode>();
  level = input<number>(1);
  showTranslation = input<boolean>(false);

  command = output<EditorCommand>();

  readonly isText = isText;

  /** Child nodes keep their component across inserts; text entries go by position. */
  trackContent(index: number, item: Content): string {
    return isText(item) ? `text:${index}` : item.id;
  }

  onKeydown(event: KeyboardEvent, waTextarea: any, contentIndex: number): void {
    // Access the internal textarea of the Web Awesome component for the caret.
    const internalTextarea = waTextarea.shadowRoot?.querySelector('textarea');
    const cmd = keyToCommand(event, {
      nodeId: this.node().id,
      contentIndex,
      cursorPos: internalTextarea?.selectionStart ?? 0,
      translationMode: this.showTranslation(),
    });
    if (cmd) {
      event.preventDefault();
      this.command.emit(cmd);
    }
  }

  onTextInput(event: Event, contentIndex: number): void {
    const text = (event.target as any).value as string;
    this.command.emit({ type: 'updateText', nodeId: this.node().id, contentIndex, text });
  }

  onTranslationInput(event: Event): void {
    const translation = (event.target as any).value as string;
    this.command.emit({ type: 'updateTranslation', nodeId: this.node().id, translation });
  }

  /** Ctrl/Cmd+I wraps the selection in <i>…</i>. */
  onTranslationKeydown(event: KeyboardEvent, waTextarea: any): void {
    if (event.key === 'i' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      const internalTextarea = waTextarea.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | null;
      if (!internalTextarea) return;

      const start = internalTextarea.selectionStart ?? 0;
      const end = internalTextarea.selectionEnd ?? 0;
      const value = internalTextarea.value;

      const newValue = value.slice(0, start) + '<i>' + value.slice(start, end) + '</i>' + value.slice(end);
      waTextarea.value = newValue;

      // Place cursor inside <i></i> if no selection, or after </i> if text was selected
      const newCursorPos = start === end ? start + 3 : end + 7;
      requestAnimationFrame(() => {
        internalTextarea.setSelectionRange(newCursorPos, newCursorPos);
      });

      this.command.emit({ type: 'updateTranslation', nodeId: this.node().id, translation: newValue });
    }
  }

  onLabelInput(event: Event): void {
    const label = (event.target as HTMLInputElement).value;
    this.command.emit({ type: 'updateLabel', nodeId: this.node().id, label });
  }

  onDelete(): void {
    this.command.emit({ type: 'deleteNode', nodeId: this.node().id });
  }
}
