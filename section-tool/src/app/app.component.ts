import { Component } from '@angular/core';
import { TextSectionerComponent } from './text-sectioner/text-sectioner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TextSectionerComponent],
  template: `<app-text-sectioner />`,
})
export class AppComponent {}
