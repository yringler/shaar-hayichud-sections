import { Component, inject, signal, HostListener, OnDestroy, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TextSectionService } from '../services/text-section.service';
import { TextNodeComponent } from '../components/text-node/text-node.component';
import { EditorCommand, Focus } from '../editor/commands';
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
export class TextSectionerComponent implements OnDestroy {
  private static readonly SHOW_TRANSLATION_KEY = 'editor_show_translation';
  private static readonly LAST_FILE_KEY = 'editor_last_file';
  private static readonly SCROLL_POSITION_KEY = 'editor_scroll_position';

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
  private scrollIntervalId: ReturnType<typeof setInterval>;

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

    this.scrollIntervalId = setInterval(() => {
      localStorage.setItem(TextSectionerComponent.SCROLL_POSITION_KEY, String(window.scrollY));
    }, 10_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.scrollIntervalId);
  }

  private async loadLastFile(filename: string): Promise<void> {
    try {
      const content = await this.libraryService.loadFile(filename);
      this.service.dispatch({ type: 'loadJson', json: content });
      const savedScroll = localStorage.getItem(TextSectionerComponent.SCROLL_POSITION_KEY);
      if (savedScroll) {
        setTimeout(() => window.scrollTo(0, parseInt(savedScroll, 10)), 100);
      }
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

  /** The single entry point for document changes coming from the editor. */
  onCommand(command: EditorCommand): void {
    const focus = this.service.dispatch(command);
    if (focus) this.focusAfterRender(focus);
  }

  private focusAfterRender(focus: Focus): void {
    requestAnimationFrame(() => {
      const byNode = `wa-textarea[data-node-id="${focus.nodeId}"]`;
      const el = (document.querySelector(`${byNode}[data-content-index="${focus.contentIndex}"]`) ??
        document.querySelector(byNode)) as any;
      // Web Awesome textareas expose focus() and setSelectionRange()
      el?.focus();
      el?.setSelectionRange?.(focus.offset, focus.offset);
    });
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
    this.service.dispatch({ type: 'clearAll' });
  }

  onPasteText(text: string): void {
    this.service.dispatch({ type: 'loadText', text });
    this.applyChapterFile();
  }

  onLoad(content: string): void {
    try {
      this.service.dispatch({ type: 'loadJson', json: content });
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
    const path = `data/chapters/${filename}`;
    const content = this.jsonOutput();
    const message = `Edit ${filename} via editor`;
    void this.saveService.save(path, content, message);
  }
}
