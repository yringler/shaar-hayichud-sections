import { Injectable } from '@angular/core';

const STORAGE_KEY = 'editor_api_password';

@Injectable({ providedIn: 'root' })
export class AuthService {
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
