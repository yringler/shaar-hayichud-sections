# Claude Code Instructions — site

> **Monorepo context**: This is the `site/` sub-project. See the [root CLAUDE.md](../CLAUDE.md) for an overview of the full repo. The JSON source files consumed here are produced by the [`section-tool/` sub-project](../section-tool/CLAUDE.md).

## Overview

Static site for chapters of Shaar Hayichud with labeled subsections, plus audio class recordings.

## Tech Stack

- **Eleventy (11ty) v3** — static site generator
- **Nunjucks** — templating (`.njk`)
- **json-renderer** (`lib/json-renderer.js`) — JSON-to-HTML rendering via a native 11ty `.json` template extension
- **Yarn 4** (zero-installs) — package manager

## Commands

```bash
yarn build    # Eleventy build → _site/
yarn serve    # Eleventy dev server with live reload
yarn test     # Unit tests for lib/json-renderer.js
```

## Project Structure

```
src/
  _data/
    site.json          # site title, URL, CDN base
    classes.json       # audio class data
    classesParts.js    # derived parts data
    i18n.json          # i18n strings
  _includes/layouts/
    base.njk           # root HTML shell (LTR English)
    text.njk           # wraps chapter content in dir="rtl"
    audio.njk          # wraps content in .ltr-content div
  texts/
    chapter_01.json    # source JSON — processed natively by 11ty .json extension
    chapter_02.json
    chapter_03.json
    chapter_04.json
    chapter_05.json
    texts.11tydata.js  # sets layout=text.njk, tag=texts, computes title + permalink
  he/texts/
    index.njk          # /he/texts/ listing page
  en/texts/
    index.njk          # /en/texts/ listing page
  en/classes/
    index.njk          # /en/classes/ listing
    series.njk         # individual series page
    parts.njk          # parts within a series
  index.njk            # homepage
lib/
  json-renderer.js      # renderJsonToHtml — parses TextNode JSON and emits HTML fragments
  json-renderer.test.js # unit tests (node --test)
  xml-renderer.js       # archived — no longer used in build (kept as reference)
  xml-renderer.test.js
xslt-reference/
  transform.xsl        # archived — no longer used in build (kept as documentation)
  README.md
```

## Directionality

- The site is **LTR English** overall (`<html lang="en">`, no global `dir="rtl"`)
- Hebrew chapter text bodies are wrapped in `<div dir="rtl">` via `layouts/text.njk`
- Audio/classes pages use `.ltr-content` class

## Content Pipeline

1. JSON source files (`src/texts/chapter_NN.json`) are registered as native
   11ty templates via `eleventyConfig.addExtension("json", { compile })` in `.eleventy.js`
2. The `compile` function calls `lib/json-renderer.js → renderJsonToHtml()` which
   walks the `TextNode` tree and emits HTML fragments
3. Each `.json` file renders to an HTML fragment, flows through the data cascade
   (`texts.11tydata.js` provides layout, tags, title, permalink), and lands in `_site/`
4. The raw JSON files are also copied to `_site/texts/` for external use

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
- Footnote digit markers stripped from Hebrew text content: `replace(/\d+/g, '')`
- Child sections recursed into (flat HTML output, not nested divs)
- Translation shown only when `data.locale.section === "translation"`

## Audio Classes

- Data lives in `src/_data/classes.json` (nested: series → parts → tracks)
- CDN base for audio files: `http://d35zpkccrlbazl.cloudfront.net`
- Custom filters in `.eleventy.js`: `trackCount`, `addPartNumbers`, `urlencode`
