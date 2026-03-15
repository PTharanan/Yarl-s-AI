import {
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  AfterViewChecked,
  OnInit,
  signal,
  computed,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ApiService, ChatRequest, ChatResponse, ModelEntry, ModelsResponse } from '../../services/api.service';
import { Subscription } from 'rxjs';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  imageUrl?: string;
  model?: string;
}

const SYSTEM_IDENTITY = "I am Yarl's Web AI";

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel implements AfterViewChecked, OnInit {
  @Output() htmlCodeGenerated = new EventEmitter<string>();
  @ViewChild('messageContainer') private messageContainer!: ElementRef;
  @ViewChild('fileInput') private fileInput!: ElementRef<HTMLInputElement>;

  private apiService = inject(ApiService);
  private currentRequest: Subscription | null = null;

  messages = signal<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: `Welcome! 👋 ${SYSTEM_IDENTITY}. I can help you generate HTML code. Send me a message describing what you want, or upload an image for inspiration.`,
      timestamp: new Date(),
    },
  ]);

  inputText = '';
  isTyping = signal(false);
  isGenerating = signal(false);
  uploadedImagePreview = signal<string | null>(null);
  showSettingsModal = signal(false);
  
  availableModels = signal<string[]>([]);
  selectedModel = signal('deepseek-coder:6.7b');
  cloudModels = signal<string[]>([]);
  localModels = signal<string[]>([]);
  isCloudSelected = computed(() => {
    const selected = this.selectedModel();
    if (this.cloudModels().includes(selected)) {
      return true;
    }
    if (this.localModels().includes(selected)) {
      return false;
    }
    return this.isLikelyCloudModel(selected);
  });

  private nextId = 2;
  private shouldScroll = false;
  private lastGeneratedHtml = '';

  messageCount = computed(() => this.messages().length);

  ngOnInit(): void {
    this.apiService.getModels().subscribe((data: ModelsResponse) => {
      const allModels = this.normalizeModelList(data.models ?? []);
      let cloudModels = this.normalizeModelList(data.cloud_models ?? []);
      let localModels = this.normalizeModelList(data.local_models ?? []);

      // Backward compatibility for older API payloads that only return a flat models list.
      if (cloudModels.length === 0 && localModels.length === 0) {
        cloudModels = allModels.filter((modelName) => this.isLikelyCloudModel(modelName));
        localModels = allModels.filter((modelName) => !cloudModels.includes(modelName));
      }

      const mergedModels = this.uniqueModels([...cloudModels, ...localModels, ...allModels]);
      if (mergedModels.length === 0) {
        return;
      }

      this.cloudModels.set(this.uniqueModels(cloudModels));
      this.localModels.set(this.uniqueModels(localModels));
      this.availableModels.set(mergedModels);

      if (!mergedModels.includes(this.selectedModel())) {
        this.selectedModel.set(mergedModels[0]);
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  sendMessage(): void {
    const text = this.inputText.trim();
    const image = this.uploadedImagePreview();
    if (!text && !image) return;

    const userMsg: ChatMessage = {
      id: this.nextId++,
      role: 'user',
      content: text || '📷 Image uploaded',
      timestamp: new Date(),
      imageUrl: image ?? undefined,
    };

    this.messages.update((msgs) => [...msgs, userMsg]);
    this.inputText = '';
    this.uploadedImagePreview.set(null);
    this.shouldScroll = true;
    this.isTyping.set(true);
    this.isGenerating.set(true);

    const request: ChatRequest = {
      prompt: text,
      image: image ?? undefined,
      previousHtml: this.lastGeneratedHtml || undefined,
      model: this.selectedModel()
    };

    this.currentRequest = this.apiService.sendMessage(request).subscribe({
      next: (response: ChatResponse) => {
        const assistantMsg: ChatMessage = {
          id: this.nextId++,
          role: 'assistant',
          content: response.message,
          timestamp: new Date(),
          model: (response as any).model_used
        };

        this.messages.update((msgs) => [...msgs, assistantMsg]);
        this.isTyping.set(false);
        this.isGenerating.set(false);
        this.currentRequest = null;
        this.shouldScroll = true;
        
        const shouldUpdatePreview = response.is_web_output ?? Boolean(response.html);
        if (shouldUpdatePreview && response.html) {
          this.lastGeneratedHtml = response.html;
          this.htmlCodeGenerated.emit(response.html);
        }
      },
      error: (err) => {
        console.error('Failed to contact backend:', err);
        const errorMsg: ChatMessage = {
          id: this.nextId++,
          role: 'assistant',
          content: 'Sorry, I encountered an error connecting to the API backend.',
          timestamp: new Date(),
        };
        this.messages.update((msgs) => [...msgs, errorMsg]);
        this.isTyping.set(false);
        this.isGenerating.set(false);
        this.currentRequest = null;
        this.shouldScroll = true;
      }
    });
  }

  stopGeneration(): void {
    if (this.currentRequest) {
      this.currentRequest.unsubscribe();
      this.currentRequest = null;
    }
    this.apiService.stopGeneration().subscribe();
    
    const stoppedMsg: ChatMessage = {
      id: this.nextId++,
      role: 'assistant',
      content: 'Generation stopped by user.',
      timestamp: new Date(),
    };
    this.messages.update((msgs) => [...msgs, stoppedMsg]);
    this.isTyping.set(false);
    this.isGenerating.set(false);
    this.shouldScroll = true;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!this.isGenerating()) {
        this.sendMessage();
      }
    }
  }

  triggerFileUpload(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        this.uploadedImagePreview.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      input.value = '';
    }
  }

  removeUploadedImage(): void {
    this.uploadedImagePreview.set(null);
  }

  startNewSession(): void {
    // Cancel any in-flight request
    if (this.currentRequest) {
      this.currentRequest.unsubscribe();
      this.currentRequest = null;
    }

    // Reset all state
    this.messages.set([
      {
        id: 1,
        role: 'assistant',
        content: `Welcome! 👋 ${SYSTEM_IDENTITY}. I can help you generate HTML code. Send me a message describing what you want, or upload an image for inspiration.`,
        timestamp: new Date(),
      },
    ]);
    this.nextId = 2;
    this.inputText = '';
    this.uploadedImagePreview.set(null);
    this.isTyping.set(false);
    this.isGenerating.set(false);
    this.lastGeneratedHtml = '';
    this.shouldScroll = true;

    // Clear the preview panel
    this.htmlCodeGenerated.emit('');
  }

  toggleSettings(): void {
    this.showSettingsModal.update(v => !v);
  }

  onModelChange(newModel: string): void {
    this.selectedModel.set(newModel);
  }

  private normalizeModelList(entries: ModelEntry[] | null | undefined): string[] {
    if (!entries || entries.length === 0) {
      return [];
    }

    return this.uniqueModels(
      entries
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry.trim();
          }
          const candidate = entry.name ?? entry.model ?? entry.id ?? '';
          return candidate.trim();
        })
        .filter((name) => name.length > 0)
    );
  }

  private uniqueModels(models: string[]): string[] {
    return Array.from(new Set(models));
  }

  private isLikelyCloudModel(modelName: string): boolean {
    const normalized = modelName.toLowerCase();
    const cloudHints = ['gemini', 'gpt', 'claude', 'anthropic', 'openai', 'cohere', 'mistral-large'];
    return cloudHints.some((hint) => normalized.includes(hint));
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private scrollToBottom(): void {
    try {
      const el = this.messageContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      } catch (err) {}
  }
}
