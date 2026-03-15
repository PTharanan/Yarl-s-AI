import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface ChatRequest {
  prompt: string;
  image?: string;
  previousHtml?: string;
  model?: string;
}

export interface ChatResponse {
  html: string;
  message: string;
  is_web_output?: boolean;
  model_used?: string;
}

export type ModelEntry =
  | string
  | {
      name?: string;
      id?: string;
      model?: string;
    };

export interface ModelsResponse {
  models?: ModelEntry[];
  cloud_models?: ModelEntry[];
  local_models?: ModelEntry[];
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private backendHost = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
  private apiBaseUrl = `http://${this.backendHost}:8000/api`;
  private apiUrl = `${this.apiBaseUrl}/generate/`;
  private stopUrl = `${this.apiBaseUrl}/stop/`;
  private modelsUrl = `${this.apiBaseUrl}/models/`;

  sendMessage(request: ChatRequest): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(this.apiUrl, request).pipe(
      catchError(error => {
        console.error('Django API call failed:', error);
        
        let errorText = 'Backend API call failed. Is the Django/Ollama server running?';
        if (error.error && error.error.error) {
           errorText = `Error from AI Server: ${error.error.error}`;
        }

        return of({
          message: `⚠️ **Error Code Sync**\n\n${errorText}\n\n*If you uploaded an image, ensure your Ollama instance supports the selected Vision model.*`,
          html: ''
        });
      })
    );
  }

  stopGeneration(): Observable<any> {
    return this.http.post(this.stopUrl, {}).pipe(
      catchError(() => of({ message: 'Stop signal sent.' }))
    );
  }

  getModels(): Observable<ModelsResponse> {
    return this.http.get<ModelsResponse>(this.modelsUrl).pipe(
      catchError(error => {
        console.error('Failed to fetch models:', error);
        return of({ models: ['deepseek-coder:6.7b'], cloud_models: [], local_models: ['deepseek-coder:6.7b'] }); // Fallback
      })
    );
  }
}
