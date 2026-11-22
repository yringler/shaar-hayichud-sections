/**
 * yarn study-dump --series <id> --chapter <N> [--lecture <id or number>]... [--no-transcripts]
 * yarn study-dump --series <id> --chapter <N> --lecture <id or number> --words <first>-<last>
 *
 * Prints what a writer of data/study/<series>/chapter_NN.json needs: the
 * chapter's lines with ids, its classes, term spellings and the transcripts,
 * sentence by sentence, with word ranges to cite. With --words, only those
 * words of one class, each with its index (to cite part of a sentence, such
 * as a phrase's English). See data/study/STYLE.md.
 */
import { parseArgs } from 'node:util';
import { DATA_DIR } from '../pipeline.js';
import { chapterLectureIds, loadStudy, loadStudyContext } from '../study.js';
import { dumpChapter, dumpWords } from '../study-dump.js';
import { chapterKey } from '../transcripts.js';

const { values } = parseArgs({
  options: {
    series: { type: 'string' },
    chapter: { type: 'string' },
    lecture: { type: 'string', multiple: true, default: [] },
    'no-transcripts': { type: 'boolean', default: false },
    words: { type: 'string' },
  },
});
if (!values.series || !values.chapter) {
  console.error('usage: yarn study-dump --series <id> --chapter <N> [--lecture <id or number>]... [--no-transcripts] [--words <first>-<last>]');
  process.exit(2);
}
const loaded = loadStudy(DATA_DIR);
const series = loaded.series.find((s) => s.id === values.series)?.data;
if (!series) {
  console.error(`no valid data/study/${values.series}/series.json`);
  process.exit(1);
}
const chapter = chapterKey(values.chapter.replace(/^chapter_/, '').replace(/^0+/, ''));
const ctx = loadStudyContext(DATA_DIR);
if (values.words !== undefined) {
  const range = /^(\d+)-(\d+)$/.exec(values.words);
  const ids = chapterLectureIds(ctx, series, chapter);
  const lecture = values.lecture.length === 1 ? ids.find((id) => id === values.lecture[0] || /^\d+/.exec(id)?.[0] === values.lecture[0]) : undefined;
  if (!range || !lecture) {
    console.error(`--words <first>-<last> takes one --lecture, one of the chapter's classes (${ids.join(', ')})`);
    process.exit(2);
  }
  process.stdout.write(dumpWords(ctx, lecture, Number(range[1]), Number(range[2])));
  process.exit(0);
}
process.stdout.write(dumpChapter(ctx, series, loaded.translit, chapter, { lectures: values.lecture, noTranscripts: values['no-transcripts'] }));
