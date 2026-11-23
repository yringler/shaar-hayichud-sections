# Notes for the Rabbi Walters Original Class (`walters-original`)

What a writer of this series' study files needs to know beyond
`data/study/STYLE.md`. Catalog series 0, "Rabbi Benyamin Walters Original
Class". Written from chapters 1, 2 and 10-32; add to it as the files are
revised. The series is published publicly (`series.json` has `public`), so
the sensitivity section below is not optional reading.

## The classes

- Short tapes, about 8 to 17 minutes each, in two albums. Each album
  numbers its tapes from 01, so a tape number names a tape only within its
  album; the lecture ID is the whole file name.

  | Album | Tapes |
  |-------|-------|
  | Walters original 1 | introduction 01-04, cover page 05-06, ch. 10 07-17, 11 18-23, 12 24-29, 13 30-34, 14 35-39, 15 40-46, Q and A on 15 47-48, 16 49-52, 17 53-61, 18 62-65, 19 66-71, 20 72-76, 21 77-80, 22 81-88, first addendum 89-99 |
  | Walters original 2 | ch. 23 01-04, 24 05-08, 1 09-18, 2 19-23, 25 24-29, 26 30-38, 27 39-46, 28 47-54, More on 28 55-56, 29 57-61, 30 62-66, 31 67-70, 32 71-77, second addendum 78-88 |

  So the order is not the book's: chapters 1 and 2 come after 24, and
  tape 24 of chapter 25 says they were just learned. Even so, in chapter 10
  he speaks of chapters 1 to 9 as already learned ("as the Mitteler Rebbe
  pointed out in chapter 5").
- Some titles end in "(M)" or "(N)", alternating by pairs of chapters (10 M,
  11 N, 12 M, 13 N, 14 M, 15 N, 23 M, 24 N, 27 M, 28 N); the rest have
  neither. The last tape of a chapter is marked "(End)". The classes never
  say what M and N stand for.
- He dates classes in passing: late Elul in chapter 17, Yud-Tes Kislev
  coming in 18, "we just had Parshas Bereishis" in 27.
- Each tape picks up where the last one stopped, often in the middle of a
  line or a sentence; a line can be split across two tapes. Many tapes open
  by summing up the previous one (a `recap`, placed under the passage it sums
  up, with `outOfPlace`). Some do not, and some end mid-sentence without the
  next tape picking it up.
- When the text says "as explained above" (כנ"ל) and he goes back over an
  earlier chapter's *mashal* right there, that is an explanation in its
  place, not a recap.
- Tapes or long stretches that read no line: a free introduction (chapter 26,
  tape 30), a tape spent on free discussion before he rereads a line
  (chapter 18 class 64, chapter 17 class 58, chapter 29 class 59), a review
  tape (chapter 32, tape 74). Place their blocks by subject, under the line
  they come back to or review, with `outOfPlace`.
- Extra tapes are attached through `series.json` `chapterLectures`: the Q and
  A tapes 47-48 (album 1) on chapter 15, and "More on Chapter 28" 55-56
  (album 2) on chapter 28. They read no line. Chapter 15 places them by
  subject (class 47 and class 48 w0-654 under line 4, the rest of 48 under
  lines 37-39); chapter 28 puts 54-56 under its last line. Either way,
  `outOfPlace`.
- Now and then a remark to the recording or the room ("Lights, camera,
  action.", "I'll erase to the next slide", "Still there?", "Where do we go?
  All right."): `omitted`, `logistics`, or simply dropped from the prose of
  the block it sits in.

## Who speaks

- Chapters 10, 12, 13, 20 and 22 are solo: no one else is heard, and his
  questions are his own objections ("You're going to say to me, 'Wait a
  minute...'"): `askedBy: "teacher"`.
- Elsewhere there are listeners, mostly off the tape. Often only his answer
  is heard ("No, ...", "Yeah, that's an orech hadaas", "Right, exactly").
  In chapters 15, 16, 27 and 28 some questions are heard ("A spring?", "One
  thing?"), and in 27-28 he calls the student Shmuel and mentions sitting
  next to him in 770.
- The rule from chapters 27-28: a question you can hear, or one he repeats,
  is a `question` with `askedBy: "student"`; an answer to a question you
  cannot hear is written as his own explanation. Chapters 17, 18 and 24 also
  wrote some inferred questions as student blocks; each is recorded in
  `notes`. Where a listener gave the example, say so ("like you were just
  saying"); do not write "as was said in class".

## Reading and translating

- He reads the Hebrew himself, a phrase at a time, and gives the English at
  once, close to the words ("ומעתה, and now"), then explains. Some chapters
  are dense with phrases (chapter 2: 146 for 37 lines).
- Often he reads a whole line and goes straight into the explanation or a
  *mashal*: those phrases keep their Hebrew and have no English. Before
  leaving `en` empty, check the next sentences and any second reading later
  in the class: he sometimes renders a line piece by piece a sentence or two
  on, or only when he comes back to it. A phrase may cite that sentence; say
  so in `notes`. A line he never reads keeps its Hebrew with no English, even
  if a nearby sentence restates it. Never put your own translation in a
  block.
- His rendering often runs on into a gloss, a summary or an example ("like
  ties a string around his finger", "...includes everything"). A phrase's
  `en` stops where his rendering of that Hebrew stops; the rest goes in the
  block. When he quotes a whole verse for one word of it, the phrase gets
  only his English for its own words. When he reads words without
  translating and then renders them with the next words, join them into one
  phrase.
- He comments on the printed text ("there should probably be another
  parenthesis", "the os is supposed to be a tes", "should be ניכר"). Record
  it in `notes`; the chapter's lines stay the text.

## Transcripts and alignments

- The transcripts have no speaker labels, and his Hebrew is the machine's
  hearing: where his reading differs from the chapter file, the chapter's
  lines are the text. His English usually follows the chapter's wording, a
  sign the transcript misheard. Check block prose against the line wherever
  they differ: chapter 16's block once followed "d'yihyeh lo bayis", a
  mishearing of ההיולי לבא לגלוי, and spoke of "a house of his own".
- Recurring mishearings: tehiru as "tziyur", רצון לרצון as "רצון ורצון" or
  "רצון שברצון", rosh toch sof as "ראשי תיבות", Keser d'Atik Yomin as
  "כתר דעקודים", yichud Abba v'Ima as "yichud ahava", v'notzer as "v'nakeh".
  He also mixes Yiddish into a reading ("איז ווייטער זאגן").
- Most tapes have Sofer's word times; a few are re-timed (the dump says
  which). The seconds can be off; the word ranges are right.
- The alignment is often a little wrong, and the dump is what counts. Marks
  land on his second reading or a reread, on a recap of earlier lines, or on
  a false hit in a review tape; a tape can open with half a line read well
  before the line's mark; a line marked NOT READ can be read (often in
  Aramaic or inside the previous line's mark). Place blocks by where he
  actually reads, and leave the alignment to the maintainer. Low confidence
  marks (0.4-0.6) are usually in the right place.

## His manner (keep it)

- Plain, warm, informal American English, spoken to "you". He builds a
  *mashal* into a little scene and acts out the dialogue: the nice guy with
  his hot cocoa and fuzzy slippers and the knock at the door; the two
  beggars on the park bench ("He gave me a coat." "I don't need a coat.");
  the cat stalking a mouse; "I ran out of passing-the-salt movements." Keep
  the props and the jokes; the dialogue he acts out becomes a sentence of
  prose, with at most one line of his quoted per block (STYLE.md, "Write a
  guide, not a recording"; the files were rewritten this way in November
  2026, as `markel-advanced` was).
- He reuses his images across chapters and refers back to them without
  retelling them: the coat (10, 30), the architect's blueprint (13-15), the
  teacher's class plan and how much to make the student work (13, 15, 21),
  the dream house and the mansion (16, 18, 21), the woman with her chicken
  and the rabbi's *pilpul* (1, 2, 12), the hippies' peace sign, the
  get-rich-quick tapes, video games, cocoa with sugar. Use the same name for
  a recurring image.
- Science and technology, explained simply, and above all physiology: the
  brain, nerves, the liver, the kidneys, the heart, the fluid under the
  skull, the Zohar's physiology of the brain, often "from what I
  researched". Keep it as he says it, with his shrugs and hedges ("we'll
  have to wait and see"); a factual slip goes in `notes`.
- History and everyday life: Napoleon as a baby, Bill Gates and "cash, cold
  cash", basketball, the eighth-grade yearbook. Personal recollections:
  mivtzaim, his teacher, students who tell him their plans.
- He talks about method: where the Mitteler Rebbe is in his argument, why
  there are several *meshalim*, that a *mashal* is understood physically and
  its *nimshal* not, and that from chapter 22 on the book mixes the two. He
  sets up a paradox before he answers it ("Alarm should be going off in your
  head"). These are `keyPoint` blocks.
- Practical turns, short and pointed: *tzedaka* with a sour face, "just be
  yourself", teach something to understand it, every maamar ends with a
  *hora'a l'maaseh*. These are `avodah` blocks.
- He announces what comes next as "we" ("now we're going to explain"). Keep
  "we": "he" reads as the Mitteler Rebbe. "In Yiddish we would say"
  introduces the Mitteler Rebbe's own Yiddish line. When he speaks as "me"
  inside a *mashal*, third-person prose says "a person", not an unclear
  "him".
- A general pattern (husbands and wives, a source cited as one more example)
  is a `mashal`; `story` is for a single event (the dog on the boy's grave,
  a Rebbe story).
- Sources and facts cited loosely and from memory, often with "I think"
  (Tehillim "chapter 19" for 18:12, Bava Basra for Kesubos 105b, "chapter
  15" for 16). Report them as he gives them, keep his hesitation, and put
  the correction in `notes`. When he corrects himself, keep the final
  attribution in the text and the slip in `notes`. Keep apart what he "saw
  in another place in Chassidus" and his own "maybe" on top of it.
- Hebrew terms inside English sentences (the *Atzmus*, *mamash*, *davka*).
  He says "G-d" far more often than *Hashem* in the early chapters; by
  chapter 32 he says *Hashem* often.

## Naming him

"Rabbi Walters", and only where STYLE.md allows it.

## Translation

Phrases carry only his English as he gives it in class, each with the
`audio` of where he says it; a phrase he reads without translating has no
English (STYLE.md, Phrases). No published translation is used.

## Spellings

Use `translit.json` first. For terms it lacks, the files agree on: kelim
(not keilim), tikunim, Tikun (not Tikkun), rosh toch sof, levushim, hisabus,
hagbala, shinui hamahus, kruma d'avira, mocha stima'a, ne'etzalim, memutza,
uvchein, yemei kedem, koach MaH. Still unsettled: chassadim (27, 30) against
chasadim (15, 29); mivtzaim against mivtzoim; gimmel rishin against gimmel
reishin. The table's חיות is only *Chayos* (angels); in chapters 13 and 23
it means vitality.

## Sensitivity, for this series

Flag as STYLE.md says, and flag more than in a private file: the public
edition is printed with his name on it. The rule that settled most cases:
keep the teaching and replace only the word or claim the reason names, with
his own example where it survives (chapter 18 kept "a hut, or two huts and a
couple of cows" and dropped only "Africa"); `omit` only a pure aside. A
publishable text neither softens more than the reason names nor adds a
sentence he did not say; reviewers removed both kinds.

Flagged, with the precedent:

- **goy, goyim, goyishe**, even in a neutral halachic case (15, 17, 18, 21,
  28): `other-groups`, replace with "a non-Jew", "non-Jews", "the nations" or
  "our enemies", whichever keeps the case accurate. A Torah position about
  the nations (each nation's *mazal*) stays, worded "the nations".
- **Groups and professions**: scientists as "haughty idiots" or "the
  scientists say" (28, 30), philosophers who "don't know how to use logic"
  (28), modern men and ancient cultures (27), builders as "stupid people"
  (14), fellow Jews' "stupid humility" in dress (28), robot teachers and
  Walmart cashiers (15), an Iranian (22), Africa (16, 18): `other-groups`.
  Criticism of an idea ("science doesn't tell you why", the philosopher's
  definition of G-d) is not flagged.
- **Movements within Judaism**: Reform and Conservative (26, 32), the "Rebbe
  is Moshiach" belief as an example (17, 26), the Chassidim and Misnagdim
  history told from memory (18), baalei teshuva who are "not going to be
  human" (20), chassidim who dress by imitation (18, 28): `other-groups`. The
  Alter Rebbe and the Gra aside (22) was left, as it criticises no one.
- **Other religions**: Christianity and "Yoshke" (20), missionaries (20, 25),
  Eastern religions, New Age and "cultish" things (17): `other-religions`.
  Describing Arius as "this Christian" (1) is not flagged.
- **Politics**: a single partisan side used as an example ("a liberal" in
  19, liberalism in 26), church and state (19): `politics`, replaced with a
  neutral word. Liberal and conservative named evenly as two leanings (17,
  20) was left. The reviewer removed the flags on "only the Republican side"
  (1) and on Israel and democracy (20): printed as said.
- **Women**: his own generalisations beyond a line ("women get more
  emotional, because they're kalei daas" in 32, and the "some lady" of the
  chicken story in 12, borderline): `women`. The reviewer removed the flags
  on chapter 1, class 17 (women's daas, multitasking, judges) and on boys
  and girls learning kashrus (2): printed as said, in condensed form. The line's own
  words ("a light daas, like women") and a line's Talmudic figure (30) are
  not flagged. Where his remark rests on a halacha or a saying of Chazal
  (women are not judges, *bina yeseira*), flag his own explanation of it and
  say so in the reason.
- **Health and law**: his own medical claims and remedies (curing cancer and
  an inhalant in the Q and A on 15, the adrenal glands and the fluid under
  the skull in 21, the liver and "fry their brain" in 27,
  reflexology and bloodletting in 31, wrapping a fevered patient in 22),
  loose rulings on liability (29): `health-or-legal`. Physiology that only
  explains a line, or the Mitteler Rebbe's own claim (sight failing in old
  age, 31), is not flagged; nor, after review, faith healing (27) or the
  Alter Rebbe "allowed to expect a miracle" on risking one's life (32).
- **Misstated halacha and history under his name**: the mitzva of kiddush
  "is not verbal" and no wine on Shabbos if you don't enjoy it (26), a
  *shechita* "back and forth all day" (2, `judgment`), the bomb
  built "before the Russians" (2): `other`, with a publishable text that
  drops the claim. A source slip (a wrong chapter or tractate) only goes in
  `notes`.
- **Irreverence**: the Rebbe's sichos "talk really stupidly" (15) and "the
  Rebbe in his room" (29), Yaakov "had to lie and cheat" (16), G-d with His
  train set (17, borderline), the Holocaust and Moshiach's delay (26),
  recent hurricanes beside the Flood (32): `other`. Provocative Torah
  positions stated as such ("I don't care about Shabbos... I just care about
  G-d" as the stance of teshuva, "G-d is revealed through the aveiros") are
  left, with a word in `notes`.
- **Named people**: Bobby Fischer (23), the Kfar Chabad farmer (28), "Rabbi
  Markel's website" (17), the Rabbi Hollander story (26): `named-person`.
  Rebbe stories told with reverence, and a name used only as an example of
  wealth, are not flagged.
- **Private**: the student Shmuel (27-29), his wife's teaching at the local
  cheder (14) and his nephew's wedding (28) are now written without the
  person (STYLE.md, People in the class): "a friend you know", "little kids
  starting math", "a little kid who puts on his father's hat". Not flagged.
- **Crude**: "angel poop" (14), drugs "laced with rat poison" (17), the
  *tachas* joke (31, mild).
- **The one in chapter 10**: a charitable foundation is "a machine" that
  would let a person starve on the doorstep (`other-groups`). "To mean that
  G-d is only kindness ... is heresy" was left as a Torah position that
  names no group.
