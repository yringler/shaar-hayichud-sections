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

# Generate index.html
{
  echo '<!DOCTYPE html>'
  echo '<html>'
  echo '<head>'
  echo '  <meta charset="UTF-8">'
  echo '  <style>'
  echo '    body { max-width: 70ch; margin: 2em auto; font-family: serif; line-height: 1.7; direction: ltr; }'
  echo '    a { color: inherit; }'
  echo '    li { margin-block: 0.5em; }'
  echo '  </style>'
  echo '</head>'
  echo '<body>'
  echo '  <ul>'
  for xml in chapter_*.xml; do
    html="${xml%.xml}.html"
    num="${xml#chapter_}"
    num="${num%.xml}"
    echo "    <li><a href=\"${html}\">Chapter ${num}</a></li>"
  done
  echo '  </ul>'
  echo '</body>'
  echo '</html>'
} > dist/index.html
echo "index.html generated"
