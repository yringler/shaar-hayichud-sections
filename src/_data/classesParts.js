'use strict';

const classes = require('./classes.json');

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function countTracks(children) {
  return (children || []).reduce(
    (sum, node) => sum + (node.file ? 1 : countTracks(node.children)),
    0
  );
}

module.exports = classes.flatMap((series) =>
  (series.children || []).map((part) => ({
    seriesTitle: series.title,
    seriesSlug: slugify(series.title),
    partTitle: part.title,
    partSlug: slugify(part.title),
    base: part.base || null,
    children: part.children || [],
    trackCount: countTracks(part.children),
  }))
);
