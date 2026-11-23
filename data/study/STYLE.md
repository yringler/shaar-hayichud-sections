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
- under each passage, the teacher's translation phrase by phrase, then
  **blocks**: one thought each, a paragraph or two, in readable prose;
- every block points at the stretch of the recording it was written from, so
  a reader can hear the teacher say it. The block is the paragraph the
  recording lacks, and the place to jump to;
- an analogy, a story, a question, a practical point and a digression are
  each their own block, labelled, so they can be found, listed and skipped;
- it is the teacher's class, in his manner and with his examples,
  **condensed**: a reader gets in two minutes what took him ten. It is not a
  transcript, not a summary of the chapter and not a new commentary.

**The guide is there to make it easier to connect to the class, not to
replace it.** That is the test for every choice below. A block says what he
teaches clearly enough that a reader knows what is in that stretch and
wants to hear it, and points at the audio where he says it. It does not try
to carry everything the recording carries: his voice, his timing, the
flavor of a joke and the back-and-forth with the class stay in the
recording, which is one tap away. So a block can drop flair and spoken
asides without loss, and a softened public text loses little; what a block
must never do is change what he teaches.

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

The transcript has no speaker labels, and it writes many Hebrew terms in
Hebrew script inside English sentences ("the עיון is a כלי for the השגה"):
write them transliterated (Prose rules). Where his reading of a line differs
from the chapter file, the line is the text, and his English usually follows
the line, a sign the transcript misheard. Check a block's prose against the
line wherever the two differ: a block once followed "d'yihyeh lo bayis", a
mishearing of ההיולי לבא לגלוי, and spoke of "a house of his own".

Some tapes have Sofer's word times and not re-timed ones (the dump says
which). Their seconds can be off by a lot; the word ranges are right, and
`yarn study-fill` re-stamps the seconds when the tape is re-timed.

The `=== LINE` marks are approximate; the dump's sentences are what count. A
mark can land on his second reading or a reread, on a recap of earlier
lines, or on a false hit in a review; a class can read half a line well
before the line's mark; a line marked `NOT READ` can be read (often in
Aramaic, or inside the previous line's mark). Place blocks by where he
actually reads and what he is explaining. Do not edit alignments; report a
wrong one.

## Structure

```
chapter
  title, overview (100–200 words), terms (6–12)
  sections (4–9)                    a concept, with a descriptive title and a summary
    passages (1–8 per section)      consecutive lines taught together (usually 1–4)
      phrases                       the lines' Hebrew, phrase by phrase, with his English
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
- A passage the series never reads has `"blocks": []`,
  `"skip": { "reason": "no-recording" }` and no `phrases`. One the class
  reads and translates without comment has phrases and
  `"skip": { "reason": "read-only" }`; better, join it to its neighbour.
- **Classes join mid-thought.** A tape can stop in the middle of a line or a
  sentence, and the next class pick it up. A class that opens by finishing
  or summing up the previous one: place that under the passage it belongs
  to, as a `recap` with `outOfPlace`.
- **A class or a long stretch that reads no line** (an introduction, free
  discussion, a review, an extra tape attached through `series.json`
  `chapterLectures`): its blocks go under the passage they discuss or come
  back to, or under the chapter's last passage when they are about the
  chapter as a whole, each with `outOfPlace`.

## Phrases

The passage's Hebrew cut where the teacher stops to translate, usually 2 to
10 words a phrase.

**The English is only his, from this class.** A phrase's `en` is the
teacher's own rendering, as he gives it when he reads the phrase, and its
`audio` points at where he says it. Nothing else goes in `en`: no rendering
of your own, however plain, and no published translation.

- `he` must be the lines' text exactly. Do not type it: write
  `{ "to": "<the phrase's last word>", "en": "…", "audio": … }` and let
  `yarn study-fill` copy the Hebrew from the chapter (the last phrase of a
  passage needs no `to`). `to` is matched from where the previous phrase
  ended, ignoring punctuation around the word.
- `audio` is `{ "lecture": "<lecture id>", "words": [first, last] }`: the
  stretch where he gives the English of that phrase, usually just after he
  reads it, not the reading of the Hebrew. Sentence ranges are too coarse:
  `yarn study-dump … --lecture <number> --words <first>-<last>` prints each
  word of a stretch with its index. A phrase he translates twice cites the
  telling its `en` follows.
- `en` is his English tidied as a block is (false starts and "you know"
  dropped), not reworded. Keep a term he leaves in Hebrew as an italic
  transliteration, with his gloss after it if he gives one:
  `the *tzimtzum* (contraction)`. Add no words of your own. Italics only,
  no bold.
- **A phrase he reads but does not translate** keeps its `he` and has no
  `en` and no `audio`: `{ "to": "<last word>" }`. Cut it where his
  translated phrases end, so his English is never stretched over words he did
  not translate.
- **Read on before leaving `en` empty.** He sometimes renders a line piece by
  piece a sentence or two later, or only when he comes back to it. The
  phrase may cite that later sentence; say so in `notes`. A line he never
  reads keeps its Hebrew and no English, even if a nearby sentence restates
  it.
- **`en` stops where his rendering stops.** A gloss, summary or example that
  runs on from it goes in the block. When he quotes a whole verse for one
  word of it, the phrase gets only his English for its own words. When he
  reads words without translating and then renders them with the next words,
  make them one phrase.
- A passage no class reads has no phrases at all.
- Only a series whose `series.json` names a `publishedTranslation` may have
  `en` without `audio`; none does.

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

- **Size.** 30 to 150 words, and about a third to a half of the words it
  cites (the check warns past 60% on a stretch of 120 words or more). A long
  explanation is several blocks, one per
  step; set `"join": true` on a block that continues the previous block's
  paragraph. If he only translates a line, one short block is enough.
- **Order.** Class order. A point he makes elsewhere (an earlier class, a
  later recap) may be placed under the passage it explains; say so in
  `outOfPlace`.
- **Titles** on `mashal`, `story` and `digression` are short labels to
  navigate by: "The film in the projector", "Bilaam's donkey". An image he
  comes back to in later chapters keeps the same title wherever it appears.
- **`mashal` or `story`.** A general pattern (husbands and wives, a source
  cited as one more example) is a `mashal`; `story` is for a single event
  (the dog on the boy's grave, a Rebbe story).
- **`recap` or `explanation`.** When the text says "as explained above" and
  he goes back over an earlier chapter's *mashal* right there, that is an
  `explanation` in its place, not a `recap`.
- **`question` blocks**: `question` is the question in a sentence, `askedBy`
  is `student` or `teacher`, `text` is the answer. Keep a student's question
  only when he answers it. The transcript does not say who speaks: a question
  is a `student`'s when you can hear it or he repeats it; one he puts
  himself ("So you say, ...", "You're going to say to me, 'Wait a
  minute...'") is the `teacher`'s. An answer to a question you cannot hear is
  written as his own explanation; if you do infer the question, say so in
  `notes`. Where a listener gave the example, say so ("like you were just
  saying"); never write "as was said in class".

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
A remark to the recording or the room inside a block's stretch ("Still
there?", "Where do we go?") is simply dropped from the prose; a stretch of
them is `logistics`. A tape's last seconds that are another recording
altogether (another speaker, another subject) are `other`, with a note.
Everything else he says has a block, **including what is off the text**: the
joke, the story about a relative, the opinion on science or politics, the
complaint. Those are `aside`, `story` or `digression` blocks. They are part
of the class, and often the part a student remembers.

## Voice

- **Explanations** are impersonal and in the present tense, as in *Lessons in
  Tanya*: "The light of the projector stays the same." Do not write "Rabbi
  Markel says" in every block. The file is his class throughout.
- **Keep his manner.** Use his examples, his turns of phrase, his order, his
  humor, his bluntness. If he says "poof, the world", write that.
- **Write a guide, not a recording.** Say his point in written prose, in the
  guide's voice. His spoken English stays out of quotation marks: at most one
  short quote per block, and only a line a reader would remember (a
  punchline, a striking image), not ordinary explanation he happened to say.
  Dialogue he acts out and exchanges with students ("What do you mean?" "I
  understand.") become a sentence of prose. Verbal flair spices up the
  recording but the guide loses nothing without it; the audio keeps it. A
  quotation of a source (a verse, the Gemara, a saying of a Rebbe) is not his
  spoken English and stays quoted.
- **Do not soften, tidy or improve.** No hedges he did not make, no balance he
  did not give, no modern sensitivity, no moral he did not draw. If he is
  rude about something, the block is rude about it (and flagged, below).
- **Condense, do not transcribe.** Speech circles; the block goes straight.
  Drop false starts, repetitions, "you know", the listener's "Right.", the
  setup before a point ("let me explain something"), the second and third
  restatement of the same idea, and recaps of what the block already said.
  Join what he says in three tries into one clear sentence. A sharp claim is
  said once: when he hammers a point three to five times in a row (the Bin
  Laden *mashal* in `markel-advanced` chapter 20: "he would kill
  everybody... kill millions... kill his own people... kill himself"), the
  block keeps it once, in its strongest form, with his one best example.
  This holds for flagged blocks too: printing a remark raw keeps what he
  said, not every repetition of it. Tell a *mashal* or
  a story in its few decisive moves, not every beat. Keep what is his: the
  example, the image, the joke, the turn of phrase, and the one line worth
  quoting. Condensing never adds, softens or reorders the
  argument; it only leaves out what he said twice or said on the way.
- Name him (as the series' `NOTES.md` says) only for something personal: a
  recollection, an opinion he marks as his own, a disagreement with a reading.
- In a `story` or `aside`, tell it as he tells it, in the third person about
  him if he is in it.
- **"We" and "he".** Keep his "we" when he announces what comes next ("now
  we're going to explain"): "he" reads as the Mitteler Rebbe. When he speaks
  as "I" or "me" inside a *mashal*, the third-person prose says "a person",
  not an unclear "him".
- **People in the class.** When he uses someone present or close as his
  example (a student by name, the student's wife, his own wife, son or
  grandson), write the same point without the person: "a frum woman who is
  into learning", "a small child learning his letters", "a friend you have
  known for years". Never put their name, family or circumstances in the
  text; the example loses nothing. This is the one place the text does not
  keep what he said, so it needs no flag. Flag `private` only when the point
  cannot be made without the person.

## Faithfulness

- Every sentence must be traceable to the cited words. No outside sources,
  cross-references or Torah content he did not say. If he cites a source,
  report it as he gave it, even loosely ("it says somewhere in the *Zohar*").
  If he is unsure or wrong about a reference or a fact, write what he said,
  with his hesitation ("I think"), and put the correction in `notes`, not in
  the text. When he corrects himself, the text has his final version and
  `notes` the slip. Keep apart what he says he saw in a source and his own
  "maybe" on top of it.
- If a stretch is garbled or you cannot tell what he meant, leave it out,
  list it in `omitted` as `unclear`, and add a `notes` entry. Never guess.
- When he comments on the printed text ("the os is supposed to be a tes"),
  record it in `notes`; the chapter's lines stay the text.
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
| `private` | personal details that cannot be written out of the point (see People in the class) |
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
  drops only what the reason names, with his own example where it survives
  (keep "a hut, or two huts and a couple of cows" and drop only "Africa"),
  condensed as the `text` is. It neither softens more than the reason names
  nor adds a sentence he did not say. `action: "omit"` only when nothing
  would be left (a pure aside).
- Write the two side by side: everything outside the flagged remark is the
  same words in `text` and `publishable`, so that a word diff of the two
  shows only what the reason names. If writing the public text finds a
  tighter way to say the rest, tighten `text` the same way: a reviewer who
  sees the whole block reworded cannot tell what the flag removes, and a
  `text` left closer to the transcript than its public twin is not
  condensed enough.
- A `publishable` text may keep only the point. A joke or an image that is
  easy to misread in print (Rabbi Raichik's nose through his tallis) can be
  left out of it: the block's audio is there for whoever wants the class
  itself, and listeners get the full flavor.
- Put the remark in a block of its own (an `aside`), so that the swap touches
  one sentence and not the explanation around it.
- When in doubt, flag. A flag costs nothing; a missed one is found by a
  stranger.
- `"reviewed": "YYYY-MM-DD"` on a flag means a person has checked it against
  the class and accepted it as it stands. Never add it yourself. If you
  change a reviewed block's `text` or `title`, or its flag's `action`,
  `publishable` or `publishableTitle`, delete `reviewed`: the change needs a
  new look.
- A flag is never deleted because a reviewer chose to print it as said: it
  becomes `"action": "keep"` (with `reviewed`, no `publishable`), so that a
  later reviewer can go through every flag again. Both exports print a `keep`
  block as said and without the flag. Only a writer's flag that should never
  have been raised (a rule says it is not flagged) is removed.
- Do not flag ordinary humor or criticism of ideas (as opposed to people
  and groups).
- **Flag the teacher, not the text.** The chapter's own words, a figure of
  the Talmud the line cites, the Mitteler Rebbe's own claims, and physiology
  or science that only explains a line are not flagged. Where his remark
  rests on a halacha or a saying of Chazal, flag his own explanation of it
  and say so in the reason.
- **Insult words** ("idiot", "stupid", said of people: others, a character
  in a joke, himself or his listeners) are always flagged: `crude` when the
  word is all there is, otherwise the category of whom it is said about,
  with a `replace` text that drops or swaps the word. The `text` keeps the
  word as he said it; a softer wording, the reviewer's included, goes in
  `publishable`, never in `text`.
- **"Goy", "goyim", "goyishe"** are his plain words for a non-Jew, non-Jews
  and non-Jewish. Where it is just the word, it is not flagged. Flag
  (`other-groups`) only contempt.
- **Reform and Conservative** called heretics, "not rabbis", or outside
  Torah: that is the classical halachic position, not his delivery, and is
  not flagged (other-groups covers contempt beyond it: insults, mockery).
  Criticism of *frum* camps and their ideas is still flagged as usual.
- A wrong halacha or a wrong fact of history stated under his name is
  `other`, with a `publishable` text that drops the claim. A slip in a source
  (a wrong chapter or tractate) only goes in `notes`.
- `named-person`: a Rebbe story told with reverence, or a name used only as
  an example (of wealth, say), is not flagged.
- `politics`: one partisan side used as an example is flagged; both sides
  named evenly, as two leanings, is not.

### Raw, softened or dropped: the test

The flag decides content only; concision is already done in both texts
(above). For each flag ask: **is it the position, or the way he put it?**

- **Raw** (`"recommend": "raw"`): the remark is the teaching itself, a
  position of Torah or Chassidus stated as such, which a traditional reader
  expects and a softened text would misrepresent. Meditation that seeks G-d
  through concentration alone is *avoda zara*; "G-d is love" or pantheism is
  a mistake; a Jewish *daas* against a goyishe one; women and *psak*, or
  *kalei daas*, stated as the doctrine; a criticism of how scientists think;
  his own view of a book or a practice; a *mashal* built on two people's
  different viewpoints (the husband and the wife at the building), where
  softening the two into one kills the point. Flag it still (an outside reader may
  object), write the `publishable` text as usual, and mark it `raw`: the
  reviewer usually prints it as said.
- **Softened** (`replace`, no `recommend`): the point stands, but the edge is
  his delivery. Most often it is verbal flair: the remark spices up the
  recording, and may even hold a deep truth, but the guide loses nothing
  without it (he tells the camp that prefers *hiskashrus* to study "you're
  having dreams"; the guide says "Someone may say, 'I'm *batel* to the Rebbe;
  what do I need to study this for?'" and gives his answer). The audio keeps
  the flavor for whoever wants it. Also: insults ("idiots", "stupid"), coarse words, jabs at present-day
  cultures, nations or politics, sniping at fellow Jews and their camps or
  groups, a joke at the expense of a real, recent person, or a doctrine
  carried on into his own examples (women in general, then wives compared
  with their husbands).
- **Drop** (`omit`): a joke whose point is irreverence or darkness and that
  carries no teaching (G-d reading the book to find out who He is; a
  suicidal man deciding to jump).
- **A person decides** (`"recommend": "judgment"`, with `judgmentNote`
  saying what to weigh): a remark a reader could act on (prayer, health,
  law, money: "we don't even have to worry about *davenen*"), a doctrine
  that shades into examples where it is not clear which side it falls on,
  and the first chapters of a new series or teacher.

`recommend` is the writer's lean and changes nothing published: the public
edition applies `action` until a person decides the flag (raw is `keep`).

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
