import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

const STORAGE_KEY = 'editor_api_password';

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Whether saves need the editor password (false in the offline build, whose local server has no auth). */
  readonly required: boolean = environment.requireAuth;

  private password: string | null = localStorage.getItem(STORAGE_KEY);

  getPassword(): string {
    if (!this.password) {
      this.promptForPassword();
    }
    return this.password!;
  }

  clearPassword(): void {
    this.password = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  promptForPassword(): void {
    const entered = window.prompt('Enter editor password:');
    if (entered) {
      this.password = entered;
      localStorage.setItem(STORAGE_KEY, entered);
    }
  }
}
