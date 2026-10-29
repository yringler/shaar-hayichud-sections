#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs the tools the
# repo's builds and tests need (see CLAUDE.md "Repo-level Commands").
# Local sessions are left alone; use your own installs there.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Hugo: pinned to Cloudflare Pages' default (v3 build image), so local builds
# match production. See site/CLAUDE.md before changing it.
HUGO_VERSION=0.147.7
# Dart SDK for packages/dart (pubspec: sdk ^3.8.0).
DART_VERSION=3.13.7

OPT="$HOME/.local/opt"
BIN="$HOME/.local/bin"
mkdir -p "$OPT" "$BIN"

hugo_dir="$OPT/hugo-$HUGO_VERSION"
if [ ! -x "$hugo_dir/hugo" ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/hugo.tgz" \
    "https://github.com/gohugoio/hugo/releases/download/v$HUGO_VERSION/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
  mkdir -p "$hugo_dir"
  tar -xzf "$tmp/hugo.tgz" -C "$hugo_dir" hugo
  rm -rf "$tmp"
fi
ln -sfn "$hugo_dir/hugo" "$BIN/hugo"

dart_dir="$OPT/dart-sdk-$DART_VERSION"
if [ ! -x "$dart_dir/bin/dart" ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/dart.zip" \
    "https://storage.googleapis.com/dart-archive/channels/stable/release/$DART_VERSION/sdk/dartsdk-linux-x64-release.zip"
  unzip -q "$tmp/dart.zip" -d "$tmp"
  rm -rf "$dart_dir"
  mv "$tmp/dart-sdk" "$dart_dir"
  rm -rf "$tmp"
fi
ln -sfn "$dart_dir/bin/dart" "$BIN/dart"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# Project dependencies (each has its own tree; no root build step).
cd "$CLAUDE_PROJECT_DIR"
(cd data/tools && yarn install)
(cd site && yarn install)
# section-tool pins Yarn 4.13 through packageManager with no yarnPath, so run it through Corepack.
(cd section-tool && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack yarn install)
(cd packages/dart && "$BIN/dart" pub get)
