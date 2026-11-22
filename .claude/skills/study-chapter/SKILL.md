---
name: study-chapter
description: Write or revise one chapter's study guide file (data/study/<series>/chapter_NN.json) from a class series' transcripts - passages of chapter lines with a phrase-by-phrase translation and audio-anchored blocks (explanation, mashal, story, question, aside...). Use when asked to generate, upgrade or fix the study guide of a chapter for a series.
---

# Write one chapter's study guide

Skill version 2. You produce exactly one file:
`data/study/<series>/chapter_NN.json`. You are given a series id (a
directory under `data/study/`, e.g. `markel-advanced`) and a chapter number.

**Touch nothing else.** Other writers are working on other chapters at the
same time. Do not edit `data/study/translit.json`, `STYLE.md`, `NOTES.md`,
`series.json`, another chapter's file, chapter text, alignments or tools. If
one of them is wrong or lacking, say so in your final report (and, for a
term, define it in your file's `terms`). Do not commit unless told to.

## 1. Read

1. `data/study/STYLE.md`: the rules. Read all of it; it is the contract.
2. `data/study/<series>/NOTES.md`: what holds for this series.
3. `data/study/markel-advanced/chapter_09.json`: the model file. Look at how
   its passages, phrases and blocks are cut, how long blocks are, how asides
   and questions are kept, and at its one `sensitivity` flag.
4. The dump (run in `data/tools`; `corepack yarn` if plain `yarn` is 1.x;
   `yarn install` once if `node_modules` is missing):

   ```bash
   yarn study-dump --series <series> --chapter <N> --no-transcripts   # lines, classes, spellings
   yarn study-dump --series <series> --chapter <N> --lecture <number> # one class
   ```

   Save each class's dump to a file in your scratch directory and read it
   **whole**, in class order, before writing anything about it. Do not write
   from the auto-generated topics, from memory of the book, or from skimming.

If the file already exists (a ported or earlier draft), you are revising it:
read it too, keep what is right, and bring it up to STYLE.md (phrases cut as
taught in class, every stretch of class accounted for, titles, flags). Set
`provenance` to `generated`.

## 2. Plan

Before writing JSON, write yourself a plan (not in the repo):

- the sections (4 to 9), each a run of lines, with a working title;
- within each, the passages (runs of lines), and for each passage the
  blocks: kind, word range, one line on what it says;
- every stretch of every class is in some block's range or on your
  `omitted` list. Walk each class's dump from its first word to its last
  and check that the ranges join up.

Things that go wrong here:

- **Lines the class never reads** (the dump says `NOT READ`): they still
  need passages (`skip: no-recording`), grouped by sense.
- **A class that reads no line** (free discussion): its blocks go under the
  passage being discussed, with `outOfPlace` saying so, or under the
  chapter's last passage if it is about the whole chapter.
- **`=== LINE` marks are approximate.** The alignment marks where a line's
  words are heard; he often reads the next phrase before finishing his
  explanation of the last, or reads a line twice. Decide the block's passage
  by what is being explained, not only by the mark.
- **Tape ends.** A side can stop mid-sentence and the next class resume it.
  The end of a side is sometimes another recording altogether: `omitted`,
  reason `other`.

## 3. Write

Write the file (see the schema, `data/schema/study/study-chapter.schema.json`,
and the model). Mechanics that save mistakes:

- **Phrases**: never type Hebrew. Write `{ "to": "<last word>", "en": "…" }`;
  the last phrase of a passage is just `{ "en": "…" }`. `to` matches the
  first occurrence of that word after the previous phrase's end, so when
  the word repeats inside the phrase (a second `כו'`, a second `מלא`), end
  the phrase at the earlier one or pick a different cut.
- **Audio**: `{ "lecture": "<full lecture id>", "words": [first, last] }`,
  from the `[w<first>-<last>]` of the dump. No `start`/`end`.
- `lectures`: every lecture you cite, with the `transcriptionId` the dump's
  class list prints.
- JSON strings: escape `"` as `\"`; a paragraph break inside a text is `\n\n`.
- A long chapter (more than three classes): write and check it class by
  class. Until the last passage exists, `study-check` reports the lines not
  yet covered as stale; that is expected.

Then:

```bash
yarn study-fill  --series <series> --chapter <N>   # Hebrew of phrases, seconds, formatting
yarn study-check --series <series> --chapter <N>
```

Repeat until `study-check` ends with `0 error(s), 0 stale`. Then go through
every warning:

| Warning | What to do |
|---------|------------|
| words … neither cited nor listed in "omitted" | read that stretch again; write its block, or list it with the true reason |
| starts at …, but the class reads this passage at … | move the block to the passage it explains, or add `outOfPlace` |
| class … does not read this passage's lines | the same |
| bold … is not in the passage's translation | quote the phrase's `en` exactly, or drop the bold |
| a mashal/story/digression without a "title" | add one |
| is N words; split it | split at the turn of thought |
| has Hebrew script | transliterate |
| term … does not appear in the file's prose | use it or drop it from `terms` |
| spelled differently across chapters | use the other chapter's spelling unless it is wrong; report it |

A warning may stand only if you can say why in your report.

## 4. Review your own file

Read the finished JSON once against the dump, as a reviewer who distrusts
it. For each block, the question is "did he say this, here?"

- [ ] Pick ten blocks spread across the file; for each, reread the cited
      sentences. Every claim in the block is in them. Nothing of substance
      in them is missing from the block.
- [ ] No sentence states Torah content, a source or an example that is not
      in the cited words.
- [ ] Every joke, story, sharp remark and digression in the classes has a
      block. Search the dumps for the things a tidy writer drops: laughter,
      names of people, "by the way", "you know what they say", opinions on
      the world. Compare `study-check`'s coverage lines: each class should
      be near 100% cited plus omitted.
- [ ] Nothing was softened. Where his wording is blunt, the block is.
- [ ] Every block a public edition could not print as it stands has
      `sensitivity`, in a block of its own where possible, with a
      `publishable` text that keeps the teaching.
- [ ] Phrases: read each `he` beside its `en`; the English is that Hebrew
      and no more. The cuts fall where he pauses.
- [ ] Bold quotes only the translation. Terms are spelled as the dump's
      spellings list says. First use glossed. G-d spelled so.
- [ ] Section titles describe; summaries are one or two sentences; the
      overview is 100 to 200 words and true to the blocks; 4 to 6 review
      questions, each answerable from its lines' passage.
- [ ] `notes` lists everything you were unsure of, with line ids.
- [ ] `yarn study-check --series <series> --chapter <N>`: 0 errors, 0 stale.
- [ ] `git status`: only your chapter file changed.

## 5. Report

End with a short report: the file; the counts `study-check` prints (passages,
blocks by kind, flagged, coverage per class); the lines with no recording;
warnings left standing and why; terms you defined that `translit.json`
lacks; anything wrong you saw in files you may not edit (a misaligned line,
a class that reads a different chapter than the catalog says, a spelling in
the table); and what a reviewer should look at first.
