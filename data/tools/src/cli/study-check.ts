/**
 * yarn study-check [--series <id>] [--chapter <N>] [--quiet]
 *
 * Checks data/study/ strictly: schema, line coverage, phrases against the
 * chapter text, lectures, word ranges and their times, closeness to the
 * alignment, uncited stretches, term spellings. Errors and stale references
 * fail (exit 1); warnings are printed (not with --quiet) and do not.
 * `yarn build-data` runs the same checks but only errors fail it.
 */
import { parseArgs } from 'node:util';
import { DATA_DIR } from '../pipeline.js';
import { checkStudy } from '../study.js';
import { chapterKey } from '../transcripts.js';

const { values } = parseArgs({
  options: { series: { type: 'string' }, chapter: { type: 'string' }, quiet: { type: 'boolean', default: false } },
});
const chapter = values.chapter !== undefined ? chapterKey(values.chapter.replace(/^chapter_/, '').replace(/^0+/, '')) : undefined;
const { issues, stats } = checkStudy(DATA_DIR, undefined, { ...(values.series !== undefined ? { series: values.series } : {}), ...(chapter !== undefined ? { chapter } : {}) });

for (const level of ['warning', 'stale', 'error'] as const) {
  if (level === 'warning' && values.quiet) continue;
  for (const i of issues.filter((x) => x.level === level)) console.log(`${level.toUpperCase()} ${i.file}: ${i.message}`);
}
for (const [file, s] of stats) {
  const kinds = Object.entries(s.byKind).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`\n${file}: ${s.passages} passages (${s.skipped} skipped), ${s.blocks} blocks (${kinds}), ${s.words} words, ${s.flagged} flagged`);
  for (const c of s.coverage) {
    console.log(`  ${c.lecture}: ${Math.round((100 * c.cited) / c.words)}% of ${c.words} words cited, ${Math.round((100 * c.omitted) / c.words)}% listed as omitted`);
  }
}
const count = (level: string) => issues.filter((i) => i.level === level).length;
console.log(`\n${count('error')} error(s), ${count('stale')} stale, ${count('warning')} warning(s).`);
if (count('error') + count('stale') > 0) process.exit(1);
