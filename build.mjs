import { execFile } from 'child_process';
import { mkdirSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);
const xslt3Bin = require.resolve('xslt3/xslt3');

// Output fragments to src/texts/ so Eleventy can wrap them in the base layout
mkdirSync('src/texts', { recursive: true });

const xmlFiles = readdirSync('.').filter(f => /^chapter_.*\.xml$/.test(f)).sort();

// Transform all chapters in parallel
await Promise.all(xmlFiles.map(async input => {
  const output = `src/texts/${input.replace(/\.xml$/, '.html')}`;
  console.log(`${input} -> ${output}`);
  return execFileAsync(process.execPath, [xslt3Bin, `-xsl:transform.xsl`, `-s:${input}`, `-o:${output}`]);
}));

console.log('XSL transform complete');
