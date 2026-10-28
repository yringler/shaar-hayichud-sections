# data/ — single source of truth

Everything the site, the section tool and the Flutter app show about Shaar
Hayichud comes from this directory:

| Path | What it is | Edited by |
|------|------------|-----------|
| `classes.txt` | Audio class catalog (series → sections → lectures) | hand, plus `yarn set-durations` |
| `chapters/chapter_NN.json` | Chapter text as `TextNode[]` trees | section-tool (saves via the GitHub API) |
| `schema/v1/` | JSON Schemas for everything published under `/data/v1/` | hand |
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
new `v2/` alongside it.

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

The build fails on duplicate or colliding IDs.

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
yarn set-durations  # ffprobe lectures with no :seconds and write the result into classes.txt
                    #   (downloads to tools/.cache/media/; needs ffprobe; --dry-run to preview)
```

Known CDN gap: `84 - The Rebbes Shaar Hayichud.mp3` (Second Addendum) returns
404 in every folder. `yarn check-urls` reports it.
