import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

interface SaveResponse {
  commitSha: string;
}

export type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

@Injectable({ providedIn: 'root' })
export class SaveService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  readonly status = signal<SaveStatus>('idle');
  readonly errorMessage = signal<string | null>(null);

  async save(path: string, content: string, message: string): Promise<void> {
    this.status.set('saving');
    this.errorMessage.set(null);

    try {
      await this.attemptSave(path, content, message);
      this.status.set('success');
      setTimeout(() => this.status.set('idle'), 3000);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        // Clear stored password and re-prompt
        this.auth.clearPassword();
        this.auth.promptForPassword();
        // Retry once
        try {
          await this.attemptSave(path, content, message);
          this.status.set('success');
          setTimeout(() => this.status.set('idle'), 3000);
        } catch (retryErr) {
          this.status.set('error');
          this.errorMessage.set(this.extractError(retryErr));
        }
      } else {
        this.status.set('error');
        this.errorMessage.set(this.extractError(err));
      }
    }
  }

  private async attemptSave(path: string, content: string, message: string): Promise<void> {
    const password = this.auth.getPassword();
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${password}`,
    });
    const url = `${environment.saveApiBaseUrl}/api/save`;
    await firstValueFrom(
      this.http.post<SaveResponse>(url, { path, content, message }, { headers }),
    );
  }

  private extractError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return (err.error as { error?: string })?.error || err.message;
    }
    return err instanceof Error ? err.message : 'Unknown error';
  }
}
