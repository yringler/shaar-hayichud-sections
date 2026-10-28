Chapters of Shaar Hayichud, with labeled subsections, plus audio class recordings.
Text taken from [chabadlibrary.org/books](https://chabadlibrary.org/books/2800530003) .

Chapter text and the class catalog live in the repo's [`data/`](../data/README.md)
directory, not in this one.

## Build

```bash
cd site
yarn build    # data build (../data/tools) + Hugo build → hugo/public/
yarn serve    # data build + Hugo dev server with live reload
```

The build also publishes the data as JSON at `/data/v1/` (see `data/README.md`).

Every line of chapter text is rendered as `<span class="line" id="…">` using the line's
stable ID, so a page can be linked to (or highlighted at) a specific line, e.g.
`/texts/chapter-1/#<line id>`.

## EPUB

```bash
yarn epub     # generates dist/shaar-hayichud.epub
```
