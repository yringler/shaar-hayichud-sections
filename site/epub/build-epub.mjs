// build-epub.mjs
// Generates dist/shaar-hayichud.epub directly from src/texts/chapter_NN.json.
//
// No pre-build step needed — reads JSON chapter files and renders HTML on the fly.
//
// Usage:
//   yarn epub

import { readFileSync, readdirSync, mkdirSync } from 'fs';
import path from 'path';
import Epub from 'epub-gen';
import { renderJsonToHtml } from '../lib/json-renderer.js';

const root = path.resolve(import.meta.dirname, '..');
const textsDir = path.join(root, 'hugo', 'chapters');
const distDir = path.join(root, 'dist');
const outputPath = path.join(distDir, 'shaar-hayichud.epub');

mkdirSync(distDir, { recursive: true });

const hebrewNumerals = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י'];

const chapterFiles = readdirSync(textsDir)
  .filter(f => /^chapter_\d+\.json$/.test(f))
  .sort();

if (chapterFiles.length === 0) {
  console.error('No chapter_NN.json files found in src/texts/.');
  process.exit(1);
}

const chapters = await Promise.all(
  chapterFiles.map(async filename => {
    const n = parseInt(filename.match(/^chapter_(\d+)\.json$/)[1], 10);
    const heb = hebrewNumerals[n - 1] ?? String(n);
    const jsonContent = readFileSync(path.join(textsDir, filename), 'utf8');
    const html = await renderJsonToHtml(jsonContent, {});
    return {
      title: `פרק ${heb} — Chapter ${n}`,
      data: html,
    };
  })
);

const titlePage = {
  title: 'Title Page',
  data: `<div style="text-align:center; direction:rtl; margin-top:4em;">
  <h1>שער היחוד</h1>
  <h2 style="direction:ltr;">Shaar Hayichud</h2>
  <p style="direction:ltr; margin-top:2em;">Rabbi DovBer Schneuri (Mitteler Rebbe)</p>
</div>`,
};

const css = `
  body { direction: rtl; text-align: right; font-family: "Times New Roman", serif; }
  .depth-1 { margin-top: 1.5em; }
  .depth-2 { margin-top: 1em; padding-right: 1.5em; }
  .depth-3 { margin-top: 0.8em; padding-right: 3em; }
  .depth-4 { margin-top: 0.6em; padding-right: 4.5em; }
  .label { font-weight: bold; margin-bottom: 0.3em; }
  .number { margin-left: 0.5em; color: #555; }
  .content { margin-top: 0.2em; line-height: 1.7; }
`;

console.log(`Building EPUB from ${chapters.length} chapters...`);
console.log(`Output: ${outputPath}`);

await new Epub({
  title: 'שער היחוד — Shaar Hayichud',
  author: 'Rabbi DovBer Schneuri (Mitteler Rebbe)',
  language: 'he',
  output: outputPath,
  content: [titlePage, ...chapters],
  css,
}).promise;

console.log('EPUB build complete.');
