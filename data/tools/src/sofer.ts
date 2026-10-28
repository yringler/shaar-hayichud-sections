/**
 * Minimal Sofer.ai REST client (https://docs.sofer.ai): folders, transcription
 * create / status / result, documents. `fetch` is injected so the dedup and
 * folder logic can be tested without the network.
 */

export const SOFER_API_BASE = 'https://api.sofer.ai';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SoferFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface SoferDocument {
  id: string;
  type: string;
  title: string;
  folder_id?: string | null;
  status: string;
  archived?: boolean;
}

export type SoferStatus =
  | 'RECEIVED'
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'UPLOADED'
  | 'INSUFFICIENT_FUNDS';

/** Statuses after which a transcription will never complete. */
export const DEAD_STATUSES: ReadonlySet<string> = new Set(['CANCELLED', 'FAILED', 'INSUFFICIENT_FUNDS']);

export interface SoferBalance {
  total_balance: number;
  available_balance: number;
  pending_balance: number;
  all_time_spend: number;
}

export class SoferError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class SoferClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch,
    private readonly base = SOFER_API_BASE,
    private readonly retries = 3,
    private readonly retryDelayMs = 2000,
  ) {
    if (!apiKey) throw new Error('Sofer API key is empty');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    // GETs are retried on 5xx / 429 (the API returns transient 500s); writes are not, to never submit twice.
    const attempts = method === 'GET' ? this.retries + 1 : 1;
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchFn(`${this.base}${path}`, init);
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : null) as T;
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable || attempt >= attempts) {
        throw new SoferError(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      await new Promise((r) => setTimeout(r, this.retryDelayMs * 2 ** (attempt - 1)));
    }
  }

  balance(): Promise<SoferBalance> {
    return this.request('GET', '/v1/balance/');
  }

  /** Children of `parentId` (root folders when null). Follows pagination. */
  async listFolders(parentId: string | null): Promise<SoferFolder[]> {
    const out: SoferFolder[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ limit: '100' });
      if (parentId) q.set('parent_id', parentId);
      if (cursor) q.set('cursor', cursor);
      const page: { folders: SoferFolder[]; next_cursor?: string | null } = await this.request(
        'GET',
        `/v1/folders/?${q}`,
      );
      out.push(...page.folders);
      cursor = page.next_cursor ?? null;
    } while (cursor);
    // Without parent_id the API lists every folder; keep only roots.
    return out.filter((f) => (f.parent_id ?? null) === parentId);
  }

  createFolder(name: string, parentId: string | null): Promise<SoferFolder> {
    return this.request('POST', '/v1/folders/', parentId ? { name, parent_id: parentId } : { name });
  }

  /** Transcript documents directly inside a folder. Follows pagination. */
  async listFolderTranscripts(folderId: string): Promise<SoferDocument[]> {
    const out: SoferDocument[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ limit: '100', type: 'transcript' });
      if (cursor) q.set('cursor', cursor);
      const page: { documents: SoferDocument[]; next_cursor?: string | null } = await this.request(
        'GET',
        `/v1/folders/${folderId}/documents?${q}`,
      );
      out.push(...page.documents);
      cursor = page.next_cursor ?? null;
    } while (cursor);
    return out;
  }

  /** Every transcription the account owns (no filtering or paging in the API). */
  listTranscriptions(): Promise<{ id: string; title: string; folder_id?: string | null; status: string }[]> {
    return this.request('GET', '/v1/transcriptions/');
  }

  moveDocument(documentId: string, folderId: string | null): Promise<SoferDocument> {
    return this.request('PATCH', `/v1/documents/${documentId}`, { folder_id: folderId });
  }

  /** Returns the new transcription id. */
  async createTranscription(audioUrl: string, info: Record<string, unknown>): Promise<string> {
    const res: unknown = await this.request('POST', '/v1/transcriptions/', { audio_url: audioUrl, info });
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object') {
      const r = res as Record<string, unknown>;
      const id = r['transcription_id'] ?? r['id'];
      if (typeof id === 'string') return id;
    }
    throw new Error(`unexpected create-transcription response: ${JSON.stringify(res).slice(0, 200)}`);
  }

  async status(transcriptionId: string): Promise<string> {
    const res: { status: string } = await this.request('GET', `/v1/transcriptions/${transcriptionId}/status`);
    return res.status;
  }

  getTranscription<T>(transcriptionId: string): Promise<T> {
    return this.request('GET', `/v1/transcriptions/${transcriptionId}`);
  }
}

/**
 * Finds or creates each folder of `names` under the previous one (root
 * first) and returns the innermost folder id. Sibling names are unique
 * case-insensitively on Sofer, so they are matched that way.
 */
export async function ensureFolderPath(
  client: Pick<SoferClient, 'listFolders' | 'createFolder'>,
  names: string[],
  cache = new Map<string, string>(),
): Promise<string> {
  let parent: string | null = null;
  const key: string[] = [];
  for (const name of names) {
    key.push(name.toLowerCase());
    const cacheKey = key.join('\u0000');
    const cached = cache.get(cacheKey);
    if (cached) {
      parent = cached;
      continue;
    }
    const siblings = await client.listFolders(parent);
    const found = siblings.find((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase());
    const folder: SoferFolder = found ?? (await client.createFolder(name, parent));
    cache.set(cacheKey, folder.id);
    parent = folder.id;
  }
  if (parent === null) throw new Error('empty folder path');
  return parent;
}

/** A remote transcription whose title carries this lecture's id suffix, preferring live ones. */
export function pickExisting<T extends { title: string; status: string }>(items: T[], idSuffix: string): T | undefined {
  const mine = items.filter((d) => d.title.trim().endsWith(idSuffix));
  return mine.find((d) => d.status === 'COMPLETED') ?? mine.find((d) => !DEAD_STATUSES.has(d.status));
}
