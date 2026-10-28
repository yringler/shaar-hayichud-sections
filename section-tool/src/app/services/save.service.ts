import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { gitBlobSha } from './base-version';

interface SaveResponse {
  commitSha: string;
  /** Git blob sha of the saved file: the base version for the next save. */
  contentSha?: string;
}

export type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

@Injectable({ providedIn: 'root' })
export class SaveService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  readonly status = signal<SaveStatus>('idle');
  readonly errorMessage = signal<string | null>(null);

  /**
   * Save `content` to `path`. `baseSha` is the git blob sha of the version
   * the editor loaded (null for new content); the server refuses the save if
   * the file has changed since. Resolves to the saved file's blob sha (the
   * next save's base), or null if the save failed.
   */
  async save(path: string, content: string, message: string, baseSha: string | null = null): Promise<string | null> {
    this.status.set('saving');
    this.errorMessage.set(null);

    try {
      const saved = await this.attemptSave(path, content, message, baseSha);
      this.status.set('success');
      setTimeout(() => this.status.set('idle'), 3000);
      return saved;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        // Clear stored password and re-prompt
        this.auth.clearPassword();
        this.auth.promptForPassword();
        // Retry once
        try {
          const saved = await this.attemptSave(path, content, message, baseSha);
          this.status.set('success');
          setTimeout(() => this.status.set('idle'), 3000);
          return saved;
        } catch (retryErr) {
          this.status.set('error');
          this.errorMessage.set(this.extractError(retryErr));
        }
      } else {
        this.status.set('error');
        this.errorMessage.set(this.extractError(err));
      }
      return null;
    }
  }

  private async attemptSave(path: string, content: string, message: string, baseSha: string | null): Promise<string> {
    const password = this.auth.getPassword();
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${password}`,
    });
    const url = `${environment.saveApiBaseUrl}/api/save`;
    const body = baseSha ? { path, content, message, baseSha } : { path, content, message };
    const response = await firstValueFrom(this.http.post<SaveResponse>(url, body, { headers }));
    return response?.contentSha ?? (await gitBlobSha(content));
  }

  private extractError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return (err.error as { error?: string })?.error || err.message;
    }
    return err instanceof Error ? err.message : 'Unknown error';
  }
}
