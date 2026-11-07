import { checkChapterJson } from '../app/editor/chapter-check';
import { staleBaseError } from '../app/services/base-version';
import { SaveStore, StoreError } from './save-store';

/** The body of POST /api/save. */
export interface SaveRequestBody {
  path: string;
  content: string;
  message: string;
  /**
   * Git blob sha of the JSON the editor loaded. When given, the save is
   * refused (409) if the file has changed since; see base-version.ts.
   */
  baseSha?: string;
}

export interface HandleSaveOptions {
  /**
   * null: no auth (the local offline server). Any string, even '': require
   * `Authorization: Bearer <non-empty token>` equal to it, so an unset Pages
   * secret fails closed.
   */
  apiSecret: string | null;
  /** Added to every response (the Pages function's CORS headers). */
  headers?: Record<string, string>;
}

/**
 * Chapter files live in the monorepo's data/chapters/ (the single source of
 * truth that the site and the published /data/v1/ JSON are built from).
 * Only chapter files may be written. The pre-move client path
 * 'hugo/chapters/<file>' is still accepted for editors running a cached build.
 */
export function resolveChapterPath(path: string): string | null {
  const m = /^(?:data\/chapters|hugo\/chapters)\/(chapter_\d+\.json)$/.exec(path);
  return m ? `data/chapters/${m[1]}` : null;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * The one save implementation: auth, body and path validation, the chapter
 * structure check, the stale-base check and the response shape. The Pages
 * function and the local server are thin adapters that pass a SaveStore.
 */
export async function handleSave(request: Request, store: SaveStore, options: HandleSaveOptions): Promise<Response> {
  const headers = options.headers ?? {};

  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' }, headers);
  }

  if (options.apiSecret !== null) {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || token !== options.apiSecret) {
      return json(401, { error: 'Unauthorized' }, headers);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' }, headers);
  }

  const fields = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { path, content, message, baseSha } = fields;
  if (!isNonEmptyString(path) || !isNonEmptyString(content) || !isNonEmptyString(message)) {
    return json(400, { error: 'Missing required fields: path, content, message' }, headers);
  }
  if (baseSha !== undefined && baseSha !== null && typeof baseSha !== 'string') {
    return json(400, { error: 'Invalid baseSha: expected a string' }, headers);
  }

  const repoPath = resolveChapterPath(path);
  if (!repoPath) {
    return json(400, { error: 'Invalid path: expected data/chapters/chapter_NN.json' }, headers);
  }
  // Cheap structural check (line objects with valid, unique ids); the data
  // build does the full schema and corpus-wide checks.
  const problems = checkChapterJson(content);
  if (problems.length > 0) {
    return json(400, { error: `Invalid chapter content: ${problems.join('; ')}` }, headers);
  }

  try {
    const current = await store.currentSha(repoPath);
    const stale = staleBaseError(baseSha, current ?? undefined);
    if (stale) {
      return json(409, { error: stale }, headers);
    }
    const result = await store.write(repoPath, content, message, current);
    return json(200, { commitSha: result.commitSha, contentSha: result.contentSha }, headers);
  } catch (e) {
    if (e instanceof StoreError) {
      return json(e.status, { error: e.message }, headers);
    }
    const msg = e instanceof Error ? e.message : '';
    return json(500, { error: msg || 'Save failed' }, headers);
  }
}
