# Notes for the Rabbi Walters New Class, 2020 (`walters-2020`)

What a writer of this series' study files needs to know beyond
`data/study/STYLE.md`. Catalog series 90, "Rabbi Benyamin Walters New Class
(2020) - Edited". Written before any chapter file existed; add to it as the
files are written and reviewed.

The teacher is the same Rabbi Walters as `walters-original`, about thirty
years later. Read `walters-original/NOTES.md` for his manner, images and the
sensitivity calls on him; check here and in the classes whether they still
hold, and record what differs.

The series is PUBLIC (`series.json` has `public`): the public edition is
printed with his name on it, so flag as `walters-original/NOTES.md`
("Sensitivity, for this series") says, and flag more than in a private file.

## The classes

- Live classes over Zoom (sometimes by phone) in 2020, about 20 to 45
  minutes each, numbered 001-061 in one run. One or two students, usually
  the same one; a second joins at times. They ask and answer aloud, so there
  is real back-and-forth (STYLE.md on questions; never name a student).
- These are the EDITED recordings (folder `Walters 2020 Edited/`): pre-class
  setup, goodbyes, Zoom and phone trouble and a few off-topic asides were cut
  out, so a class can begin mid-greeting-free and splices are seamless. The
  unedited originals are catalog series 75; do not cite them.
- 004 and 008 were each one class recorded in two files (a Zoom restart);
  the edited files join them, so 004 and 008 are single lectures.
- Chapters and classes: ch 1 = 001-007 (001 opens with a general
  introduction to the sefer before chapter 1), ch 2 = 008-009, ch 3 = 010-012,
  ch 4 = 044-045, ch 5 = 046-047, ch 6 = 048-051, ch 7 = 052-053,
  ch 8 = 054-055, ch 9 = 056, ch 10 = 057-061 (057 is an introductory recap
  and 061 a recap and extension; both read no line and are attached to
  chapter 10 through `series.json`).
- 013-043 are Reb Hillel's Biur (commentary) on chapter 3, read from "the
  back" of the book (pp. 316-341). They do not read chapter text and are not
  part of any chapter file yet. 012 begins reading the Biur after finishing
  chapter 3's lines; that stretch of 012 belongs to the Biur, so list it in
  `omitted` with that reason unless it explains a line of the chapter.
- He gives page and column ("we're on page 330, the second column") and
  opens most classes with "so we're up to..." and a short recap.

## Transcripts and alignments

- Sofer transcripts, speaker labeling off (students are not separated from
  the teacher: tell who speaks from the content).
- 42 transcripts had broken Sofer word times and are re-timed (STYLE.md,
  Sources); the others use Sofer's times.
- Alignments to chapter lines are strong for chapters 1, 2 and 4-10 (mean
  confidence 0.85-0.98, consecutive classes continue line by line). 004 and
  008 are weaker (0.76, 0.66).

## What the reviews kept finding

Every chapter was written by one agent and reviewed by another; these are
the writers' recurring errors. Check them first.

- Phrase audio starting or ending on his Hebrew reading instead of his
  English (in most chapters, most phrases). He reads a clause in Hebrew,
  then gives the English, sometimes a sentence later: cite only the English
  words, and leave a phrase Hebrew-only when he gives none.
- Sentences pulled into a block from the neighbouring block's span.
- Wrong speaker: a student's story, example or citation told as the
  teacher's. The student speaks often in 2020 (not in 5784): read who says it.
- Wrong Rebbe: "Reb Hillel Paritcher gives a mashal" where he says the
  Frierdiker Rebbe (ch 1); "his son, the Mitteler Rebbe" where the passage is
  the author speaking of his father, the Alter Rebbe (ch 4).
- His hedges dropped ("I think", "I believe", "if I'm not mistaken", "it
  could be based on the Zohar"); keep them.
- Publishable text reworded beyond the flagged words.

## His manner and recurring images (2020)

- Leans on modern examples: Zoom, phones, iPhones, toasters and radios,
  investing, scientists, Jim Kwik and memory training. Brand and person
  names in stories are flagged named-person in this public series.
- Sharp words that recur and are flagged (other / other-groups): "snob",
  "stupid", "psychobabble", "peasant", remarks on Kabbalists showing off.
  Criticism of ideas (philosophy, intellectual models) is left unflagged.
- Statements on women's daas and roles (ch 1, class 006) are flagged
  judgment, as in walters-original.
- "Ner Mitzvah v'Torah Ohr" (007): the volume in which Shaar HaYichud is
  printed, so "the introduction of this book" is right.

## Tools

- `study-dump --lecture <number>` does not work for this series (its lecture
  ids start with "Walters 2020 Edited/...", and the tool matches a leading
  number). Pass the full lecture id instead, e.g.
  `--lecture "Walters 2020 Edited/Shaar HaYichud/Ch 01/Shaar HaYichud 001.m4a"`;
  the same for `--words` lookups.
