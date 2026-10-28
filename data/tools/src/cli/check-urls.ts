/**
 * yarn check-urls — OPT-IN check that every catalog URL exists on the CDN.
 * Not part of build-data (it needs the network and takes a while).
 * Sends HEAD (falling back to a 1-byte ranged GET if HEAD is refused).
 * Options: --concurrency N, --cdn-base. Exit code 1 if any URL fails.
 * Behind an HTTP proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { parseArgs } from 'node:util';
import { catalogLectures, DEFAULT_CDN_BASE } from '../catalog.js';
import { defaultPaths, loadCatalog } from '../pipeline.js';
import { SchemaSet } from '../validate.js';

const { values } = parseArgs({
  options: {
    concurrency: { type: 'string', default: '8' },
    'cdn-base': { type: 'string', default: DEFAULT_CDN_BASE },
  },
});

const paths = defaultPaths();
const { catalog, errors } = loadCatalog(paths, new SchemaSet(paths.schemaDir), values['cdn-base']);
if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}

async function check(url: string): Promise<number> {
  let res = await fetch(url, { method: 'HEAD' });
  if (res.status === 405 || res.status === 501) {
    res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    await res.body?.cancel();
  }
  return res.status;
}

const lectures = [...catalogLectures(catalog.series)];
const failures: string[] = [];
let next = 0;
const worker = async () => {
  while (next < lectures.length) {
    const lecture = lectures[next++]!;
    try {
      const status = await check(lecture.url);
      if (status < 200 || status >= 300) failures.push(`${status} ${lecture.id} -> ${lecture.url}`);
    } catch (e) {
      failures.push(`ERR ${lecture.id} -> ${lecture.url} (${(e as Error).message})`);
    }
  }
};
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency)) }, worker));

for (const f of failures.sort()) console.error(f);
console.log(`Checked ${lectures.length} URLs: ${lectures.length - failures.length} ok, ${failures.length} failed.`);
process.exit(failures.length > 0 ? 1 : 0);
