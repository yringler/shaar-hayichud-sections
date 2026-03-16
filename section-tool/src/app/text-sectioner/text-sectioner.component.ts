import { Component, inject, signal, HostListener, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TextSectionService } from '../services/text-section.service';
import { TextNodeComponent, NodeKeydownEvent, NodeTextChangeEvent, NodeLabelChangeEvent, NodeDeleteEvent, NodeTranslationChangeEvent } from '../components/text-node/text-node.component';
import { XmlOutputComponent } from '../components/xml-output/xml-output.component';
import { SaveService } from '../services/save.service';
import { XmlLibraryService } from '../services/xml-library.service';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/number-input/number-input.js';

@Component({
  selector: 'app-text-sectioner',
  standalone: true,
  imports: [TextNodeComponent, XmlOutputComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './text-sectioner.component.html',
  styleUrl: './text-sectioner.component.css',
})
export class TextSectionerComponent {
  private static readonly SHOW_TRANSLATION_KEY = 'editor_show_translation';
  private static readonly LAST_FILE_KEY = 'editor_last_file';

  private service = inject(TextSectionService);
  private saveService = inject(SaveService);
  private libraryService = inject(XmlLibraryService);

  rootNodes = this.service.rootNodes;
  jsonOutput = this.service.jsonOutput;
  showTranslation = signal(localStorage.getItem(TextSectionerComponent.SHOW_TRANSLATION_KEY) === 'true');
  saveStatus = this.saveService.status;
  saveErrorMessage = this.saveService.errorMessage;
  currentFile = this.libraryService.currentFile;
  showSaveOverlay = signal(false);

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.onSave();
      if (this.currentFile()) {
        this.showSaveOverlay.set(true);
        setTimeout(() => this.showSaveOverlay.set(false), 1000);
      }
    }
  }

  chapterNumber = signal<number | null>(null);

  constructor() {
    const lastFile = localStorage.getItem(TextSectionerComponent.LAST_FILE_KEY);
    if (lastFile) {
      void this.loadLastFile(lastFile);
    }
  }

  private async loadLastFile(filename: string): Promise<void> {
    try {
      const content = await this.libraryService.loadFile(filename);
      this.service.loadFromJson(content);
    } catch {
      localStorage.removeItem(TextSectionerComponent.LAST_FILE_KEY);
    }
  }

  onChapterNumberInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const num = value ? parseInt(value, 10) : null;
    this.chapterNumber.set(num);
  }

  private applyChapterFile(): void {
    const num = this.chapterNumber();
    const filename = num ? `chapter_${String(num).padStart(2, '0')}.json` : null;
    this.libraryService.currentFile.set(filename);
  }

  toggleTranslation(): void {
    this.showTranslation.update(v => !v);
    localStorage.setItem(TextSectionerComponent.SHOW_TRANSLATION_KEY, String(this.showTranslation()));
  }

  onNodeKeydown(event: NodeKeydownEvent): void {
    const { nodeId, contentIndex, event: keyEvent, cursorPos } = event;
    let focusId: string | null = null;

    if (keyEvent.key === 'Enter' && keyEvent.altKey) {
      focusId = this.service.splitToParentSibling(nodeId, contentIndex, cursorPos);
    } else if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
      focusId = this.service.splitToChild(nodeId, contentIndex, cursorPos);
    } else if (keyEvent.key === 'Tab' && !keyEvent.shiftKey) {
      focusId = this.service.splitToSibling(nodeId, contentIndex, cursorPos);
    } else if (keyEvent.key === 'Enter' && keyEvent.shiftKey) {
      focusId = this.service.mergeWithParent(nodeId);
    } else if (keyEvent.key === 'Tab' && keyEvent.shiftKey) {
      focusId = this.service.mergeWithPreviousSibling(nodeId);
    }

    if (focusId) {
      // Focus the target textarea after Angular renders
      requestAnimationFrame(() => {
        const el = document.querySelector(`wa-textarea[data-node-id="${focusId}"]`) as any;
        // Web Awesome components have a focus() method
        el?.focus();
      });
    }
  }

  onTextChange(event: NodeTextChangeEvent): void {
    this.service.updateNodeText(event.nodeId, event.contentIndex, event.text);
  }

  onLabelChange(event: NodeLabelChangeEvent): void {
    this.service.updateNodeLabel(event.nodeId, event.label);
  }

  onDeleteNode(event: NodeDeleteEvent): void {
    this.service.deleteNode(event.nodeId);
  }

  onTranslationChange(event: NodeTranslationChangeEvent): void {
    this.service.updateNodeTranslation(event.nodeId, event.translation);
  }

  onCopy(): void {
    navigator.clipboard.writeText(this.jsonOutput());
  }

  onDownload(): void {
    const blob = new Blob([this.jsonOutput()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sections.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  onClear(): void {
    this.service.clearAll();
  }

  onPasteText(text: string): void {
    this.service.loadFromText(text);
    this.applyChapterFile();
  }

  onLoad(content: string): void {
    try {
      this.service.loadFromJson(content);
      const filename = this.currentFile();
      if (filename) {
        localStorage.setItem(TextSectionerComponent.LAST_FILE_KEY, filename);
      }
    } catch (error) {
      alert('Failed to load: ' + (error instanceof Error ? error.message : 'Invalid format'));
    }
  }

  onSave(): void {
    const filename = this.currentFile();
    if (!filename) {
      alert('No file loaded. Load a file from the library before saving.');
      return;
    }
    const path = `hugo/chapters/${filename}`;
    const content = this.jsonOutput();
    const message = `Edit ${filename} via editor`;
    void this.saveService.save(path, content, message);
  }
}
