import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { SaveResult, SaveStore } from '../src/save-api/save-store';
import { createLocalServer } from './local-server';

const SECRET = 'TOP-SECRET-DO-NOT-LEAK';
const HEBREW_CHAPTER = '[\n  {\n    "children": [{ "id": "abcdefgh", "text": "שער היחוד והאמונה" }]\n  }\n]\n';
const VALID_CONTENT = JSON.stringify([{ children: [{ id: 'abcdefgh', text: 'x' }] }]);

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Host header; defaults to 127.0.0.1:<port>. */
  host?: string;
}

class FakeStore implements SaveStore {
  writes: { repoPath: string; content: string; message: string; expectedSha: string | null }[] = [];
  currentShaCalls = 0;

  async currentSha(): Promise<string | null> {
    this.currentShaCalls++;
    return null;
  }

  async write(repoPath: string, content: string, message: string, expectedSha: string | null): Promise<SaveResult> {
    this.writes.push({ repoPath, content, message, expectedSha });
    return { commitSha: 'c0ffee', contentSha: 'beef' };
  }
}

describe('createLocalServer', () => {
  let root: string;
  let distDir: string;
  let chaptersDir: string;
  let store: FakeStore;
  let server: http.Server;
  let port: number;

  function request(urlPath: string, opts: RequestOptions = {}): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: opts.method ?? 'GET',
          path: urlPath,
          headers: { Host: opts.host ?? `127.0.0.1:${port}`, ...(opts.headers ?? {}) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (opts.body !== undefined) req.write(opts.body);
      req.end();
    });
  }

  function save(body: unknown, headers: Record<string, string> = {}): Promise<RawResponse> {
    return request('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  const validSave = { path: 'data/chapters/chapter_01.json', content: VALID_CONTENT, message: 'Update chapter 1' };

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'local-server-'));
    writeFileSync(path.join(root, 'secret.txt'), SECRET);
    distDir = path.join(root, 'dist');
    chaptersDir = path.join(root, 'chapters');
    mkdirSync(distDir);
    mkdirSync(chaptersDir);
    writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(path.join(distDir, 'main-abc.js'), 'console.log(1);');
    writeFileSync(path.join(chaptersDir, 'chapter_02.json'), '[]\n');
    writeFileSync(path.join(chaptersDir, 'chapter_01.json'), HEBREW_CHAPTER);
    writeFileSync(path.join(chaptersDir, 'notes.txt'), 'notes');
    store = new FakeStore();
    server = createLocalServer({ distDir, chaptersDir, store, maxBodyBytes: 4096 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  describe('chapters', () => {
    it('lists chapter files sorted, without non-JSON files', async () => {
      const res = await request('/texts/index.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(JSON.parse(res.body.toString('utf8'))).toEqual([
        { file: 'chapter_01.json', url: '/texts/chapter_01.json' },
        { file: 'chapter_02.json', url: '/texts/chapter_02.json' },
      ]);
    });

    it('serves a chapter byte for byte', async () => {
      const res = await request('/texts/chapter_01.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.body.equals(readFileSync(path.join(chaptersDir, 'chapter_01.json')))).toBe(true);
    });

    it('answers HEAD with headers only', async () => {
      const res = await request('/texts/chapter_01.json', { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });

    it('404s missing chapters and non-JSON files', async () => {
      expect((await request('/texts/chapter_99.json')).status).toBe(404);
      expect((await request('/texts/notes.txt')).status).toBe(404);
    });

    it('rejects writes to /texts/', async () => {
      expect((await request('/texts/chapter_01.json', { method: 'POST', body: 'x' })).status).toBe(405);
    });
  });

  describe('path traversal', () => {
    const attempts = [
      '/texts/../secret.txt',
      '/texts/..%2Fsecret.txt',
      '/texts/%2e%2e%2fsecret.txt',
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e%5csecret.txt',
      '/texts/%E0%A4%A',
      '/%E0%A4%A',
      '/main-abc.js%00.html',
    ];
    for (const attempt of attempts) {
      it(`does not serve ${attempt}`, async () => {
        const res = await request(attempt);
        expect(res.status).not.toBe(200);
        expect(res.body.toString('utf8')).not.toContain(SECRET);
      });
    }
  });

  describe('static files', () => {
    it('serves files with their MIME type', async () => {
      const res = await request('/main-abc.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(res.body.toString('utf8')).toBe('console.log(1);');
    });

    it('falls back to index.html for / and app routes', async () => {
      for (const route of ['/', '/some/route']) {
        const res = await request(route);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(res.body.toString('utf8')).toContain('<title>app</title>');
      }
    });

    it('404s missing files that have an extension', async () => {
      expect((await request('/missing.js')).status).toBe(404);
    });

    it('sets nosniff and no-cache', async () => {
      const res = await request('/main-abc.js');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-cache');
    });
  });

  describe('host check', () => {
    it('accepts localhost and 127.0.0.1', async () => {
      expect((await request('/', { host: `localhost:${port}` })).status).toBe(200);
      expect((await request('/', { host: `127.0.0.1:${port}` })).status).toBe(200);
    });

    it('rejects other hosts (DNS rebinding)', async () => {
      expect((await request('/', { host: `evil.example:${port}` })).status).toBe(403);
      expect((await request('/texts/index.json', { host: 'localhost' })).status).toBe(403);
      const res = await save(validSave, { Host: `evil.example:${port}` });
      expect(res.status).toBe(403);
      expect(store.writes).toEqual([]);
    });
  });

  describe('/api/save', () => {
    it('saves without an Authorization header and without an Origin', async () => {
      const res = await save(validSave);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body.toString('utf8'))).toEqual({ commitSha: 'c0ffee', contentSha: 'beef' });
      expect(store.writes).toEqual([
        { repoPath: 'data/chapters/chapter_01.json', content: VALID_CONTENT, message: 'Update chapter 1', expectedSha: null },
      ]);
    });

    it('accepts a localhost Origin and a charset parameter', async () => {
      const res = await save(validSave, {
        Origin: `http://localhost:${port}`,
        'Content-Type': 'Application/JSON; charset=utf-8',
      });
      expect(res.status).toBe(200);
      expect((await save(validSave, { Origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    });

    it('rejects a foreign Origin before touching the store', async () => {
      const res = await save(validSave, { Origin: 'http://evil.example' });
      expect(res.status).toBe(403);
      expect(store.writes).toEqual([]);
      expect(store.currentShaCalls).toBe(0);
    });

    it('rejects non-JSON content types (no simple cross-site form posts)', async () => {
      const res = await save(validSave, { 'Content-Type': 'text/plain' });
      expect(res.status).toBe(415);
      expect(store.writes).toEqual([]);
    });

    it('rejects other methods, including OPTIONS (no CORS)', async () => {
      const options = await request('/api/save', { method: 'OPTIONS' });
      expect(options.status).toBe(405);
      expect(options.headers['allow']).toBe('POST');
      expect((await request('/api/save')).status).toBe(405);
    });

    it('rejects bodies over the limit', async () => {
      const big = { ...validSave, content: 'x'.repeat(10_000) };
      const res = await save(big);
      expect(res.status).toBe(413);
      expect(store.writes).toEqual([]);
    });

    it('passes handleSave validation errors through', async () => {
      const res = await save({ ...validSave, path: 'data/chapters/../x.json' });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body.toString('utf8')).error).toContain('Invalid path');
    });

    it('never sends CORS headers', async () => {
      const responses = await Promise.all([
        save(validSave, { Origin: `http://localhost:${port}` }),
        request('/api/save', { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } }),
        request('/texts/index.json', { headers: { Origin: 'http://evil.example' } }),
        request('/', { headers: { Origin: 'http://evil.example' } }),
      ]);
      for (const res of responses) {
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
    });
  });
});
