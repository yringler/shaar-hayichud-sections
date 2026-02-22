import { execFile } from 'child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);
const xslt3Bin = require.resolve('xslt3/xslt3');

mkdirSync('dist', { recursive: true });

const xmlFiles = readdirSync('.').filter(f => /^chapter_.*\.xml$/.test(f)).sort();

// Transform all chapters in parallel
await Promise.all(xmlFiles.map(async input => {
  const output = `dist/${input.replace(/\.xml$/, '.html')}`;
  console.log(`${input} -> ${output}`);
  return execFileAsync(process.execPath, [xslt3Bin, `-xsl:transform.xsl`, `-s:${input}`, `-o:${output}`]);
}));

// Generate index.html
const items = xmlFiles.map(xml => {
  const html = xml.replace(/\.xml$/, '.html');
  const num = xml.replace(/^chapter_/, '').replace(/\.xml$/, '');
  return `    <li><a href="${html}">Chapter ${num}</a></li>`;
}).join('\n');

const index = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { max-width: 70ch; margin: 2em auto; font-family: serif; line-height: 1.7; direction: ltr; }
    a { color: inherit; }
    li { margin-block: 0.5em; }
  </style>
</head>
<body>
  <ul>
${items}
  </ul>
</body>
</html>`;

writeFileSync('dist/index.html', index);
console.log('index.html generated');
