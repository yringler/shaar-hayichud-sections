# Changelog

## 2.0.0

Breaking: the site stopped publishing class transcripts and the study-beta
export.

- Removed `Transcript`, `TranscriptSegment`, `parseTranscript`,
  `DataUrls.transcriptsIndex`, `DataUrls.transcript` and the
  `TranscriptTiming` extension (`/data/v1/transcripts/` is no longer
  published).
- Removed `ChapterAlignmentsLecture.transcript`.
- Removed `StudyGuideBlock.sensitivity` and `StudyGuideSensitivity` (with its
  category and action enums): every published guide is in its public
  edition, and the beta export (`/data/study-beta/`) is gone.
- Added `DataUrls.studyAdvancedIndex` (`/data/v1/study/index-advanced.json`):
  the study guides published unlisted, in the same shape as
  `DataUrls.studyIndex` (parse it with `parseStudyIndex`); their guides are
  at `study/<series>/chapter_NN.json` like the public ones.
- Files published before this release still parse: the dropped fields
  (a lecture's `transcript`, a block's `sensitivity`) are ignored.

## 1.7.0

- `StudyGuideBlock.sensitivity` (`StudyGuideSensitivity`: categories,
  reason, action, publishable text and title): optional in
  `schema/v1/study.schema.json`. The public edition (`/data/v1/study/`)
  never has it; the unlisted beta export (`/data/study-beta/v1/study/`),
  every series as written in the same shape, does, so both read with these
  models.

## 1.6.2

- The first published 1.6 release: 1.6.0 and 1.6.1 were never published to
  pub.dev. No code changes from 1.6.0.

## 1.6.0

- Public study guides (`/data/v1/study/`): `StudyIndex` (`study/index.json`:
  the series with public guides, each chapter's guide and the classes it is
  written from, with their part of the chapter in seconds) and `StudyGuide`
  (one chapter: passages of line ids, the teacher's phrase-by-phrase English
  with where he says it, and audio-anchored blocks), generated from
  `schema/v1/study*.schema.json`; `parseStudyIndex`, `parseStudyGuide`,
  `DataUrls.studyIndex` and `DataUrls.studyGuide`.

## 1.5.0

- First release on pub.dev.
- `ChapterAlignmentsLecture.chapterStartSeconds` (where a class's
  part on a chapter starts) and `playStart` (and
  `ChapterAlignmentsIndex.playStart`): a tap on a class's first line on a
  chapter plays a short lead-in, or offers a longer one (an intro).

## 1.4.0

- `lineInClass` and `playableRefs` (and
  `ChapterAlignmentsIndex.playableRefs`): a chosen class plays every line it
  reads; other lines play the best other class and can be marked.

## 1.3.1

- `rankRefs` never treats a lecture without a series as the
  preferred one (parity with the site for out-of-range indexes).

## 1.3.0

- Follow-along logic, ported from the site's
  `audio/model.ts` and checked against the same vectors: `spans` /
  `spanAt` (the current line or transcript paragraph at a time), `rankRefs`
  (which class plays for a line), `nextInSeries` (autoplay next, within the
  chapter), `chooseSeries`, `topicAt`, and the `ChapterAlignmentsIndex`
  and `TranscriptTiming` extensions.

## 1.2.0

- Alignments and transcripts are published. Added
  `ChapterAlignments` (`alignments/chapters/chapter_NN.json`),
  `parseChapterAlignments`, `DataUrls.chapterAlignments` /
  `chapterAlignmentsIndex`, `Outline` (`outlines/<lecture>.json`,
  auto-generated topics), `parseOutline`, `DataUrls.outline` /
  `outlinesIndex`, and the optional `Alignment.chapter`,
  `AlignmentSegment.confidence`, `Transcript.chapter` and
  `ChapterAlignmentsLecture.outline`.

## 1.1.0

- Chapter text is a list of `TextLine` (`id` + `text`) instead of
  newline-joined strings (`TextFragment` is gone); `TextNode` no longer has
  `id` or the deprecated `text`; alignment segments reference `lineId`.
  Added `allLines` and `Chapter.indexLines()`.

## 1.0.0

- First release.
