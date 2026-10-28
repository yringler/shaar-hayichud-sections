/**
 * yarn outline — fetch Sofer.ai's topic outline (POST /v1/timestamps/outline)
 * for each stored transcript and write data/outlines/<encoded lecture id>.json.
 *
 * Idempotent: a lecture whose outline was made from its current transcription
 * is skipped (--force refetches); one made from an older transcription is
 * refetched. By default every lecture with a stored transcript; narrow with
 * --lecture <id> / --section <heading id> and --limit N.
 *
 * The outline endpoint has no documented price, so the balance is read before
 * and after every call and the cost printed; the run stops when one call
 * costs more than --max-cents-per-call (default 10).
 *
 * Needs SOFER_API_KEY; behind an HTTP proxy run with NODE_USE_ENV_PROXY=1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildStoredOutline, formatOutline, OUTLINE_REQUEST, outlineNeeded, outlinePath, type StoredOutline } from '../outline.js';
import { parseClassesTxt } from '../parse.js';
import { DATA_DIR, defaultPaths } from '../pipeline.js';
import { SoferClient } from '../sofer.js';
import { lectureContexts, selectLectures, transcriptPath, type StoredTranscript } from '../transcripts.js';

const { values } = parseArgs({
  options: {
    lecture: { type: 'string', multiple: true, default: [] },
    section: { type: 'string', multiple: true, default: [] },
    limit: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'max-cents-per-call': { type: 'string', default: '10' },
  },
});

const apiKey = process.env['SOFER_API_KEY']?.trim();
if (!apiKey && !values['dry-run']) {
  console.error('Set SOFER_API_KEY (Sofer.ai API key) in the environment.');
  process.exit(2);
}

const paths = defaultPaths();
const all = lectureContexts(parseClassesTxt(readFileSync(paths.classesTxt, 'utf8')).series);
const picked =
  values.lecture.length + values.section.length > 0
    ? selectLectures(all, values.lecture, values.section)
    : { selected: all, errors: [] };
if (picked.errors.length > 0) {
  for (const e of picked.errors) console.error(e);
  process.exit(2);
}
let todo = picked.selected.filter((c) => existsSync(transcriptPath(DATA_DIR, c.lecture.id)));
if (values.limit) todo = todo.slice(0, Number(values.limit));
if (todo.length === 0) {
  console.error('No selected lecture has a stored transcript (run yarn transcribe first).');
  process.exit(2);
}

const client = apiKey ? new SoferClient(apiKey) : null;
const maxCents = Number(values['max-cents-per-call']);
let failures = 0;
for (const ctx of todo) {
  const id = ctx.lecture.id;
  const tFile = transcriptPath(DATA_DIR, id);
  const transcript = JSON.parse(readFileSync(tFile, 'utf8')) as StoredTranscript;
  const out = outlinePath(DATA_DIR, id);
  const existing = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as StoredOutline) : null;
  const why = outlineNeeded(transcript, existing, values.force);
  console.log(id);
  if (!why) {
    console.log(`  skip: ${path.relative(DATA_DIR, out)} is up to date`);
    continue;
  }
  if (values['dry-run'] || !client) {
    console.log(`  dry run: would fetch (${why}) for ${transcript.sofer.transcriptionId}`);
    continue;
  }
  try {
    const before = (await client.balance()).available_balance;
    const t0 = Date.now();
    const topics = await client.outline(transcript.sofer.transcriptionId, OUTLINE_REQUEST);
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    const after = (await client.balance()).available_balance;
    const rel = path.relative(DATA_DIR, tFile).split(path.sep).join('/');
    const stored = buildStoredOutline(transcript, rel, topics, OUTLINE_REQUEST, new Date());
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, formatOutline(stored));
    const cost = before - after;
    console.log(`  wrote ${path.relative(DATA_DIR, out)}: ${topics.length} topics (${why}; ${seconds}s; cost ${cost}c, balance ${after}c)`);
    if (cost > maxCents) {
      console.error(`  stopping: the call cost ${cost}c, above --max-cents-per-call ${maxCents}`);
      process.exit(1);
    }
  } catch (e) {
    failures += 1;
    console.error(`  error: ${(e as Error).message}`);
  }
}
process.exit(failures > 0 ? 1 : 0);
