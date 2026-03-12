# epub

`build-epub.mjs` generates `dist/shaar-hayichud.epub` directly from the JSON chapter
files in `src/texts/`. No pre-build step is needed.

```bash
yarn epub
```

Make sure `epub-gen` is installed (`yarn install`) and that `src/texts/chapter_NN.json`
files exist.

## Notes

The rendering logic used for the EPUB is the same as the site build: `lib/json-renderer.js`
walks the `TextNode` tree and emits `depth-N` div structures.
