---
name: study-review
description: Build and publish the review pages for a series' study guides (data/study/<series>/) and write the reviewer's decisions back - a sensitivity review (each flagged block as written beside its softened text, decided raw / softened / drop) and a before/after review of a rewrite (each block old beside new, rated). Also runs a rewrite pass over a series with a team of agents writing edit lists. Use when asked for a review tool, a page to review flags or a rewrite, to apply decisions or ratings from such a page, or to condense or rewrite blocks across many chapters.
---

# Study-guide review pages

The study guides are reviewed by a person on two claude.ai Artifact pages,
built from the chapter files and published privately. The reviewer's
decisions are saved in each page's database, read back with the
`ArtifactData` tool, and written into the files by the scripts here. The
rules being reviewed against are in `data/study/STYLE.md` (Sensitivity; the
raw / softened / drop test; "Write a guide, not a recording") and in the
series' `NOTES.md`, where the reviewer's past calls are recorded. Read both
before writing anything for the reviewer.

```
.claude/skills/study-review/
  pages/flags.html        sensitivity review (template; {{TITLE}}, {{HEADING}})
  pages/compare.html      before/after review of a rewrite (template)
  scripts/flags_data.py   series -> flags.json for flags.html
  scripts/compare_data.py series + git ref -> ch/index.json, ch/<chapter>.json for compare.html
  scripts/make_page.py    fills a template's title into a build directory
  scripts/apply_decisions.py  the flags page's decisions -> chapter files
  scripts/apply_edits.py  agents' edit lists -> chapter files
  scripts/common.py       shared helpers
  briefs/rewrite.md       the brief for each agent of a rewrite team
```

The scripts are Python 3, standard library only, and find the repo from
their own path, so they run from anywhere. Build into the session's
scratchpad, never into the repo. Run `cd data/tools && yarn build-data`
first if `data/dist/v1/catalog.json` is missing (the pages' Listen links
come from it).

## Before you publish: an existing page?

Each page is one artifact per series and kind, kept across sessions: the
reviewer's decisions live in its database. Before publishing, list the
user's artifacts (`Artifact` action `list`) and look for the title (for
Markel: "Markel Sensitivity Review", "Markel Condensing Review"). If it
exists, `read` it and republish to its `url` with the same title; publishing
without `url` makes a second page with an empty database. If there is none,
publish a new one. Pages are private to the user; say so when you give the
link.

Load the `artifact-capabilities` skill once in the session before the first
publish (the pages declare `capabilities: {db: {}, user: {}}`); the pages
themselves are already written, so the `artifact-design` pass is done.

## A. Sensitivity review (pages/flags.html)

Shows every flagged block: the uncensored text beside the softened text
(with a word diff), why it was flagged, the writer's lean (`recommend`), the
transcript of its audio, a Listen link and the passage. The reviewer
decides **Raw** (print as said), **Softened** (print the softened text, or
their own edit of it) or **Drop** (leave the block out), and can add a note.

```bash
S=.claude/skills/study-review/scripts; OUT=<scratchpad>/flags-review
python3 $S/flags_data.py --series markel-advanced --out $OUT          # [--chapters 1-19]
python3 $S/make_page.py flags --title "Markel Sensitivity Review" --out $OUT
```

Publish `$OUT/flags.html` with `files: {"flags.json": "$OUT/flags.json"}`,
`capabilities: {db: {}, user: {}}`, `icon: "checklist"` (first publish only).
Decisions are documents in the page's `reviews` collection, keyed by block
id (`chapter_NN.s<i>.p<j>.b<k>`): `{ decision: "raw"|"soft"|"drop",
publishable?, publishableTitle?, note?, at }`.

**Apply them** when the reviewer says they are done (or asks you to apply
what is there):

1. `ArtifactData` action `query`, collection `reviews`, `query: {limit: 1000}`,
   `out_dir: <scratchpad>/db` (writes `<scratchpad>/db/reviews/<id>.json`).
2. `python3 $S/apply_decisions.py --series <series> --flags $OUT/flags.json --dump <scratchpad>/db/reviews --dry-run`,
   read the summary, then run it without `--dry-run`. It removes a Raw
   flag, sets `action` and `reviewed` (today) on Softened and Drop, uses the
   reviewer's own softened text where they wrote one, and drops the
   writer's lean. It skips (and lists) any block whose text or flag changed
   since the page was built. **Notes are printed, not applied**: act on each
   (a note on a Raw block usually explains a call: record the rule it implies
   in the series' `NOTES.md`).
3. `cd data/tools && yarn study-check --series <series>` (0 errors, 0
   warnings), `yarn build-data`, commit.
4. Rebuild and republish the page so it shows the files as they now are.

`flags.json` must be the one the page was published with (the script checks
each decision against what the reviewer saw). Block ids are positional: if
blocks were added, removed or moved since, rebuild the page and ask for the
affected decisions again rather than applying them.

## B. Before/after review of a rewrite (pages/compare.html)

Shows each block before and after a rewrite, chapter by chapter (a menu
loads one chapter at a time), with a word diff, the transcript and Listen,
and the words and quoted words per chapter. The reviewer rates a block
**Good**, **Cut too much** (teaching lost) or **Still too long**, with an
optional note. Flagged blocks are labelled (reviewed flags are not
rewritten).

```bash
OUT=<scratchpad>/rewrite-review
python3 $S/compare_data.py --series markel-advanced --before <ref> --out $OUT   # [--after <ref>] [--chapters 1-4,6]
python3 $S/make_page.py compare --title "Markel Condensing Review" --out $OUT
```

`--before` is the commit before the rewrite (e.g. `<first rewrite commit>~1`);
`--after` defaults to the working tree. It refuses blocks that moved
between the two (this page is for text rewrites). Publish
`$OUT/compare.html` with `files` mapping `ch/index.json` and every
`ch/<chapter>.json` to their paths under `$OUT`, the same capabilities and
`icon: "document"`.

Ratings are documents in the `ratings` collection, keyed by block id:
`{ rating?: "good"|"more"|"less", note?, at }` (`more` = cut too much,
`less` = still too long). Read them back the same way (`query`, `out_dir`)
and act on them yourself: for "cut too much", put back what the transcript
shows was lost; for "still too long", condense further; follow each note.
Edit by an edit list and `apply_edits.py` (below), check, commit, rebuild
the page.

## C. A rewrite pass with a team of agents

For a pass over many chapters (the November 2026 condensing of
`markel-advanced` ran 11 agents over 18 chapters):

1. Pilot one chapter first and show it on page B before running the rest.
2. Split the work by words of text (about 8,000 words of blocks per agent);
   split a big chapter by sections, giving each agent 0-based
   `sections[i]` ranges written as indexes, never "sections 4 through 6".
3. Give each agent `briefs/rewrite.md` with its series, scope and output
   path (`<scratchpad>/team/gNN.json`). Agents write edit lists and never
   touch the chapter files, so they can share a chapter.
4. As each finishes: `python3 $S/apply_edits.py --series <series> <scratchpad>/team/gNN.json`
   (it refuses a stale `old`, a flagged block, or a text that occurs twice),
   then `yarn study-check --series <series> --chapter N`. A block the check
   calls too long goes back to the agent that wrote it, by `SendMessage`,
   for a tightened edit list. Check a sample of each list against the
   transcript yourself, and especially anything an agent says it filled in
   or was unsure of. Commit per agent.
5. Read each agent's report for errors fixed, flags it thinks are missing
   (an agent may not add flags: you add them, unreviewed, and they appear on
   page A) and places it was unsure; pass those on to the user.
6. Build page B over the whole pass for the reviewer.

## Notes

- Keep the files' formatting: `apply_edits.py` swaps exact JSON strings;
  scripts that re-serialize a file (`apply_decisions.py`) run
  `yarn study-fill` on it afterwards, which restores the house style.
- A flagged block's `text` and `publishable` use the same words outside the
  flagged remark (STYLE.md). Changing one means changing the other and
  deleting `reviewed`.
- The pages save to the artifact's database only for signed-in viewers in
  claude.ai; elsewhere they are read-only, and "Copy decisions" on page A
  gives the reviewer a JSON to paste instead.
