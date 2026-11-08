---
name: run-section-tool
description: Run the section-tool editor locally (offline mode) and drive it headlessly with Playwright to load a chapter, screenshot it, or inspect its DOM. Use to reproduce or verify a section-tool UI change in the real app.
---

# Run the section-tool and drive it with Playwright

Use **offline mode** (port 4300). Dev mode (`yarn start`, port 4200) can't load chapters by itself: it fetches them from the Hugo site at `:1313`, saves through wrangler at `:8788`, and requires auth. Offline mode serves the app and `data/chapters/` from one local Node server (`server/local.ts`) and needs no auth, env vars, network access or Hugo.

## Start / stop

```bash
cd section-tool
corepack yarn build:offline   # ~15s -> dist/offline/browser; rerun after every source change
corepack yarn serve:offline   # run in the background; listens on 127.0.0.1:4300
```

- Use `corepack yarn`. The global yarn may be 1.x, and the package pins Yarn 4.
- `serve:offline` exits if `dist/offline/browser/index.html` is missing, so build first. (`corepack yarn offline` does the build and the serve in one step.)
- Ready check: `curl -s localhost:4300/texts/index.json` returns the list of chapter files. Each chapter is at `/texts/<file>`.
- Stop: `pkill -f server/local.ts`.

## Open a chapter

There is no URL route for a chapter. Go to `http://localhost:4300/`, click the **Library** button, then click the `li.file-item` row whose text is the file name (e.g. `chapter_14.json`). Each section's text is a `wa-textarea.text-area`, and the real `<textarea>` is inside its shadow root.

**Never press Ctrl+S or click Save in automated runs.** Offline saves write `data/chapters/` and make a real local git commit.

## Screenshot script

Chromium and Playwright are preinstalled in cloud sessions: `require('playwright')` works from any directory. Don't run `playwright install`.

```bash
node .claude/skills/run-section-tool/screenshot.cjs chapter_14.json /path/to/out.png [width] [height]
```

It writes `out.png` (viewport) and `out-full.png` (full page), and prints the size and position of each `wa-textarea` host and of its inner `<textarea>`. Open the PNG with the Read tool to look at it. Copy the script and adapt it for interactions: section-tool is keyboard-driven, and `section-tool/CLAUDE.md` lists the shortcuts.
