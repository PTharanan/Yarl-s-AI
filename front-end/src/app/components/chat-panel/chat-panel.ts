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
  private speechRecognition: any = null;
  private pendingVoicePrompt = false;

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
  isListening = signal(false);
  voiceSupported = signal(false);
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
    this.setupVoiceInput();

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

    const usedVoiceInput = this.pendingVoicePrompt;
    const modelForRequest = this.resolveModelForRequest(text, usedVoiceInput);

    const userMsg: ChatMessage = {
      id: this.nextId++,
      role: 'user',
      content: text || '📷 Image uploaded',
      timestamp: new Date(),
      imageUrl: image ?? undefined,
    };

    this.messages.update((msgs) => [...msgs, userMsg]);
    this.inputText = '';
    this.pendingVoicePrompt = false;
    this.uploadedImagePreview.set(null);
    this.shouldScroll = true;
    this.isTyping.set(true);
    this.isGenerating.set(true);

    if (this.isListening()) {
      this.stopVoiceInput();
    }

    const request: ChatRequest = {
      prompt: text,
      image: image ?? undefined,
      previousHtml: this.lastGeneratedHtml || undefined,
      model: modelForRequest
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

  toggleVoiceInput(): void {
    if (!this.voiceSupported() || this.isGenerating()) {
      return;
    }

    if (this.isListening()) {
      this.stopVoiceInput();
      return;
    }

    try {
      this.speechRecognition?.start();
    } catch (err) {
      console.warn('Voice recognition failed to start:', err);
      this.isListening.set(false);
    }
  }

  getVoiceButtonTitle(): string {
    if (!this.voiceSupported()) {
      return 'Voice input is not supported in this browser';
    }
    return this.isListening() ? 'Stop voice input' : 'Start voice input';
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
    this.pendingVoicePrompt = false;
    this.uploadedImagePreview.set(null);
    this.isTyping.set(false);
    this.isGenerating.set(false);
    this.lastGeneratedHtml = '';
    this.shouldScroll = true;

    if (this.isListening()) {
      this.stopVoiceInput();
    }

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

  private setupVoiceInput(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const speechRecognitionConstructor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!speechRecognitionConstructor) {
      this.voiceSupported.set(false);
      return;
    }

    const recognition = new speechRecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      this.isListening.set(true);
    };

    recognition.onend = () => {
      this.isListening.set(false);
    };

    recognition.onerror = () => {
      this.isListening.set(false);
    };

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) {
          transcript += (result[0]?.transcript || '');
        }
      }

      const finalText = transcript.trim();
      if (!finalText) {
        return;
      }

      const prefix = this.inputText.trim().length > 0 ? `${this.inputText.trim()} ` : '';
      this.inputText = `${prefix}${finalText}`.trim();
      this.pendingVoicePrompt = true;
    };

    this.speechRecognition = recognition;
    this.voiceSupported.set(true);
  }

  private stopVoiceInput(): void {
    try {
      this.speechRecognition?.stop();
    } catch {
      // Ignore stop errors when recognition is already idle.
    }
    this.isListening.set(false);
  }

  private resolveModelForRequest(prompt: string, fromVoiceInput: boolean): string {
    if (!fromVoiceInput || !this.isWebCreationTask(prompt)) {
      return this.selectedModel();
    }

    const cloudModel = this.getPreferredCloudModel();
    if (!cloudModel) {
      return this.selectedModel();
    }

    if (this.selectedModel() !== cloudModel) {
      this.selectedModel.set(cloudModel);
    }

    return cloudModel;
  }

  private getPreferredCloudModel(): string | null {
    const clouds = this.cloudModels();
    if (clouds.length === 0) {
      return null;
    }

    const geminiModel = clouds.find((modelName) => modelName.toLowerCase().includes('gemini'));
    return geminiModel ?? clouds[0] ?? null;
  }

  private isWebCreationTask(prompt: string): boolean {
    const normalizedPrompt = (prompt || '').toLowerCase();
    const webTaskHints = [
      'create website',
      'build website',
      'make website',
      'web app',
      'landing page',
      'portfolio',
      'dashboard',
      'html',
      'css',
      'ui',
      'frontend',
      'web design',
    ];

    return webTaskHints.some((hint) => normalizedPrompt.includes(hint));
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
