Chapters of Shaar Hayichud, with labeled subsections.
Text taken from [chabadlibrary.org/books](https://chabadlibrary.org/books/2800530003).

## Convert to HTML

Build all chapters into `dist/`:

```bash
bash build.sh
```

Or convert a single file:

```bash
npx xslt3 -xsl:transform.xsl -s:chapter_01.xml -o:dist/chapter_01.html
```