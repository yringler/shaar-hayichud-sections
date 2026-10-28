# data/ — single source of truth

Everything the site, the section tool and the Flutter app show about Shaar
Hayichud comes from this directory:

| Path | What it is | Edited by |
|------|------------|-----------|
| `classes.txt` | Audio class catalog (series → sections → lectures) | hand, plus `yarn set-durations` |
| `chapters/chapter_NN.json` | Chapter text as `TextNode[]` trees of lines (see below) | section-tool (saves via the GitHub API) |
| `schema/v1/` | JSON Schemas for everything published under `/data/v1/`. The Dart models in [`packages/dart`](../packages/dart/README.md) are generated from them; regenerate after a schema change | hand |
| `transcripts/<lecture>.json` | Raw word-timestamped Sofer.ai transcripts of classes (see [Transcripts and alignments](#transcripts-and-alignments)) | `yarn transcribe` |
| `alignments/<lecture>.json` | Class time ranges for chapter line IDs | `yarn align` |
| `schema/sources/` | JSON Schemas for source files that are not published (the stored transcript) | hand |
| `tools/` | TypeScript build / validation tooling | hand |
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
| `/data/v1/alignments/index.json` | reserved (empty) — per-lecture files will follow `alignment.schema.json` |
| `/data/v1/transcripts/index.json` | reserved (empty) — per-lecture files will follow `transcript.schema.json` |
| `/data/v1/schema/*.schema.json` | the schemas themselves |

`/data/*` is served with `Access-Control-Allow-Origin: *` (see
`site/hugo/static/_headers`) so other origins, such as the Flutter web app, can
fetch it. Within `v1`, changes are additive only; a breaking change means a
new `v2/` alongside it. (Chapter text moving from newline-joined strings to
line objects was a one-time exception, made before any client read chapters.)

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
yarn align          # transcripts + chapters -> alignments/ (offline)
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
yarn align                        # every lecture with a stored transcript
yarn align --section 4 --verbose  # print each line with the words heard
```

Behind an HTTP proxy, prefix commands with `NODE_USE_ENV_PROXY=1`.

Both files are named after the lecture's catalog ID, encoded like a published
URL segment plus `.json` (e.g. `07%20-%20Chap-%2010-1%20Atmus%20Ohr%20Ein%20Sof%20%28M%29.mp3.json`).
`yarn build-data` validates both, but they are **not published yet**: the
`/data/v1/transcripts/` and `/data/v1/alignments/` collections stay empty until
the alignment quality has been reviewed for more classes.

### `yarn transcribe`

Select lectures with `--lecture <id>` (repeatable) and/or `--section <heading id>`
(every lecture under that `#`/`##`/`###` heading, in catalog order), optionally
`--limit N`. For each one:

1. If `transcripts/<lecture>.json` exists it is skipped. `--force` re-downloads
   the existing Sofer transcription; it never submits a new one.
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
4. Otherwise it checks the balance against an estimate, submits the catalog URL
   (`audio_url`; the CDN serves direct mp3 links, so nothing is uploaded) with
   `primary_language: en` and `hebrew_word_format: ["he"]` (Hebrew words in
   Hebrew letters, which alignment needs), polls the status until `COMPLETED`, and
   stores the raw `GET /v1/transcriptions/{id}` response with its word-level
   timestamps.

Cost is about $1.50 per audio hour (model `v1`). The stored file follows
`schema/sources/sofer-transcript.schema.json`; one word per line keeps diffs readable.

### `yarn align`

Offline and deterministic; rerun after a transcript, chapter or the algorithm
changes. Only lectures that teach a single chapter are aligned, against
`chapters/chapter_NN.json`: the lecture's own `- Title` decides when it names
one chapter (Markel's `- Chapter 3` under a `## Part`), else its innermost
heading, at any depth. `Chapter 10`, `Ch 10` and `Chapter 32 Part 2 to end`
count; Q and A, introductions, addenda, `More on Chapter 28` and multi-chapter
titles (`Chapters 15 and 16`, `Ch 1-2`) are skipped.

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
previous class of the same chapter reached, for classes that open with a recap.

To extend to more classes: transcribe a heading (for example `--section 5` for
Chapter 11), run `yarn align --section 5 --verbose`, spot-check a few lines
against the audio, then commit `transcripts/` and `alignments/`.

