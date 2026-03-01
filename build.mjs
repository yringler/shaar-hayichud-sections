import { execFile } from 'child_process';
import { mkdirSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);
const xslt3Bin = require.resolve('xslt3/xslt3');

// Output fragments to both locale text dirs so each locale gets its own data cascade
const outputDirs = ['src/he/texts', 'src/en/texts'];
outputDirs.forEach(dir => mkdirSync(dir, { recursive: true }));

const xmlFiles = readdirSync('.').filter(f => /^chapter_.*\.xml$/.test(f)).sort();

// Transform all chapters in parallel, writing to each locale directory
await Promise.all(xmlFiles.flatMap(input =>
  outputDirs.map(dir => {
    const output = `${dir}/${input.replace(/\.xml$/, '.html')}`;
    console.log(`${input} -> ${output}`);
    return execFileAsync(process.execPath, [xslt3Bin, `-xsl:transform.xsl`, `-s:${input}`, `-o:${output}`]);
  })
));

console.log('XSL transform complete');
