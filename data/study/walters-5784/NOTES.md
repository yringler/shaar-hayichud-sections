# Notes for the Rabbi Walters New Class, 5784 (`walters-5784`)

What a writer of this series' study files needs to know beyond
`data/study/STYLE.md`. Catalog series 104, "Rabbi Benyamin Walters New Class
(5784)". Add to it as the files are written and reviewed.

The teacher is the same Rabbi Walters as `walters-original` and
`walters-2020`. Read both of their NOTES.md files: `walters-original` for
the sensitivity calls on him, `walters-2020` for his manner in recent years
and the errors reviewers kept finding in writers' files ("What the reviews
kept finding"). Check those first.

The series is PUBLIC (`series.json` has `public`): flag as
`walters-original/NOTES.md` ("Sensitivity, for this series") says, and flag
more than in a private file.

## The classes

- 5784 (2023-24), one teacher and one student, by Zoom or phone, about 20 to
  100 minutes each. This set is the second half of the book only, chapters
  33-54; the first half of this run was not provided. Class 033 opens by
  recalling that they did chapters 1-32 together.
- Most files are monologues: the student is rarely heard, and never named.
  Never name a student.
- Files are numbered by chapter, not by class. A chapter recorded in two
  files is `NNN.1` and `NNN.2` (033, 037, 039, 040, 045, 046, 047, 053);
  the second usually continues the same session.
- 054 ends with a siyum on the book (from about 79:00), then the teacher's
  own recollection of how his learning of this book started: learning it at
  fifteen in Pittsburgh with Rabbi Markel, translating it, and the early
  recordings. It is the teacher speaking (he says "you can hear me clinking
  the coffee" of the early recordings; the student only confirms). Leave it out
  (`omitted`, reason `personal`; STYLE.md, What may be left out).
- The audio is the edited copy (`Walters 5784 Edited/`); only 033.1 (pre-class
  talk about selling CDs) and 054 (a mute stretch and goodbyes) had anything
  cut.

## Transcripts and alignments

- Sofer transcripts, speaker labeling off.
- 16 of the 30 had broken Sofer word times and are re-timed (STYLE.md,
  Sources).

## Tools

- `study-dump --lecture <number>` does not work for this series (its lecture
  ids start with "Walters 5784 Edited/..."). Pass the full lecture id, e.g.
  `--lecture "Walters 5784 Edited/Ch 33/033.1 Shaar HaYichud ch 33 part 1.mp3"`.
- Use the compiled CLIs (`node build/cli/study-dump.js`, `study-fill.js`,
  `study-check.js`) rather than yarn when several agents run at once.
