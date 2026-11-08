// Open a chapter in the offline section-tool (http://localhost:4300) and screenshot it.
// Usage: node screenshot.cjs [chapter_NN.json] [out.png] [width] [height]
// Never presses Save / Ctrl+S: saving in offline mode creates a real git commit.
const { chromium } = require('playwright');

(async () => {
  const file = process.argv[2] || 'chapter_14.json';
  const out = process.argv[3] || 'section-tool.png';
  const width = Number(process.argv[4] || 1600);
  const height = Number(process.argv[5] || 850);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });

  await page.goto('http://localhost:4300/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Library' }).click();
  await page.locator('li.file-item', { hasText: file }).click();
  await page.locator('wa-textarea.text-area').first().waitFor();
  await page.waitForTimeout(1000);

  await page.screenshot({ path: out });
  await page.screenshot({ path: out.replace(/\.png$/, '-full.png'), fullPage: true });

  // Sizes of each wa-textarea host vs. the real <textarea> in its shadow DOM.
  const sizes = await page.locator('wa-textarea.text-area').evaluateAll((els) =>
    els.map((el) => {
      const ta = el.shadowRoot && el.shadowRoot.querySelector('textarea');
      const r = el.getBoundingClientRect();
      return {
        hostTop: Math.round(r.top), hostH: Math.round(r.height),
        textareaTop: ta ? Math.round(ta.getBoundingClientRect().top) : null,
        textareaH: ta ? ta.clientHeight : null, textareaScrollH: ta ? ta.scrollHeight : null,
      };
    }),
  );
  console.log(JSON.stringify(sizes, null, 1));
  await browser.close();
})();
