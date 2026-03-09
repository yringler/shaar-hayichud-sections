# XSLT Reference (archived)

The files in this directory are **not used in the build**. They are kept as
documentation and as the authoritative source of truth for the transformation
rules that were originally applied to the XML chapter files.

The equivalent logic is now implemented in JavaScript in `lib/xml-renderer.js`,
registered as a native Eleventy template extension for `.xml` files.

## What the original transform.xsl did

- Matched the document root and processed `section/section` children at `depth=1`
- For each `<section label="…">` element:
  - Computed a hierarchical section number (`1`, `1.2`, `1.2.3`, …)
  - Emitted `<div class="depth-N">` containing:
    - `<div class="label">` with `<span class="number">` and the label text
    - `<div class="content">` with the section's direct text, footnote digits stripped
  - Recursed into child `<section>` elements at `depth+1`
