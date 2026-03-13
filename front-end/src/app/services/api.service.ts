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
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = 'http://127.0.0.1:8000/api/generate/';
  private stopUrl = 'http://127.0.0.1:8000/api/stop/';
  private modelsUrl = 'http://127.0.0.1:8000/api/models/';

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

  getModels(): Observable<{ models: string[] }> {
    return this.http.get<{ models: string[] }>(this.modelsUrl).pipe(
      catchError(error => {
        console.error('Failed to fetch models:', error);
        return of({ models: ['deepseek-coder:6.7b'] }); // Fallback
      })
    );
  }
}
