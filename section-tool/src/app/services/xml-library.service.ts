import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class XmlLibraryService {
  private readonly indexUrl = `${environment.xmlBaseUrl}/texts/index.json`;

  readonly currentFile = signal<string | null>(null);

  async getFileList(): Promise<string[]> {
    const response = await fetch(this.indexUrl);
    if (!response.ok) {
      throw new Error(`Failed to load file index: ${response.statusText}`);
    }
    const entries = await response.json() as Array<{ file: string; url: string }>;
    return entries.map(entry => entry.file);
  }

  async loadFile(filename: string): Promise<string> {
    const url = `${environment.xmlBaseUrl}/texts/${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load file "${filename}": ${response.statusText}`);
    }
    this.currentFile.set(filename);
    return response.text();
  }
}
