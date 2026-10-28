# Architecture

Angular 21, standalone components, zoneless change detection, signals.

## Layers

| Where | What | Angular? |
|-------|------|----------|
| `src/app/models/` | The editor's `TextNode` model and type guards | no |
| `src/app/editor/` | The document logic: commands (`applyCommand`), immutable tree helpers, the keymap, and chapter JSON load/save | no (except the `ID_SOURCE` token and test helpers) |
| `src/app/services/text-section.service.ts` | Holds the document in a signal and exposes `dispatch(command)` plus the derived `jsonOutput` | yes |
| `src/app/components/`, `src/app/text-sectioner/` | Rendering and user input | yes |
| `src/app/services/` (others) | Saving through the Cloudflare Pages Function, auth, and the chapter library | yes |
| `functions/api/save.ts` | Cloudflare Pages Function that commits a chapter to `data/chapters/` | n/a |

## Data flow

1. The user types or presses a key in a `TextNodeComponent`.
2. The component builds an `EditorCommand` (key presses go through `keyToCommand`) and emits it. Commands bubble up through the recursive node components unchanged.
3. `TextSectionerComponent.onCommand` calls `TextSectionService.dispatch`.
4. `dispatch` runs the pure `applyCommand` on the current tree and stores the new tree. `jsonOutput` recomputes.
5. If the command returned a `Focus`, the container puts the caret there after the next render.

Because the tree is immutable, the previous tree is never changed. That keeps nested `input()`s honest (a changed node is a new object) and makes undo a matter of keeping old trees.

## Ids

Node ids exist only in memory, are generated on load through the injected `IdSource`, and are not written to the chapter JSON. Templates track child nodes by id.

## Load and save

`editor/serialization.ts` parses chapter JSON into editor nodes and prints the tree back as the JSON the editor saves. A golden test round-trips every chapter in `data/chapters/`.
