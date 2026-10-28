import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildManifest,
  commonFolderPath,
  findBatchItem,
  groupIntoBatches,
  loadState,
  pendingLectureIds,
  saveState,
  supersededTitle,
  Transcriber,
  type BatchState,
  type RunOptions,
  type TranscribeClient,
} from './batch.js';
import { parseClassesTxt } from './parse.js';
import { SoferClient, SoferError, type BatchManifestItem, type SoferDocument, type SoferFolder } from './sofer.js';
import { lectureContexts, transcriptPath, type StoredTranscript } from './transcripts.js';
import type { SeriesTranscriptionConfig } from './transcription-config.js';

const catalog = lectureContexts(
  parseClassesTxt(`
# Markel:37
## Part 1: Chapters 10-15:38
> m/p1
- Introduction
001 Intro.mp3:722.997
### Chapter 10:39
002 a.mp3:1804.2
003 b.mp3:900
# Walters:0
> w
### Chapter 10:4
07 w.mp3:3600
`).series,
);
const [intro, a, b, w] = catalog;
const config: SeriesTranscriptionConfig[] = [
  { seriesId: '37', title: 'Markel', speakers: { mode: 'auto' }, note: '' },
  { seriesId: '0', title: 'Walters', speakers: { mode: 'off' }, note: '' },
];

describe('batch helpers', () => {
  it('builds a manifest with per-item title, client id and speaker settings', () => {
    const items = buildManifest([
      { lectureId: '001 Intro.mp3', audioUrl: 'https://x/1.mp3', title: 'Introduction [001 Intro.mp3]', speakers: { mode: 'auto' } },
      { lectureId: '07 w.mp3', audioUrl: 'https://x/7.mp3', title: 'Part 1 [07 w.mp3]', speakers: { mode: 'off' } },
    ]);
    assert.deepEqual(items, [
      { audio_url: 'https://x/1.mp3', title: 'Introduction [001 Intro.mp3]', client_item_id: '001 Intro.mp3', auto_detect_speakers: true },
      { audio_url: 'https://x/7.mp3', title: 'Part 1 [07 w.mp3]', client_item_id: '07 w.mp3', num_speakers: 1 },
    ]);
    assert.throws(() => buildManifest([]), /empty/);
    const dup = { lectureId: 'x', audioUrl: 'u', title: 't', speakers: { mode: 'off' } as const };
    assert.throws(() => buildManifest([dup, dup]), /twice/);
    assert.throws(() => buildManifest(Array.from({ length: 501 }, (_, i) => ({ ...dup, lectureId: `${i}` }))), /at most 500/);
  });

  it('finds the common folder and groups by series', () => {
    assert.deepEqual(commonFolderPath([['M', 'Part 1', 'Introduction'], ['m', 'Part 1', 'Chapter 10']]), ['M', 'Part 1']);
    assert.deepEqual(commonFolderPath([['M', 'P'], ['W', 'P']]), []);
    const groups = groupIntoBatches([{ folderPath: ['M', 'x'] }, { folderPath: ['W'] }, { folderPath: ['m', 'y'] }]);
    assert.deepEqual(groups.map((g) => g.length), [2, 1]);
  });

  it('matches status items by client_item_id, then by title suffix', () => {
    const item = { lectureId: '002 a.mp3', clientItemId: '002 a.mp3', title: '', folderPath: [], folderId: '', audioUrl: '', request: {} };
    const status = (transcriptions: { id: string; client_item_id?: string | null; title: string; status: string }[]) => ({
      batch_id: 'b',
      status: 'PROCESSING',
      total_count: 1,
      transcriptions,
    });
    assert.equal(findBatchItem(status([{ id: '1', client_item_id: '002 a.mp3', title: 'x', status: 'PENDING' }]), item)?.id, '1');
    assert.equal(findBatchItem(status([{ id: '2', client_item_id: null, title: 'Part 1 [002 a.mp3]', status: 'PENDING' }]), item)?.id, '2');
    assert.equal(findBatchItem(status([{ id: '3', title: 'Part 1 [003 b.mp3]', status: 'PENDING' }]), item), undefined);
  });

  it('a superseded title no longer ends with the id suffix', () => {
    assert.equal(supersededTitle('Part 1 [a.mp3]', '2026-10-28'), 'Part 1 [a.mp3] (superseded 2026-10-28)');
    assert.ok(!supersededTitle('Part 1 [a.mp3]', 'x').endsWith('[a.mp3]'));
  });

  it('round-trips the state file and lists pending lectures', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'state-')), 'sub', 'state.json');
    assert.deepEqual(loadState(file), { version: 1, batches: [] });
    const item = (id: string, done?: 'written') => ({
      lectureId: id, clientItemId: id, title: id, folderPath: ['M'], folderId: 'f', audioUrl: 'u', request: {}, ...(done ? { done } : {}),
    });
    const state: BatchState = {
      version: 1,
      batches: [
        { batchFileId: 'm1', batchId: 'b1', createdAt: '', folderPath: ['M'], estimateCents: 1, items: [item('x'), item('y', 'written')] },
        { batchFileId: 'm2', batchId: null, createdAt: '', folderPath: ['M'], estimateCents: 1, items: [item('z')] },
      ],
    };
    saveState(file, state);
    assert.deepEqual(loadState(file), state);
    assert.deepEqual([...pendingLectureIds(state)], ['x']);
  });
});

/** In-memory Sofer: folders, documents, batches. Records every write. */
class FakeSofer implements TranscribeClient {
  folders: SoferFolder[] = [];
  docs: (SoferDocument & { speakers?: string[] })[] = [];
  writes: string[] = [];
  manifests: BatchManifestItem[][] = [];
  batches = new Map<string, { info: Record<string, unknown>; ids: string[]; items: BatchManifestItem[] }>();
  balanceCents = 799;
  /** Status every new transcription gets; tests flip it to COMPLETED. */
  newStatus = 'PROCESSING';
  private n = 0;
  private nextId = (p: string) => `${p}${++this.n}`;

  async balance() {
    return { total_balance: this.balanceCents, available_balance: this.balanceCents, pending_balance: 0, all_time_spend: 0 };
  }
  async listFolders(parent: string | null) {
    return this.folders.filter((f) => f.parent_id === parent);
  }
  async createFolder(name: string, parent: string | null) {
    const f = { id: this.nextId('f'), name, parent_id: parent };
    this.folders.push(f);
    return f;
  }
  async listFolderTranscripts(folderId: string) {
    return this.docs.filter((d) => d.folder_id === folderId && !d.archived);
  }
  async listAllTranscriptions() {
    return this.docs.filter((d) => d.folder_id).map((d) => ({ id: d.id, title: d.title, folder_id: d.folder_id ?? null, status: d.status }));
  }
  async moveDocument(id: string, folderId: string | null) {
    this.writes.push(`move ${id}`);
    const d = this.docs.find((x) => x.id === id)!;
    d.folder_id = folderId;
    return d;
  }
  async updateDocument(id: string, fields: { title?: string; folder_id?: string | null; archived?: boolean }) {
    this.writes.push(`update ${id} ${JSON.stringify(fields)}`);
    const d = this.docs.find((x) => x.id === id);
    if (!d) throw new SoferError('not found', 404);
    if (fields.title !== undefined) d.title = fields.title;
    if (fields.archived) {
      d.archived = true;
      d.folder_id = null;
    }
    return d;
  }
  async createTranscription(_url: string, info: Record<string, unknown>) {
    this.writes.push('create single');
    const id = this.nextId('t');
    this.docs.push({ id, type: 'transcript', title: String(info['title']), folder_id: String(info['folder_id']), status: this.newStatus });
    return id;
  }
  async status(id: string) {
    return this.docs.find((d) => d.id === id)!.status;
  }
  async getTranscription<T>(id: string): Promise<T> {
    const d = this.docs.find((x) => x.id === id)!;
    return { text: d.title, timestamps: [{ word: 'w', start: 0, end: 1, speaker: 'SPEAKER_00' }], info: { id } } as T;
  }
  async uploadBatchFile(items: BatchManifestItem[]) {
    this.manifests.push(items);
    return { batch_file_id: this.nextId('m'), item_count: items.length, status: 'PENDING_VALIDATION' };
  }
  async getBatchFile(_id: string) {
    return { id: _id, item_count: 0, status: 'VALID' };
  }
  async createStandardBatch(batchFileId: string, info: Record<string, unknown>) {
    this.writes.push(`create batch ${batchFileId}`);
    const items = this.manifests[this.manifests.length - 1]!;
    const ids = items.map((i) => {
      const id = this.nextId('t');
      this.docs.push({ id, type: 'transcript', title: i.title, folder_id: String(info['folder_id']), status: this.newStatus });
      return id;
    });
    const batchId = this.nextId('b');
    this.batches.set(batchId, { info, ids, items });
    return { batch_id: batchId, transcription_ids: ids, total_count: ids.length, status: 'RECEIVED' };
  }
  async batchStatus(batchId: string) {
    const b = this.batches.get(batchId)!;
    const transcriptions = b.ids.map((id, i) => {
      const d = this.docs.find((x) => x.id === id)!;
      return { id, client_item_id: b.items[i]!.client_item_id, folder_id: d.folder_id ?? null, title: d.title, status: d.status };
    });
    const done = transcriptions.every((t) => t.status === 'COMPLETED');
    return { batch_id: batchId, status: done ? 'COMPLETED' : 'PROCESSING', total_count: b.ids.length, transcriptions };
  }
  completeAll() {
    for (const d of this.docs) if (d.status === 'PROCESSING') d.status = 'COMPLETED';
  }
}

const opts = (o: Partial<RunOptions> = {}): RunOptions => ({
  force: false,
  resubmit: false,
  allowUnlisted: false,
  single: false,
  dryRun: false,
  model: 'v1',
  language: 'en',
  cdnBase: 'https://cdn',
  ...o,
});

function setup(sofer = new FakeSofer(), timeoutMs = 0) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'transcribe-'));
  const statePath = path.join(dataDir, 'state.json');
  const logs: string[] = [];
  const make = () =>
    new Transcriber({
      client: sofer,
      dataDir,
      statePath,
      pollMs: 0,
      timeoutMs,
      sleep: async () => {},
      now: () => new Date('2026-10-28T12:00:00Z'),
      log: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      config,
    });
  return { sofer, dataDir, statePath, logs, make };
}

const readStored = (dataDir: string, id: string) => JSON.parse(readFileSync(transcriptPath(dataDir, id), 'utf8')) as StoredTranscript;

describe('Transcriber', () => {
  it('puts only lectures that pass dedup into one batch per series, with speaker settings per series', async () => {
    const { sofer, dataDir, make } = setup();
    // 002 already exists on Sofer in its folder: reused, not resubmitted.
    const ch10 = await sofer.createFolder('Chapter 10', (await sofer.createFolder('Part 1: Chapters 10-15', (await sofer.createFolder('Markel', null)).id)).id);
    sofer.docs.push({ id: 'old2', type: 'transcript', title: 'Part 1 [002 a.mp3]', folder_id: ch10.id, status: 'COMPLETED' });
    sofer.newStatus = 'COMPLETED';
    const res = await make().run([intro!, a!, b!, w!], opts());

    assert.equal(res.failures, 0);
    assert.deepEqual(res.submitted, ['001 Intro.mp3', '003 b.mp3', '07 w.mp3']);
    assert.deepEqual(
      sofer.manifests.map((m) => m.map((i) => [i.client_item_id, i.auto_detect_speakers ?? false, i.num_speakers ?? null])),
      [
        [['001 Intro.mp3', true, null], ['003 b.mp3', true, null]],
        [['07 w.mp3', false, 1]],
      ],
    );
    // The Markel batch is filed in the common ancestor, then each item is moved to its own folder.
    const [markelBatch] = [...sofer.batches.values()];
    const part1 = sofer.folders.find((f) => f.name === 'Part 1: Chapters 10-15')!;
    assert.equal(markelBatch!.info['folder_id'], part1.id);
    assert.equal(markelBatch!.info['hebrew_word_format']?.toString(), 'he');
    const introDoc = sofer.docs.find((d) => d.title === 'Introduction [001 Intro.mp3]')!;
    assert.equal(introDoc.folder_id, sofer.folders.find((f) => f.name === 'Introduction')!.id);

    assert.equal(readStored(dataDir, '002 a.mp3').sofer.transcriptionId, 'old2');
    const s1 = readStored(dataDir, '001 Intro.mp3');
    assert.deepEqual(s1.sofer.folderPath, ['Markel', 'Part 1: Chapters 10-15', 'Introduction']);
    assert.equal(s1.sofer.request['auto_detect_speakers'], true);
    assert.equal(s1.sofer.request['processing_mode'], 'standard');
    assert.ok(typeof s1.sofer.request['batch_id'] === 'string');
    assert.equal(readStored(dataDir, '07 w.mp3').sofer.request['num_speakers'], 1);
  });

  it('checks the balance against the batch estimate before uploading anything', async () => {
    const { sofer, make } = setup();
    sofer.balanceCents = 50; // 001+002 with speakers ~ 2527s * $1.30/h = 92c
    const res = await make().run([intro!, a!], opts());
    assert.equal(res.failures, 1);
    assert.deepEqual(sofer.manifests, []);
    assert.ok(!sofer.writes.some((x) => x.startsWith('create')));
  });

  it('submits nothing when any selected lecture failed, so a batch is never partial', async () => {
    const { sofer, make } = setup();
    const real = sofer.listFolderTranscripts.bind(sofer);
    let calls = 0;
    sofer.listFolderTranscripts = async (id: string) => {
      if (++calls === 2) throw new SoferError('rate limited', 429);
      return real(id);
    };
    const res = await make().run([intro!, a!], opts());
    assert.equal(res.failures, 1);
    assert.deepEqual(sofer.manifests, []);
  });

  it('refuses to submit when no listing can rule out a duplicate', async () => {
    const { sofer, make } = setup();
    sofer.listAllTranscriptions = async () => {
      throw new SoferError('500', 500);
    };
    const res = await make().run([a!], opts());
    assert.equal(res.failures, 1);
    assert.deepEqual(sofer.manifests, []);
  });

  it('resumes a submitted batch by polling it, never resubmitting', async () => {
    const { sofer, dataDir, statePath, make } = setup();
    // First run: submit, stop waiting while still processing (timeout 0).
    const first = await make().run([intro!, a!], opts());
    assert.equal(first.pending, 2);
    assert.equal(loadState(statePath).batches.length, 1);
    assert.ok(!existsSync(transcriptPath(dataDir, '001 Intro.mp3')));

    // Rerun with the same selection while still processing: no new create.
    const creates = () => sofer.writes.filter((x) => x.startsWith('create')).length;
    await make().run([intro!, a!], opts());
    assert.equal(creates(), 1);

    // Finished: a rerun with nothing selected stores both and clears the state.
    sofer.completeAll();
    const done = await make().run([], opts());
    assert.equal(done.pending, 0);
    assert.equal(creates(), 1);
    assert.deepEqual(loadState(statePath).batches, []);
    assert.ok(existsSync(transcriptPath(dataDir, '001 Intro.mp3')));
    assert.ok(existsSync(transcriptPath(dataDir, '002 a.mp3')));
  });

  it('drops a batch whose create outcome is unknown and lets folder dedup find what it created', async () => {
    const { sofer, statePath, make } = setup();
    sofer.newStatus = 'COMPLETED';
    // Simulate a crash during the create call: the batch exists on Sofer, but the state has no batch id.
    sofer.createStandardBatch = (async function (this: FakeSofer, id: string, info: Record<string, unknown>) {
      await FakeSofer.prototype.createStandardBatch.call(this, id, info);
      throw new Error('socket hang up');
    }).bind(sofer);
    const first = await make().run([a!], opts());
    assert.equal(first.failures, 1);
    assert.equal(loadState(statePath).batches[0]!.batchId, null);

    sofer.createStandardBatch = FakeSofer.prototype.createStandardBatch.bind(sofer);
    const second = await make().run([a!], opts());
    assert.equal(second.failures, 0);
    assert.deepEqual(second.submitted, []);
    assert.equal(sofer.writes.filter((x) => x.startsWith('create')).length, 1);
    assert.deepEqual(loadState(statePath).batches, []);
  });

  it('--force re-fetches, --resubmit supersedes the committed transcription and submits anew', async () => {
    const { sofer, dataDir, make } = setup();
    sofer.newStatus = 'COMPLETED';
    await make().run([a!], opts({ single: true }));
    const old = readStored(dataDir, '002 a.mp3').sofer.transcriptionId;
    assert.equal(readStored(dataDir, '002 a.mp3').sofer.request['auto_detect_speakers'], true);

    // Committed: plain rerun skips; --force re-fetches the same one.
    await make().run([a!], opts());
    await make().run([a!], opts({ force: true }));
    assert.equal(readStored(dataDir, '002 a.mp3').sofer.transcriptionId, old);
    assert.equal(sofer.writes.filter((x) => x.startsWith('create')).length, 1);

    const res = await make().run([a!], opts({ resubmit: true }));
    assert.equal(res.failures, 0);
    const now = readStored(dataDir, '002 a.mp3');
    assert.notEqual(now.sofer.transcriptionId, old);
    assert.equal(now.sofer.request['processing_mode'], 'standard');
    const oldDoc = sofer.docs.find((d) => d.id === old)!;
    assert.equal(oldDoc.title, 'Part 1 [002 a.mp3] (superseded 2026-10-28)');
    assert.equal(oldDoc.archived, true);
    // Only the new transcription is left in the lecture's folder.
    const folder = sofer.folders.find((f) => f.name === 'Chapter 10')!;
    assert.deepEqual((await sofer.listFolderTranscripts(folder.id)).map((d) => d.id), [now.sofer.transcriptionId]);
  });

  it('--force without a transcription on Sofer refuses instead of submitting', async () => {
    const { sofer, dataDir, make } = setup();
    const file = transcriptPath(dataDir, '002 a.mp3');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ sofer: { transcriptionId: 'gone', title: 't', folderPath: [], request: {} } }));
    const res = await make().run([a!], opts({ force: true }));
    assert.equal(res.failures, 1);
    assert.deepEqual(sofer.manifests, []);
  });
});

describe('SoferClient batch calls', () => {
  it('retries a document update on 429 (rejected, not applied) but not on 5xx', async () => {
    const statuses = [429, 200];
    const calls: string[] = [];
    const client = new SoferClient(
      'k',
      async (url, init) => {
        calls.push(`${init?.method} ${url}`);
        const st = statuses.shift() ?? 500;
        return new Response(st === 200 ? '{}' : 'x', { status: st });
      },
      'https://api',
      3,
      0,
    );
    await client.updateDocument('d', { archived: true });
    assert.equal(calls.length, 2);
    await assert.rejects(client.updateDocument('d', { archived: true }), /HTTP 500/);
    assert.equal(calls.length, 3);
  });

  it('sends a standard batch with the manifest id and never retries it', async () => {
    const calls: { url: string; method?: string | undefined; body?: string }[] = [];
    const client = new SoferClient(
      'k',
      async (url, init) => {
        calls.push({ url, method: init?.method, body: init?.body as string });
        return new Response('oops', { status: 502 });
      },
      'https://api',
      3,
      0,
    );
    await assert.rejects(client.createStandardBatch('mf', { model: 'v1' }), /HTTP 502/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api/v1/transcriptions/batch');
    assert.deepEqual(JSON.parse(calls[0]!.body!), { processing_mode: 'standard', batch_file_id: 'mf', info: { model: 'v1' } });
  });
});
