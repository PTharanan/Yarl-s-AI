import { Component, signal } from '@angular/core';
import { ChatPanel } from './components/chat-panel/chat-panel';
import { PreviewPanel } from './components/preview-panel/preview-panel';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ChatPanel, PreviewPanel],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  generatedHtml = signal('');

  onHtmlCodeGenerated(code: string): void {
    this.generatedHtml.set(code);
  }
}
