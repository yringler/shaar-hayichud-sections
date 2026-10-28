/**
 * yarn set-durations — measure lectures that have no ':seconds' in
 * classes.txt with ffprobe and write the durations back into the file.
 *
 * Each file is downloaded once into data/tools/.cache/media/ (as lessons2's
 * bin/set_duration.dart did) because ffprobe over HTTP can misreport VBR mp3s.
 * Requires ffprobe on PATH. Options: --dry-run, --concurrency N, --cdn-base,
 * --file <path> (default data/classes.txt).
 */
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { buildMediaUrl, DEFAULT_CDN_BASE } from '../catalog.js';
import { fillDurations } from '../durations.js';
import { parseClassesTxt } from '../parse.js';
import { DATA_DIR, defaultPaths } from '../pipeline.js';

const run = promisify(execFile);

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
    'cdn-base': { type: 'string', default: DEFAULT_CDN_BASE },
    file: { type: 'string' },
  },
});

const paths = defaultPaths();
if (values.file) paths.classesTxt = path.resolve(values.file);
const cacheDir = path.join(DATA_DIR, 'tools', '.cache', 'media');
const parsed = parseClassesTxt(readFileSync(paths.classesTxt, 'utf8'));
if (parsed.errors.length > 0) {
  for (const e of parsed.errors) console.error(`classes.txt:${e.line}: ${e.message}`);
  process.exit(1);
}

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(tmp));
  renameSync(tmp, dest);
}

async function ffprobe(file: string): Promise<number | null> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  const n = Number.parseFloat(stdout.trim());
  return Number.isFinite(n) ? n : null;
}

const cdnBase = values['cdn-base'];
const result = await fillDurations(
  parsed,
  (l) => buildMediaUrl(cdnBase, l.folder, l.filename),
  async (lecture, url) => {
    const dest = path.join(cacheDir, ...lecture.folder.split('/'), lecture.filename);
    await download(url, dest);
    return ffprobe(dest);
  },
  { concurrency: Number(values.concurrency), onProgress: (m) => console.log(m) },
);

for (const f of result.failures) console.error(`warning: ${f}`);
if (result.updates.length === 0) {
  console.log('No missing durations were filled.');
} else if (values['dry-run']) {
  console.log(`Dry run: would set ${result.updates.length} duration(s).`);
} else {
  writeFileSync(paths.classesTxt, result.text);
  console.log(`Set ${result.updates.length} duration(s) in ${paths.classesTxt}.`);
}
process.exit(result.failures.length > 0 ? 1 : 0);
