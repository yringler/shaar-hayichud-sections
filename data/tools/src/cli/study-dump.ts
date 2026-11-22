/**
 * yarn study-dump --series <id> --chapter <N> [--lecture <id or number>]... [--no-transcripts]
 *
 * Prints what a writer of data/study/<series>/chapter_NN.json needs: the
 * chapter's lines with ids, its classes, term spellings and the transcripts,
 * sentence by sentence, with word ranges to cite. See data/study/STYLE.md.
 */
import { parseArgs } from 'node:util';
import { DATA_DIR } from '../pipeline.js';
import { loadStudy, loadStudyContext } from '../study.js';
import { dumpChapter } from '../study-dump.js';
import { chapterKey } from '../transcripts.js';

const { values } = parseArgs({
  options: {
    series: { type: 'string' },
    chapter: { type: 'string' },
    lecture: { type: 'string', multiple: true, default: [] },
    'no-transcripts': { type: 'boolean', default: false },
  },
});
if (!values.series || !values.chapter) {
  console.error('usage: yarn study-dump --series <id> --chapter <N> [--lecture <id or number>]... [--no-transcripts]');
  process.exit(2);
}
const loaded = loadStudy(DATA_DIR);
const series = loaded.series.find((s) => s.id === values.series)?.data;
if (!series) {
  console.error(`no valid data/study/${values.series}/series.json`);
  process.exit(1);
}
const chapter = chapterKey(values.chapter.replace(/^chapter_/, '').replace(/^0+/, ''));
process.stdout.write(dumpChapter(loadStudyContext(DATA_DIR), series, loaded.translit, chapter, { lectures: values.lecture, noTranscripts: values['no-transcripts'] }));
