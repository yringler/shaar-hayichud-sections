/**
 * The offline-mode HTTP server: serves the built Angular app, the chapter
 * files of the local checkout (same contract as the Hugo site's /texts/), and
 * POST /api/save through the shared handleSave with a local SaveStore.
 * Localhost only: requests must carry a localhost Host header, and saves a
 * localhost Origin (when present). Node only.
 */
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

import { handleSave } from '../src/save-api/handle-save';
import { SaveStore } from '../src/save-api/save-store';

export interface LocalServerOptions {
  /** The Angular build output (the directory holding index.html). */
  distDir: string;
  /** The checkout's data/chapters/ directory, served at /texts/. */
  chaptersDir: string;
  store: SaveStore;
  /** Largest accepted /api/save body; default 10 MiB. */
  maxBodyBytes?: number;
}

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const JSON_TYPE = 'application/json; charset=utf-8';
const CHAPTER_FILE = /^[A-Za-z0-9_-]+\.json$/;
const DEFAULT_MAX_BODY = 10 * 1024 * 1024;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache',
};

/** A body that exceeded maxBodyBytes. */
class BodyTooLarge extends Error {}

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: string | Uint8Array,
  contentType: string,
  extra: Record<string, string> = {},
): void {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, {
    ...BASE_HEADERS,
    ...extra,
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

function sendJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  send(req, res, status, JSON.stringify(body), JSON_TYPE, extra);
}

function isGetOrHead(req: http.IncomingMessage): boolean {
  return req.method === 'GET' || req.method === 'HEAD';
}

function methodNotAllowed(req: http.IncomingMessage, res: http.ServerResponse, allow: string): void {
  sendJson(req, res, 405, { error: 'Method not allowed' }, { Allow: allow });
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** decodeURIComponent, or null when the escape sequences are malformed. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

export function createLocalServer(opts: LocalServerOptions): http.Server {
  const distDir = path.resolve(opts.distDir);
  const chaptersDir = path.resolve(opts.chaptersDir);
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const { store } = opts;

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`request failed: ${message}`);
      if (!res.headersSent) {
        sendJson(req, res, 500, { error: 'Internal server error' });
      } else {
        res.destroy();
      }
    });
  });

  function localPort(): number {
    return (server.address() as AddressInfo).port;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const port = localPort();
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      sendJson(req, res, 403, { error: 'Forbidden host' });
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendJson(req, res, 400, { error: 'Bad request' });
      return;
    }

    if (pathname === '/api/save') {
      await handleSaveRoute(req, res, host);
      return;
    }
    if (pathname === '/texts/index.json') {
      await handleIndex(req, res);
      return;
    }
    if (pathname.startsWith('/texts/')) {
      await handleChapter(req, res, pathname.slice('/texts/'.length));
      return;
    }
    await handleStatic(req, res, pathname);
  }

  async function handleSaveRoute(req: http.IncomingMessage, res: http.ServerResponse, host: string): Promise<void> {
    if (req.method !== 'POST') {
      methodNotAllowed(req, res, 'POST');
      return;
    }
    const mediaType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      sendJson(req, res, 415, { error: 'Expected Content-Type: application/json' });
      return;
    }
    const origin = req.headers.origin;
    const port = localPort();
    if (origin !== undefined && origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) {
      sendJson(req, res, 403, { error: 'Forbidden origin' });
      return;
    }

    let body: Buffer;
    try {
      body = await readBody(req, maxBodyBytes);
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        // Answer, then drop the connection so the rest of the body is not read.
        res.on('finish', () => req.destroy());
        sendJson(req, res, 413, { error: 'Request body too large' }, { Connection: 'close' });
        return;
      }
      throw err;
    }

    const request = new Request(`http://${host}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array(body),
    });
    const response = await handleSave(request, store, { apiSecret: null });
    const text = await response.text();

    if (response.ok) {
      const { commitSha } = JSON.parse(text) as { commitSha?: string };
      console.log(`saved ${savedPath(body)} → ${commitSha ?? ''}`);
    } else {
      let error = text;
      try {
        error = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        // Keep the raw text.
      }
      console.error(`save failed ${response.status}: ${error}`);
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key !== 'content-type' && key !== 'content-length') headers[key] = value;
    });
    send(req, res, response.status, text, response.headers.get('content-type') ?? JSON_TYPE, headers);
  }

  async function handleIndex(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!isGetOrHead(req)) {
      methodNotAllowed(req, res, 'GET, HEAD');
      return;
    }
    const entries = await readdir(chaptersDir, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'index.json')
      .map((e) => e.name)
      .sort();
    const body = JSON.stringify(
      names.map((f) => ({ file: f, url: `/texts/${f}` })),
      null,
      2,
    );
    send(req, res, 200, body, JSON_TYPE);
  }

  async function handleChapter(req: http.IncomingMessage, res: http.ServerResponse, rest: string): Promise<void> {
    if (!isGetOrHead(req)) {
      methodNotAllowed(req, res, 'GET, HEAD');
      return;
    }
    const name = safeDecode(rest);
    if (name === null) {
      sendJson(req, res, 400, { error: 'Bad request' });
      return;
    }
    if (!CHAPTER_FILE.test(name)) {
      sendJson(req, res, 404, { error: 'Not found' });
      return;
    }
    const abs = path.join(chaptersDir, name);
    if (path.dirname(abs) !== chaptersDir) {
      sendJson(req, res, 404, { error: 'Not found' });
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(abs);
    } catch (err) {
      if (isNotFound(err) || (err as NodeJS.ErrnoException).code === 'EISDIR') {
        sendJson(req, res, 404, { error: 'Not found' });
        return;
      }
      throw err;
    }
    send(req, res, 200, bytes, JSON_TYPE);
  }

  async function handleStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    if (!isGetOrHead(req)) {
      methodNotAllowed(req, res, 'GET, HEAD');
      return;
    }
    const decoded = safeDecode(pathname);
    if (decoded === null) {
      sendJson(req, res, 400, { error: 'Bad request' });
      return;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) {
      sendJson(req, res, 404, { error: 'Not found' });
      return;
    }
    const abs = path.resolve(distDir, '.' + decoded);
    if (abs !== distDir && !abs.startsWith(distDir + path.sep)) {
      sendJson(req, res, 404, { error: 'Not found' });
      return;
    }

    if (await isFile(abs)) {
      const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
      send(req, res, 200, await readFile(abs), type);
      return;
    }

    const lastSegment = decoded.split('/').pop() ?? '';
    if (path.extname(lastSegment) !== '') {
      sendJson(req, res, 404, { error: 'Not found' });
      return;
    }
    // SPA fallback: client-side routes get the app shell.
    send(req, res, 200, await readFile(path.join(distDir, 'index.html')), MIME['.html']);
  }

  return server;
}

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isFile();
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** The `path` field of a save body, for logging only. */
function savedPath(body: Buffer): string {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { path?: unknown };
    return typeof parsed.path === 'string' ? parsed.path : '?';
  } catch {
    return '?';
  }
}
