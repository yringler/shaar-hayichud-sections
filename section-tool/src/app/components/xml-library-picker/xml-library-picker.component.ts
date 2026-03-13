import { Component, inject, output, signal, computed, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { XmlLibraryService } from '../../services/xml-library.service';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/input/input.js';

@Component({
  selector: 'app-xml-library-picker',
  standalone: true,
  templateUrl: './xml-library-picker.component.html',
  styleUrl: './xml-library-picker.component.css',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class XmlLibraryPickerComponent {
  private libraryService = inject(XmlLibraryService);
  private static readonly SORT_KEY = 'xml-library-sort-reverse';

  fileSelected = output<string>();

  isOpen = signal(false);
  isLoading = signal(false);
  error = signal<string | null>(null);
  files = signal<string[]>([]);
  filter = signal('');
  selectedFile = signal<string | null>(null);
  sortReverse = signal(localStorage.getItem(XmlLibraryPickerComponent.SORT_KEY) !== 'false');

  filteredFiles = computed(() => {
    const f = this.filter().toLowerCase();
    const list = f ? this.files().filter(name => name.toLowerCase().includes(f)) : this.files();
    return this.sortReverse() ? [...list].reverse() : list;
  });

  async open(): Promise<void> {
    this.isOpen.set(true);
    this.filter.set('');
    this.selectedFile.set(null);
    this.error.set(null);
    this.isLoading.set(true);
    try {
      const files = await this.libraryService.getFileList();
      this.files.set(files);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load file list');
    } finally {
      this.isLoading.set(false);
    }
  }

  close(): void {
    this.isOpen.set(false);
  }

  onFilterInput(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  async loadSelected(filename: string): Promise<void> {
    this.selectedFile.set(filename);
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const content = await this.libraryService.loadFile(filename);
      this.fileSelected.emit(content);
      this.close();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load file');
    } finally {
      this.isLoading.set(false);
    }
  }

  toggleSort(): void {
    const next = !this.sortReverse();
    this.sortReverse.set(next);
    localStorage.setItem(XmlLibraryPickerComponent.SORT_KEY, String(next));
  }

  onDialogHide(): void {
    this.isOpen.set(false);
  }
}
