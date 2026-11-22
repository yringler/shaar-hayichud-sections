# Notes for the Rabbi Markel series (`markel-advanced`)

What a writer of this series' study files needs to know beyond
`data/study/STYLE.md`. Catalog series 37, "Rabbi Markel Series (Advanced)".

## The classes

- Recorded on cassette, a side at a time, with a small group; some classes
  are over the phone. A student reads the Hebrew a phrase at a time; Rabbi
  Markel repeats it, translates and explains. A listener answers "Right."
  after most sentences (the dump folds those away).
- The transcripts have **no speaker labels**. A question is usually a
  student's when the next sentence answers it ("So you say, …" is often
  Rabbi Markel putting the question himself: that is `askedBy: "teacher"`).
- Terms are in Hebrew script inside English sentences ("the עיון is a כלי
  for the השגה"). Write them transliterated.
- The series was not recorded in chapter order (chapters 10–15 first, with
  an introduction, tape 001; then 1–4, 16–33, 7–9, 5–6, 34–54), so a class
  may refer back to a chapter that comes later in the book.
- Tapes begin and end mid-thought. A class often opens by finishing the
  previous tape's point: place that under the passage it belongs to, as a
  `recap` or with `outOfPlace`. A tape's last seconds are sometimes another
  recording altogether (a different speaker, a different subject): list it
  in `omitted` as `other`, with a note.
- Some classes read no line at all (free discussion of the chapter: 063 on
  chapter 5; 065, 067 and 072 on chapter 6). Their content still gets
  blocks, under the passage it discusses, or under the chapter's last
  passage when it is about the chapter as a whole.
- A few tapes have Sofer's word times and not re-timed ones (the dump says
  "sofer times"): the seconds can be off by a lot. The word ranges are still
  right, and `yarn study-fill` re-stamps the seconds when the tape is
  re-timed.

## His manner (keep it)

- Everyday American analogies, built up in dialogue: the movie projector,
  the pizza, the architect and the pink walls, the *schnorrers* comparing
  notes. Keep the props and the dialogue.
- "The *Aibershter*" for G-d, "*mamash*", "*davka*", "that whole business",
  "poof". Keep them where they carry the tone.
- Blunt opinions on science and scientists, psychology, other religions,
  politics, "the world", other approaches within Judaism, and now and then
  on men and women. They go in, as he says them, each in an `aside` of its
  own, flagged.
- Stories about his teachers, relatives and students, by name. They go in;
  flag `named-person` or `private` when a living or recent person is
  criticised or exposed.
- He often says a chapter "is the point of the whole book" or "the hardest
  chapter": that is a `keyPoint` or `aside`, worth keeping.

## Naming him

"Rabbi Markel", and only where STYLE.md allows it.

## Translation

Phrases carry only his English as he gives it in class, each with the
`audio` of where he says it; a phrase he reads without translating has no
English (STYLE.md, Phrases). His published translation (Sefaria, "The Gate
of Unity", 2023, CC-BY) is not used: whether and how to show it is a separate
decision. Chapters 1–5 and 10 were ported from the study guide demo with
that translation a paragraph at a time; when one of them is rewritten, cut it
into phrases as he translates in class and drop the published English.

## Sensitivity, for this series

Flag freely (see STYLE.md). Seen so far: remarks about women (chapter 10),
"idol worship" said of other religions and of meditation practices
(chapter 1), remarks on communism and on foundations and bureaucracies
(chapter 10), jokes built on what husbands and wives want (chapter 9).
