# xslt-reference (archived)

`transform.xsl` is kept as documentation — the original XSLT transformation rules
that defined the rendering logic. It is **not used in the build**.

The equivalent logic is implemented in `lib/json-renderer.js`, which walks the JSON
TextNode tree and emits the same `depth-N` div structure.

## EPUB generation

`build-epub.mjs` generates `dist/shaar-hayichud.epub` directly from the JSON chapter
files in `src/texts/`. No pre-build step is needed.

```bash
yarn epub
```

Make sure `epub-gen` is installed (`yarn add epub-gen`) and that `src/texts/chapter_NN.json`
files exist.

## Original XSLT transformation rules

- Matched `section/section` children at depth 1
- Per section: hierarchical numbering (`1`, `1.2`, `1.2.3`, …) + optional `@label`
- Direct text → `<div class="depth-N">` with `.label` + `.content`
- Footnote digit markers stripped: `replace(/\d+/g, '')`
- Child sections recursed (flat HTML, not nested divs)
