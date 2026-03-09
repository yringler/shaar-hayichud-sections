import { Component, inject, signal, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TextSectionService } from '../services/text-section.service';
import { TextNodeComponent, NodeKeydownEvent, NodeTextChangeEvent, NodeLabelChangeEvent, NodeDeleteEvent, NodeTranslationChangeEvent } from '../components/text-node/text-node.component';
import { XmlOutputComponent } from '../components/xml-output/xml-output.component';
import { SaveService } from '../services/save.service';
import { XmlLibraryService } from '../services/xml-library.service';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

@Component({
  selector: 'app-text-sectioner',
  standalone: true,
  imports: [TextNodeComponent, XmlOutputComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './text-sectioner.component.html',
  styleUrl: './text-sectioner.component.css',
})
export class TextSectionerComponent {
  private service = inject(TextSectionService);
  private saveService = inject(SaveService);
  private libraryService = inject(XmlLibraryService);

  rootNodes = this.service.rootNodes;
  xmlOutput = this.service.xmlOutput;
  showTranslation = signal(false);
  saveStatus = this.saveService.status;
  saveErrorMessage = this.saveService.errorMessage;
  currentFile = this.libraryService.currentFile;

  toggleTranslation(): void {
    this.showTranslation.update(v => !v);
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
    navigator.clipboard.writeText(this.xmlOutput());
  }

  onDownload(): void {
    const blob = new Blob([this.xmlOutput()], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sections.xml';
    a.click();
    URL.revokeObjectURL(url);
  }

  onClear(): void {
    this.service.clearAll();
  }

  onLoad(xmlContent: string): void {
    try {
      this.service.loadFromXml(xmlContent);
    } catch (error) {
      alert('Failed to load XML: ' + (error instanceof Error ? error.message : 'Invalid XML format'));
    }
  }

  onSave(): void {
    const filename = this.currentFile();
    if (!filename) {
      alert('No file loaded. Load a file from the library before saving.');
      return;
    }
    const path = `src/texts/${filename}`;
    const content = this.xmlOutput();
    const message = `Edit ${filename} via editor`;
    void this.saveService.save(path, content, message);
  }
}
