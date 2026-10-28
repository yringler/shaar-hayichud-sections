/**
 * yarn transcribe — transcribe catalog lectures with Sofer.ai and store the
 * raw word-timestamped result in data/transcripts/<encoded lecture id>.json.
 *
 * Needs SOFER_API_KEY in the environment (never pass it on the command line,
 * never commit it). Behind an HTTP proxy run with NODE_USE_ENV_PROXY=1.
 *
 * Select lectures with --lecture <id> (repeatable) and/or --section <heading
 * id> (every lecture under that heading, in catalog order), optionally capped
 * with --limit N. For each one, in order:
 *   1. a committed transcript exists -> skip (unless --force, which re-fetches
 *      the existing Sofer transcription; it never submits again);
 *   2. find or create the Sofer folder path mirroring the catalog headings;
 *   3. reuse a transcription already on Sofer whose title ends with
 *      "[<lecture id>]" (in that folder, else anywhere in the account, moving
 *      it into the folder) -> no new charge;
 *   4. otherwise submit the catalog URL (audio_url) and poll until done.
 * --dry-run prints what would be submitted and submits nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildMediaUrl, DEFAULT_CDN_BASE } from '../catalog.js';
import { parseClassesTxt } from '../parse.js';
import { DATA_DIR, defaultPaths } from '../pipeline.js';
import { DEAD_STATUSES, ensureFolderPath, pickExisting, SoferClient, SoferError } from '../sofer.js';
import {
  folderPathFor,
  formatTranscript,
  lectureContexts,
  selectLectures,
  soferTitleFor,
  titleIdSuffix,
  transcriptPath,
  type SoferResult,
  type StoredTranscript,
} from '../transcripts.js';

const { values } = parseArgs({
  options: {
    lecture: { type: 'string', multiple: true, default: [] },
    section: { type: 'string', multiple: true, default: [] },
    limit: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'poll-seconds': { type: 'string', default: '20' },
    'timeout-minutes': { type: 'string', default: '90' },
    'cdn-base': { type: 'string', default: DEFAULT_CDN_BASE },
    language: { type: 'string', default: 'en' },
    model: { type: 'string', default: 'v1' },
  },
});

/** USD per audio hour, from the Sofer docs; only used for the pre-submit balance check. */
const PRICE_PER_HOUR: Record<string, number> = { v1: 1.5, v0: 1.0 };

const apiKey = process.env['SOFER_API_KEY']?.trim();
if (!apiKey) {
  console.error('Set SOFER_API_KEY (Sofer.ai API key) in the environment.');
  process.exit(2);
}

const paths = defaultPaths();
const parsed = parseClassesTxt(readFileSync(paths.classesTxt, 'utf8'));
if (parsed.errors.length > 0) {
  for (const e of parsed.errors) console.error(`classes.txt:${e.line}: ${e.message}`);
  process.exit(1);
}
const all = lectureContexts(parsed.series);

const { selected, errors: selectErrors } = selectLectures(all, values.lecture, values.section);
if (selectErrors.length > 0) {
  for (const e of selectErrors) console.error(e);
  process.exit(2);
}
if (selected.length === 0) {
  console.error('Nothing selected. Pass --lecture <id> and/or --section <heading id>.');
  process.exit(2);
}
const todo = values.limit ? selected.slice(0, Number(values.limit)) : selected;

const client = new SoferClient(apiKey);
const folderCache = new Map<string, string>();
const pollMs = Number(values['poll-seconds']) * 1000;
const timeoutMs = Number(values['timeout-minutes']) * 60_000;

/** All account transcriptions, fetched at most once; null if the endpoint fails. */
let accountList: Awaited<ReturnType<SoferClient['listTranscriptions']>> | null | undefined;
async function accountTranscriptions() {
  if (accountList === undefined) {
    try {
      accountList = await client.listTranscriptions();
    } catch (e) {
      console.warn(`  (could not list account transcriptions: ${(e as Error).message})`);
      accountList = null;
    }
  }
  return accountList ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(id: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    let status: string;
    try {
      status = await client.status(id);
    } catch (e) {
      // Transient errors while polling are retried until the deadline.
      if (e instanceof SoferError && e.status < 500 && e.status !== 429) throw e;
      status = `error (${(e as Error).message})`;
    }
    if (status !== last) console.log(`  status: ${status}`);
    last = status;
    if (status === 'COMPLETED') return;
    if (DEAD_STATUSES.has(status)) throw new Error(`transcription ${id} ended with ${status}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${id} (last status ${status}); rerun later to resume`);
    await sleep(pollMs);
  }
}

let failures = 0;
for (const ctx of todo) {
  const id = ctx.lecture.id;
  const out = transcriptPath(DATA_DIR, id);
  console.log(`${id}`);
  if (existsSync(out) && !values.force) {
    console.log(`  skip: ${path.relative(DATA_DIR, out)} exists`);
    continue;
  }
  try {
    const folderPath = folderPathFor(ctx);
    const title = soferTitleFor(ctx);
    const suffix = titleIdSuffix(id);
    const audioUrl = buildMediaUrl(values['cdn-base'], ctx.lecture.folder, ctx.lecture.filename);
    const info: Record<string, unknown> = {
      model: values.model,
      primary_language: values.language,
      // Hebrew words in Hebrew letters, so the read-aloud text can be matched to the chapter.
      hebrew_word_format: ['he'],
      title,
    };

    if (values['dry-run']) {
      console.log(`  dry run: folder ${folderPath.join(' / ')}; title "${title}"; ${audioUrl}`);
      continue;
    }

    const folderId = await ensureFolderPath(client, folderPath, folderCache);
    let transcriptionId: string | undefined;
    const inFolder = pickExisting(await client.listFolderTranscripts(folderId), suffix);
    if (inFolder) {
      transcriptionId = inFolder.id;
      console.log(`  reusing Sofer transcription ${transcriptionId} (${inFolder.status})`);
    } else {
      const elsewhere = pickExisting(await accountTranscriptions(), suffix);
      if (elsewhere) {
        transcriptionId = elsewhere.id;
        console.log(`  reusing Sofer transcription ${transcriptionId} (${elsewhere.status}); moving it into the folder`);
        await client.moveDocument(transcriptionId, folderId);
      }
    }

    if (!transcriptionId) {
      if (values.force && existsSync(out)) {
        throw new Error('--force found no transcription on Sofer to re-fetch; delete the local file to submit again');
      }
      const hours = (ctx.lecture.durationSeconds ?? 3600) / 3600;
      const estimateCents = Math.ceil(hours * (PRICE_PER_HOUR[values.model] ?? 1.5) * 100);
      const bal = await client.balance();
      if (bal.available_balance < estimateCents) {
        throw new Error(`available balance ${bal.available_balance}c is below the estimate ${estimateCents}c`);
      }
      transcriptionId = await client.createTranscription(audioUrl, { ...info, folder_id: folderId });
      console.log(`  submitted ${transcriptionId} (~${estimateCents}c; balance ${bal.available_balance}c)`);
    }

    await waitFor(transcriptionId);
    const result = await client.getTranscription<SoferResult>(transcriptionId);
    const stored: StoredTranscript = {
      schemaVersion: 1,
      lectureId: id,
      audioUrl,
      provider: 'sofer.ai',
      sofer: { transcriptionId, title, folderPath, request: info },
      result,
    };
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, formatTranscript(stored));
    console.log(`  wrote ${path.relative(DATA_DIR, out)} (${result.timestamps?.length ?? 0} words)`);
  } catch (e) {
    failures += 1;
    console.error(`  error: ${(e as Error).message}`);
  }
}

try {
  const bal = await client.balance();
  console.log(`Sofer balance: ${bal.available_balance}c available, ${bal.pending_balance}c pending.`);
} catch {
  // informational only
}
process.exit(failures > 0 ? 1 : 0);
