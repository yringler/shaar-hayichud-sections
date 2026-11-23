# Brief: a rewrite pass over existing study-guide blocks (for one agent of a team)

Give each agent this file plus, in its prompt: the series, its scope (chapters,
or a chapter's sections as 0-based indexes, e.g. "sections[0] through
sections[3]"), the output path for its edit list, and the goal of the pass
(below is the condensing pass of November 2026; change "What to do" for
another kind of pass).

Repo root: the git checkout you are in. Files: `data/study/<series>/chapter_NN.json`.
First read `data/study/STYLE.md` in full and `data/study/<series>/NOTES.md`.

## What to do (the condensing pass)

The guide is there to make it easier to connect to the class, not to replace
it. Rewrite each block in your scope that needs it as the best written
study-guide version of what he teaches there (STYLE.md, "Write a guide, not a
recording" and "Condense, do not transcribe"):

1. Cut repetition, restatements, setup lines, false starts, "you know",
   recaps, and student back-and-forth that carries no point. A sharp point
   he hammers several times in a row is said once, in its strongest form,
   with his one best example.
2. Turn quoted spoken lines into guide prose. Rhetorical exchanges become one
   sentence. At most one short quote of his per block, and only a line a
   reader would remember. Quotations of sources (verses, Gemara, a Rebbe)
   stay quoted.

Expect the length to move little and the quoted words to fall by about two
thirds. Do not cut teaching to make a block shorter.

## Rules

- Only blocks without a `sensitivity` field: a flagged block's text must stay
  matched to its reviewed public text. Never touch phrases, audio, kinds,
  `outOfPlace`, notes or anything else.
- Rewrite `text`, and `title` only if it is clumsy or quotes a line you turned
  into prose.
- Never add anything he did not say, never soften (these are the uncensored
  texts), never reorder the argument. Check every block you change against its
  audio: `cd data/tools && yarn study-dump --series <series> --chapter N
  --lecture <3-digit prefix> --words <first>-<last>` with the block's
  `audio[0]` lecture and words, or read
  `data/transcripts/<url-encoded lecture>.json` (`result.timestamps[i].word`).
- Each block stays under about half the words of class it cites (the check
  warns above that).
- `**bold**` only for words quoted verbatim from the passage's phrase `en`.
  No Hebrew script in prose; "G-d", never spelled out. Terms spelled as in
  `data/study/translit.json`.
- People in the class are not named (STYLE.md). Speaker labels the transcript
  cannot support are dropped.
- A plain error (a mishearing, a wrong attribution): fix it and report it.

## Output: an edit list, not edits

Do not edit the chapter files (other agents work on the same files). Write a
JSON array to the output path in your prompt, one entry per block you change:

    { "chapter": "chapter_NN", "at": "sections[i].passages[j].blocks[k]",
      "old": "<exact current text>", "text": "<new text>", "title": "<only if changed>" }

Work a chapter (or section range) at a time and write as you go. Before
finishing, validate with a script: every `old` equals the block's current
text, no edited block is flagged, no Hebrew script, no "God", only the
allowed Markdown, balanced quote marks, every bold run in its passage's
phrase `en`.

Report briefly: per chapter, blocks changed and left, words and quoted words
before and after; errors you fixed; blocks where you were unsure whether
something was teaching or flair (chapter and `at`).
