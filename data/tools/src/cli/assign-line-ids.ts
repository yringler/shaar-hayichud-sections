/**
 * yarn assign-line-ids — give every chapter line a stable id.
 *
 * Idempotent: existing ids are kept; only lines without one (including
 * legacy "\n"-joined strings) get a new random id, unique across all chapters.
 * A duplicated id keeps its first occurrence (in file order); later copies get
 * new ids.
 * Each file keeps its indent style and trailing newline.
 *
 * Options: --dir <chapters dir> (default data/chapters), --check (write
 * nothing; exit 1 if any line lacks an id or an id is used twice).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { indexLineIds, type Chapter } from '../chapter.js';
import { assignLineIds, collectLineIds, formatLike, hasAllLineIds, type LegacyNode } from '../assign-line-ids.js';
import { defaultPaths } from '../pipeline.js';
import { CHAPTER_FILE } from '../validate.js';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});

const dir = values.dir ? path.resolve(values.dir) : defaultPaths().chaptersDir;
const files = readdirSync(dir)
  .filter((f) => CHAPTER_FILE.test(f))
  .sort()
  .map((f) => {
    const file = path.join(dir, f);
    const raw = readFileSync(file, 'utf8');
    return { name: f, file, raw, data: JSON.parse(raw) as LegacyNode[] };
  });

if (values.check) {
  const missing = files.filter((f) => !hasAllLineIds(f.data)).map((f) => f.name);
  if (missing.length > 0) {
    console.error(`Lines without ids in: ${missing.join(', ')}\nRun: yarn assign-line-ids`);
    process.exit(1);
  }
  const { errors } = indexLineIds(
    files.map((f) => ({ key: f.name.replace(/\.json$/, ''), data: f.data as unknown as Chapter })),
  );
  if (errors.length > 0) {
    console.error(`Duplicate line ids:\n${errors.join('\n')}\nRun: yarn assign-line-ids`);
    process.exit(1);
  }
  console.log(`All lines in ${files.length} chapters have unique ids.`);
  process.exit(0);
}

const taken = new Set<string>();
for (const f of files) collectLineIds(f.data, taken);

const kept = new Set<string>();
let total = 0;
for (const f of files) {
  const { chapter, assigned } = assignLineIds(f.data, taken, undefined, kept);
  if (assigned === 0) continue;
  writeFileSync(f.file, formatLike(f.raw, chapter));
  console.log(`${f.name}: ${assigned} new line id(s)`);
  total += assigned;
}
console.log(`Assigned ${total} line id(s) across ${files.length} chapters.`);
