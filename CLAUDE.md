# Shaar Hayichud Sections — Monorepo

This repo has one shared data directory, two sub-projects and two Dart packages. Read each one's own docs for details

## Layout

| Directory | Description | Docs |
|-----------|-------------|------|
| [`data/`](data/README.md) | **Single source of truth**: the class catalog (`classes.txt`), chapter JSON (`chapters/`), class transcripts (`transcripts/`), line alignments (`alignments/`) and topic outlines (`outlines/`), JSON Schemas (`schema/v1/`, `schema/sources/`), the TypeScript build/validation/transcription tools (`tools/`), the Python forced-alignment re-timing tool (`retime/`, output in `retimed/`) and its back-channel remover (`backchannel`, edit lists in `edits/`) | [data/README.md](data/README.md) |
| [`section-tool/`](section-tool/CLAUDE.md) | Angular 21 keyboard-driven tool for dividing Hebrew text into nested JSON sections | [section-tool/CLAUDE.md](section-tool/CLAUDE.md) |
| [`packages/dart/`](packages/dart/CLAUDE.md) | `shaar_hayichud_data` (pub.dev): pure Dart models (generated from `data/schema/v1`, not committed) and loader for the published JSON; used by lessons2 | [packages/dart/CLAUDE.md](packages/dart/CLAUDE.md) |
| [`packages/snapshot/`](packages/snapshot/CLAUDE.md) | `shaar_hayichud_snapshot` (pub.dev): a copy of `data/dist/v1` (catalog, chapters, chapter alignments) as Flutter assets, so lessons2 works offline on first launch; built at publish time, not committed | [packages/snapshot/CLAUDE.md](packages/snapshot/CLAUDE.md) |
| [`site/`](site/CLAUDE.md) | Hugo static site rendering the chapters and the audio classes, with a static (Pagefind) search, and publishing `data/` as versioned JSON | [site/CLAUDE.md](site/CLAUDE.md) |

## How the pieces relate

- `section-tool` edits chapter files (`TextNode[]` arrays). Its Cloudflare Pages Function saves them to `data/chapters/` through the GitHub API. Offline, `yarn offline` serves the same editor from a local Node server that writes `data/chapters/` in the local checkout and commits each save locally (pushing stays manual); both share one save implementation. The offline save also re-aligns the saved chapter's classes (`yarn align --chapter`) into the same commit; for cloud saves, the `realign` GitHub workflow (`.github/workflows/realign.yml`) re-aligns after each push to `master` and commits the changed `data/alignments/`.
- `data/tools` validates `data/` (catalog grammar, stable IDs, JSON Schemas) and writes `data/dist/v1/`. This directory is generated and git-ignored.
- `site`'s `yarn build` runs the data build, then Hugo, then the Pagefind search index over what the site published (`/search/`). Hugo renders pages from `data/chapters/` and the generated catalog, and publishes `data/dist/v1/` at `/data/v1/`. Other clients, such as the lessons2 Flutter app, read that published JSON, using the Dart models in `packages/dart/`.
- Both Dart packages are published to pub.dev from GitHub Actions when a tag is pushed (`shaar_hayichud_data-v<version>`, `shaar_hayichud_snapshot-v1.<YYYYMMDD>.<n>`; `.github/workflows/publish-*.yml`); `dart.yml` checks them on PRs. lessons2 depends on the published versions, so nothing from this repo is copied or committed there: a data change reaches the app's bundled copy only when a snapshot is tagged and lessons2 upgrades to it (between snapshots the app fetches `/data/v1/`). Generated files (`packages/dart/lib/src/generated/`, `packages/snapshot/data/`) are git-ignored and shipped through each package's `.pubignore`.
- `data/tools` `yarn transcribe` stores Sofer.ai word-timestamped transcripts of classes in `data/transcripts/` (needs `SOFER_API_KEY`; never commit the key), and `yarn align` maps them to chapter line IDs in `data/alignments/`. `yarn outline` stores Sofer topic outlines in `data/outlines/`. `data/retime` (Python, uv; never needed by the build or deploy) re-times Sofer's often-broken word times against the audio into `data/retimed/`, which `yarn align` and the published transcripts prefer; a stale retimed file fails the build. All are keyed by catalog lecture ID and validated by the data build, which publishes the lectures allowlisted in `data/audio-publish.json` under `/data/v1/{alignments,transcripts,outlines}/`. See [data/README.md](data/README.md#transcripts-and-alignments).
- `data/retime`'s `backchannel` (extra `edit`; never needed by the build or deploy) finds the Markel listener's standalone "Right."s and writes `data/edits/` edit lists (keyed by lecture ID, validated by the data build, not published) plus room-tone-filled `<stem> (edited).mp3` files of the same duration, uploaded next to the originals; `classes.txt` then points at them with `@ old-id` lines, so IDs and all timestamps stay valid.
- Catalog IDs are persisted by apps (favorites, downloads). Never change an existing ID. `data/README.md` explains how.
- Chapter text is made of lines with stable, corpus-unique random IDs, so alignments and transcripts can point at a line. Anything that rewrites chapter text (the editor, scripts) must carry existing line IDs over and mint new ones only for new lines. Sections have no persisted ID. The site renders each line as an element whose HTML `id` is the line ID.

Each sub-project, `data/tools` and the Dart packages have their own dependency trees. There is no build step at the repo root.

In Claude Code cloud sessions, `.claude/hooks/session-start.sh` installs Hugo (pinned to Cloudflare Pages' default, 0.147.7 extended) and the Dart SDK into `~/.local`, then each project's dependencies. It does nothing in local sessions. Change the pinned versions there.

## Repo-level Commands

```bash
# Data (validate + generate dist/v1)
cd data/tools
yarn install
yarn build-data
yarn test

# Dart models package (needs data/dist/v1 built first)
cd packages/dart
dart pub get
dart run tool/generate_models.dart   # required: models are not committed
dart analyze
dart test

# Data snapshot package (needs data/dist/v1 built first)
cd packages/snapshot
dart pub get
dart run tool/build_snapshot.dart    # writes data/v1/ (git-ignored)
dart test

# Section tool (Angular)
cd section-tool
yarn install
yarn start       # dev server at http://localhost:4200
yarn offline     # offline editor at http://localhost:4300; saves commit locally
yarn test        # Vitest unit tests

# Site (Hugo; needs hugo on PATH)
cd site
yarn build       # data build + Hugo build + search index → hugo/public/
yarn serve       # data build + Hugo dev server with live reload
yarn test        # unit tests for lib/json-renderer.js
```
