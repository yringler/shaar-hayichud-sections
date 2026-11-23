# data/ — single source of truth

Everything the site, the section tool and the Flutter app show about Shaar
Hayichud comes from this directory : 

| Path | What it is | Edited by |
|------|------------|-----------|
| `classes.txt` | Audio class catalog (series → sections → lectures) | hand, plus `yarn set-durations` |
| `chapters/chapter_NN.json` | Chapter text as `TextNode[]` trees of lines (see below) | section-tool (saves via the GitHub API) |
| `schema/v1/` | JSON Schemas for everything published under `/data/v1/`. The Dart models in [`packages/dart`](../packages/dart/README.md) are generated from them; regenerate after a schema change | hand |
| `transcripts/<lecture>.json` | Raw word-timestamped Sofer.ai transcripts of classes (see [Transcripts and alignments](#transcripts-and-alignments)) | `yarn transcribe` |
| `alignments/<lecture>.json` | Class time ranges for chapter line IDs | `yarn align` |
| `outlines/<lecture>.json` | Sofer.ai's auto-generated topic outline of a class (see [`yarn outline`](#yarn-outline)) | `yarn outline` |
| `retimed/<lecture>.json` | Word times re-derived from the audio by forced alignment, replacing Sofer's broken ones (see [Re-timing](#re-timing-dataretime)) | `data/retime` (Python) |
| `study/<series>/chapter_NN.json` | Study guides: a class series' teaching of a chapter as passages and blocks of prose anchored to line IDs and to the recording (see [Study guides](#study-guides-datastudy)). The public edition of series whose teacher allowed it is published in `dist/v1/study/`; an unlisted beta copy of all of them, as written and in the same shape, is written to `dist/study-beta/v1/study/` | writers (people or agents), `yarn study-fill` |
| `edits/<lecture>.json` | Listener "Right." edits of a class recording: spans replaced by room tone in the `(edited).mp3` next to the original (see [Back-channel edits](#back-channel-edits-dataretime-backchannel)) | `data/retime` (`backchannel`) |
| `alignment-chapters.json` | Chapters a class reads when its catalog title or heading does not say (see [`yarn align`](#yarn-align)) | hand |
| `chapter-starts.json` | Hand-set start of a class's part on a chapter, where the computed one is wrong (see [Where a class starts on a chapter](#where-a-class-starts-on-a-chapter)) | hand |
| `audio-publish.json` | Which transcripts / alignments / outlines are published, and the alignment confidence floor (see [Publishing audio](#publishing-audio)) | hand |
| `schema/sources/` | JSON Schemas for source files that are not published (the stored transcript, retimed words, audio edits) | hand |
| `schema/study/` | JSON Schemas of the study guides (chapter file, series file, transliteration table); not published | hand |
| `tools/` | TypeScript build / validation tooling | hand |
| `retime/` | Python forced-alignment re-timing tool and the back-channel remover (`backchannel`); never needed by the build or deploy ([README](retime/README.md)) | hand |
| `dist/` | Generated output (git-ignored) | `yarn build-data` |

`site/`'s `yarn build` runs the data build first, so a Cloudflare Pages deploy
always validates and republishes this directory. A validation error fails the
deploy instead of publishing broken data.

## Published files

The site publishes `dist/v1/` at `https://www.shaarhayichudresources.com/data/v1/`:

| URL | Schema |
|-----|--------|
| `/data/v1/index.json` | `schema/v1/index.schema.json` — lists the files below |
| `/data/v1/catalog.json` | `schema/v1/catalog.schema.json` |
| `/data/v1/chapters/index.json`, `/data/v1/chapters/chapter_NN.json` | `index.schema.json`, `chapter.schema.json` |
| `/data/v1/alignments/index.json`, `/data/v1/alignments/<lecture>.json` | `index.schema.json`, `alignment.schema.json` — per class: line ID → time range + confidence |
| `/data/v1/alignments/chapters/index.json`, `/data/v1/alignments/chapters/chapter_NN.json` | `index.schema.json`, `chapter-alignments.schema.json` — per chapter: the classes that discuss it and, per aligned line, every class's range |
| `/data/v1/transcripts/index.json`, `/data/v1/transcripts/<lecture>.json` | `index.schema.json`, `transcript.schema.json` — paragraphs with start/end times (and `speaker` when Sofer labelled speakers) |
| `/data/v1/outlines/index.json`, `/data/v1/outlines/<lecture>.json` | `index.schema.json`, `outline.schema.json` — auto-generated topics on the class timeline |
| `/data/v1/study/index.json`, `/data/v1/study/<series>/chapter_NN.json` | `study-index.schema.json`, `study.schema.json` — public study guides (see [Public study guides](#public-study-guides-v1study)) |
| `/data/v1/schema/*.schema.json` | the schemas themselves |

`/data/*` is served with `Access-Control-Allow-Origin: *` (see
`site/hugo/static/_headers`) so other origins, such as the Flutter web app, can
fetch it. Within `v1`, changes are additive only; a breaking change means a
new `v2/` alongside it. (Chapter text moving from newline-joined strings to
line objects was a one-time exception, made before any client read chapters.)

Per-lecture files are listed by URL path, with the lecture ID percent-encoded
like a catalog URL segment (`alignments/07%20-%20Chap-…mp3.json`). On disk in
`dist/v1/` the file has the decoded name (the lecture ID plus `.json`), so a web
server, which decodes the request path, finds it. Clients fetch the listed path
as-is.

Every lecture in the catalog has one canonical, already-encoded `url`. To
build it, each folder segment and the filename are percent-encoded so that
only RFC 3986 unreserved characters stay literal, then joined with `/`.
Clients should use the `url` as-is and not rebuild it from `folder` and
`filename`.

## Stable IDs — do not change them

Apps persist favorites, recents and downloads against catalog IDs, so an ID
must never change once published:

- **Section IDs** are the `:N` suffix on heading lines. They are unique
  across all sections. When you add a heading, use a number no other heading
  uses.
- **Lecture IDs** default to the **filename**. If you rename or move a file
  on the CDN, keep the old ID by adding an `@ <old id>` line (see below).
  Do not remove an `@` line that is already there.

- **Line IDs** identify one line of chapter text (see below). Alignments
  and transcripts point at lines by ID alone.

The build fails on duplicate or colliding IDs.

## Chapter files

A chapter is an array of sections (`TextNode`: optional `label`, `children`,
optional `translation`). `children` holds lines and sub-sections in document
order. A line is `{ "id": "…", "text": "…" }`: one line of Hebrew text (never
blank, never containing a newline) with a stable ID.

Line IDs are 8 random lowercase base32 characters (`[a-z2-7]{8}`), unique
across **all** chapters, and are never positional. They follow the line, not
its position:

- an unchanged or lightly edited line keeps its ID, even when lines around it
  are added, removed or moved into another section;
- joining two lines is a delete plus an insert: the joined line gets a new ID;
- a new line gets a new random ID (`data/tools/src/line-id.ts` generates them;
  pass every ID already in the corpus so a new one never collides);
- a deleted line's ID disappears and is not reused.

Sections have no persisted ID, and translations stay at section level.
`yarn assign-line-ids` gives an ID to any line that lacks one, and to later
copies of a duplicated ID; the build fails on a duplicate line ID anywhere in
the corpus. It also checks that
every alignment `lineId` exists in the alignment's chapter.

`site/scripts/sefaria-swap.py` (re)imports Sefaria's text into the existing
sections and carries line IDs over: each output line is paired one to one,
in order, with the old line ids that its words came from (respelled words
included), keeping as many words as possible. Its tests:
`cd site && yarn test:scripts`.

## `classes.txt` grammar

The parser reads one line at a time. It trims each line and skips blank lines
and lines that start with `//`. Any other line must be one of these:

| Line | Meaning |
|------|---------|
| `# Title:N` | Starts a new top-level series with ID `N`. Closes any open `##`/`###`. |
| `## Title:N` | Starts a section inside the current `#`. Closes any open `###`. |
| `##` (bare) | Closes the current `##` (and `###`). Later items attach to the `#`. |
| `### Title:N` | Starts a sub-section inside the current `##`, or inside the `#` if no `##` is open. |
| `###` (bare) | Closes the current `###`. Later items attach to the open `##` or `#`. |
| `> folder/path` | Sets the CDN folder for the file lines that follow. It **persists** across headings until the next `>` line. It may contain `/`. |
| `- Title` | Title for the **next** file line. Without one, the lecture is titled `Part N`, where N is its position among its parent's lectures. |
| `@ lecture-id` | Explicit stable ID for the **next** file line. The rest of the line is the ID, spaces included. |
| `filename.mp3` or `filename.m4a` | A lecture. Optionally followed by `:seconds` (for example `001 Intro.mp3:722.997`). With no seconds, the duration is unknown. |

`- Title` and `@ id` may come in either order, but both must come directly
before their file line. Only blank lines and comments may come between them.

A lecture belongs to the innermost open heading. Order in the file is display
order. Sections and lectures that share a parent are numbered in one sequence
(`displayOrder`).

Example:

```
# Rabbi Markel Series (Advanced):37
## Part 1: Chapters 10-15:38
> Markel Advanced Compact Seminar/Advanced  part 1 ch 10-15 compact
- Introduction
001 Intro.mp3:722.997
### Chapter 10:39
002 Tape016-Side1-Ch10.mp3:1804.218667
###
- Chapter 3
@ 021 Tape004-Side1-Ch3.mp3
021 Tape004-Side1-Ch3 (remastered).mp3
```

In this example, the last lecture keeps its old ID after its file was
renamed.

The build reports these as errors, with line numbers:

- a heading with no `:N` ID
- a duplicate section ID or lecture ID
- a lecture ID that matches a section ID
- the same file twice in one section
- a file with no `>` folder above it
- content before the first `#`
- a `- Title` or `@ id` line with no file line after it
- an unrecognised line

## Tools (`data/tools/`)

Run these from `data/tools/` (`yarn install` once). The tools use the same
pinned Yarn 4.12 release as `site/`.

```bash
yarn build-data     # validate classes.txt + every chapter, write dist/v1/
yarn test           # unit tests (node:test)
yarn check-urls     # OPT-IN: HEAD every catalog URL on the CDN. Not part of the build.
                    #   Behind a proxy: NODE_USE_ENV_PROXY=1 yarn check-urls
yarn assign-line-ids  # give every chapter line without an id a new one (idempotent;
                    #   later copies of a duplicated id get new ones;
                    #   --check reports missing or duplicate ids without writing)
yarn set-durations  # ffprobe lectures with no :seconds and write the result into classes.txt
                    #   (downloads to tools/.cache/media/; needs ffprobe; --dry-run to preview)
```
yarn transcribe     # Sofer.ai transcripts -> transcripts/ (needs SOFER_API_KEY; see below)
yarn outline        # Sofer.ai topic outlines -> outlines/ (needs SOFER_API_KEY)
yarn align          # transcripts + chapters -> alignments/ (offline)
yarn study-dump     # what a study guide writer needs, as text (see Study guides)
yarn study-fill     # study guides: phrases' Hebrew, seconds from word ranges, formatting
yarn study-check    # study guides: strict check (schema, lines, audio, spellings)
```

## Transcripts and alignments

Classes are transcribed by [Sofer.ai](https://docs.sofer.ai), then aligned to
chapter lines, so a line ID can be mapped to the time it is read in a class.

```bash
cd data/tools
export SOFER_API_KEY=...          # never commit it or pass it as an argument
yarn transcribe --section 4 --limit 3 --dry-run   # what would be submitted
yarn transcribe --section 4 --limit 3             # Chapter 10, first three classes
yarn transcribe --lecture "07 - Chap- 10-1 Atmus Ohr Ein Sof (M).mp3"
yarn transcribe                   # no arguments: resume (poll) batches a previous run submitted
yarn outline                      # topic outline for every transcript that lacks a current one
yarn align                        # every lecture with a stored transcript
yarn align --section 4 --verbose  # print each line with the words heard
yarn align --chapter chapter_18   # only the lectures that read chapter 18
```

Behind an HTTP proxy, prefix commands with `NODE_USE_ENV_PROXY=1`.

Both files are named after the lecture's catalog ID, encoded like a published
URL segment plus `.json` (e.g. `07%20-%20Chap-%2010-1%20Atmus%20Ohr%20Ein%20Sof%20%28M%29.mp3.json`).
`yarn build-data` validates both and publishes the ones `audio-publish.json`
selects (see [Publishing audio](#publishing-audio)). The raw Sofer files are
never published.

### `yarn transcribe`

Select lectures with `--lecture <id>` (repeatable) and/or `--section <heading id>`
(every lecture under that `#`/`##`/`###` heading, in catalog order), optionally
`--limit N`.

**Scope and per-series settings** live in one place,
`tools/src/transcription-config.ts`, keyed by the series' catalog ID (its `#`
heading's `:N`; the tests check the title still matches `classes.txt`):

| Series | Speaker labeling | Why |
|--------|------------------|-----|
| Rabbi Benyamin Walters Original Class (`:0`) | off (`num_speakers: 1`) | only Rabbi Walters is audible, even in Q and A |
| Rabbi Markel Series (Advanced) (`:37`) | off (`num_speakers: 1`) | students are audible, but auto-detection did not separate them (below) |

A series not listed (today Walters New Class (2020) and Other Classes, which
need cleanup first) is refused; `--allow-out-of-scope` overrides, with
speaker labeling off. Speaker labeling uses auto-detection rather than
`num_speakers: 2`: Sofer recommends a fixed count only when it is known
exactly, and a class has one main voice plus an unknown number of students
with short questions. The setting sent is stored in the transcript's
`sofer.request`. First result (Markel Part 1, October 2026): auto-detection
found one speaker in the introduction and two in `002 Tape016-Side1-Ch10.mp3`,
but the second speaker got only 16 words, all of them the teacher's own
sentences, and about 300 words got no speaker. Labeling was therefore turned
off for Markel. The introduction keeps its stored labels, but the data build
publishes `speaker` only for series whose labeling is on (`speakerLabelsOn` in
`tools/src/publish.ts`), so they are not shown. `002` was restored to its
first, unlabelled transcription (`b952099f…`), whose word timestamps were
better (555 zero-length words against 1,266 in the labelled re-run), and
re-aligned; in Sofer it is back in the Chapter 10 folder and the re-run is
archived as superseded.

For each lecture:

1. If `transcripts/<lecture>.json` exists it is skipped. `--force` re-downloads
   the existing Sofer transcription; it never submits a new one.
   `--resubmit` (paid) is for re-transcribing with new settings: it retitles
   the Sofer transcription the committed file came from to
   `<title> (superseded YYYY-MM-DD)` and archives it (the API has no delete;
   archiving moves it out of the folder to the root, where neither the
   folder nor the account dedup sees it), then carries on with step 2 as if
   there were no file.
2. The Sofer folder path that mirrors the catalog tree is found or created,
   one level at a time, matching existing folders by name (case-insensitively)
   under their parent. It is every heading the lecture sits under, at any depth
   (`#`, `##`, `###`), series first:
   `Rabbi Benyamin Walters Original Class / Chapters 10-15 / Chapter 10`. A
   lecture with its own `- Title` that sits next to sub-headings in its parent
   (the catalog shows it as a sibling of those headings) gets a folder named
   after its title: `Rabbi Markel Series (Advanced) / Part 1: Chapters 10-15 / Introduction`,
   `.../Part 2: Chapters 1-4 / Chapter 3`. Untitled lectures, and lectures in a
   heading with no sub-headings, stay in the heading's folder. If the catalog
   moves a lecture that already has a transcript, `yarn transcribe` warns on
   skip; `--force` re-fetches it and moves it into the new folder.
3. The Sofer title is the catalog title plus the lecture ID in brackets, e.g.
   `Part 1 [07 - Chap- 10-1 Atmus Ohr Ein Sof (M).mp3]`. Before submitting, the
   tool looks for a transcription whose title ends in `[<lecture id>]` in that
   folder (and, as a fallback, anywhere in the account, moving it into the
   folder), and reuses it. A run that crashed after submitting therefore never
   pays twice. The account-wide list comes from `GET /v1/transcriptions/`,
   or, since that returns HTTP 500 on this account (as does paging
   `GET /v1/documents/` past an old document), from walking every folder's
   transcripts. That walk misses transcriptions at the root, which the
   pipeline never creates (it always submits with a `folder_id`). If neither
   can be fetched, nothing new is submitted, since a duplicate cannot be
   ruled out; rerun later, or pass `--allow-unlisted` if you are sure.
4. Every lecture that passed dedup goes into a Sofer **standard-mode batch**,
   one per series (at most 500 items): the manifest (`json_items`, each with
   the catalog `audio_url`, its title, `client_item_id` = lecture ID and the
   series' speaker setting) is uploaded with `POST
   /v1/transcriptions/batch-files` and validated, the balance is checked
   against the estimate for the whole run, and `POST /v1/transcriptions/batch`
   (`processing_mode: "standard"`, `info`: `model: v1`, `primary_language:
   en`, `hebrew_word_format: ["he"]` (Hebrew words in Hebrew letters, which
   alignment needs), `folder_id`) starts it. Sofer puts a whole batch in one
   folder, so the batch goes to the items' deepest common folder and each
   transcription is moved into its own folder when it completes. If any
   selected lecture hit an error before this point, nothing is submitted, so
   a batch is never partial; fix it and rerun.
5. The run polls `GET /v1/transcriptions/batch/{id}/status` (every
   `--poll-seconds`, default 60, for up to `--timeout-minutes`, default 120)
   and stores each finished item's raw `GET /v1/transcriptions/{id}` response
   with its word-level timestamps (and `speaker` per word when labelled).

Standard mode costs $1.00 per audio hour with model `v1` (+$0.30 with speaker
labeling) and promises results within 24 hours; two one-item batches (a 12
and a 30 min class) took about 1 h 35 min (October 2026). `--single` submits files one at a time
with `POST /v1/transcriptions/` instead ($1.50/h, minutes), the old path.

**Resuming.** The batch is written to `tools/.cache/sofer-batches.json`
(git-ignored; `--state` to move it) before the create call and again with
its batch ID after it. Any later run, with or without arguments, first polls
the batches in that file and stores what finished, and never resubmits a
lecture that is in one. If a run died during the create call itself (no
batch ID recorded), the entry is dropped with a warning and steps 3–4 decide:
folder-listing dedup finds whatever the batch created. Create calls are never
retried automatically; only free, idempotent writes (document updates,
manifest uploads) are retried after HTTP 429 (some endpoints allow 5
requests a minute). Exit status: 0 done, 1 errors, 3 still waiting.

The stored file follows `schema/sources/sofer-transcript.schema.json`; one
word per line keeps diffs readable.

### `yarn outline`

`POST /v1/timestamps/outline` asks Sofer for an LLM-generated topic outline of
a finished transcription, each topic aligned to a start time.
`yarn outline` fetches it for every selected lecture with a stored transcript
(`--lecture`, `--section`, `--limit`; default all) and writes
`outlines/<lecture>.json`
(`schema/sources/sofer-outline.schema.json`):

```json
{
  "schemaVersion": 1,
  "lectureId": "07 - Chap- 10-1 Atmus Ohr Ein Sof (M).mp3",
  "provider": "sofer.ai",
  "transcriptionId": "1f129292-…",
  "transcript": "transcripts/07%20-%20Chap-….mp3.json",
  "fetchedAt": "2026-10-28T17:32:16.829Z",
  "request": { "monotone": true, "conclusion_bias": false },
  "topics": [
    {"title": "…", "starting_phrase": "…", "start_time_sec": 86.79, "matched_text": "", "score_norm": 1, "confidence": "HIGH", …}
  ]
}
```

`topics` is Sofer's raw response, one topic per line. It is idempotent: a
lecture whose outline was made from its current transcription is skipped
(`--force` refetches); one made from an older transcription (after
`yarn transcribe --resubmit`) is refetched, and until then the build fails on
the stale outline. `monotone: true` because a class runs through the text in
order; `conclusion_bias` stays off because it sends any topic titled
"conclusion" to the last third of the audio, while a class can conclude an
argument anywhere. The docs give no price; the tool reads the balance around
every call and stops if one costs more than `--max-cents-per-call` (default
10). So far it has cost nothing.

### `yarn align`

Offline and deterministic; rerun after a transcript, chapter or the algorithm
changes. With nothing stale it rewrites every file byte for byte.

Chapter edits re-align themselves. A save in the offline editor runs
`yarn align --chapter <key>` and commits the changed alignments with the
chapter. A push to `master` that changes `data/chapters/`,
`alignment-chapters.json` or the alignment code runs the `realign` GitHub
workflow (`.github/workflows/realign.yml`): a full `yarn align`, a commit of
any changed `alignments/` files back to `master`, then `yarn build-data`. The
cloud editor commits only the chapter, so the Cloudflare Pages build of that
commit can fail on an alignment that points at a split or deleted line; the
workflow's commit follows within a minute or two and deploys. A new transcript
or retimed file still needs a manual `yarn align`. Lectures that teach one or two chapters are aligned, against
`chapters/chapter_NN.json`. Which chapters: an entry in
`alignment-chapters.json` (below), else the lecture's own `- Title` when it
names chapters (Markel's `- Chapter 3` or `- End Chapter 34 and Chapter 35`
under a `## Part`), else its innermost heading, at any depth. `Chapter 10`,
`Ch 10`, `Chapter 32 Part 2 to end`, `Chapter 42 Part 2`, `End Chapter 50`,
`Chapters 41 and 42`, `End Chapter 29 and 30` count; Q and A, introductions,
addenda (`Chapter 46 Addendum` falls back to its heading), `More on Chapter 28`
and ranges (`Ch 1-2`) are skipped.

**Classes that read two chapters** (a tape that finishes one chapter and
starts the next) are aligned against both chapters' lines concatenated in
reading order, in the same single monotonic pass, so the path finds the
switch itself and the segments carry both `chapter` keys. Naming a chapter the
class does not read is harmless: it gets no lines (`218`, titled "End Chapter
43 and Chapter 44", only reads 44). The file's top-level `chapter` is the one
with the most aligned lines, `stats.chapters` breaks the counts down per
chapter, and the data build lists the class on every chapter it has segments
in. On the 20 Markel two-chapter tapes this put every switch where the teacher
announces the next chapter (October 2026 spot checks), and the per-chapter line
ranges join up with the neighbouring tapes'.

`alignment-chapters.json` maps a lecture ID to the chapters it reads, for
classes the catalog labels with one chapter but that read two (found by
aligning every class against its neighbouring chapters too):

```json
{ "lectures": {
  "008 Tape019-Side1-Ch12.mp3": ["chapter_12", "chapter_13"],
  "218 Tape48-Side1 cH43&44-.mp3": [
    { "chapter": "chapter_43", "fromSeconds": 0, "note": "opens with a recap of chapter 43" },
    { "chapter": "chapter_44", "fromSeconds": 272.7, "note": "…" }
  ]
} }
```

A list of chapter keys is aligned as above. A list of ranges (increasing
`fromSeconds`, the first at 0, each running to the next) aligns each stretch to
its chapter alone, for a class that goes back and forth between chapters; a
chapter may repeat, and a line heard in two ranges keeps its better one. Other
fields on a range are notes for people. `yarn align` and the tests reject
unknown lectures or chapters. `fromSeconds` is in the word times `yarn align`
uses: once a tape has a `retimed/` file, its boundaries are in retimed time
(218's chapter 44 boundary was 169 s in Sofer's times, inside a 353-word pile,
and is 272.7 s retimed). Re-derive them whenever a tape is retimed.

The class reads the text aloud phrase by phrase and explains it in English with
Hebrew terms mixed in. `src/align.ts` keeps the transcript's Hebrew words,
normalizes both sides (nikud, punctuation, geresh/gershayim, final letters,
Yiddish ligatures), and aligns transcript words to chapter words in one
monotonic dynamic-programming pass: similar words (exact, with or without
ו/י, one prefix letter, small edit distance) gain, isolated Hebrew words gain
less (they are usually explanation terms), skipping transcript words is free,
and skipping a chapter word inside the aligned span costs (except
abbreviations and markers such as `(י)`), so the path cannot jump ahead to a
stray term. A line's range runs from its first to its last matched word (in
the densest cluster, splitting at gaps over 150 s), so it includes any
explanation in the middle of the line. Its `confidence` is the
similarity-weighted share of the line's words heard. Lines below 0.35, or not
read in the class, are absent.

An alignment file is a superset of `schema/v1/alignment.schema.json`
(`lectureId`, `segments[]` of `startSeconds`/`endSeconds`/`chapter`/`lineId`),
plus `confidence`, matched word counts and `firstWord`/`lastWord` indexes into
the transcript's `result.timestamps`, along with `transcript` (its path), `method`
and `stats`. The build validates it against that schema and checks every line ID.

`--after-previous` starts the search a few lines before the last line the
previous class reading the same (first) chapter reached, for classes that open
with a recap. It does not apply to range overrides.

To extend to more classes: transcribe a heading (for example `--section 5` for
Chapter 11), run `yarn align --section 5 --verbose`, spot-check a few lines
against the audio, then commit `transcripts/` and `alignments/`, and add the
heading (or the lectures) to `audio-publish.json`.

### Re-timing (`data/retime/`)

Sofer's word timestamps are broken on about a third of the tapes: runs of 20
or more words share one start time ("piles"), or are spread at a synthetic
0.417 s spacing, and later times drift by minutes (tape 216's chapter 43,
read at 12:06, aligned at 6:26). `data/retime/` is a Python tool
(torchaudio MMS_FA forced alignment; [README](retime/README.md)) that
re-times every Sofer word against the audio and writes
`retimed/<lecture>.json`: one `[start, end, score, kind]` per transcript word
plus a `transcriptSha` of the transcript it was made from
(`schema/sources/retimed.schema.json`).

```bash
cd data/retime && uv sync
uv run retime --affected --max-minutes 100   # resumable; skips tapes already current
cd ../tools && yarn align --lecture "…"      # re-align each retimed tape
```

When a lecture has a `retimed/` file, `yarn align` and the published
transcripts use its times instead of Sofer's; the alignment records which in
`method.times` (`"retimed"` or `"sofer"`; absent means Sofer). The data build
fails on a retimed file that does not match its transcript (stale hash, word
count, non-monotone times), so it can never be silently ignored, and on an
alignment whose `method.times` differs from what the lecture has now (rerun
`yarn align` after retiming). Python is only needed to make the files; the
build and the deploy only read them.

### Back-channel edits (`data/retime/`, `backchannel`)

In the Rabbi Markel series a listener answers the teacher with a standalone
"Right." about 100-135 times an hour. `backchannel` (in `data/retime/`, behind
`uv sync --extra edit`; [README](retime/README.md#back-channel-removal-backchannel))
finds them from the audio (short energy bursts in pauses, a speaker check
against the teacher, two keyword checks, a per-tape 10 ms listener
posterior) and from the transcript's "Right." brackets, and writes
`edits/<lecture>.json` (`schema/sources/audio-edits.schema.json`): the spans,
each `isolated` (`fill`) or `overlap` (`partial-fill`, only the part outside
the teacher's speech), with their scores, the candidates it `kept`, the
source file's sha256, rate, channels and duration, and, once rendered, the
`output` file's sha256, duration, bitrate and verification.

```bash
cd data/retime && uv sync --extra edit
uv run backchannel detect --all-markel --render   # resumable; edits/ + <cache>/edited/
uv run backchannel contact --all-markel --reel    # clips to listen to
```

Edits are filled with room tone, never cut, so the edited file has the
original's duration and every time in `transcripts/`, `retimed/`,
`alignments/` and `outlines/` holds for both files. Precision comes first: a
missed "right" stays, the teacher's words are never touched (0 damaged
words on the labelled windows; precision 0.99, recall 0.83).

The edited mp3 is uploaded next to the original as `<stem> (edited).mp3`
(the original is kept), and only then does `classes.txt` switch to it, with
an `@ <old id>` line so the lecture keeps its ID (`backchannel-upload
--classes-patch` writes that change). The data build checks every edit list:
schema, file name, lecture and transcript exist, `transcriptSha` matches the
transcript (stale is an error, as for `retimed/`), edits ordered, disjoint
and inside the audio, and a recorded render made from the current edits.
Nothing in `edits/` is published.

### Publishing audio

`audio-publish.json` is the one place that decides what reaches `/data/v1/`
(and so the site):

```json
{ "minConfidence": 0.45, "sections": ["4"], "lectures": ["001 Intro.mp3"] }
```

- A lecture is published when its ID is in `lectures`, or it is under a
  heading whose `:N` ID is in `sections` (a series ID selects the whole
  series). Unknown IDs fail the build.
- `minConfidence` drops alignment segments below it from the published files
  (the stored alignment keeps them). Lowering it shows more lines and more
  false positives: around 0.4 the matches stop being trustworthy.

For each published lecture the build writes, when the source exists:

- `alignments/<lecture>.json`: the v1 alignment fields plus `chapter` and each
  segment's `confidence`.
- `alignments/chapters/chapter_NN.json`: every published class aligned to the
  chapter (`lectures[]`: id, url, title, series, part, and paths of its
  alignment, transcript and outline) and `lines[]` in document order, each
  with `refs[]` (`lecture` index, start, end, confidence; best first). Each
  lecture also has `chapterStartSeconds`, where its part on this chapter
  starts (see [Where a class starts on a chapter](#where-a-class-starts-on-a-chapter)).
  The site's chapter player reads this file.
- `transcripts/<lecture>.json`: the words (with `retimed/` times when the
  lecture has them) as paragraphs (`segments[]` of
  `startSeconds`/`endSeconds`/`text`, plus `speaker` when Sofer labelled
  speakers and the series' speaker labeling is on in
  `tools/src/transcription-config.ts`). A paragraph ends at every change of speaker, at a pause of 2 s or
  more (once it has 8 words), or at a sentence end once it has 25 words and a
  0.8 s pause, or 70 words; never more than 200 words
  (`DEFAULT_PARAGRAPH_OPTIONS` in `tools/src/publish.ts`). `chapter` is set
  when the lecture is under a `### Chapter N` heading.
- `outlines/<lecture>.json`: from `outlines/<lecture>.json` (an object with a
  `topics` array of Sofer topics `{title, start_time_sec?, confidence:
  "HIGH"|"MEDIUM"|"LOW"|"NONE", ...}`), only topics with a start time and HIGH
  or MEDIUM confidence, as `{title, startSeconds, confidence}` in time order,
  with `generatedBy: "sofer.ai"`. Show them as auto-generated.

#### Where a class starts on a chapter

Many classes open with an intro before the first line of text (Walters 1-1
reads its first line at 1:04), and a class that reads two chapters hands
over to the second one with "Okay, go ahead" or a short intro. A tap on a
class's first line would skip that. So each lecture of a chapter index
carries `chapterStartSeconds`, and the clients' `playStart` (site
`audio/model.ts`, Dart `follow_along.dart`, shared vectors) decides from it:
a lead-in under 15 s is played, a longer one is offered ("From start of
class") while the line plays from itself.

`chapterStarts()` in `tools/src/publish.ts` computes it from the published
segments: 0 on the chapter the class reaches first, and on a later chapter
3 s (`CHAPTER_LEAD_SECONDS`) before its first line, never inside the
previous chapter's lines. Pauses do not mark the switch: the recorder was
usually stopped between chapters ("you can turn the tape off now"), so the
boundary pauses are no longer than ordinary ones (checked on all 16 Markel
two-chapter tapes, November 2026); the first line minus 3 s was right on 13
of them.

`chapter-starts.json` sets it by hand where that is wrong, found by
listening:

```json
{ "lectures": {
  "209 Tape41-Side2 Ch38&39.mp3": {
    "chapter_39": { "startSeconds": 706.0, "note": "intro to chapter 39 after 'Go ahead.'" }
  }
} }
```

`startSeconds` is audio time (the mp3 the catalog plays) and may not be
after the class's first published line on that chapter: the build fails
then (and for unknown or unpublished lectures, chapters the class has no
line on, or a time past its end). Set it to the first line itself to offer
nothing earlier (221: its 200 s preview of chapter 46 is too far back). An
override is checked against the alignment, so re-check it when a tape is
re-aligned or re-timed and the build complains.

Published transcript text and outline titles spell the Name as G-d, like the
chapter translations: `reverentSpelling` in `tools/src/publish.ts` turns God,
God's, Godly and Godliness (and lower-case godly and godliness) into G-d,
G-d's, G-dly and G-dliness. A bare lower-case "god" ("their god is science")
is left alone. The stored Sofer files in `transcripts/` and `outlines/` keep
Sofer's spelling.

## Study guides (`data/study/`)

A study guide turns a class series' recordings of a chapter into something
that can be read and navigated: the chapter's lines, the teacher's translation
of them phrase by phrase, and under them small blocks of prose (an explanation, a *mashal*,
a story, a question and its answer, a practical point, an aside), each
pointing at the stretch of recording it was written from. It began as a
separate demo (`yringler/shaarhayichudstudydemo`); here it is data, written
by people or by agents (`.claude/skills/study-chapter/`), checked by the data
build, and published in two ways: the [public edition](#public-study-guides-v1study)
of a series whose teacher has allowed it (`"public"` in its `series.json`)
goes into `dist/v1/study/`, and every series, as written, goes into the
unlisted [beta export](#the-study-beta-export) for the lessons2 closed beta,
in the same shape. Neither is in the Dart snapshot package.

```
study/
  STYLE.md                  how the files are written (voice, kinds of block, sensitivity)
  translit.json             one spelling per Hebrew term (shared; chapter writers do not edit it)
  <series>/
    series.json             the catalog series the files are written from
    NOTES.md                what a writer needs to know about this series
    chapter_NN.json         one chapter (schema/study/study-chapter.schema.json)
```

A chapter file, in outline:

```json
{
  "schemaVersion": 1, "series": "markel-advanced", "chapter": "chapter_09",
  "title": "…", "status": "draft", "provenance": { "method": "generated", "from": "…", "date": "…" },
  "lectures": [{ "id": "058 Tape014-Side2-Ch9.mp3", "transcriptionId": "6ee9ccc6-…" }],
  "overview": "…", "terms": [{ "term": "tzimtzum", "he": "צמצום", "gloss": "…", "line": "jgxhg273" }],
  "sections": [{
    "title": "The answer is tzimtzum: a light, not cause and effect", "summary": "…",
    "passages": [{
      "lines": ["jgxhg273", "fqrwiien", "la52lxbp"],
      "phrases": [
        { "he": "והתירוץ לכל זה הוא ענין הצמצום", "en": "The explanation is the matter of the *tzimtzum*",
          "audio": { "lecture": "058 Tape014-Side2-Ch9.mp3", "words": [467, 473], "start": 220.12, "end": 222.88 } },
        { "he": "כידוע" }
      ],
      "blocks": [{
        "kind": "mashal", "title": "The film in the projector", "text": "…",
        "audio": [{ "lecture": "058 Tape014-Side2-Ch9.mp3", "words": [584, 747], "start": 268.8, "end": 338.32 }],
        "sensitivity": { "categories": ["women"], "reason": "…", "action": "replace", "publishable": "…" }
      }]
    }]
  }],
  "reviewQuestions": [{ "question": "…", "lines": ["fqrwiien"] }],
  "omitted": [{ "lecture": "…", "words": [3875, 3917], "reason": "logistics" }],
  "notes": [{ "text": "…", "lines": ["efwibyo2"] }]
}
```

What each part is anchored to:

- **Text**: passages name chapter **line IDs**. Together they cover every
  line of the chapter once, in order. A passage's `phrases` spell out its
  lines' Hebrew exactly (joined by spaces), so a translation cannot outlive
  an edit of the text unnoticed.
- **Translation**: a phrase's `en` is only the teacher's own English from
  the class, and its `audio` (one entry, the same shape as a block's) points
  at where he says it. A phrase he reads without translating has `he` alone;
  a passage no class reads (`skip: no-recording`) has no phrases. English
  without `audio` is allowed only in a series whose `series.json` names a
  `publishedTranslation`; none does.
- **Audio**: a block's `audio` names a catalog **lecture ID** and a **word
  range** `[first, last]` into that lecture's stored transcript
  (`transcripts/<lecture>.json`, `result.timestamps`). Word indexes are the
  anchor because they survive re-timing (`retimed/` keeps the words and
  changes their times). `start`/`end` are the seconds of those words in the
  audio the catalog plays, written by `yarn study-fill`, never by hand. The
  file's `lectures` records each transcript's `transcriptionId`; a tape that
  is transcribed again (`yarn transcribe --resubmit`) makes the file an
  error until its ranges are redone.
- **Kinds of block**: `explanation`, `mashal`, `keyPoint`, `question`,
  `story`, `avodah`, `aside`, `digression`, `recap`. The first `audio` entry
  is the block's own; further entries are other tellings of the same thing.
- **Prose** is Markdown, inline only: `*italics*` (transliterated terms),
  `**bold**` (only words quoted from the passage's translation) and blank
  lines between paragraphs.
- **Sensitivity**: the files keep the class as it was said. A block that
  should not be published as it stands carries `sensitivity` (categories, a
  reason, and `action`: `replace` with a `publishable` text, or `omit`).
  `publicView()` in `tools/src/study.ts` applies it, for the
  [public edition](#public-study-guides-v1study).
- **Nothing dropped silently**: a stretch of a chapter's class that no block
  cites is listed in `omitted` with a reason, or the check warns about it.

### Checks

`yarn build-data` checks every study file (`tools/src/study.ts`), in three
levels:

| Level | Examples | `yarn build-data` | `yarn study-check` |
|-------|----------|-------------------|--------------------|
| error | invalid JSON or schema; unknown lecture, or one outside the series; a word range past the transcript's end; a transcript re-made since; Markdown that is not allowed; "God" spelled out; a term spelled against `translit.json`; `replace` with no `publishable`; a phrase's `en` with no `audio` (or `audio` with no `en`); phrases on a `no-recording` passage | fails | fails |
| stale | a line ID that is no longer in the chapter; lines not covered once and in order; phrases that are not the lines' text; `start`/`end` that are not the word range's times | warns | fails |
| warning | a block far (120 s) from where the class reads its passage, without `outOfPlace`; a phrase's `audio` more than 120 s outside its class's part on the chapter; 250 or more uncited words of class; a class of the chapter the file never cites; bold that does not quote the translation; a `mashal`, `story` or `digression` with no title; a block over 260 words; Hebrew script in prose; a term spelled two ways across chapters | counts | prints |

Stale references only warn in the build so that editing a chapter in the
section tool, or re-timing a tape, never blocks a deploy. After such a
change run `yarn study-fill` (it re-stamps seconds) and `yarn study-check`,
and mend the passages whose lines changed.

```bash
cd data/tools
yarn study-dump --series markel-advanced --chapter 9              # everything a writer needs
yarn study-dump --series markel-advanced --chapter 6 --lecture 064  # one class of a long chapter
yarn study-dump --series markel-advanced --chapter 6 --no-transcripts
yarn study-dump --series markel-advanced --chapter 9 --lecture 058 --words 584-620  # each word with its index
yarn study-fill --series markel-advanced --chapter 9              # after writing or editing
yarn study-check --series markel-advanced --chapter 9             # strict; also prints coverage
yarn study-check --quiet                                          # all files, no warnings
```

`yarn study-dump` prints the chapter's lines with their IDs and where each
is read, the series' classes on the chapter (the ones the catalog or
`alignment-chapters.json` ties to it, plus `chapterLectures` in
`series.json`), the spellings from `translit.json` that occur, and each
class's transcript in sentences, `[w<first>-<last> <time>]`, with a
`=== LINE` mark where the alignment says a line is read. `--words` prints
one stretch of one class word by word with indexes, for citing part of a
sentence (a phrase's English).

The tests (`tools/src/study.test.ts`) run against a miniature data
directory, `tools/fixtures/study/` (catalog, chapter, transcript, alignment
and a study file that passes every check).

`yarn study-fill` also expands the writers' shorthand for phrases:
`{ "to": "<last Hebrew word of the phrase>", "en": "…", "audio": … }` becomes
`{ "he": "…", "en": "…", "audio": … }` with the Hebrew copied from the
chapter, and stamps phrase `audio` seconds as it does blocks'.

### Public study guides (`v1/study/`)

A series is public when its `series.json` has `public`: who gave permission
and when (`{ "permission": "…", "date": "YYYY-MM-DD" }`). Set it only on the
teacher's word. `yarn build-data` then writes its guides, beside the rest of
`v1` (`exportStudy(…, 'public')` in `tools/src/study-export.ts`):

- `study/index.json` (`schema/v1/study-index.schema.json`): `{ schemaVersion,
  series: [{ id, catalogSeriesId, teacher, title, chapters: [{ chapter, path,
  status, stale?, lectures: [{ id, start, end, continuesIn? }] }] }] }`, the
  chapters in order, `path` relative to the edition's root (`/data/v1/`). A
  lecture's `start`/`end` are its part of the chapter in seconds
  (`chapterWordRange`, timed with the words the site plays; without an
  alignment, the span of the guide's own audio). `continuesIn` is the chapter
  the class reads on into, from its alignment. No timestamp, so an unchanged
  build is byte-identical.
- `study/<series>/chapter_NN.json` (`schema/v1/study.schema.json`):
  `schemaVersion`, `series`, `chapter`, `title`, `status`, `stale?`,
  `provenance: { method }`, `overview`, `overviewAudio?` (where the class sums
  the chapter up, `{ lecture, start, end }[]`) and `sections` → `passages`
  (`lines`, `phrases?`, `blocks`, `skip?`). Each phrase gains `lines`: the
  line IDs whose text it overlaps, by character offsets into the passage's
  lines joined by spaces; `en` is present only where the teacher translates
  the phrase, and then its `audio` becomes `lecture`, `start` and `end` on
  the phrase. Block `audio` is `{ lecture, start, end }`; `outOfPlace` and
  phrase `notes` are kept. Word ranges, `lectures`/`transcriptionId`,
  provenance details, `terms`, `reviewQuestions`, `omitted` and `notes` are
  dropped. Fields are copied from a whitelist, so a new writer-side field
  does not leak.
- Each guide is in its **public edition** (`publicView()`): a block with
  `sensitivity` is replaced by its `publishable` text (and
  `publishableTitle`), or dropped when its action is `omit`, so no
  `sensitivity` is published.

Only files with no error are written; a stale one is marked `"stale": true`.
The build validates the files against the v1 schemas, and the Dart package
has models for them (`StudyIndex`, `StudyGuide`), which lessons2 reads both
editions with. The Dart snapshot package does not bundle them: the app
fetches them.

### The study-beta export

`yarn build-data` also writes `dist/study-beta/v1/study/`
(`exportStudy(…, 'beta')`), which the site publishes at
`/data/study-beta/v1/study/` with `X-Robots-Tag: noindex`. It is the same
shape as `v1/study/` (the same schemas, validated by the build), with every
series, permitted or not, each guide **as written**: blocks keep their
`sensitivity` (optional in the v1 schema, and only ever present here). It is
for the lessons2 closed beta only: not part of `v1`, not in
`dist/v1/index.json` and never in the snapshot package.

It is deliberately not disallowed in a `robots.txt`: a crawler that obeys a
Disallow never fetches the files, so it never sees their `noindex`, and a
disallowed URL linked from elsewhere can still be indexed by its URL alone.

Tests: `tools/src/study-export.test.ts` (phrase→line mapping, the index,
trimming, both editions, stale and erroring files).

### State (November 2026)

Two series. `markel-advanced` (catalog series 37) has chapters 1–19, each
written from the classes, reviewed against the transcripts and then
migrated to class-only phrase translations (each `en` anchored with
`audio`; phrases he only reads are Hebrew-only). `walters-original`
(catalog series 0) has every chapter the series teaches (1, 2 and 10–32),
each written from the classes and then reviewed against the transcripts
by a second agent; it is public (Rabbi Walters gave permission), so its
87 sensitivity flags decide what `/data/v1/study/` prints. Nobody has yet listened to
the audio against the blocks, and tapes with only Sofer's word times may
start a second or two off.
A new series needs a directory with `series.json` and `NOTES.md`.
