import { Component, input, output, ElementRef, viewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { XmlLibraryPickerComponent } from '../xml-library-picker/xml-library-picker.component';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

@Component({
  selector: 'app-xml-output',
  standalone: true,
  imports: [XmlLibraryPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './xml-output.component.html',
  styleUrl: './xml-output.component.css',
})
export class XmlOutputComponent {
  jsonContent = input.required<string>();

  copyRequest = output<void>();
  downloadRequest = output<void>();
  clearRequest = output<void>();
  loadRequest = output<string>();

  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  onCopy(): void {
    this.copyRequest.emit();
  }

  onDownload(): void {
    this.downloadRequest.emit();
  }

  onClear(): void {
    this.clearRequest.emit();
  }

  onLoadFileClick(): void {
    this.fileInput()?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        this.loadRequest.emit(content);
      };
      reader.readAsText(file);
      // Reset input so same file can be loaded again
      input.value = '';
    }
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const content = event.clipboardData?.getData('text') || '';
    if (content.trim()) {
      this.loadRequest.emit(content);
      (event.target as HTMLTextAreaElement).value = '';
    }
  }
}
