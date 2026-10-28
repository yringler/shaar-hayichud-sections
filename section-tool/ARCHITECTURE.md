# Architecture

Angular 21, standalone components, zoneless change detection, signals.

## Layers

| Where | What | Angular? |
|-------|------|----------|
| `src/app/models/` | The editor's `TextNode` / `TextRun` / `Line` model and type guards | no |
| `src/app/editor/` | The document logic: commands (`applyCommand`), immutable tree helpers, line-id logic, the keymap, chapter JSON load/save, and the pre-save chapter check | no (except the `ID_SOURCE` token and test helpers) |
| `src/app/services/text-section.service.ts` | Holds the document in a signal and exposes `dispatch(command)` plus the derived `jsonOutput` | yes |
| `src/app/components/`, `src/app/text-sectioner/` | Rendering and user input | yes |
| `src/app/services/` (others) | Saving through the Cloudflare Pages Function, auth, and the chapter library | yes |
| `functions/api/save.ts` | Cloudflare Pages Function that commits a chapter to `data/chapters/`; reuses `editor/chapter-check.ts` | n/a |

## Data flow

1. The user types or presses a key in a `TextNodeComponent`.
2. The component builds an `EditorCommand` (key presses go through `keyToCommand`) and emits it. Commands bubble up through the recursive node components unchanged.
3. `TextSectionerComponent.onCommand` calls `TextSectionService.dispatch`.
4. `dispatch` runs the pure `applyCommand` on the current tree and stores the new tree. `jsonOutput` recomputes.
5. If the command returned a `Focus`, the container puts the caret there after the next render.

Because the tree is immutable, the previous tree is never changed. That keeps nested `input()`s honest (a changed node is a new object) and makes undo a matter of keeping old trees.

## Ids

Node (section) ids exist only in memory, are generated on load through the injected `IdSource`, and are not written to the chapter JSON. Templates track child nodes by id.

Line ids are persisted and must stay stable: audio alignments and transcripts point at a line by id alone. In memory, consecutive lines form a `TextRun`, edited as one textarea (lines joined by `"\n"`). The rules, all in `editor/lines.ts`:

- **Edits** (`updateText`) diff the run's old lines against the new text. Unchanged lines keep their id, an edited line that is clearly the same line (similar enough, in the same place) keeps its id, a moved line keeps its id, and only genuinely new lines get fresh ones. Joining lines is a delete plus an insert: the joined line gets a fresh id and the joined lines' ids disappear.
- **Changes spanning commands.** Many real edits take several input events (cut then paste, drag and drop, undo after a delete, moving a line to another section). `TextSectionService` keeps the lines that commands removed (`retireLines`) and passes them to `applyCommand`; when such a line comes back, it gets its id back. Loading or starting a document forgets them.
- **Splits** snap to a line boundary, so a line is never cut in two. Merges, deletes and moves carry lines, ids included, unchanged.
- **Fresh ids** come from `IdSource.lineId(taken)`, unique within the document. Uniqueness across the corpus is enforced by the data build.

Text runs are tracked by position in the template, not by line id: a run's first line changes as the user types, and re-creating the textarea would lose the caret.

## Load and save

`editor/serialization.ts` parses chapter JSON into editor nodes and prints the tree back as the JSON the editor saves, in the loaded file's own layout. A golden test checks that loading and saving every chapter in `data/chapters/` is byte-identical.

Loading reports how many lines got a fresh id because theirs was missing, invalid or duplicated (or the file used the old plain-string format); the editor asks before saving such a file, since that replaces persisted ids. Saves also carry the git blob sha of the JSON that was loaded (`services/base-version.ts`), and `functions/api/save.ts` refuses (409) to overwrite a file that changed since: the editor loads from the deployed site, which can lag behind the repository.
