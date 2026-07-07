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
import { ApiService, ChatRequest, ChatResponse, ModelEntry, ModelsResponse, ProviderConfig, ProviderType } from '../../services/api.service';
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

// localStorage keys for the "bring your own key" provider settings.
const LS_PROVIDER_CONFIG = 'yarl_provider_config';
const LS_PROVIDER_ENABLED = 'yarl_provider_enabled';

interface ProviderPreset {
  provider: ProviderType;
  label: string;
  shortLabel: string;  // Used in the navbar pill for brevity.
  defaultModel: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  keyHelpUrl: string;
}

// Presets auto-fill the model + base URL defaults in the modal.
const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-...',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    keyPlaceholder: 'sk-...',
    keyHelpUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    provider: 'zai',
    label: 'z.ai (GLM)',
    shortLabel: 'z.ai',
    defaultModel: 'glm-4.6',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    keyPlaceholder: 'your z.ai key',
    keyHelpUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic (Claude)',
    shortLabel: 'Claude',
    defaultModel: 'claude-3-5-sonnet-latest',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-...',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    defaultModel: 'gemini-1.5-flash',
    defaultBaseUrl: '',
    keyPlaceholder: 'AIza...',
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    provider: 'ollama',
    label: 'Ollama (local)',
    shortLabel: 'Ollama',
    defaultModel: 'deepseek-coder:6.7b',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    keyPlaceholder: 'ollama (any value)',
    keyHelpUrl: 'https://ollama.com',
  },
  {
    provider: 'custom',
    label: 'Custom (OpenAI-compatible)',
    shortLabel: 'Custom',
    defaultModel: '',
    defaultBaseUrl: '',
    keyPlaceholder: 'API key',
    keyHelpUrl: '',
  },
];

function findPreset(provider: ProviderType): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.provider === provider) ?? PROVIDER_PRESETS[0];
}

interface StoredProviderConfig {
  provider: ProviderType;
  base_url: string;
  model: string;
  api_key: string;
}

function readStoredConfig(): StoredProviderConfig {
  const fallback: StoredProviderConfig = {
    provider: 'openai',
    base_url: '',
    model: '',
    api_key: '',
  };
  try {
    const raw = localStorage.getItem(LS_PROVIDER_CONFIG);
    if (!raw) {
      return fallback;
    }
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function writeStoredConfig(config: StoredProviderConfig): void {
  try {
    localStorage.setItem(LS_PROVIDER_CONFIG, JSON.stringify(config));
  } catch {
    // localStorage may be unavailable (private mode) — settings just won't persist.
  }
}

function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Ignore write failures.
  }
}

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

  // ===== AI provider settings (bring your own key) =====
  showKeySettings = signal(false);
  showProviderKey = signal(false);
  // Editing buffers for the modal — populated when the modal opens.
  providerInput: ProviderType = 'openai';
  providerModelInput = '';
  providerKeyInput = '';
  providerBaseUrlInput = '';
  // Persisted values actually used when building requests.
  private initialConfig = readStoredConfig();
  provider = signal<ProviderType>(this.initialConfig.provider);
  providerModel = signal<string>(this.initialConfig.model);
  providerKey = signal<string>(this.initialConfig.api_key);
  providerBaseUrl = signal<string>(this.initialConfig.base_url);
  providerEnabled = signal<boolean>(readStoredFlag(LS_PROVIDER_ENABLED));
  // True when a complete provider config exists (model + key). Used to gate the
  // "override the model picker" behavior and the header pill.
  providerConfigured = computed(() => {
    return Boolean(this.providerModel().trim() && this.providerKey().trim());
  });
  providerActive = computed(() => this.providerEnabled() && this.providerConfigured());
  providerDisplayName = computed(() => findPreset(this.provider()).shortLabel);

  readonly providerPresets = PROVIDER_PRESETS;
  
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
    this.loadModels();
  }

  /**
   * Load the model list. When a provider config is active, fetch models for the
   * user's own key; otherwise fall back to the server-side Gemini/Ollama list.
   */
  private loadModels(): void {
    const providerConfig = this.resolveProviderForRequest();

    const source = providerConfig
      ? this.apiService.getProviderModels(providerConfig)
      : this.apiService.getModels();

    source.subscribe((data: ModelsResponse) => {
      // Surface provider fetch failures (e.g. bad key) as a chat message.
      if (data.error) {
        this.messages.update((msgs) => [
          ...msgs,
          {
            id: this.nextId++,
            role: 'assistant',
            content: `⚠️ ${data.error}`,
            timestamp: new Date(),
          },
        ]);
        this.shouldScroll = true;
        // Keep any previously loaded models; don't wipe the picker on error.
        return;
      }

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
        // Reset picker lists so stale server models don't linger after switching.
        this.cloudModels.set([]);
        this.localModels.set([]);
        this.availableModels.set([]);
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

    // When a provider config is active, it overrides the 3-dots model picker.
    const providerConfig = this.resolveProviderForRequest();
    const request: ChatRequest = {
      prompt: text,
      image: image ?? undefined,
      previousHtml: this.lastGeneratedHtml || undefined,
      model: providerConfig ? this.providerModel().trim() : modelForRequest,
      provider_config: providerConfig ?? undefined
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

  // ===== AI provider settings modal handlers =====
  openKeySettings(): void {
    // Seed the modal inputs with the currently persisted values.
    this.providerInput = this.provider();
    this.providerModelInput = this.providerModel();
    this.providerKeyInput = this.providerKey();
    this.providerBaseUrlInput = this.providerBaseUrl();
    this.showProviderKey.set(false);
    this.showKeySettings.set(true);
  }

  closeKeySettings(): void {
    this.showKeySettings.set(false);
  }

  /**
   * Switching providers in the modal resets ALL fields to that provider's
   * fresh defaults — model, key, and base URL are cleared and re-seeded.
   */
  onProviderPresetChange(provider: ProviderType): void {
    this.providerInput = provider;
    const preset = findPreset(provider);

    // Clear everything, then apply this provider's defaults.
    this.providerKeyInput = '';
    this.providerModelInput = preset.defaultModel;
    this.providerBaseUrlInput = preset.provider === 'gemini' ? '' : preset.defaultBaseUrl;
  }

  presetFor(provider: ProviderType): ProviderPreset {
    return findPreset(provider);
  }

  saveKeySettings(): void {
    const provider = this.providerInput;
    this.provider.set(provider);
    this.providerModel.set(this.providerModelInput.trim());
    this.providerKey.set(this.providerKeyInput.trim());
    this.providerBaseUrl.set(this.providerBaseUrlInput.trim());

    writeStoredConfig({
      provider,
      base_url: this.providerBaseUrl(),
      model: this.providerModel(),
      api_key: this.providerKey(),
    });
    // Auto-enable the override once a complete config is saved.
    if (this.providerConfigured()) {
      this.providerEnabled.set(true);
      writeStoredFlag(LS_PROVIDER_ENABLED, true);
    }

    this.showKeySettings.set(false);
    // Refresh the Model Selector to show this provider's models.
    this.loadModels();
  }

  /** Disconnect: stop overriding the 3-dots picker, keep the saved config. */
  disconnectProvider(): void {
    this.providerEnabled.set(false);
    writeStoredFlag(LS_PROVIDER_ENABLED, false);
    // Restore the server-side model list.
    this.loadModels();
  }

  clearKeySettings(): void {
    this.providerInput = 'openai';
    this.providerModelInput = '';
    this.providerKeyInput = '';
    this.providerBaseUrlInput = '';

    this.provider.set('openai');
    this.providerModel.set('');
    this.providerKey.set('');
    this.providerBaseUrl.set('');
    this.providerEnabled.set(false);

    writeStoredConfig({ provider: 'openai', base_url: '', model: '', api_key: '' });
    writeStoredFlag(LS_PROVIDER_ENABLED, false);
    // Restore the server-side model list.
    this.loadModels();
  }

  toggleProviderKeyVisibility(): void {
    this.showProviderKey.update(v => !v);
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
    // Provider config override is handled in sendMessage() — this method only
    // deals with the server-side 3-dots picker (when no provider override).
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

  /**
   * Builds the provider_config object to send with the request, or null when
   * the user's custom provider is not active (server defaults via 3-dots picker).
   */
  private resolveProviderForRequest(): ProviderConfig | null {
    if (!this.providerActive()) {
      return null;
    }

    const cfg: ProviderConfig = {
      provider: this.provider(),
      model: this.providerModel().trim(),
      api_key: this.providerKey().trim(),
    };

    const baseUrl = this.providerBaseUrl().trim();
    if (baseUrl) {
      cfg.base_url = baseUrl;
    }

    return cfg;
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
