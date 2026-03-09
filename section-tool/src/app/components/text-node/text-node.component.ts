import { Component, input, output, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TextNode } from '../../models/text-node.model';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';

export interface NodeKeydownEvent {
  nodeId: string;
  contentIndex: number;  // Index in children array
  event: KeyboardEvent;
  cursorPos: number;
}

export interface NodeTextChangeEvent {
  nodeId: string;
  contentIndex: number;  // Index in children array
  text: string;
}

export interface NodeLabelChangeEvent {
  nodeId: string;
  label: string;
}

export interface NodeDeleteEvent {
  nodeId: string;
}

export interface NodeTranslationChangeEvent {
  nodeId: string;
  translation: string;
}

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

  nodeKeydown = output<NodeKeydownEvent>();
  textChange = output<NodeTextChangeEvent>();
  labelChange = output<NodeLabelChangeEvent>();
  deleteNode = output<NodeDeleteEvent>();
  translationChange = output<NodeTranslationChangeEvent>();

  onKeydown(event: KeyboardEvent, waTextarea: any, contentIndex: number): void {
    if (
      event.key === 'Enter' ||
      event.key === 'Tab'
    ) {
      event.preventDefault();
      // Access internal textarea from Web Awesome component
      const internalTextarea = waTextarea.shadowRoot?.querySelector('textarea');
      const cursorPos = internalTextarea?.selectionStart ?? 0;

      this.nodeKeydown.emit({
        nodeId: this.node().id,
        contentIndex,
        event,
        cursorPos,
      });
    }
  }

  onTextInput(event: Event, contentIndex: number): void {
    const waTextarea = event.target as any;
    const value = waTextarea.value;
    this.textChange.emit({ nodeId: this.node().id, contentIndex, text: value });
  }

  onTranslationInput(event: Event): void {
    const waTextarea = event.target as any;
    const value = waTextarea.value;
    this.translationChange.emit({ nodeId: this.node().id, translation: value });
  }

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

      this.translationChange.emit({ nodeId: this.node().id, translation: newValue });
    }
  }

  isString(item: TextNode | string): item is string {
    return typeof item === 'string';
  }

  onLabelInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.labelChange.emit({ nodeId: this.node().id, label: value });
  }

  onDelete(): void {
    this.deleteNode.emit({ nodeId: this.node().id });
  }

  // Re-emit child events so they bubble up to the container
  onChildKeydown(event: NodeKeydownEvent): void {
    this.nodeKeydown.emit(event);
  }

  onChildTextChange(event: NodeTextChangeEvent): void {
    this.textChange.emit(event);
  }

  onChildLabelChange(event: NodeLabelChangeEvent): void {
    this.labelChange.emit(event);
  }

  onChildDelete(event: NodeDeleteEvent): void {
    this.deleteNode.emit(event);
  }

  onChildTranslationChange(event: NodeTranslationChangeEvent): void {
    this.translationChange.emit(event);
  }
}
