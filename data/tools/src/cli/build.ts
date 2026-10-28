/**
 * yarn build-data — validate data/ and write data/dist/v1/.
 * Options: --out <dir> (default data/dist), --cdn-base <origin>.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_CDN_BASE } from '../catalog.js';
import { build, defaultPaths } from '../pipeline.js';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'cdn-base': { type: 'string', default: DEFAULT_CDN_BASE },
  },
});

const paths = defaultPaths();
if (values.out) paths.distDir = path.resolve(values.out);

const result = build(paths, values['cdn-base']);
if (result.errors.length > 0) {
  for (const e of result.errors) console.error(e);
  console.error(`\nData build failed with ${result.errors.length} error(s); nothing was written.`);
  process.exit(1);
}

const series = result.catalog?.series ?? [];
const lectures = series.reduce((n, s) => n + s.lectureCount, 0);
console.log(
  `Wrote ${result.outDir}: ${series.length} series, ${lectures} lectures, ${result.chapters?.length ?? 0} chapters.`,
);
