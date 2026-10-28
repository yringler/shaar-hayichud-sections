/**
 * yarn transcribe — transcribe catalog lectures with Sofer.ai and store the
 * raw word-timestamped result in data/transcripts/<encoded lecture id>.json.
 *
 * Needs SOFER_API_KEY in the environment (never pass it on the command line,
 * never commit it). Behind an HTTP proxy run with NODE_USE_ENV_PROXY=1.
 *
 * Select lectures with --lecture <id> (repeatable) and/or --section <heading
 * id> (every lecture under that heading, in catalog order), optionally capped
 * with --limit N. Only series listed in src/transcription-config.ts are in
 * scope (--allow-out-of-scope overrides). For each lecture:
 *   1. a committed transcript exists -> skip. --force re-fetches the existing
 *      Sofer transcription (never submits); --resubmit retitles and archives
 *      it as superseded and submits a new one (paid);
 *   2. find or create the Sofer folder path mirroring the catalog headings;
 *   3. reuse a transcription already on Sofer whose title ends with
 *      "[<lecture id>]" (in that folder, else anywhere in the account, moving
 *      it into the folder) -> no new charge. If the account-wide list could
 *      not be fetched, nothing is submitted unless --allow-unlisted;
 *   4. everything left goes into one standard-mode batch per series
 *      ($1.00/h with v1, results within 24 h), after a balance check. The
 *      batch is recorded in tools/.cache/sofer-batches.json before and after
 *      the create call, so a rerun (with or without arguments) polls it
 *      instead of submitting again. --single submits files one by one
 *      ($1.50/h, the old path) instead.
 * --dry-run prints what would be submitted and touches nothing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadState, pendingLectureIds, Transcriber } from '../batch.js';
import { DEFAULT_CDN_BASE } from '../catalog.js';
import { parseClassesTxt } from '../parse.js';
import { DATA_DIR, defaultPaths } from '../pipeline.js';
import { SoferClient } from '../sofer.js';
import { partitionByScope, TRANSCRIPTION_SERIES } from '../transcription-config.js';
import { lectureContexts, selectLectures } from '../transcripts.js';

const { values } = parseArgs({
  options: {
    lecture: { type: 'string', multiple: true, default: [] },
    section: { type: 'string', multiple: true, default: [] },
    limit: { type: 'string' },
    force: { type: 'boolean', default: false },
    resubmit: { type: 'boolean', default: false },
    single: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'allow-unlisted': { type: 'boolean', default: false },
    'allow-out-of-scope': { type: 'boolean', default: false },
    'poll-seconds': { type: 'string', default: '60' },
    'timeout-minutes': { type: 'string', default: '120' },
    state: { type: 'string', default: path.join(DATA_DIR, 'tools', '.cache', 'sofer-batches.json') },
    'cdn-base': { type: 'string', default: DEFAULT_CDN_BASE },
    language: { type: 'string', default: 'en' },
    model: { type: 'string', default: 'v1' },
  },
});

if (values.force && values.resubmit) {
  console.error('--force re-fetches, --resubmit pays for a new transcription: pass one of them.');
  process.exit(2);
}

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
const pending = pendingLectureIds(loadState(values.state));
if (selected.length === 0 && pending.size === 0) {
  console.error('Nothing selected. Pass --lecture <id> and/or --section <heading id>.');
  process.exit(2);
}
const todo = values.limit ? selected.slice(0, Number(values.limit)) : selected;

const { outOfScope } = partitionByScope(todo);
if (outOfScope.length > 0) {
  const series = [...new Set(outOfScope.map((c) => `"${c.ancestors[0]?.title}" (:${c.ancestors[0]?.id})`))];
  const allowed = TRANSCRIPTION_SERIES.map((s) => `"${s.title}" (:${s.seriesId})`).join(', ');
  const msg = `${outOfScope.length} selected lecture(s) are in series outside the transcription allowlist: ${series.join(', ')}. Allowed: ${allowed} (src/transcription-config.ts).`;
  if (!values['allow-out-of-scope']) {
    console.error(`${msg} Pass --allow-out-of-scope to transcribe them anyway (speaker labeling off).`);
    process.exit(2);
  }
  console.warn(`warning: ${msg}`);
}

const client = new SoferClient(apiKey);
const transcriber = new Transcriber({
  client,
  dataDir: DATA_DIR,
  statePath: values.state,
  pollMs: Number(values['poll-seconds']) * 1000,
  timeoutMs: Number(values['timeout-minutes']) * 60_000,
});
const result = await transcriber.run(todo, {
  force: values.force,
  resubmit: values.resubmit,
  allowUnlisted: values['allow-unlisted'],
  single: values.single,
  dryRun: values['dry-run'],
  model: values.model,
  language: values.language,
  cdnBase: values['cdn-base'],
});

try {
  const bal = await client.balance();
  console.log(`Sofer balance: ${bal.available_balance}c available, ${bal.pending_balance}c pending.`);
} catch {
  // informational only
}
process.exit(result.failures > 0 ? 1 : result.pending > 0 ? 3 : 0);
