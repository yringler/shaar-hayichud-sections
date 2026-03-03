# Shaar Hayichud Sections

Static site for chapters of Shaar Hayichud with labeled subsections, plus audio class recordings.

## Tech Stack

- **Eleventy (11ty) v3** — static site generator
- **Nunjucks** — templating (`.njk`)
- **fast-xml-parser** — XML-to-HTML rendering via a native 11ty `.xml` template extension
- **Yarn 4** (zero-installs) — package manager

## Commands

```bash
yarn build    # Eleventy build → _site/
yarn serve    # Eleventy dev server with live reload
yarn test     # Unit tests for lib/xml-renderer.js
```

## Project Structure

```
src/
  _data/
    site.json          # site title, URL, CDN base
    classes.json       # audio class data
    classesParts.js    # derived parts data
  _includes/layouts/
    base.njk           # root HTML shell (LTR English)
    text.njk           # wraps chapter content in dir="rtl"
    audio.njk          # wraps content in .ltr-content div
  he/texts/
    chapter_01.xml     # source XML — processed natively by 11ty .xml extension
    chapter_02.xml
    chapter_03.xml
    texts.11tydata.js  # sets layout=text.njk, tag=texts, computes title + permalink
    index.njk          # /he/texts/ listing page
  en/texts/
    chapter_01.xml     # same XML content, picks up en locale data
    chapter_02.xml
    chapter_03.xml
    texts.11tydata.js  # same as he/
    index.njk          # /en/texts/ listing page
  classes/
    index.njk          # /classes/ listing
    series.njk         # individual series page
    parts.njk          # parts within a series
  index.njk            # homepage
lib/
  xml-renderer.js      # renderXmlToHtml — parses XML and emits HTML fragments
  xml-renderer.test.js # unit tests (node --test)
xslt-reference/
  transform.xsl        # archived — no longer used in build (kept as documentation)
  README.md
```

## Directionality

- The site is **LTR English** overall (`<html lang="en">`, no global `dir="rtl"`)
- Hebrew chapter text bodies are wrapped in `<div dir="rtl">` via `layouts/text.njk`
- Audio/classes pages use `.ltr-content` class

## Content Pipeline

1. XML source files (`src/{he,en}/texts/chapter_NN.xml`) are registered as native
   11ty templates via `eleventyConfig.addExtension("xml", { compile })` in `.eleventy.js`
2. The `compile` function calls `lib/xml-renderer.js → renderXmlToHtml()` which
   uses `fast-xml-parser` with `preserveOrder: true` to replicate the old XSLT logic
3. Each `.xml` file renders to an HTML fragment, flows through the data cascade
   (`texts.11tydata.js` provides layout, tags, title, permalink), and lands in `_site/`

### Transformation rules (from the archived XSLT)

- Root `<section>` element → its direct `<section>` children are processed at depth 1
- Per section: hierarchical numbering (`1`, `1.2`, `1.2.3`, …) + optional `@label`
- Direct text of each section → `<div class="depth-N">` with `.label` + `.content`
- Footnote digit markers stripped from content: `replace(/\d+/g, '')`
- Child sections recursed into (flat HTML output, not nested divs)

## Audio Classes

- Data lives in `src/_data/classes.json` (nested: series → parts → tracks)
- CDN base for audio files: `http://d35zpkccrlbazl.cloudfront.net`
- Custom filters in `.eleventy.js`: `trackCount`, `addPartNumbers`, `urlencode`
