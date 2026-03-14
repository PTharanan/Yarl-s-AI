import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  signal,
  inject,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-preview-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preview-panel.html',
  styleUrl: './preview-panel.css',
})
export class PreviewPanel implements OnChanges, OnInit {
  @Input() htmlCode: string = '';

  private polarizer = inject(DomSanitizer);

  activeTab = signal<'preview' | 'code'>('preview');
  isLoading = signal(false);
  hasContent = signal(false);
  
  // Storing the sanitized HTML safely here
  sanitizedHtml = signal<SafeHtml>('');

  defaultHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #f5f6f8ff;
    font-family: 'Inter', system-ui, sans-serif;
    color: #4b5563;
    text-align: center;
    padding: 3.5rem;
    overflow: hidden;
  }
  .icon-card {
    position: relative;
    width: 80px;
    height: 80px;
    margin-bottom: 2rem;
    animation: bounce-subtle 4s ease-in-out infinite;
  }
  .icon-surface {
    position: absolute;
    inset: 0;
    border-radius: 20px;
    background: #000000;
    border: 1px solid #1a1a1a;
    transform: rotate(45deg);
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  }
  .icon-card svg {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 36px; height: 36px;
    color: #2563eb;
    z-index: 10;
  }
  @keyframes bounce-subtle {
    0%, 100% { transform: scale(1) translateY(0); }
    50% { transform: scale(1.05) translateY(-8px); }
  }
  h2 {
    font-size: 22px;
    font-weight: 800;
    color: #111827;
    margin-bottom: 12px;
    letter-spacing: -0.02em;
    font-family: 'Inter', sans-serif;
  }
  p {
    font-size: 15px;
    max-width: 340px;
    line-height: 1.8;
    color: #9ca3af;
    font-weight: 500;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 2rem;
    padding: 8px 18px;
    border-radius: 24px;
    background: #eff6ff;
    border: 1px solid #dbeafe;
    font-size: 12px;
    font-weight: 700;
    color: #2563eb;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #2563eb;
    animation: flash 2s infinite;
  }
  @keyframes flash {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.4); }
  }
</style>
</head>
<body>
  <div class="icon-card">
    <div class="icon-surface"></div>
    <img src="/logo.png" alt="Yarl Logo" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; object-fit: contain; z-index: 10;" />
  </div>
  <h2>Studio Workspace</h2>
  <p>Describe your vision in the chat to begin. Every change renders here in instant high-definition.</p>
  <div class="status-pill">
    <span class="dot"></span>
    Awaiting Prompt
  </div>
</body>
</html>`;

  ngOnInit(): void {
    this.sanitizedHtml.set(this.polarizer.bypassSecurityTrustHtml(this.defaultHtml));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['htmlCode']) {
      if (this.htmlCode) {
        this.isLoading.set(true);
        this.hasContent.set(true);

        // Safe DOM Sanitization for the iframe's srcdoc
        this.sanitizedHtml.set(this.polarizer.bypassSecurityTrustHtml(this.htmlCode));

        setTimeout(() => {
          this.isLoading.set(false);
        }, 400);
      } else {
        // Reset to default
        this.hasContent.set(false);
        this.sanitizedHtml.set(this.polarizer.bypassSecurityTrustHtml(this.defaultHtml));
        this.activeTab.set('preview');
      }
    }
  }

  setTab(tab: 'preview' | 'code'): void {
    this.activeTab.set(tab);
  }

  refreshPreview(): void {
    const code = this.htmlCode || this.defaultHtml;
    this.isLoading.set(true);
    
    // Clear and redraw
    this.sanitizedHtml.set('');
    setTimeout(() => {
      this.sanitizedHtml.set(this.polarizer.bypassSecurityTrustHtml(code));
      this.isLoading.set(false);
    }, 150);
  }

  copyCode(): void {
    const code = this.htmlCode || this.defaultHtml;
    navigator.clipboard.writeText(code).then(() => {
      // Toast notification could exist here
    });
  }

  downloadHtml(): void {
    const code = this.htmlCode || this.defaultHtml;
    
    // Create blob from code
    const blob = new Blob([code], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    
    // Trigger download
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'yarls-web-project.html';
    
    document.body.appendChild(anchor);
    anchor.click();
    
    // Cleanup
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }
}
