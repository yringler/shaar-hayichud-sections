# Claude Code Instructions — site

> **Monorepo context**: This is the `site/` sub-project. See the [root CLAUDE.md](../CLAUDE.md) for an overview of the full repo. Everything rendered here comes from the repo's [`data/`](../data/README.md) directory: chapter JSON, which [`section-tool`](../section-tool/CLAUDE.md) edits, and the class catalog.

## Overview

Static site for chapters of Shaar Hayichud with labeled subsections, plus audio class recordings. It also publishes `data/` as versioned JSON at `/data/v1/` for other clients, such as the Flutter app.

## Tech Stack

- **Hugo** — static site generator (Go templates)
- **Yarn 4** — package manager (epub script; `yarn build` also installs and runs `../data/tools`)
- **TypeScript** for the two audio scripts (`hugo/assets/js/`), bundled by Hugo's built-in `js.Build` (esbuild); type-checked with `../data/tools`' TypeScript, so the site has no JS dependencies of its own

## Commands

```bash
yarn data     # Validate ../data and generate ../data/dist/v1 (run by build/serve)
yarn build    # data + Hugo build → hugo/public/ (minified)
yarn serve    # data + Hugo dev server with live reload
yarn test     # Unit tests (lib/json-renderer.js, the audio model) + typecheck of hugo/assets/js
              #   (typecheck needs ../data/tools installed: yarn data does it)
yarn test:e2e [dir]  # OPT-IN browser test of the audio features on hugo/public (run yarn build
              #   first; needs Playwright with Chromium and ffmpeg). Screenshots go to [dir].
yarn test:scripts  # Unit tests for scripts/sefaria-swap.py (python3)
yarn epub     # Generate EPUB from ../data/chapters
```

## Deployment

The site is hosted on **Cloudflare Pages**. Every push to the repo triggers an automatic build and deployment using:

- **Build command**: `yarn build`. This runs the data build in `../data/tools`. Pages clones the whole repo, so `../data` is available. Invalid data fails the deploy.
- **Output directory**: `hugo/public`
- `hugo/static/_headers` sets the Pages response headers. `/data/*` and `/texts/*` are CORS-open (`Access-Control-Allow-Origin: *`), and `/data/*` is cached for a short time.

## Project Structure

```
hugo/
  hugo.toml        # Hugo config: baseURL, params, module mounts (see below)
  content/         # section stubs + _content.gotmpl content adapters (texts, he, translation, classes)
  data/i18n.json   # nav label translations (en/he)
  layouts/         # baseof, per-section list/single layouts, partials (render-textnode, catalog, class-track, audio/)
  assets/js/       # play.ts, follow.ts, audio/model.ts (see Audio on chapter pages)
  static/          # CNAME, _headers, texts/index.json
lib/json-renderer.js  # renderJsonToHtml, used by the EPUB builder (tests alongside)
lib/audio-model.test.mjs  # unit tests for hugo/assets/js/audio/model.ts (Node 22.18+ runs .ts directly)
scripts/e2e-audio.cjs # yarn test:e2e
epub/build-epub.mjs   # generates dist/shaar-hayichud.epub from ../data/chapters
```

The site has no data of its own beyond `i18n.json`. Chapter JSON and the class catalog
come from `../data/` (see [data/README.md](../data/README.md)).

## Module Mounts

`hugo.toml` mounts directories from outside `hugo/`:
- `../../data/chapters` → `data/chapters` (`site.Data.chapters`) and `static/texts` (legacy raw JSON at `/texts/chapter_NN.json`)
- `../../data/dist/v1` → `static/data/v1` (the published JSON API)
- `../../data/dist/v1/catalog.json` → `data/v1` (`site.Data.v1.catalog`, read via the `catalog.html` partial, which fails the build if the data build has not run)
- `../../data/dist/v1` → `assets/data/v1` (audio alignments, transcripts and outlines, read with `resources.Get … | transform.Unmarshal` by `partials/audio/`). Adding an assets mount replaces the default one, so `assets` → `assets` is listed too.

Per-lecture files in `dist/v1` are named by the decoded lecture ID (`transcripts/001 Intro.mp3.json`) while index.json lists the encoded URL path, so templates build asset paths from the ID, never from an index `path`.

Keep mounts portable across Hugo versions: Cloudflare Pages builds with its image's default Hugo (no `HUGO_VERSION` is pinned) while developers may run a much newer one. Mount single files directly instead of filtering a directory (`includeFiles` was removed in Hugo 0.153; its `files` replacement does not exist in older releases). Likewise, stay on `site.Data` until the Pages default Hugo supports `hugo.Data`; newer Hugo only warns about it.

## Content Adapters

Content adapters (`_content.gotmpl`) auto-generate pages from data at build time — no `.md` stub files needed per chapter. When a new chapter JSON is saved via the section-tool, Hugo discovers it automatically on next build.

Each chapter generates 3 pages:
- `/texts/chapter-N/` — English view
- `/he/texts/chapter-N/` — Hebrew view
- `/translation/chapter-N/` — Translation view (only if chapter has translations)

## Directionality

- The site is **LTR English** overall (`<html lang="en">`)
- Hebrew chapter text bodies are wrapped in `<div dir="rtl">`
- Audio/classes pages use `.ltr-content` class

## Content Pipeline

1. Chapter JSON files in `../data/chapters/` are loaded as Hugo data via module mount
2. Content adapters generate pages referencing data keys (e.g., `chapter_01`)
3. `layouts/_default/single.html` checks for `chapter_data` param and calls the recursive `render-textnode.html` partial
4. The partial walks the `TextNode` tree, emitting `<div class="depth-N">` blocks with hierarchical numbering and one `<span class="line">` per line of text
5. Raw JSON files are also served at `/texts/` via the static mount

### JSON TextNode Format

Chapter files are JSON arrays of `TextNode` objects (produced by `section-tool`; schema: `../data/schema/v1/chapter.schema.json`). A section's own text is a run of `Line` objects (`{id, text}`, one line, no newline) at the start of its `children`:

```json
[
  {
    "label": "optional section label",
    "children": [
      { "id": "k3m9qa2x", "text": "a line of Hebrew text" },
      { "label": "child section", "children": ["..."] }
    ],
    "translation": "optional English translation"
  }
]
```

Tell the two apart by `children`: a section always has it, a line never does.

### Transformation Rules

- Each `TextNode` with lines of its own emits a `<div class="depth-N">` block
- Each line is rendered as `<span class="line" id="<line id>">`, wrapped in a `<p>` when the section has several lines. The line ID is the anchor that audio alignments and transcripts point at, so every line must keep its span and ID. The EPUB omits the IDs (they may start with a digit, which XHTML forbids).
- `render-textnode.html` and `lib/json-renderer.js` must produce the same markup
- Hierarchical numbering: `1`, `1.1`, `1.1.1`, …
- Optional `label` shown as `.label` inside the div
- Footnote digit markers stripped from Hebrew text content: `replaceRE \d+`
- Child sections recursed into (flat HTML output, not nested divs)
- Translation shown only when page param `showTranslation` is true

## Audio Classes

- The source is `../data/classes.txt`. The data build turns it into `catalog.json`, a tree of series → sections → lectures with stable IDs and one canonical `url` per lecture. Hugo never parses `classes.txt` itself.
- `content/classes/_content.gotmpl` creates one page per series and one page per child section, with slugs built from the titles. Series that have been renamed keep their old URLs as aliases.
- Templates use the lecture `url` exactly as given and never build URLs themselves.
- Each track links to its transcript page and to the chapter it is aligned to ("Follow in the text"), when those are published.

## Audio on chapter pages and transcript pages

Published audio data comes from `../data/audio-publish.json` (see data/README.md, "Publishing audio"). Coverage is sparse on purpose: a chapter with no published alignment renders exactly as before (no player, no script, no `data-t`).

`partials/audio/index.html` (cached) lists what was published: transcripts (with their page URL), per-chapter alignment indexes, aligned lectures and outlines. `partials/audio/lectures.html` (cached) maps every catalog lecture ID to its series, part and part page.

**Chapter page** (`_default/single.html`, any page that shows the Hebrew): when `alignments/chapters/<key>.json` exists,

- `partials/audio/chapter-panel.html` renders `<section class="listen" data-listen data-chapter-alignments=… data-follow-src=…>` with the Teacher (series) and Class selectors (`[data-listen-series]`, `[data-listen-select]`, options carry `data-series`, `data-url`, `data-transcript`), the Listen along button (`[data-listen-along]`), a Transcript link, one `<audio data-listen-audio preload=none>`, a status note (`[data-listen-note]`), and the outline UI (`[data-listen-now]`, `<details data-listen-topics>`). `data-js-only` elements start `hidden`; `data-no-js` ones are hidden by the script. Without JS it is a plain player for the first class.
- Every aligned line gets `data-t="<seconds>"` (best class start: highest confidence, then catalog order); `render-textnode.html` and `lib/json-renderer.js` (`lineTimes` option) stay in parity. The text wrapper gets `data-aligned-text`.
- `play.js` (`assets/js/play.ts`, loaded as a module only on these pages) fetches the chapter alignment JSON, adds a `<button class="line-play">` (no text content, so copying is unchanged) before each aligned `.line`, and plays the best class from the line: the saved teacher's series first, then the class already playing, then confidence, then catalog order. When several classes discuss the line, the button opens a menu (`.line-chooser`, arrow keys, Esc). The teacher choice is saved in `localStorage` (`shaarHayichud.audio.series`, every access in try/catch) and applies on every chapter page; if the saved teacher has no classes on the chapter or the line, the page falls back to another series and says so in the note.
- **Listen along** loads `follow.js` (`assets/js/follow.ts`) with a dynamic `import()`. While it is on, clicking a line's text also plays (selection-safe: ignored when text is selected or on double-click), and the line under discussion gets `is-discussing`; CSS draws `border-inline-start` on its block (`p` or `.content`) via `:has()`. A line is current from its start until the next aligned line of that class starts, held at most 30 s past its own end (`spans()` in `audio/model.ts`): this copes with zero-length ranges and collapsed timestamps. The current line scrolls into view unless the reader scrolled in the last 5 s. With an outline, the panel shows "Now: <topic>" and a collapsible, clickable topic list for the class in the player (marked auto-generated; topics follow the class timeline, not lines).

**Transcript pages**: `content/classes/_content.gotmpl` adds `/classes/transcripts/<slug>/` for each published transcript; the slug is the lecture ID lowercased, extension dropped, other runs of characters → `-` (`001 Intro.mp3` → `001-intro`). It depends on the ID alone, so it never changes; a slug collision or a series slugged `transcripts` fails the build. `partials/audio/transcript.html` renders `<p class="tseg" id="tN" data-start data-end [data-speaker]>` paragraphs (speaker label at each change; other speakers than the main one indented), outline topics as `<h2 class="topic">` before the first paragraph starting no more than 5 s before the topic, and the same panel without selectors. Listen along makes paragraphs clickable (seek) and adds a play button to each. /texts lists transcripts with no chapter under "Classes without text".

Scripts are built by `partials/audio/scripts.html` (`js.Build`, ESM, ES2020, minified, fingerprinted). js.Build exists in every Hugo build since 0.74 (no extended edition or Node needed), so it works with Cloudflare Pages' default Hugo (0.147.7 in the v3 image); tested with 0.147.7 and 0.152.2. Hugo writes `assets/jsconfig.json` on each build (git-ignored).
