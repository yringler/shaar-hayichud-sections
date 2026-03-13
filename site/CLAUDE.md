# Claude Code Instructions — site

> **Monorepo context**: This is the `site/` sub-project. See the [root CLAUDE.md](../CLAUDE.md) for an overview of the full repo. The JSON source files consumed here are produced by the [`section-tool/` sub-project](../section-tool/CLAUDE.md).

## Overview

Static site for chapters of Shaar Hayichud with labeled subsections, plus audio class recordings.

## Tech Stack

- **Hugo** — static site generator (Go templates)
- **Yarn 4** (zero-installs) — package manager (for epub/convert scripts only)

## Commands

```bash
yarn build    # Hugo build → hugo/public/ (minified)
yarn serve    # Hugo dev server with live reload
yarn test     # Unit tests for lib/json-renderer.js
yarn epub     # Generate EPUB from chapters
```

## Deployment

The site is hosted on **Cloudflare Pages**. Every push to the repo triggers an automatic build and deployment using:

- **Build command**: `yarn build`
- **Output directory**: `hugo/public`

## Project Structure

```
hugo/
  hugo.toml              # Hugo config (baseURL, params, module mounts)
  chapters/
    chapter_01.json      # source JSON (mounted as both data and static)
    ...chapter_10.json
  content/
    _index.md            # homepage
    about.md
    texts/
      _index.md          # texts listing
      _content.gotmpl    # content adapter: generates EN chapter pages from data
    he/
      _index.md          # Hebrew homepage
      texts/
        _index.md        # Hebrew texts listing
        _content.gotmpl  # content adapter: generates HE chapter pages
    translation/
      _index.md          # translation listing
      _content.gotmpl    # content adapter: generates translation chapter pages
      translation-philosophy.md
    classes/
      _index.md          # classes listing
      _content.gotmpl    # content adapter: generates series/part pages from classes.json
  data/
    classes.json         # audio class hierarchy (series → parts → tracks)
    i18n.json            # nav label translations (en/he)
  layouts/
    _default/
      baseof.html        # HTML shell with inline CSS, nav
      single.html        # default single page (dispatches chapter rendering)
      list.html          # default list page
    home.html            # homepage layout
    he/list.html         # Hebrew section listing
    texts/list.html      # texts listing
    translation/list.html
    classes/
      list.html          # classes/series listing
      single.html        # part page with audio players
    partials/
      render-textnode.html  # recursive TextNode→HTML renderer (Go templates)
      track-count.html      # recursive audio file counter
      audio-url.html        # URL builder with space encoding
  static/
    CNAME
    _headers
    texts/index.json     # index of chapter JSON files
lib/
  json-renderer.js       # renderJsonToHtml — used by epub builder
  json-renderer.test.js  # unit tests (node --test)
epub/
  build-epub.mjs         # generates dist/shaar-hayichud.epub from JSON chapters
convert.js               # one-off data conversion utility
```

## Module Mounts

Hugo mounts `chapters/` to two targets:
- `data/chapters` — makes chapter JSON available as `site.Data.chapters` in templates
- `static/texts` — serves raw JSON files at `/texts/chapter_01.json` etc.

This means chapter files live in one place but are accessible both for rendering and as a static API.

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

1. Chapter JSON files in `hugo/chapters/` are loaded as Hugo data via module mount
2. Content adapters generate pages referencing data keys (e.g., `chapter_01`)
3. `layouts/_default/single.html` checks for `chapter_data` param and calls the recursive `render-textnode.html` partial
4. The partial walks the `TextNode` tree, emitting `<div class="depth-N">` blocks with hierarchical numbering
5. Raw JSON files are also served at `/texts/` via the static mount

### JSON TextNode Format

Chapter files are JSON arrays of `TextNode` objects (produced by `section-tool`):

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

- Data lives in `hugo/data/classes.json` (nested: series → parts → tracks)
- CDN base configured in `hugo.toml` params
- Track counting and part numbering done in Go template partials
