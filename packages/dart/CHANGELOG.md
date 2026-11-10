# Changelog

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
