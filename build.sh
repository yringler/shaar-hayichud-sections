#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist

transform() {
  input="$1"
  output="dist/${input%.xml}.html"
  echo "$input -> $output"
  npx xslt3 -xsl:transform.xsl -s:"$input" -o:"$output"
}
export -f transform

printf '%s\n' chapter_*.xml | xargs -P 20 -I {} bash -c 'transform "$@"' _ {}
