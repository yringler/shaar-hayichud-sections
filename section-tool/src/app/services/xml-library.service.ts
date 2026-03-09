import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class XmlLibraryService {
  private readonly indexUrl = `${environment.xmlBaseUrl}/xml/index.json`;

  readonly currentFile = signal<string | null>(null);

  async getFileList(): Promise<string[]> {
    const response = await fetch(this.indexUrl);
    if (!response.ok) {
      throw new Error(`Failed to load XML index: ${response.statusText}`);
    }
    return response.json() as Promise<string[]>;
  }

  async loadFile(filename: string): Promise<string> {
    const url = `${environment.xmlBaseUrl}/xml/${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load XML file "${filename}": ${response.statusText}`);
    }
    this.currentFile.set(filename);
    return response.text();
  }
}
