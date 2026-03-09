# Shaar Hayichud Sections — Monorepo

This repo contains two independent sub-projects. See each sub-project's `CLAUDE.md` for full details.

## Sub-projects

| Directory | Description | CLAUDE.md |
|-----------|-------------|-----------|
| [`section-tool/`](section-tool/CLAUDE.md) | Angular 21 keyboard-driven tool for dividing Hebrew text into nested XML sections | [section-tool/CLAUDE.md](section-tool/CLAUDE.md) |
| [`site/`](site/CLAUDE.md) | Eleventy (11ty) static site rendering the Shaar Hayichud chapters with audio class recordings | [site/CLAUDE.md](site/CLAUDE.md) |

## Relationship Between Sub-projects

- `section-tool` produces labeled XML (`<section label="...">` trees)
- `site` consumes that XML as source content and renders it to HTML

The two sub-projects have separate `package.json` files, separate dependency trees, and are developed independently. There is no shared build step at the monorepo root.

## Repo-level Commands

Each sub-project is run from its own directory:

```bash
# Section tool (Angular)
cd section-tool
npm install
npm start        # dev server at http://localhost:4200
npm test         # Vitest unit tests

# Site (Eleventy)
cd site
yarn build       # build → _site/
yarn serve       # dev server with live reload
yarn test        # unit tests for lib/xml-renderer.js
```
