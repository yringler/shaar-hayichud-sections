# Writing a study file

How `data/study/<series>/chapter_NN.json` is written, for whoever drafts or
edits one, person or agent. The format is
`data/schema/study/study-chapter.schema.json`; `data/README.md` (Study guides)
says how the files are checked. Notes that hold for one series only are in
that series' `NOTES.md`.

## What a study file is for

A recorded class is an hour of speech with no paragraphs. The teacher reads a
phrase, translates it, explains it, tells a story, answers a student, goes
back to the text. A study file gives that hour the structure of a page
without replacing the recording:

- the chapter's own lines stay the spine: every line is in a passage, in
  order;
- under each passage, the translation phrase by phrase, then **blocks**: one
  thought each, a paragraph or two, in readable prose;
- every block points at the stretch of the recording it was written from, so
  a reader can hear the teacher say it. The block is the paragraph the
  recording lacks, and the place to jump to;
- an analogy, a story, a question, a practical point and a digression are
  each their own block, labelled, so they can be found, listed and skipped;
- it is the teacher's class, in his words and his manner. It is neither a
  summary nor a new commentary.

## Sources

Write from the series' classes on the chapter and from nothing else.
`yarn study-dump --series <series> --chapter <N>` (in `data/tools`) prints
everything: the lines with their ids, the classes, the spellings that apply,
and each class as sentences, `[w<first>-<last> <time>] text`, with a
`=== LINE` mark where the class reads each line. `--lecture <number>` prints
one class; `--no-transcripts` prints the header only.

The transcript is machine-made. Its Hebrew is what the machine heard, often
wrong; the chapter's lines are the text. English can be misheard too: if a
sentence makes no sense, do not guess (see Faithfulness).

## Structure

```
chapter
  title, overview (100–200 words), terms (6–12)
  sections (4–9)                    a concept, with a descriptive title and a summary
    passages (1–8 per section)      consecutive lines taught together (usually 1–4)
      phrases                       the lines' Hebrew, phrase by phrase, with English
      blocks                        what the class says about them, in class order
  reviewQuestions (4–6)
  omitted                           stretches of class no block uses, with the reason
  notes                             for the reviewer
```

- **Sections** follow the teacher's own turns ("now he's getting to…", "so
  the answer is…") and the section labels of the chapter file. A title says
  what the section teaches ("The answer is tzimtzum: light, not cause and
  effect"), never "Part 3". The `summary` is the concept in one or two
  sentences.
- **Passages** cover every line of the chapter exactly once, in order. Start
  a new passage where the teacher stops reading and starts explaining.
- A passage the series never reads has `"blocks": []` and
  `"skip": { "reason": "no-recording" }` (phrases optional). One the class
  reads and translates without comment has phrases and
  `"skip": { "reason": "read-only" }`; better, join it to its neighbour.

## Phrases

The passage's Hebrew cut where the teacher stops to translate, usually 2 to
10 words a phrase, each with its English.

- `he` must be the lines' text exactly. Do not type it: write
  `{ "to": "<the phrase's last word>", "en": "…" }` and let `yarn study-fill`
  copy the Hebrew from the chapter (the last phrase of a passage needs no
  `to`). `to` is matched from where the previous phrase ended, ignoring
  punctuation around the word.
- `en` follows the teacher's own rendering when he gives one; where he only
  reads, give a plain, literal rendering in the words he uses elsewhere. Keep
  a term he leaves in Hebrew as an italic transliteration with the meaning
  after it at first use: `the *tzimtzum* (contraction)`. Words added for
  English sense go in square brackets. Italics only, no bold.
- A series whose translation comes from a published one says so in
  `series.json` or the file's `provenance`; then `en` is that translation,
  verbatim, and its footnotes go in `notes`.

## Blocks

A block is one thought of the class. It has a `kind`, `text`, and `audio`.

| kind | what it is | needs |
|------|------------|-------|
| `explanation` | what the words of the passage mean | |
| `mashal` | an analogy or example, with what it stands for | `title` |
| `keyPoint` | the point to take away, when he stresses one | |
| `question` | a question a student or the teacher raises, and his answer | `question`, `askedBy` |
| `story` | a story, an event, a recollection | `title` |
| `avodah` | what to do with it: in prayer, in contemplation, in conduct | |
| `aside` | a remark off the line: a joke, a sharp opinion, a comment on the world | |
| `digression` | a longer excursion away from the text | `title` |
| `recap` | a later summary of the passage (often the next class's opening) | |

- **Size.** 30 to 200 words. A long explanation is several blocks, one per
  step; set `"join": true` on a block that continues the previous block's
  paragraph. If he only translates a line, one short block is enough.
- **Order.** Class order. A point he makes elsewhere (an earlier class, a
  later recap) may be placed under the passage it explains; say so in
  `outOfPlace`.
- **Titles** on `mashal`, `story` and `digression` are short labels to
  navigate by: "The film in the projector", "Bilaam's donkey".
- **`question` blocks**: `question` is the question in a sentence, `askedBy`
  is `student` or `teacher`, `text` is the answer. Keep a student's question
  only when he answers it.

### Audio

`"audio": [{ "lecture": "<lecture id>", "words": [first, last] }]`

- `words` are the indexes in the dump: the first word of the first sentence
  the block was written from and the last word of its last sentence. Include
  the reading of the line when the block opens the passage, so that playing
  the block starts with the text.
- Never write `start` or `end`; `yarn study-fill` writes them from the words.
- Consecutive blocks should not overlap, and together they should cover the
  class. `yarn study-check` lists every stretch of 250 words or more that no
  block cites: write the missing block, or list the stretch in `omitted`.
- A second entry in `audio` is another telling of the same thing (he reads
  the passage twice, or sums it up next class).

### What may be left out

Only what `omitted` has a reason for: `logistics` (the tape, the phone, who
is on the call), `reading` (text read or reread with no comment),
`repetition` (said again with nothing added), `unclear` (garbled, or you
cannot tell what he meant), `other-chapter`, `other` (with a `note`).
Everything else he says has a block, **including what is off the text**: the
joke, the story about a relative, the opinion on science or politics, the
complaint. Those are `aside`, `story` or `digression` blocks. They are part
of the class, and often the part a student remembers.

## Voice

- **Explanations** are impersonal and in the present tense, as in *Lessons in
  Tanya*: "The light of the projector stays the same." Do not write "Rabbi
  Markel says" in every block. The file is his class throughout.
- **Keep his manner.** Use his examples, his turns of phrase, his order, his
  humor, his bluntness. If he says "poof, the world", write that. A line of
  his worth having word for word goes in quotation marks. Dialogue he acts out
  ("What, you changed your mind?") stays dialogue.
- **Do not soften, tidy or improve.** No hedges he did not make, no balance he
  did not give, no modern sensitivity, no moral he did not draw. If he is
  rude about something, the block is rude about it (and flagged, below).
- **Rework speech into prose.** Drop false starts, repetitions, "you know",
  the listener's "Right." Join what he says in three tries into one clear
  sentence. Keep his words where they are good.
- Name him (as the series' `NOTES.md` says) only for something personal: a
  recollection, an opinion he marks as his own, a disagreement with a reading.
- In a `story` or `aside`, tell it as he tells it, in the third person about
  him if he is in it.

## Faithfulness

- Every sentence must be traceable to the cited words. No outside sources,
  cross-references or Torah content he did not say. If he cites a source,
  report it as he gave it, even loosely ("it says somewhere in the *Zohar*").
  If he is unsure or wrong about a reference, write what he said and put the
  correction in `notes`, not in the text.
- If a stretch is garbled or you cannot tell what he meant, leave it out,
  list it in `omitted` as `unclear`, and add a `notes` entry. Never guess.
- Literal word meanings in glosses are allowed.

## Sensitivity

The files are private and uncensored. A public edition may come later, so
mark what could not be published as it stands. **The `text` is never
softened**: marking is what lets it stay as he said it.

Flag a block with `sensitivity` when it does any of these:

| category | examples |
|----------|----------|
| `women` | generalisations or jokes about women, or about men and women |
| `other-religions` | disparaging another religion, its founders or its followers |
| `other-groups` | remarks about nations, races, movements within Judaism, professions |
| `named-person` | criticism or gossip about a named or identifiable person, living or recent |
| `politics` | partisan or political opinions |
| `crude` | crude language or imagery |
| `health-or-legal` | medical, psychological, legal or financial advice a reader might act on |
| `private` | personal details of a student, the family, the teacher |
| `other` | anything else you would not print with his name on it without asking him |

```json
"sensitivity": {
  "categories": ["other-religions"],
  "reason": "Calls a named religion idol worship in passing.",
  "action": "replace",
  "publishable": "The same point, made without the comparison."
}
```

- `action: "replace"` with a `publishable` text that keeps the teaching and
  drops only what the reason names; or `action: "omit"` when nothing would be
  left (a pure aside).
- Put the remark in a block of its own (an `aside`), so that the swap touches
  one sentence and not the explanation around it.
- When in doubt, flag. A flag costs nothing; a missed one is found by a
  stranger.
- Do not flag ordinary humor, strong Torah positions stated as such, or
  criticism of ideas (as opposed to people and groups).

## Prose rules

- Markdown, inline only: `*italics*` for transliterated terms and titles of
  works; `**bold**` only for words quoted from the passage's `en` (verbatim;
  `…` inside a bold run joins two pieces); a blank line between paragraphs.
  No headings, lists, links, block quotes or HTML.
- Hebrew terms are italic transliterations, spelled as in
  `data/study/translit.json` (the dump lists the ones that occur). At a
  term's first use in the chapter give the meaning in parentheses; after
  that, bare. Translate instead where it reads naturally. Proper names
  (sefiros, worlds, people, books) are capitalised; follow the table.
- A term the table lacks: spell it in the table's manner (Ashkenazi, as
  Chabad speaks: *s* for ת without dagesh, *ch* for ח and כ, final *-us*,
  *-a*), put it in the file's `terms`, and use that spelling throughout. **Do
  not edit `translit.json`**: it is shared. New terms are moved into it later
  by whoever merges the chapters.
- Write G-d, G-dly, G-dliness. No Hebrew script in prose.
- Plain ASCII quotes and apostrophes.

## The rest of the file

- `title`: an English working title for the chapter.
- `overview`: what the chapter says as these classes teach it, 100 to 200
  words. Write it last.
- `terms`: 6 to 12 key terms, glossed as he explains them here, each with the
  `line` where it first matters.
- `reviewQuestions`: 4 to 6, each answerable from the file, each with the
  `lines` of the passage that answers it.
- `lectures`: every lecture cited, in class order, with the `transcriptionId`
  the dump prints.
- `status`: `draft`. `provenance`: `{ "method": "generated", "from":
  "<skill name and version>", "date": "YYYY-MM-DD" }`. Never a generator's
  name or version.
- `notes`: what you were unsure of, left out or decided, each with the
  `lines` it concerns.

## Checking

```bash
cd data/tools
yarn study-fill --series <series> --chapter <N>     # phrases' Hebrew, seconds, formatting
yarn study-check --series <series> --chapter <N>    # must end "0 error(s), 0 stale"
```

Read every warning: fix it, or be able to say why it stands.
