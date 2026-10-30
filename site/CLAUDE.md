# Claude Code Instructions — site

> **Monorepo context**: This is the `site/` sub-project. See the [root CLAUDE.md](../CLAUDE.md) for an overview of the full repo. Everything rendered here comes from the repo's [`data/`](../data/README.md) directory: chapter JSON, which [`section-tool`](../section-tool/CLAUDE.md) edits, and the class catalog.

## Overview

Static site for chapters of Shaar Hayichud with labeled subsections, plus audio class recordings. It also publishes `data/` as versioned JSON at `/data/v1/` for other clients, such as the Flutter app.

## Tech Stack

- **Hugo** — static site generator (Go templates)
- **Yarn 4** — package manager (epub script; `yarn build` also installs and runs `../data/tools`)
- **TypeScript** for the audio scripts (`hugo/assets/js/`), bundled by Hugo's built-in `js.Build` (esbuild); type-checked with `../data/tools`' TypeScript, so the site has no JS dependencies of its own

## Commands

```bash
yarn data     # Validate ../data and generate ../data/dist/v1 (run by build/serve)
yarn build    # data + Hugo build → hugo/public/ (minified)
yarn serve    # data + Hugo dev server with live reload
yarn test     # Unit tests (lib/json-renderer.js, the audio model) + typecheck of hugo/assets/js
              #   (typecheck needs ../data/tools installed: yarn data does it)
yarn test:e2e [dir]  # OPT-IN browser test of the audio features on hugo/public (run yarn build
              #   first; needs Playwright with Chromium and ffmpeg): chapter pages, transcript pages,
              #   class lists (lesson text, reader, topics, Autoplay next), topic deep links,
              #   the outlines pages (all their links checked in the built HTML) and the site nav.
              #   Screenshots go to [dir].
              #   Under Yarn PnP Playwright may not resolve: run it as
              #   NODE_PATH=$(npm root -g) node scripts/e2e-audio.cjs [dir]
yarn test:scripts  # Unit tests for scripts/sefaria-swap.py (python3)
yarn epub     # Generate EPUB from ../data/chapters
```

## Deployment

The site is hosted on **Cloudflare Pages**. Every push to the repo triggers an automatic build and deployment using:

These are dashboard settings (Pages project → Settings → Builds); a Pages Wrangler file can't set the build command or root directory, so they don't live in the repo:

- **Root directory**: `site`
- **Build command**: `yarn build`. This runs the data build in `../data/tools`. Pages clones the whole repo, so `../data` is available. Invalid data fails the deploy.
- **Output directory**: `hugo/public`
- `hugo/static/_headers` sets the Pages response headers. `/data/*` and `/texts/*` are CORS-open (`Access-Control-Allow-Origin: *`), and `/data/*` is cached for a short time.

## Project Structure

```
hugo/
  hugo.toml        # Hugo config: baseURL, params, module mounts (see below)
  content/         # section stubs + _content.gotmpl content adapters (texts, he, translation, classes, outlines)
  data/i18n.json   # nav label translations (en/he)
  layouts/         # baseof, per-section list/single layouts, partials (render-textnode, catalog,
                   #   classes-url, format-time, class-track, part-nav, audio/, outlines/; see Hugo partials)
  assets/js/       # entry points play.ts, follow.ts, classes.ts, outlines.ts; shared audio/model.ts (pure, unit tested),
                   #   audio/store.ts (localStorage), audio/player.ts (playAt/seekOnPlay, scrolling helpers)
                   #   (see Class lists, Audio on chapter pages, Outlines pages)
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

The class catalog generates more:
- `content/classes/_content.gotmpl`: `/classes/<series>/` and `/classes/<series>/<part>/` (see Audio Classes), and `/classes/transcripts/<slug>/`
- `content/outlines/_content.gotmpl`: `/outlines/<series>/` for each series with at least one published outline (see Outlines pages); `content/outlines/_index.md` is `/outlines/`

## Site nav

`layouts/_default/baseof.html`: Home, Texts, Classes, Outlines, About, plus the language switch. Labels come from `data/i18n.json` (`nav.*`, en/he). Outlines (`תקצירי שיעורים` in Hebrew) shows in both languages and always links the English `/outlines/`. The translation has no nav item: the English Texts page (`layouts/texts/list.html`) starts with an "English translation →" entry linking `/translation/`. Only the site nav (`body > nav`) gets the nav bar styles in `main.css`; other `<nav>` elements (`nav.class-toc`, `nav.part-nav`, `nav.outlines-nav`) style themselves.

## Hugo partials

- `catalog.html`: the class catalog (`site.Data.v1.catalog`), failing the build when the data build has not run.
- `classes-url.html`: the one place that builds class page URLs. `dict "series" $s` → `/classes/<series>/`; with `"part" $p` → `/classes/<series>/<part>/` (slugs: `title | urlize`). `content/classes/_content.gotmpl` creates those pages with its own slugs and must agree with it.
- `audio/lectures.html` (cached): every catalog lecture by ID with its `series`, `seriesUrl`, `part`, `partUrl` (its class page: the part page, or the series page for a lecture directly under the series), `anchor` (`class-<id | urlize>`, the id of its box) and `classUrl` (`partUrl#anchor`). Use these instead of building class links.
- `format-time.html`: seconds → `h:mm:ss` or `m:ss`, the same as `formatTime()` in `assets/js/audio/model.ts`. Every time shown by a template goes through it.
- `audio/outline.html`: a lecture's published topics (`title`, `startSeconds`) or an empty slice. `audio/topics.html`: a class box's collapsed topic list (`details[data-track-topics]`, one `button[data-start]` per topic), used by `class-track.html`.
- `outlines/tree.html`, `outlines/class.html`, `outlines/class-details.html`, `outlines/nav.html`: the outlines pages (below).

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

## Outlines pages

`/outlines/` (`layouts/outlines/list.html`) introduces the auto-generated topic outlines and has one card per series that has an outlines page: its counts and a link to each of its parts there (`/outlines/<series>/#<part anchor>`).

`/outlines/<series>/` (`layouts/outlines/single.html`, same series slug as `/classes/`) shows the whole series in catalog order, every topic pre-rendered:

- Breadcrumb, `h1` (series title), counts, Expand all / Collapse all (`.outlines-controls`, `data-js-only`).
- Each part is a `section.outline-part` with an `<h2>` and `id="<part title | urlize>"`, and a link to its class page. Each chapter heading in it is a `section.outline-chapter` with an `<h3>` and `id="<part anchor>--<chapter title | urlize>"`, set off by a side border, so the part's loose classes (outside any heading) are visibly not in a chapter.
- Each class with an outline is a collapsed `details.outline-class`: the summary has the title and topic count; inside, an "Open class" link to its box (`classUrl`) and an `<ol class="outline-topics">` of topic deep links, `<partUrl>?t=<int startSeconds>#<box anchor>`, each "`<span>time</span> title`". classes.js on the class page opens that box's topics and offers Play from there (see Class lists). The markup is lean on purpose (the Walters page has about 930 topics): the time span has no class, and only titles with Hebrew letters are wrapped in `<bdi>`.
- `partials/outlines/tree.html` (cached per series) builds the page's model and decides what is shown: parts and chapter headings without any outlined class are left out; a class without an outline in a shown part, loose or inside a shown heading, is listed plainly (title linking to its box, "no outline yet"); lectures directly under the series form a last part, "Other classes" (`#other-classes`). The adapter makes a page only for a series with at least one outline.
- Build failures: two parts or chapters on one page with the same anchor (or an empty one), and a lecture missing from `audio/lectures.html` (its links would have no target).
- Wide screens (≥ 64rem): the body widens to 72rem (`body:has(.outlines-layout)`) for a sticky side nav (`nav.outlines-nav`) listing parts → chapters. Narrow screens hide it and show the same list (`partials/outlines/nav.html`) in a "Jump to" `<details>` at the top.
- `outlines.js` (`assets/js/outlines.ts`): Expand all / Collapse all, and the part crossing the top 30% of the viewport gets `aria-current="location"` in the side nav (IntersectionObserver; the first part until one gets there). It opens nothing on load, also when the URL names a part.

## Audio Classes

- The source is `../data/classes.txt`. The data build turns it into `catalog.json`, a tree of series → sections → lectures with stable IDs and one canonical `url` per lecture. Hugo never parses `classes.txt` itself.
- `content/classes/_content.gotmpl` creates one page per series and one page per child section, with slugs built from the titles. Series that have been renamed keep their old URLs as aliases.
- Templates use the lecture `url` exactly as given and never build URLs themselves.
- Each track links to its transcript page and to the chapter it is aligned to ("Follow in the text"), when those are published. A class aligned to two chapters links to both ("Follow in the text:", "Chapter 34", "Chapter 35"), its transcript page names both, and both chapter pages list it; `audio/index.html`'s `aligned` entry carries the chapter with the most aligned lines plus `all`.

**Class lists** (`classes/single.html`, `classes/list.html`):

- A part page has previous/next cards (`partials/part-nav.html`, `nav.part-nav`, `rel=prev`/`rel=next`) under its heading and again at the end: the neighbouring part pages of the same series in catalog order (section items only; lectures directly under a series have no part page). The first part has only Next, the last only Previous.
- A part page with more than one heading starts with a quick contents list (`nav.class-toc`): one pill link per heading (`#<title | urlize>`, the `section.chapter-section` id) with its class count; two headings with the same anchor, or an empty one, fail the build. Each track box has `id="class-<lecture id | urlize>"`.
- Each aligned class shows the chapter text it reads (`partials/audio/lesson-text.html`): every line from its first aligned line to its last in reading order (`audio/chapter-lines.html` → `audio/flatten-lines.html`, numbered like `render-textnode.html`), per chapter it reads, with `data-start`/`data-end` from the class's own alignment (`alignments/<id>.json`) on aligned lines. The lines carry `data-line`, never `id` (a line can appear in several boxes). The box (`.lesson-text`, `dir=rtl`) is about three phrases tall and scrolls on its own.
- `classes.js` (`assets/js/classes.ts`, built by `audio/scripts.html`): one class plays at a time; preview lines get a ▶ button and clicking one (or the line text, selection-safe) plays from there; while the class plays, the current line gets `is-discussing` and the box scrolls itself (never the page; quiet 5 s after the reader scrolls it). "Follow in the text" (`a[data-lesson-open]`) opens the in-page reader instead of navigating: a full-screen `role=dialog` that shows the chapter text taken from the chapter page (`[data-aligned-text]`, fetched once per chapter), lines outside the lesson muted, ▶ and click-to-seek on the lesson's aligned lines, the current line marked and kept in view. The class's own `<audio>` stays where it is in the DOM and is docked by CSS together with its Autoplay next toggle (their wrapper, `.track.is-reading .track-player`, `position: fixed`), so playback is never interrupted. While it is open everything but the reader and the docked player is `inert`, so focus stays in the dialog and the player. Opening pushes a history entry (a page loaded on such an entry clears it); ← Back to classes (once, even on a double-click), Esc or the browser's Back close it and return focus to the link (focused again in a 0 ms timeout: with a `#class-…` fragment in the URL, Chromium's history traversal moves focus to the body right after `popstate`). A chapter page that fails to load is fetched again on the next open. A modified click (new tab) still goes to the chapter page.
- Every seek goes through `playAt(audio, t)` (`audio/player.ts`, shared with play.ts): it waits for `loadedmetadata` when the `<audio>` is not loaded yet (`preload=none`) and keeps at most one pending seek per `<audio>` (a WeakMap), so a later `playAt()` cancels an earlier one that is still waiting; it resolves false when the browser refuses to play. `seekOnPlay(audio, t)` arms a seek for the next native play, also cancelled by any `playAt()`. `smoothScroll()` and `scrollWatcher()` (the 5 s quiet after the reader scrolls) live there too; follow.ts uses them as well (its bundle gets its own copy, fine for these stateless helpers, but it cannot see play.js's pending seeks: a transcript paragraph click sets `currentTime` directly).
- **Topic deep links**: `<part page>?t=<T>#class-<lecture id | urlize>` (`T` = the topic's `startSeconds` floored). On arrival classes.ts (`initDeepLinks()`, after `initAutoplay()` unhides the `[data-js-only]` topic lists) opens the box's topics; with `?t` and topics it selects the last topic whose floored start is ≤ `t`, else the first (`deepLinkTarget()` in `audio/model.ts`; `parseDeepLink()` reads the URL), marks its `<li>` `aria-current` + `is-selected` (kept until another topic is under way), and puts a focused `button.audio-link.deep-play` "▶ Play from m:ss" under the player. It plays from the topic's exact start when `t` names it or is past the last topic's start (the class may be shorter than `t`), else from `t`; the native play button seeks there too on its first play (`seekOnPlay()`). `t` is then dropped from the URL (`history.replaceState(history.state, '', …)`, hash kept). The box is scrolled into view again (`.track` has `scroll-margin-block-start`), and once more after `load`, since the browser's own fragment navigation then moves focus to the body. Never autoplays. Without `?t`, or on a `hashchange` to a `#class-…` box, it only opens the topics and scrolls.
- **Playing line in the URL**: while a lesson plays, the URL's fragment is its current line id (`/classes/…/#<line id>`), written with `replaceHash()` (`audio/player.ts`: `history.replaceState(history.state, …)`, so no history entry, no scroll, no `hashchange`; a no-op when unchanged). It is rewritten on every update, not only on a line change, because closing the reader goes back to the entry before it, whose fragment is older. It stays when playback pauses or ends. Arriving with (or a `hashchange` to) a fragment that is not a `class-…` box (`hashId()` in `audio/model.ts` decodes it), `initDeepLinks()` looks for the first lesson box whose class aligns that line, scrolls it into view with its lesson text at the line, and on arrival adds the focused "▶ Play from m:ss" button (and `seekOnPlay()`) as a topic deep link does. Never autoplays.
- **Autoplay next**: a checkbox under each box's `<audio>` (`[data-autoplay-next]`, `data-js-only`), shown only while that box's class plays (`.track.is-playing`, kept by `markPlaying()` in `audio/store.ts`). When on and a class ends, the next box on the page (document order, across headings) plays from the start. If the reader is open on the class that ended, it swaps to the next lesson (`swap()`: same history entry, its player docked), or closes when that class has no lesson text (focus moves to that box). A class hidden behind the reader never autoplays (opening the reader pauses every other class), and when the browser refuses to start the next class (autoplay policy) the reader closes and the box is shown so it can be started by hand. Closing the reader after a swap brings the focused link on screen. Otherwise the next box is scrolled into view (`block: nearest`, smooth unless reduced motion) unless the reader scrolled the page in the last 5 s (scrolling inside a lesson text box or the reader does not count). The page's last class just stops.

## Audio on chapter pages and transcript pages

Published audio data comes from `../data/audio-publish.json` (see data/README.md, "Publishing audio"). Coverage is sparse on purpose: a chapter with no published alignment renders exactly as before (no player, no script, no `data-t`).

`partials/audio/index.html` (cached) lists what was published: transcripts (with their page URL), per-chapter alignment indexes, aligned lectures and outlines. `partials/audio/lectures.html` (cached) maps every catalog lecture ID to its series, part and part page.

**Chapter page** (`_default/single.html`, any page that shows the Hebrew): when `alignments/chapters/<key>.json` exists,

- `partials/audio/chapter-panel.html` renders `<section class="listen" data-listen data-chapter-alignments=… data-follow-src=…>` with the transcript region (`[data-listen-transcript-pane]`, first child, `hidden`), the Teacher (series) and Class selectors (`[data-listen-series]`, `[data-listen-select]`, options carry `data-series`, `data-url`, `data-transcript`), the Follow along button (`[data-follow-along]`), the Show transcript toggle (`[data-listen-transcript-toggle]`), a Transcript page link, one `<audio data-listen-audio preload=none>`, a status note (`[data-listen-note]`), and the outline UI (`[data-listen-now]`, `<details data-listen-topics>`). `data-js-only` elements start `hidden`; `data-no-js` ones are hidden by the script. Without JS it is a plain player for the first class.
- Every aligned line gets `data-t="<seconds>"` (best class start: highest confidence, then catalog order); `render-textnode.html` and `lib/json-renderer.js` (`lineTimes` option) stay in parity. The text wrapper gets `data-aligned-text`.
- `play.js` (`assets/js/play.ts`, loaded as a module only on these pages) fetches the chapter alignment JSON, adds a `<button class="line-play">` (no text content, so copying is unchanged) before each aligned `.line`, and plays at once (there is no menu) the best class from the line: the saved teacher's series first (Rabbi Benyamin Walters Original Class, series `0`, when nothing is saved: `chooseSeries()` in `audio/model.ts`), then the class already playing, then confidence, then catalog order. A `?teacher=` URL parameter overrides the saved teacher for that page load only: play.ts keeps the teacher with its source (`query` or `selected`); a `query` teacher is never saved, and picking a teacher in the selector saves it and drops the parameter from the URL (`history.replaceState`). The value is the series id or its `teacherKey()` (`audio/model.ts`: the title with everything but ASCII letters and digits dropped, `RabbiMarkelSeriesAdvanced`), case-insensitive, or a unique prefix of it (`RabbiMarkel`): `resolveTeacher()`. A linked teacher with no classes on the chapter falls back with a note. The "Follow in the text" links (class lists, transcript pages) carry `?teacher=<teacherKey of the class's series>`; Hugo computes the key with the same regex. The teacher choice is saved in `localStorage` (`shaarHayichud.audio.series`) and applies on every chapter page; if the saved teacher has no classes on the chapter or the line, the page falls back to another series and says so in the note. Every `localStorage` access goes through `readStore()`/`writeStore()` (`audio/store.ts`, try/catch): with storage blocked the page works and choices last for the page only.
- **Playing line in the URL**: while the panel's `<audio>` plays, the fragment is the current line id of the class in the player (`/texts/chapter-7/#wospio7l`; `spanAt()` over the class's spans, as Follow along uses, but whether or not Follow along is on), written with `replaceHash()` (`audio/player.ts`, replaceState: no history entry). It stays when playback pauses or ends, so a reload or a copied link lands on that line (the line's `id`, by the browser's own fragment scroll). Transcript pages do not do this.
- **Autoplay next**: a small checkbox directly under the panel's `<audio>` (`[data-autoplay-next]`, `data-js-only`), shown only while the player plays (`.listen.is-playing`, `markPlaying()`). When on and the class in the player ends, the next class of the same teacher on the chapter (`nextInSeries()` in `audio/model.ts`: the next option in the Class selector) plays from the start through the same path as the selector, so Follow along, the transcript region and the outline follow; the note says "Playing next: <title>". After the teacher's last class on the chapter it stops and says so (no navigation). Its on/off is one setting for chapter pages and class lists (`shaarHayichud.audio.autoplayNext`, `on`/`off`, default off; `autoplayNext()` in `audio/store.ts` keeps every toggle on the page in step). Transcript pages have no toggle.
- Transcript and Follow in the text links (panel, class lists, transcript pages) are pill buttons (`a.audio-link`). Transcript links (the panel's and the class lists' `Transcript`) open in a new tab (`target="_blank" rel="noopener"`) and carry `partials/new-tab.html`: an `aria-hidden` box-with-arrow SVG and visually hidden "(opens in a new tab)".
- The panel docks to the bottom once playback starts (`.listen.is-active`, `position: fixed`). play.ts keeps its height in `--listen-h` (ResizeObserver), which sets the body's bottom padding and the lines' `scroll-margin-block-end`, so the last lines stay reachable however tall the panel gets. The docked panel is a flex column, at most 85vh, in which only the transcript region shrinks.
- **Show transcript** (hidden when the class in the player has no published transcript) docks the panel and shows that class's transcript in the region at the top of the panel, above the controls: 50vh (`dvh` where supported), scrolling on its own, so the controls do not move when it opens. The published `/data/v1/<lecture.transcript>` is fetched on first show (cached per class) and rendered as `.tseg` paragraphs with `data-start`/`data-end` and a play button each; clicking a paragraph (selection-safe) or its button plays from there. The current paragraph gets `is-discussing` (same side border), and it is positioned in view when the region opens. While Follow along is on, the region scrolls itself (`scrollTo` on the region, never the page; `scrollToShow()` in `audio/model.ts`) to keep the current paragraph visible, except for 5 s after the reader scrolls the region. Switching class swaps the transcript. Shown/hidden is not saved: it takes half the screen, so it opens only when asked.
- **Follow along** loads `follow.js` (`assets/js/follow.ts`) with a dynamic `import()`. Its on/off is saved in `localStorage` (`shaarHayichud.audio.followAlong`, `on`/`off`); a chapter or transcript page loaded with it on turns it on again (without starting playback). While it is on (`html.is-following`), clicking a line's text also plays (selection-safe: ignored when text is selected or on double-click), and the line under discussion gets `is-discussing`; CSS draws `border-inline-start` on its block (`p` or `.content`) via `:has()`. A line is current from its start until the next aligned line of that class starts, held at most 30 s past its own end (`spans()` in `audio/model.ts`): this copes with zero-length ranges and collapsed timestamps. The current line scrolls into view unless the reader scrolled the page in the last 5 s (scrolling inside the panel does not count). With an outline, the panel shows "Now: <topic>" and a collapsible, clickable topic list for the class in the player (marked auto-generated; topics follow the class timeline, not lines).

**Transcript pages**: `content/classes/_content.gotmpl` adds `/classes/transcripts/<slug>/` for each published transcript; the slug is the lecture ID lowercased, extension dropped, other runs of characters → `-` (`001 Intro.mp3` → `001-intro`). It depends on the ID alone, so it never changes; a slug collision or a series slugged `transcripts` fails the build. `partials/audio/transcript.html` renders `<p class="tseg" id="tN" data-start data-end [data-speaker]>` paragraphs (speaker label at each change; other speakers than the main one indented), outline topics as `<h2 class="topic">` before the first paragraph starting no more than 5 s before the topic, and the same panel without selectors or transcript toggle. Follow along makes paragraphs clickable (seek) and adds a play button to each. /texts lists transcripts with no chapter under "Classes without text".

Scripts are built by `partials/audio/scripts.html` (`js.Build`, ESM, ES2020, minified, fingerprinted). js.Build exists in every Hugo build since 0.74 (no extended edition or Node needed), so it works with Cloudflare Pages' default Hugo (0.147.7 in the v3 image); tested with 0.147.7 and 0.152.2. Hugo writes `assets/jsconfig.json` on each build (git-ignored).
