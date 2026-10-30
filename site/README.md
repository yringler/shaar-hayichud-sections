Chapters of Shaar Hayichud, with labeled subsections, plus audio class recordings.
Text taken from [chabadlibrary.org/books](https://chabadlibrary.org/books/2800530003) .

Chapter text and the class catalog live in the repo's [`data/`](../data/README.md)
directory, not in this one.

## Build

```bash
cd site
yarn build    # data build (../data/tools) + Hugo build + search index → hugo/public/
yarn serve    # data build + Hugo dev server with live reload (no search index:
              #   run yarn build once, then serve hugo/public, to try /search/)
```

`/search/` searches the chapter text, the translation, the class transcripts and their
topics with [Pagefind](https://pagefind.app): `yarn build` writes the index to
`hugo/public/pagefind/` after Hugo. The browser loads only the index chunks a query needs.
Key terms are listed with their spellings and transliterations in
`hugo/assets/js/search/glossary.ts`; add to it to make `chochmah`-style searches find more.

The build also publishes the data as JSON at `/data/v1/` (see `data/README.md`).

Every line of chapter text is rendered as `<span class="line" id="…">` using the line's
stable ID, so a page can be linked to (or highlighted at) a specific line, e.g.
`/texts/chapter-1/#<line id>`.

## EPUB

```bash
yarn epub     # generates dist/shaar-hayichud.epub
```
