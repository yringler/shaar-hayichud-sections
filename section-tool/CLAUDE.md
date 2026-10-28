# Claude Code Instructions — section-tool

> **Monorepo context**: This is the `section-tool/` sub-project. See the [root CLAUDE.md](../CLAUDE.md) for an overview of the full repo. The JSON produced here is saved by `functions/api/save.ts` (GitHub contents API) into the repo's [`data/chapters/`](../data/README.md), the single source of truth that the [`site/` sub-project](../site/CLAUDE.md) renders and publishes. Saved files must match `data/schema/v1/chapter.schema.json`; the site build fails otherwise.

A keyboard-driven Angular 21 editor (standalone components, signals, zoneless, Vitest) for dividing Hebrew chapter text into nested sections. See [ARCHITECTURE.md](ARCHITECTURE.md) for the layout and data flow.

## Architecture rules

These are the invariants; keep them when changing anything.

1. **One state owner.** `TextSectionService` holds the document in a read-only signal. The only way to change it is `dispatch(command)`. Nothing else writes the tree.
2. **Commands are pure.** All document logic lives in `src/app/editor/` with no Angular imports (except the id token and test helpers). `applyCommand(roots, command, ids)` returns a new tree and the next caret position; it never mutates its input. Updates copy only the path to the change, so every changed node gets a new reference and untouched subtrees are shared.
3. **Components only render and emit.** `TextNodeComponent` turns user actions into `EditorCommand`s (key presses through the pure `keyToCommand` keymap) and emits them; the container dispatches them and places the caret from the returned `Focus`. Components may touch the DOM (caret, textarea value), never the document.
4. **Ids are injected.** Editor code gets fresh ids from an `IdSource` (the `ID_SOURCE` token), never from `crypto` directly. Section (node) ids are in-memory only and are not persisted.
5. **Load and save are a tested pair.** `editor/serialization.ts` parses chapter JSON and prints it back. The golden test in `serialization.spec.ts` loads and saves every `data/chapters/*.json` file; keep it passing. Its doc comment states the exact formatting contract.

## Adding or changing behavior

- New document operation: add a variant to `EditorCommand`, handle it in `applyCommand`, and test it in `commands.spec.ts` (including the "unknown node" and no-op branches). Then wire the UI to emit it.
- New key binding: change `keymap.ts` and `keymap.spec.ts`.
- Changing the persisted shape: change `serialization.ts`, its spec, `data/schema/v1`, and the data in `data/chapters/` together.

## Testing

- `yarn test` (the package pins Yarn 4; if the global yarn is 1.x, use `corepack yarn test`). Pass `--watch=false` for a single run.
- Specs use the helpers in `src/app/editor/testing.ts`: `node(...)`/`nodeWith(...)` to build trees, `sequentialIds()`/`provideSequentialIds()` for deterministic ids, and `deepFreeze()` so a test fails if a command mutates its input.
- The golden round-trip test reads `../data/chapters` relative to the working directory, so run tests from `section-tool/`.

## Common commands

```bash
yarn start   # dev server at http://localhost:4200
yarn test    # Vitest
yarn build   # production build
```

## Keyboard shortcuts (user-facing)

- **Enter**: split into child section
- **Tab**: split into sibling section
- **Alt+Enter**: split and promote to the parent's sibling
- **Shift+Enter**: merge with parent
- **Shift+Tab**: merge with previous sibling
- **Ctrl+S**: save

In translation mode, Enter in the Hebrew text inserts a newline instead.

## RTL

Hebrew textareas use `dir="rtl"` and CSS handles indentation with `margin-right`. No RTL logic is needed in TypeScript.
