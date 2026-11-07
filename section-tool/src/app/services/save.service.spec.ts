import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { SaveService } from './save.service';

/** Records password calls instead of touching window.prompt or localStorage. */
class StubAuthService {
  required = true;
  password = 'first';
  prompts = 0;
  clears = 0;

  getPassword(): string {
    return this.password;
  }

  clearPassword(): void {
    this.clears++;
  }

  promptForPassword(): void {
    this.prompts++;
    this.password = 'second';
  }
}

const SAVE_URL = `${environment.saveApiBaseUrl}/api/save`;
const PATH = 'data/chapters/chapter_01.json';
const CONTENT = '[]';

/** Let pending promise continuations (e.g. the retry after a 401) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('SaveService', () => {
  let auth: StubAuthService;
  let http: HttpTestingController;
  let service: SaveService;

  beforeEach(() => {
    auth = new StubAuthService();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: auth }],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SaveService);
  });

  afterEach(() => http.verify());

  function expectSave(): TestRequest {
    const req = http.expectOne(SAVE_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Content-Type')).toBe('application/json');
    return req;
  }

  describe('without auth (offline)', () => {
    beforeEach(() => {
      auth.required = false;
    });

    it('sends no Authorization header and returns the contentSha', async () => {
      const result = service.save(PATH, CONTENT, 'msg', 'base1');
      const req = expectSave();
      expect(req.request.headers.has('Authorization')).toBe(false);
      expect(req.request.body).toEqual({ path: PATH, content: CONTENT, message: 'msg', baseSha: 'base1' });
      req.flush({ commitSha: 'c1', contentSha: 'next' });

      expect(await result).toBe('next');
      expect(service.status()).toBe('success');
      expect(auth.prompts).toBe(0);
    });

    it('does not prompt or retry on 401', async () => {
      const result = service.save(PATH, CONTENT, 'msg');
      const req = expectSave();
      expect(req.request.body).toEqual({ path: PATH, content: CONTENT, message: 'msg' });
      req.flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      expect(await result).toBeNull();
      http.expectNone(SAVE_URL);
      expect(auth.prompts).toBe(0);
      expect(auth.clears).toBe(0);
      expect(service.status()).toBe('error');
      expect(service.errorMessage()).toBe('Unauthorized');
    });
  });

  describe('with auth', () => {
    it('sends the password as a Bearer token', async () => {
      const result = service.save(PATH, CONTENT, 'msg');
      const req = expectSave();
      expect(req.request.headers.get('Authorization')).toBe('Bearer first');
      req.flush({ commitSha: 'c1', contentSha: 'next' });

      expect(await result).toBe('next');
      expect(auth.prompts).toBe(0);
    });

    it('re-prompts once on 401 and retries with the new password', async () => {
      const result = service.save(PATH, CONTENT, 'msg');
      expectSave().flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
      await settle();

      const retry = expectSave();
      expect(retry.request.headers.get('Authorization')).toBe('Bearer second');
      retry.flush({ commitSha: 'c2', contentSha: 'after-retry' });

      expect(await result).toBe('after-retry');
      expect(auth.clears).toBe(1);
      expect(auth.prompts).toBe(1);
      expect(service.status()).toBe('success');
    });

    it('gives up after a second 401', async () => {
      const result = service.save(PATH, CONTENT, 'msg');
      expectSave().flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
      await settle();
      expectSave().flush({ error: 'Still no' }, { status: 401, statusText: 'Unauthorized' });

      expect(await result).toBeNull();
      expect(auth.prompts).toBe(1);
      expect(service.status()).toBe('error');
      expect(service.errorMessage()).toBe('Still no');
    });
  });
});
