#!/usr/bin/env node
'use strict';

/**
 * Converts the custom markup in data.txt to a concise hierarchical JSON.
 *
 * Markup syntax:
 *   #         Top-level section
 *   ##        Second-level section
 *   >         Base URL path for the current ## section
 *   ###       Third-level (media) section
 *   ###       Alone: closes current media section
 *   ##        Alone: closes current section
 *   - Title   Title for the next media item
 *   filename  Media file (ID + filename, e.g. "001 Intro.mp3")
 *   //        Comment (ignored)
 *
 * Output shape:
 * [
 *   {
 *     "title": "...",
 *     "children": [
 *       {
 *         "title": "...",
 *         "base": "...",          // URL path segment, present on ## sections
 *         "children": [
 *           { "title": "...", "file": "001 Intro.mp3" },  // titled media
 *           { "file": "002 Tape.mp3" },                   // untitled media
 *           { "title": "...", "children": [...] }          // ### subsection
 *         ]
 *       }
 *     ]
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');

function extractTitle(line) {
  const spaceIdx = line.indexOf(' ');
  return spaceIdx >= 0 ? line.slice(spaceIdx + 1).trim() : '';
}

function parse(text) {
  const lines = text.split('\n');
  const topSections = [];

  let currentTop = null;
  let currentSection = null;
  let currentMediaSection = null;
  let pendingTitle = null;
  let currentBase = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const firstToken = line.split(' ')[0];

    if (firstToken === '#') {
      currentTop = { title: extractTitle(line), children: [] };
      currentSection = null;
      currentMediaSection = null;
      pendingTitle = null;
      topSections.push(currentTop);

    } else if (firstToken === '##') {
      currentMediaSection = null;
      pendingTitle = null;

      if (line === '##') {
        currentSection = null;
        continue;
      }

      currentSection = { title: extractTitle(line), children: [] };
      if (currentBase) currentSection.base = currentBase;
      if (currentTop) currentTop.children.push(currentSection);

    } else if (firstToken === '###') {
      pendingTitle = null;

      if (line === '###') {
        currentMediaSection = null;
        continue;
      }

      currentMediaSection = { title: extractTitle(line), children: [] };
      if (currentBase) currentMediaSection.base = currentBase;
      const parent = currentSection || currentTop;
      if (parent) parent.children.push(currentMediaSection);

    } else if (firstToken === '>') {
      currentBase = extractTitle(line);
      const target = currentMediaSection || currentSection || currentTop;
      if (target) target.base = currentBase;

    } else if (firstToken === '-') {
      pendingTitle = extractTitle(line);

    } else {
      // File line (e.g. "001 Intro.mp3")
      const media = {};
      if (pendingTitle) {
        media.title = pendingTitle;
        pendingTitle = null;
      }
      media.file = line;

      const parent = currentMediaSection || currentSection || currentTop;
      if (parent) parent.children.push(media);
    }
  }

  return topSections;
}

const inputFile = process.argv[2] || path.join(__dirname, 'data.txt');
const outputFile = process.argv[3];

const text = fs.readFileSync(inputFile, 'utf8');
const result = parse(text);
const json = JSON.stringify(result, null, 2);

if (outputFile) {
  fs.writeFileSync(outputFile, json);
  console.error(`Written to ${outputFile}`);
} else {
  process.stdout.write(json + '\n');
}
