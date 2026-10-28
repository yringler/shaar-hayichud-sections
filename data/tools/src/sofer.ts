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

/** id, title, folder and status of a transcription (GET /v1/transcriptions/ item). */
export interface TranscriptionSummary {
  id: string;
  title: string;
  folder_id?: string | null;
  status: string;
}

/** One item of a standard-mode batch manifest (BatchManifestAudioSource). */
export interface BatchManifestItem {
  audio_url: string;
  title: string;
  client_item_id: string;
  num_speakers?: number;
  auto_detect_speakers?: boolean;
}

/** POST / GET /v1/transcriptions/batch-files response (the POST names the id batch_file_id, the GET id). */
export interface BatchFile {
  batch_file_id?: string;
  id?: string;
  item_count: number;
  status: 'PENDING_VALIDATION' | 'VALID' | 'INVALID' | string;
  validation_errors?: string[] | null;
}

export interface BatchCreated {
  batch_id: string;
  transcription_ids: string[];
  total_count: number;
  status: string;
}

export interface BatchStatusItem {
  id: string;
  client_item_id?: string | null;
  folder_id?: string | null;
  title: string;
  status: string;
}

export interface BatchStatusResponse {
  batch_id: string;
  status: 'RECEIVED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;
  total_count: number;
  completed_count?: number;
  failed_count?: number;
  pending_count?: number;
  transcriptions: BatchStatusItem[];
}

/** One topic of POST /v1/timestamps/outline (OutlineTopic). */
export interface OutlineTopic {
  title: string;
  starting_phrase: string;
  matched_text: string;
  score_norm: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  start_time_sec?: number | null;
  token_span?: number[] | null;
  matched_content?: number | null;
  content_coverage?: number | null;
  longest_content_run_soft?: number | null;
  longest_content_run_strict?: number | null;
  [extra: string]: unknown;
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

  /**
   * `retryRateLimit`: also retry a write that got HTTP 429 (the API rejected
   * it without acting on it). Only for writes that charge nothing and are
   * safe to repeat: document updates and manifest uploads. Creates that
   * start a paid transcription are never retried.
   */
  private async request<T>(method: string, path: string, body?: unknown, retryRateLimit = false): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    // GETs are retried on 5xx / 429 (the API returns transient 500s); writes are not, to never submit twice.
    const attempts = method === 'GET' || retryRateLimit ? this.retries + 1 : 1;
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchFn(`${this.base}${path}`, init);
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : null) as T;
      const retryable = method === 'GET' ? res.status >= 500 || res.status === 429 : res.status === 429;
      if (!retryable || attempt >= attempts) {
        throw new SoferError(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      // The API allows only a few requests per minute on some endpoints: wait longer after a 429.
      const delay = res.status === 429 ? this.retryDelayMs * 10 * attempt : this.retryDelayMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
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
  listTranscriptions(): Promise<TranscriptionSummary[]> {
    return this.request('GET', '/v1/transcriptions/');
  }

  /** Every folder in the account, at any depth. */
  async listAllFolders(): Promise<SoferFolder[]> {
    const out: SoferFolder[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ limit: '100' });
      if (cursor) q.set('cursor', cursor);
      const page: { folders: SoferFolder[]; next_cursor?: string | null } = await this.request('GET', `/v1/folders/?${q}`);
      out.push(...page.folders);
      cursor = page.next_cursor ?? null;
    } while (cursor);
    return out;
  }

  /**
   * Every transcription in the account, for dedup across folders: GET
   * /v1/transcriptions/, or, when that fails, every folder's transcripts.
   * On this account /v1/transcriptions/ always returns HTTP 500, and so does
   * paging /v1/documents/ past a certain old document, so the fallback walks
   * the folders. It misses transcriptions at the root, which this pipeline
   * never creates (it always submits with a folder_id).
   */
  async listAllTranscriptions(): Promise<TranscriptionSummary[]> {
    try {
      return await this.listTranscriptions();
    } catch (e) {
      if (!(e instanceof SoferError)) throw e;
    }
    const out: TranscriptionSummary[] = [];
    for (const f of await this.listAllFolders()) {
      for (const d of await this.listFolderTranscripts(f.id)) {
        out.push({ id: d.id, title: d.title, folder_id: d.folder_id ?? f.id, status: d.status });
      }
    }
    return out;
  }

  moveDocument(documentId: string, folderId: string | null): Promise<SoferDocument> {
    return this.request('PATCH', `/v1/documents/${documentId}`, { folder_id: folderId }, true);
  }

  /** PATCH /v1/documents/{id}: only the fields given change. Archiving also moves the document to the root. */
  updateDocument(
    documentId: string,
    fields: { title?: string; folder_id?: string | null; archived?: boolean },
  ): Promise<SoferDocument> {
    return this.request('PATCH', `/v1/documents/${documentId}`, fields, true);
  }

  /** POST /v1/transcriptions/batch-files: upload a standard-mode manifest (free; no transcription starts). */
  uploadBatchFile(items: BatchManifestItem[], metadata?: { title?: string; description?: string }): Promise<BatchFile> {
    return this.request('POST', '/v1/transcriptions/batch-files', {
      content_type: 'json',
      json_items: items,
      ...(metadata ? { metadata } : {}),
    }, true);
  }

  /** GET /v1/transcriptions/batch-files/{id}: manifest validation status. */
  getBatchFile(batchFileId: string): Promise<BatchFile> {
    return this.request('GET', `/v1/transcriptions/batch-files/${batchFileId}`);
  }

  /**
   * POST /v1/transcriptions/batch in standard mode: starts (and charges for)
   * every manifest item. Never retried, like every write.
   */
  createStandardBatch(batchFileId: string, info: Record<string, unknown>, batchTitle?: string): Promise<BatchCreated> {
    return this.request('POST', '/v1/transcriptions/batch', {
      processing_mode: 'standard',
      batch_file_id: batchFileId,
      ...(batchTitle ? { batch_title: batchTitle } : {}),
      info,
    });
  }

  /**
   * POST /v1/timestamps/outline: an LLM-generated topic outline of a finished
   * transcription, each topic aligned to a start time. A write (never retried):
   * the docs give no price, so it may be charged.
   */
  outline(transcriptionId: string, options: { monotone?: boolean; conclusion_bias?: boolean }): Promise<OutlineTopic[]> {
    return this.request('POST', '/v1/timestamps/outline', { transcription_id: transcriptionId, ...options });
  }

  /** GET /v1/transcriptions/batch/{id}/status: overall and per-item status (items carry client_item_id). */
  batchStatus(batchId: string): Promise<BatchStatusResponse> {
    return this.request('GET', `/v1/transcriptions/batch/${batchId}/status`);
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

/**
 * Where to get this lecture's transcription from: one already in its folder,
 * one elsewhere in the account (to be moved in), or a new submission. The
 * account-wide list is the only guard against paying twice for a lecture
 * submitted under another folder (an older catalog path, or a crash between
 * submitting and filing it), so when that list could not be fetched
 * (`account` null) it refuses to submit unless `allowUnlisted`.
 */
export function chooseSource<T extends { id: string; title: string; status: string }>(
  inFolder: T[],
  account: T[] | null,
  idSuffix: string,
  allowUnlisted = false,
): { kind: 'folder' | 'account'; doc: T } | { kind: 'submit' } {
  const here = pickExisting(inFolder, idSuffix);
  if (here) return { kind: 'folder', doc: here };
  if (account === null) {
    if (allowUnlisted) return { kind: 'submit' };
    throw new Error(
      'could not list account transcriptions to rule out a duplicate; rerun later, or pass --allow-unlisted to submit anyway',
    );
  }
  const elsewhere = pickExisting(account, idSuffix);
  return elsewhere ? { kind: 'account', doc: elsewhere } : { kind: 'submit' };
}
