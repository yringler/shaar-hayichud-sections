# Claude Code Instructions — site

> **Monorepo context**: This is the `site/` sub-project. See the [root CLAUDE.md](../CLAUDE.md) for an overview of the full repo. Everything rendered here comes from the repo's [`data/`](../data/README.md) directory: chapter JSON, which [`section-tool`](../section-tool/CLAUDE.md) edits, and the class catalog.

## Overview

Static site for chapters of Shaar Hayichud with labeled subsections, plus audio class recordings. It also publishes `data/` as versioned JSON at `/data/v1/` for other clients, such as the Flutter app.

## Tech Stack

- **Hugo** — static site generator (Go templates)
- **Yarn 4** — package manager (epub script; `yarn build` also installs and runs `../data/tools`)

## Commands

```bash
yarn data     # Validate ../data and generate ../data/dist/v1 (run by build/serve)
yarn build    # data + Hugo build → hugo/public/ (minified)
yarn serve    # data + Hugo dev server with live reload
yarn test     # Unit tests for lib/json-renderer.js (data tests: cd ../data/tools && yarn test)
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
  layouts/         # baseof, per-section list/single layouts, partials (render-textnode, catalog, class-track)
  static/          # CNAME, _headers, texts/index.json
lib/json-renderer.js  # renderJsonToHtml, used by the EPUB builder (tests alongside)
epub/build-epub.mjs   # generates dist/shaar-hayichud.epub from ../data/chapters
```

The site has no data of its own beyond `i18n.json`. Chapter JSON and the class catalog
come from `../data/` (see [data/README.md](../data/README.md)).

## Module Mounts

`hugo.toml` mounts directories from outside `hugo/`:
- `../../data/chapters` → `data/chapters` (`site.Data.chapters`) and `static/texts` (legacy raw JSON at `/texts/chapter_NN.json`)
- `../../data/dist/v1` → `static/data/v1` (the published JSON API)
- `../../data/dist/v1/catalog.json` → `data/v1` (`site.Data.v1.catalog`, read via the `catalog.html` partial, which fails the build if the data build has not run)

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
4. The partial walks the `TextNode` tree, emitting `<div class="depth-N">` blocks with hierarchical numbering
5. Raw JSON files are also served at `/texts/` via the static mount

### JSON TextNode Format

Chapter files are JSON arrays of `TextNode` objects (produced by `section-tool`; schema: `../data/schema/v1/chapter.schema.json`):

```json
[
  {
    "label": "optional section label",
    "children": [
      "direct text string",
      { "label": "child section", "children": ["..."] }
    ],
    "translation": "optional English translation"
  }
]
```

### Transformation Rules

- Each `TextNode` with direct text strings emits a `<div class="depth-N">` block
- Hierarchical numbering: `1`, `1.1`, `1.1.1`, …
- Optional `label` shown as `.label` inside the div
- Footnote digit markers stripped from Hebrew text content: `replaceRE \d+`
- Child sections recursed into (flat HTML output, not nested divs)
- Translation shown only when page param `showTranslation` is true

## Audio Classes

- The source is `../data/classes.txt`. The data build turns it into `catalog.json`, a tree of series → sections → lectures with stable IDs and one canonical `url` per lecture. Hugo never parses `classes.txt` itself.
- `content/classes/_content.gotmpl` creates one page per series and one page per child section, with slugs built from the titles. Series that have been renamed keep their old URLs as aliases.
- Templates use the lecture `url` exactly as given and never build URLs themselves.
