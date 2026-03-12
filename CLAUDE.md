# Shaar Hayichud Sections — Monorepo

This repo contains two independent sub-projects. See each sub-project's `CLAUDE.md` for full details.

## Sub-projects

| Directory | Description | CLAUDE.md |
|-----------|-------------|-----------|
| [`section-tool/`](section-tool/CLAUDE.md) | Angular 21 keyboard-driven tool for dividing Hebrew text into nested JSON sections | [section-tool/CLAUDE.md](section-tool/CLAUDE.md) |
| [`site/`](site/CLAUDE.md) | Hugo static site rendering the Shaar Hayichud chapters with audio class recordings | [site/CLAUDE.md](site/CLAUDE.md) |

## Relationship Between Sub-projects

- `section-tool` produces JSON chapter files (`TextNode[]` arrays) that are saved as `chapter_NN.json`
- `site` reads those JSON files from `hugo/chapters/` and renders them to HTML via Go templates
- The section-tool's Cloudflare Worker saves files to `site/hugo/chapters/` via the GitHub API

The two sub-projects have separate `package.json` files, separate dependency trees, and are developed independently. There is no shared build step at the monorepo root.

## Repo-level Commands

Each sub-project is run from its own directory:

```bash
# Section tool (Angular)
cd section-tool
yarn install
yarn start       # dev server at http://localhost:4200
yarn test        # Vitest unit tests

# Site (Hugo)
cd site
yarn build       # Hugo build → hugo/public/
yarn serve       # Hugo dev server with live reload
yarn test        # unit tests for lib/json-renderer.js
```
