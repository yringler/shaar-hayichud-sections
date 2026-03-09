import { execFile } from 'child_process';
import { mkdirSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const xslt3Bin = fileURLToPath(import.meta.resolve('xslt3/xslt3.js'));

const root = path.resolve(import.meta.dirname, '..');
const xsltDir = import.meta.dirname;

const outputDir = path.join(root, 'dist');
mkdirSync(outputDir, { recursive: true });

const srcDir = path.join(root, 'src/texts');
const xmlFiles = readdirSync(srcDir).filter(f => /^chapter_.*\.xml$/.test(f)).sort();

await Promise.all(xmlFiles.map(input => {
  const output = path.join(outputDir, input.replace(/\.xml$/, '.html'));
  console.log(`${input} -> ${output}`);
  const pnpHook = path.join(root, '.pnp.cjs');
  return execFileAsync(process.execPath, [`--require`, pnpHook, xslt3Bin, `-xsl:${path.join(xsltDir, 'transform.xsl')}`, `-s:${path.join(srcDir, input)}`, `-o:${output}`]);
}));

console.log('XSL transform complete');
