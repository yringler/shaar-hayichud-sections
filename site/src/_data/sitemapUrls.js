'use strict';

const { readdirSync, readFileSync } = require("fs");
const { resolve } = require("path");
const classes = require("./classes.json");

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = function () {
  const textsDir = resolve(__dirname, "../texts");
  const chapterFiles = readdirSync(textsDir)
    .filter((f) => /^chapter_\d+\.json$/.test(f))
    .sort();

  const urls = [
    "/en/",
    "/he/",
    "/en/texts/",
    "/he/texts/",
    "/en/classes/",
    "/en/translation/",
    "/en/about/",
    "/en/translation/translation-philosophy/",
  ];

  for (const file of chapterFiles) {
    const n = parseInt(file.match(/^chapter_(\d+)\.json$/)[1], 10);
    urls.push(`/en/texts/chapter-${n}/`);
    urls.push(`/he/texts/chapter-${n}/`);
    const content = readFileSync(resolve(textsDir, file), "utf8");
    if (content.includes('"translation"')) {
      urls.push(`/en/translation/chapter-${n}/`);
    }
  }

  for (const series of classes) {
    const seriesSlug = slugify(series.title);
    urls.push(`/en/classes/${seriesSlug}/`);
    for (const part of series.children || []) {
      urls.push(`/en/classes/${seriesSlug}/${slugify(part.title)}/`);
    }
  }

  return urls;
};
