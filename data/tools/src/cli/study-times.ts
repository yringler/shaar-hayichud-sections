/**
 * yarn study-times [--series <id>] [--chapter <N>] [--check]
 *
 * Writes the start/end seconds of every audio reference in data/study/ from
 * its word range and the lecture's current word times (data/retimed/ when the
 * lecture has them), fills a lecture's empty transcriptionId, and rewrites
 * the file in the standard formatting. Run it after writing or editing a
 * study file, and after a tape is re-timed. --check writes nothing and exits
 * 1 if a file would change.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR } from '../pipeline.js';
import { formatStudyFile, loadStudyContext, stampTimes, type StudyChapterFile } from '../study.js';
import { chapterKey } from '../transcripts.js';

const { values } = parseArgs({
  options: { series: { type: 'string' }, chapter: { type: 'string' }, check: { type: 'boolean', default: false } },
});
const chapter = values.chapter !== undefined ? chapterKey(values.chapter.replace(/^chapter_/, '').replace(/^0+/, '')) : undefined;
const studyDir = path.join(DATA_DIR, 'study');
const ctx = loadStudyContext(DATA_DIR);
let failed = false;
let stale = false;
for (const entry of readdirSync(studyDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || (values.series !== undefined && entry.name !== values.series)) continue;
  for (const name of readdirSync(path.join(studyDir, entry.name)).sort()) {
    if (!/^chapter_\d{2}\.json$/.test(name) || (chapter !== undefined && name !== `${chapter}.json`)) continue;
    const file = path.join(studyDir, entry.name, name);
    const before = readFileSync(file, 'utf8');
    let data: StudyChapterFile;
    try {
      data = JSON.parse(before) as StudyChapterFile;
    } catch (e) {
      console.error(`${entry.name}/${name}: invalid JSON (${(e as Error).message})`);
      failed = true;
      continue;
    }
    const { changed, errors } = stampTimes(data, ctx);
    for (const e of errors) console.error(`${entry.name}/${name}: ${e}`);
    if (errors.length > 0) failed = true;
    const after = formatStudyFile(data);
    if (after === before) continue;
    stale = true;
    if (values.check) console.log(`${entry.name}/${name}: would change (${changed} time(s))`);
    else {
      writeFileSync(file, after);
      console.log(`${entry.name}/${name}: written (${changed} time(s) changed)`);
    }
  }
}
if (failed || (values.check && stale)) process.exit(1);
