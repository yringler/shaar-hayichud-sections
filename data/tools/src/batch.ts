/**
 * The `yarn transcribe` workflow: dedup, Sofer.ai standard-mode batches
 * (POST /v1/transcriptions/batch with an uploaded manifest), the local
 * batch state file that lets a crashed run resume by polling instead of
 * resubmitting, and writing the stored transcripts. The Sofer client is
 * injected, so all of it is tested without the network.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildMediaUrl } from './catalog.js';
import {
  chooseSource,
  DEAD_STATUSES,
  ensureFolderPath,
  SoferError,
  type BatchManifestItem,
  type BatchStatusItem,
  type BatchStatusResponse,
  type SoferClient,
  type TranscriptionSummary,
} from './sofer.js';
import {
  estimateCents,
  speakerFields,
  speakerSettingFor,
  type SeriesTranscriptionConfig,
  type SpeakerSetting,
  TRANSCRIPTION_SERIES,
} from './transcription-config.js';
import {
  folderPathFor,
  formatTranscript,
  soferTitleFor,
  titleIdSuffix,
  transcriptPath,
  type LectureContext,
  type SoferResult,
  type StoredTranscript,
} from './transcripts.js';

/** Most items Sofer accepts in one standard-mode manifest. */
export const MAX_BATCH_ITEMS = 500;

export type TranscribeClient = Pick<
  SoferClient,
  | 'balance'
  | 'listFolders'
  | 'createFolder'
  | 'listFolderTranscripts'
  | 'listAllTranscriptions'
  | 'moveDocument'
  | 'updateDocument'
  | 'createTranscription'
  | 'status'
  | 'getTranscription'
  | 'uploadBatchFile'
  | 'getBatchFile'
  | 'createStandardBatch'
  | 'batchStatus'
>;

// ---------------------------------------------------------------------------
// Batch state file
// ---------------------------------------------------------------------------

export interface BatchStateItem {
  lectureId: string;
  clientItemId: string;
  title: string;
  folderPath: string[];
  /** The lecture's own Sofer folder (the batch puts everything in the common ancestor). */
  folderId: string;
  audioUrl: string;
  /** Stored as `sofer.request` in the transcript. */
  request: Record<string, unknown>;
  /** Set once the item is finished: its transcript was written, or it ended dead. */
  done?: 'written' | 'failed';
}

export interface PendingBatch {
  batchFileId: string;
  /** Null while the create call is in flight; a state file left like that means its outcome is unknown. */
  batchId: string | null;
  createdAt: string;
  folderPath: string[];
  estimateCents: number;
  items: BatchStateItem[];
}

export interface BatchState {
  version: 1;
  batches: PendingBatch[];
}

export function loadState(file: string): BatchState {
  if (!existsSync(file)) return { version: 1, batches: [] };
  const s = JSON.parse(readFileSync(file, 'utf8')) as BatchState;
  if (s.version !== 1 || !Array.isArray(s.batches)) throw new Error(`${file}: unrecognised batch state`);
  return s;
}

/** Writes via a temporary file and rename, so a crash never leaves half a state file. */
export function saveState(file: string, state: BatchState): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Lecture ids that a known batch is still working on. */
export function pendingLectureIds(state: BatchState): Set<string> {
  const out = new Set<string>();
  for (const b of state.batches) {
    if (b.batchId === null) continue;
    for (const i of b.items) if (!i.done) out.add(i.lectureId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export interface SubmitItem {
  ctx: LectureContext;
  title: string;
  folderPath: string[];
  folderId: string;
  audioUrl: string;
  speakers: SpeakerSetting;
}

/** The manifest client_item_id: the catalog lecture id, unique in the catalog. */
export function clientItemIdFor(lectureId: string): string {
  return lectureId;
}

/** Standard-mode manifest items (BatchManifestAudioSource), with per-item title and speaker settings. */
export function buildManifest(
  items: { lectureId: string; audioUrl: string; title: string; speakers: SpeakerSetting }[],
): BatchManifestItem[] {
  if (items.length === 0) throw new Error('empty batch');
  if (items.length > MAX_BATCH_ITEMS) throw new Error(`a batch takes at most ${MAX_BATCH_ITEMS} items, got ${items.length}`);
  const seen = new Set<string>();
  return items.map((i) => {
    const client_item_id = clientItemIdFor(i.lectureId);
    if (seen.has(client_item_id)) throw new Error(`lecture ${i.lectureId} is twice in one batch`);
    seen.add(client_item_id);
    return { audio_url: i.audioUrl, title: i.title, client_item_id, ...speakerFields(i.speakers) };
  });
}

/** Longest common folder prefix (case-insensitive, like Sofer's sibling names). */
export function commonFolderPath(paths: string[][]): string[] {
  const [first, ...rest] = paths;
  if (!first) return [];
  let n = first.length;
  for (const p of rest) {
    let i = 0;
    while (i < n && i < p.length && p[i]!.trim().toLowerCase() === first[i]!.trim().toLowerCase()) i++;
    n = i;
  }
  return first.slice(0, n);
}

/** Groups submissions into batches: one per series (top-level folder), at most MAX_BATCH_ITEMS each. */
export function groupIntoBatches<T extends { folderPath: string[] }>(items: T[]): T[][] {
  const bySeries = new Map<string, T[]>();
  for (const i of items) {
    const key = (i.folderPath[0] ?? '').trim().toLowerCase();
    const g = bySeries.get(key) ?? [];
    g.push(i);
    bySeries.set(key, g);
  }
  const out: T[][] = [];
  for (const g of bySeries.values()) for (let i = 0; i < g.length; i += MAX_BATCH_ITEMS) out.push(g.slice(i, i + MAX_BATCH_ITEMS));
  return out;
}

/** The status entry for a state item: by client_item_id, else by the title's id suffix. */
export function findBatchItem(status: BatchStatusResponse, item: BatchStateItem): BatchStatusItem | undefined {
  const items = status.transcriptions ?? [];
  return (
    items.find((t) => t.client_item_id === item.clientItemId) ??
    items.find((t) => t.title.trim().endsWith(titleIdSuffix(item.lectureId)))
  );
}

/** Title for a superseded transcription: no longer ends with "[<id>]", so dedup ignores it. */
export function supersededTitle(title: string, date: string): string {
  return `${title} (superseded ${date})`;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Re-fetch the Sofer transcription a committed transcript came from; never submits. */
  force: boolean;
  /** Supersede the committed transcript's Sofer transcription and submit anew (paid). */
  resubmit: boolean;
  allowUnlisted: boolean;
  /** Submit each file on its own (POST /v1/transcriptions/, $1.50/h) instead of a standard batch ($1.00/h). */
  single: boolean;
  dryRun: boolean;
  model: string;
  language: string;
  cdnBase: string;
}

export interface RunDeps {
  client: TranscribeClient;
  dataDir: string;
  statePath: string;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  pollMs: number;
  timeoutMs: number;
  /** Manifest validation wait. */
  manifestTimeoutMs?: number;
  config?: readonly SeriesTranscriptionConfig[];
}

export interface RunResult {
  failures: number;
  /** Lectures still processing in a batch when the run stopped waiting. */
  pending: number;
  /** Lectures put into new batches by this run. */
  submitted: string[];
}

export class Transcriber {
  private readonly client: TranscribeClient;
  private readonly log: (m: string) => void;
  private readonly warn: (m: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly folderCache = new Map<string, string>();
  private accountList: TranscriptionSummary[] | undefined;
  private failures = 0;

  constructor(private readonly deps: RunDeps) {
    this.client = deps.client;
    this.log = deps.log ?? console.log;
    this.warn = deps.warn ?? console.warn;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? (() => new Date());
  }

  private get config() {
    return this.deps.config ?? TRANSCRIPTION_SERIES;
  }

  /** Resume known batches, then process `todo`, then wait for every batch. */
  async run(todo: LectureContext[], opts: RunOptions): Promise<RunResult> {
    const state = loadState(this.deps.statePath);
    this.dropUnknownBatches(state);
    const pending = pendingLectureIds(state);
    if (pending.size > 0 && !opts.dryRun) {
      this.log(`Resuming ${state.batches.length} batch(es) from ${this.deps.statePath} (${pending.size} lecture(s) pending).`);
      await this.pollOnce(state);
    }

    const submit: SubmitItem[] = [];
    for (const ctx of todo) {
      const id = ctx.lecture.id;
      this.log(id);
      if (pendingLectureIds(state).has(id)) {
        this.log('  already in a submitted batch; polling it instead of submitting');
        continue;
      }
      try {
        const item = await this.prepare(ctx, opts);
        if (item) submit.push(item);
      } catch (e) {
        this.failures += 1;
        this.warn(`  error: ${(e as Error).message}`);
      }
    }

    const submitted: string[] = [];
    if (submit.length > 0 && this.failures > 0 && !opts.dryRun) {
      // Never send a partial batch: rerunning after the error is free, and keeps the selection in one batch.
      this.warn(`Not submitting the ${submit.length} other lecture(s): fix the error(s) above and rerun.`);
      submit.length = 0;
    }
    if (submit.length > 0 && opts.dryRun) {
      const cents = submit.reduce((s, i) => s + this.estimate(i, opts), 0);
      this.log(
        `dry run: would submit ${submit.length} lecture(s) ${opts.single ? 'one by one' : `in ${groupIntoBatches(submit).length} standard batch(es)`}, ~${cents}c`,
      );
    } else if (submit.length > 0) {
      try {
        if (opts.single) await this.submitSingles(submit, opts);
        else submitted.push(...(await this.submitBatches(submit, opts, state)));
      } catch (e) {
        this.failures += 1;
        this.warn(`error: ${(e as Error).message}`);
      }
    }

    let stillPending = 0;
    if (!opts.dryRun) stillPending = await this.waitForBatches(state);
    return { failures: this.failures, pending: stillPending, submitted };
  }

  private estimate(i: SubmitItem, opts: RunOptions): number {
    return estimateCents(i.ctx.lecture.durationSeconds, i.speakers, opts.model, opts.single ? 'single' : 'batch');
  }

  /** A batch whose create call never recorded an id: its outcome is unknown, so it is dropped and dedup decides. */
  private dropUnknownBatches(state: BatchState): void {
    const unknown = state.batches.filter((b) => b.batchId === null);
    if (unknown.length === 0) return;
    for (const b of unknown) {
      this.warn(
        `warning: a batch of ${b.items.length} item(s) (manifest ${b.batchFileId}) was being created when a run stopped; ` +
          'its outcome is unknown. Dropping it from the state; the Sofer folder listing will find any transcription it created.',
      );
    }
    state.batches = state.batches.filter((b) => b.batchId !== null);
    saveState(this.deps.statePath, state);
  }

  private baseInfo(opts: RunOptions): Record<string, unknown> {
    return {
      model: opts.model,
      primary_language: opts.language,
      // Hebrew words in Hebrew letters, so the read-aloud text can be matched to the chapter.
      hebrew_word_format: ['he'],
    };
  }

  private async accountTranscriptions(): Promise<TranscriptionSummary[] | null> {
    if (this.accountList === undefined) {
      try {
        this.accountList = await this.client.listAllTranscriptions();
      } catch (e) {
        this.warn(`  (could not list account transcriptions: ${(e as Error).message})`);
        return null;
      }
    }
    return this.accountList;
  }

  /**
   * Decides one lecture: skip, re-fetch or reuse an existing Sofer
   * transcription (written right away), or return it for submission.
   */
  private async prepare(ctx: LectureContext, opts: RunOptions): Promise<SubmitItem | null> {
    const id = ctx.lecture.id;
    const out = transcriptPath(this.deps.dataDir, id);
    const committed = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as StoredTranscript) : null;
    const folderPath = folderPathFor(ctx);
    if (committed && !opts.force && !opts.resubmit) {
      this.log(`  skip: ${path.relative(this.deps.dataDir, out)} exists`);
      const had = committed.sofer.folderPath.join(' / ');
      if (had !== folderPath.join(' / ')) {
        this.warn(`  warning: stored in Sofer folder "${had}", catalog now says "${folderPath.join(' / ')}" (--force moves it)`);
      }
      return null;
    }
    const title = soferTitleFor(ctx);
    const suffix = titleIdSuffix(id);
    const audioUrl = buildMediaUrl(opts.cdnBase, ctx.lecture.folder, ctx.lecture.filename);
    const speakers = speakerSettingFor(ctx, this.config);
    const describe = `folder ${folderPath.join(' / ')}; title "${title}"; speakers ${speakers.mode}`;

    if (opts.dryRun) {
      const what = opts.resubmit && committed ? `supersede ${committed.sofer.transcriptionId}, then submit` : 'dedup, then submit if new';
      this.log(`  dry run: ${what}; ${describe}; ${audioUrl}`);
      return { ctx, title, folderPath, folderId: '', audioUrl, speakers };
    }

    const folderId = await ensureFolderPath(this.client, folderPath, this.folderCache);
    const superseded = new Set<string>();
    if (opts.resubmit && committed) {
      const old = committed.sofer.transcriptionId;
      try {
        await this.client.updateDocument(old, {
          title: supersededTitle(committed.sofer.title, this.now().toISOString().slice(0, 10)),
          archived: true,
        });
        this.log(`  superseded ${old}: retitled and archived (archiving moves it out of the folder)`);
      } catch (e) {
        if (!(e instanceof SoferError && e.status === 404)) throw e;
        this.warn(`  warning: ${old} not found on Sofer; nothing to supersede`);
      }
      superseded.add(old);
    }

    const live = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !superseded.has(x.id));
    const inFolder = live(await this.client.listFolderTranscripts(folderId));
    const here = inFolder.some((d) => d.title.trim().endsWith(suffix) && !DEAD_STATUSES.has(d.status));
    const account = here ? [] : await this.accountTranscriptions();
    const source = chooseSource(inFolder, account === null ? null : live(account), suffix, opts.allowUnlisted);

    if (source.kind !== 'submit') {
      this.log(`  reusing Sofer transcription ${source.doc.id} (${source.doc.status})${source.kind === 'account' ? '; moving it into the folder' : ''}`);
      if (source.kind === 'account') await this.client.moveDocument(source.doc.id, folderId);
      const request = opts.force && committed && committed.sofer.transcriptionId === source.doc.id ? committed.sofer.request : { ...this.baseInfo(opts), title };
      await this.waitForSingle(source.doc.id);
      await this.write({ lectureId: id, title, folderPath, audioUrl, request }, source.doc.id);
      return null;
    }
    if (opts.force && !opts.resubmit && committed) {
      throw new Error('--force found no transcription on Sofer to re-fetch (it never submits); use --resubmit to pay for a new one');
    }
    this.log(`  to submit: ${describe}`);
    return { ctx, title, folderPath, folderId, audioUrl, speakers };
  }

  private async checkBalance(cents: number): Promise<number> {
    const bal = await this.client.balance();
    if (bal.available_balance < cents) {
      throw new Error(`available balance ${bal.available_balance}c is below the estimate ${cents}c; nothing submitted`);
    }
    return bal.available_balance;
  }

  /** The old one-file-at-a-time path (POST /v1/transcriptions/), behind --single. */
  private async submitSingles(items: SubmitItem[], opts: RunOptions): Promise<void> {
    for (const i of items) {
      const id = i.ctx.lecture.id;
      try {
        const cents = this.estimate(i, opts);
        const balance = await this.checkBalance(cents);
        const info = { ...this.baseInfo(opts), title: i.title, ...speakerFields(i.speakers) };
        const tid = await this.client.createTranscription(i.audioUrl, { ...info, folder_id: i.folderId });
        this.log(`${id}\n  submitted ${tid} (~${cents}c; balance ${balance}c)`);
        await this.waitForSingle(tid);
        await this.write({ lectureId: id, title: i.title, folderPath: i.folderPath, audioUrl: i.audioUrl, request: info }, tid);
      } catch (e) {
        this.failures += 1;
        this.warn(`${id}\n  error: ${(e as Error).message}`);
      }
    }
  }

  /** Uploads one manifest per batch and creates the batches, recording each in the state file. */
  private async submitBatches(items: SubmitItem[], opts: RunOptions, state: BatchState): Promise<string[]> {
    const batches = groupIntoBatches(items);
    const total = items.reduce((s, i) => s + this.estimate(i, opts), 0);
    const balance = await this.checkBalance(total);
    this.log(`Submitting ${items.length} lecture(s) in ${batches.length} standard batch(es), ~${total}c (balance ${balance}c).`);
    const submitted: string[] = [];
    for (const group of batches) {
      const folderPath = commonFolderPath(group.map((g) => g.folderPath));
      const folderId = await ensureFolderPath(this.client, folderPath, this.folderCache);
      const manifest = buildManifest(
        group.map((g) => ({ lectureId: g.ctx.lecture.id, audioUrl: g.audioUrl, title: g.title, speakers: g.speakers })),
      );
      const uploaded = await this.client.uploadBatchFile(manifest, {
        title: `${folderPath.join(' / ')} (${group.length})`,
        description: 'shaar-hayichud-sections yarn transcribe',
      });
      const batchFileId = uploaded.batch_file_id ?? uploaded.id;
      if (!batchFileId) throw new Error(`unexpected manifest upload response: ${JSON.stringify(uploaded).slice(0, 200)}`);
      await this.waitForManifest(batchFileId, uploaded.status, uploaded.validation_errors);

      const info = { ...this.baseInfo(opts), folder_id: folderId };
      const entry: PendingBatch = {
        batchFileId,
        batchId: null,
        createdAt: this.now().toISOString(),
        folderPath,
        estimateCents: group.reduce((s, i) => s + this.estimate(i, opts), 0),
        items: group.map((g) => ({
          lectureId: g.ctx.lecture.id,
          clientItemId: clientItemIdFor(g.ctx.lecture.id),
          title: g.title,
          folderPath: g.folderPath,
          folderId: g.folderId,
          audioUrl: g.audioUrl,
          request: { ...this.baseInfo(opts), title: g.title, ...speakerFields(g.speakers), processing_mode: 'standard' },
        })),
      };
      // Recorded before the create call: if the run dies during it, the next run knows to rely on dedup.
      state.batches.push(entry);
      saveState(this.deps.statePath, state);
      const created = await this.client.createStandardBatch(batchFileId, info);
      entry.batchId = created.batch_id;
      for (const i of entry.items) i.request['batch_id'] = created.batch_id;
      saveState(this.deps.statePath, state);
      submitted.push(...entry.items.map((i) => i.lectureId));
      this.log(
        `  batch ${created.batch_id}: ${created.total_count} transcription(s) in "${folderPath.join(' / ')}" (${created.status}); ` +
          `speakers: ${group.map((g) => `${g.ctx.lecture.id}=${g.speakers.mode}`).join(', ')}`,
      );
    }
    return submitted;
  }

  private async waitForManifest(batchFileId: string, status: string, errors?: string[] | null): Promise<void> {
    const deadline = Date.now() + (this.deps.manifestTimeoutMs ?? 5 * 60_000);
    for (;;) {
      if (status === 'VALID') return;
      if (status === 'INVALID') throw new Error(`manifest ${batchFileId} is invalid: ${(errors ?? []).join('; ')}`);
      if (Date.now() > deadline) throw new Error(`manifest ${batchFileId} still ${status}; nothing submitted`);
      await this.sleep(Math.min(this.deps.pollMs, 5000));
      const f = await this.client.getBatchFile(batchFileId);
      status = f.status;
      errors = f.validation_errors;
    }
  }

  /** Polls every batch in the state once, writing finished transcripts. Returns lectures still pending. */
  private async pollOnce(state: BatchState): Promise<number> {
    for (const b of state.batches) {
      if (b.batchId === null) continue;
      let status: BatchStatusResponse;
      try {
        status = await this.client.batchStatus(b.batchId);
      } catch (e) {
        if (e instanceof SoferError && e.status < 500 && e.status !== 429) throw e;
        this.warn(`  batch ${b.batchId}: status unavailable (${(e as Error).message})`);
        continue;
      }
      for (const item of b.items) {
        if (item.done) continue;
        const t = findBatchItem(status, item);
        if (!t) {
          if (status.status === 'FAILED') {
            item.done = 'failed';
            this.failures += 1;
            this.warn(`${item.lectureId}\n  error: batch ${b.batchId} failed before creating its transcription`);
          }
          continue;
        }
        if (t.status === 'COMPLETED') {
          // Already stored by an earlier run that was stopped before it saved
          // the state: nothing to fetch or move (the file is written only after
          // the move succeeded).
          if (this.storedFrom(item.lectureId) === t.id) {
            item.done = 'written';
            continue;
          }
          try {
            // The batch filed it in the batch's folder (batch status reports folder_id null, so it is not trusted).
            const sameFolder = b.folderPath.map((x) => x.toLowerCase()).join('\u0000') === item.folderPath.map((x) => x.toLowerCase()).join('\u0000');
            if (!sameFolder && t.folder_id !== item.folderId) await this.client.moveDocument(t.id, item.folderId);
            await this.write(item, t.id);
            item.done = 'written';
            // Record progress per item, so a run stopped mid-pass resumes here.
            saveState(this.deps.statePath, state);
          } catch (e) {
            this.warn(`${item.lectureId}\n  could not store ${t.id} yet: ${(e as Error).message}`);
          }
        } else if (DEAD_STATUSES.has(t.status)) {
          item.done = 'failed';
          this.failures += 1;
          this.warn(`${item.lectureId}\n  error: transcription ${t.id} ended with ${t.status}`);
        }
      }
      if (b.items.every((i) => i.done)) this.log(`batch ${b.batchId}: finished`);
    }
    state.batches = state.batches.filter((b) => b.batchId === null || !b.items.every((i) => i.done));
    saveState(this.deps.statePath, state);
    return pendingLectureIds(state).size;
  }

  private async waitForBatches(state: BatchState): Promise<number> {
    const deadline = Date.now() + this.deps.timeoutMs;
    let last = '';
    for (;;) {
      if (pendingLectureIds(state).size === 0) return 0;
      const left = await this.pollOnce(state);
      if (left === 0) return 0;
      const msg = `  waiting for ${left} lecture(s) in ${state.batches.length} batch(es)`;
      if (msg !== last) this.log(msg);
      last = msg;
      if (Date.now() >= deadline) {
        this.log(`Stopped waiting with ${left} lecture(s) still processing; rerun yarn transcribe (no arguments needed) to resume.`);
        return left;
      }
      await this.sleep(this.deps.pollMs);
    }
  }

  private async waitForSingle(id: string): Promise<void> {
    const deadline = Date.now() + this.deps.timeoutMs;
    let last = '';
    for (;;) {
      let status: string;
      try {
        status = await this.client.status(id);
      } catch (e) {
        if (e instanceof SoferError && e.status < 500 && e.status !== 429) throw e;
        status = `error (${(e as Error).message})`;
      }
      if (status !== last) this.log(`  status: ${status}`);
      last = status;
      if (status === 'COMPLETED') return;
      if (DEAD_STATUSES.has(status)) throw new Error(`transcription ${id} ended with ${status}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${id} (last status ${status}); rerun later to resume`);
      await this.sleep(this.deps.pollMs);
    }
  }

  /** The Sofer transcription id of the stored transcript for a lecture, if any. */
  private storedFrom(lectureId: string): string | null {
    const file = transcriptPath(this.deps.dataDir, lectureId);
    if (!existsSync(file)) return null;
    try {
      return (JSON.parse(readFileSync(file, 'utf8')) as StoredTranscript).sofer.transcriptionId;
    } catch {
      return null;
    }
  }

  private async write(
    item: Pick<BatchStateItem, 'lectureId' | 'title' | 'folderPath' | 'audioUrl' | 'request'>,
    transcriptionId: string,
  ): Promise<void> {
    const result = await this.client.getTranscription<SoferResult>(transcriptionId);
    const stored: StoredTranscript = {
      schemaVersion: 1,
      lectureId: item.lectureId,
      audioUrl: item.audioUrl,
      provider: 'sofer.ai',
      sofer: { transcriptionId, title: item.title, folderPath: item.folderPath, request: item.request },
      result,
    };
    const out = transcriptPath(this.deps.dataDir, item.lectureId);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, formatTranscript(stored));
    const speakers = new Set((result.timestamps ?? []).map((w) => w.speaker).filter((s) => s != null));
    this.log(
      `${item.lectureId}\n  wrote ${path.relative(this.deps.dataDir, out)} (${result.timestamps?.length ?? 0} words` +
        `${speakers.size > 0 ? `, ${speakers.size} speaker label(s)` : ''})`,
    );
  }
}

