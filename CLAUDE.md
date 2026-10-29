# Shaar Hayichud Sections — Monorepo

This repo has one shared data directory, two sub-projects and a Dart package. Read each one's own docs for details.

## Layout

| Directory | Description | Docs |
|-----------|-------------|------|
| [`data/`](data/README.md) | **Single source of truth**: the class catalog (`classes.txt`), chapter JSON (`chapters/`), class transcripts (`transcripts/`), line alignments (`alignments/`) and topic outlines (`outlines/`), JSON Schemas (`schema/v1/`, `schema/sources/`), the TypeScript build/validation/transcription tools (`tools/`), and the Python forced-alignment re-timing tool (`retime/`, output in `retimed/`) | [data/README.md](data/README.md) |
| [`section-tool/`](section-tool/CLAUDE.md) | Angular 21 keyboard-driven tool for dividing Hebrew text into nested JSON sections | [section-tool/CLAUDE.md](section-tool/CLAUDE.md) |
| [`packages/dart/`](packages/dart/CLAUDE.md) | `shaar_hayichud_data`: pure Dart models (generated from `data/schema/v1`) and loader for the published JSON; consumed by lessons2 as a git dependency | [packages/dart/CLAUDE.md](packages/dart/CLAUDE.md) |
| [`site/`](site/CLAUDE.md) | Hugo static site rendering the chapters and the audio classes, and publishing `data/` as versioned JSON | [site/CLAUDE.md](site/CLAUDE.md) |

## How the pieces relate

- `section-tool` edits chapter files (`TextNode[]` arrays). Its Cloudflare Pages Function saves them to `data/chapters/` through the GitHub API.
- `data/tools` validates `data/` (catalog grammar, stable IDs, JSON Schemas) and writes `data/dist/v1/`. This directory is generated and git-ignored.
- `site`'s `yarn build` runs the data build, then Hugo. Hugo renders pages from `data/chapters/` and the generated catalog, and publishes `data/dist/v1/` at `/data/v1/`. Other clients, such as the lessons2 Flutter app, read that published JSON, using the Dart models in `packages/dart/`.
- `data/tools` `yarn transcribe` stores Sofer.ai word-timestamped transcripts of classes in `data/transcripts/` (needs `SOFER_API_KEY`; never commit the key), and `yarn align` maps them to chapter line IDs in `data/alignments/`. `yarn outline` stores Sofer topic outlines in `data/outlines/`. `data/retime` (Python, uv; never needed by the build or deploy) re-times Sofer's often-broken word times against the audio into `data/retimed/`, which `yarn align` and the published transcripts prefer; a stale retimed file fails the build. All are keyed by catalog lecture ID and validated by the data build, which publishes the lectures allowlisted in `data/audio-publish.json` under `/data/v1/{alignments,transcripts,outlines}/`. See [data/README.md](data/README.md#transcripts-and-alignments).
- Catalog IDs are persisted by apps (favorites, downloads). Never change an existing ID. `data/README.md` explains how.
- Chapter text is made of lines with stable, corpus-unique random IDs, so alignments and transcripts can point at a line. Anything that rewrites chapter text (the editor, scripts) must carry existing line IDs over and mint new ones only for new lines. Sections have no persisted ID. The site renders each line as an element whose HTML `id` is the line ID.

Each sub-project, `data/tools` and `packages/dart` have their own dependency trees. There is no build step at the repo root.

In Claude Code cloud sessions, `.claude/hooks/session-start.sh` installs Hugo (pinned to Cloudflare Pages' default, 0.147.7 extended) and the Dart SDK into `~/.local`, then each project's dependencies. It does nothing in local sessions. Change the pinned versions there.

## Repo-level Commands

```bash
# Data (validate + generate dist/v1)
cd data/tools
yarn install
yarn build-data
yarn test

# Dart package (needs data/dist/v1 built first)
cd packages/dart
dart pub get
dart run tool/generate_models.dart   # after changing data/schema/v1
dart analyze
dart test

# Section tool (Angular)
cd section-tool
yarn install
yarn start       # dev server at http://localhost:4200
yarn test        # Vitest unit tests

# Site (Hugo; needs hugo on PATH)
cd site
yarn build       # data build + Hugo build → hugo/public/
yarn serve       # data build + Hugo dev server with live reload
yarn test        # unit tests for lib/json-renderer.js
```
