#!/usr/bin/env node
/**
 * Browser test of the audio features on the built site (hugo/public/):
 * chapter 10 play-from-here, the teacher/class selectors and their saved
 * choice, Listen along (the is-discussing border), a transcript page, phone
 * width, and pages without audio staying untouched.
 *
 *   yarn build && yarn test:e2e [screenshot dir]
 *
 * Opt-in: needs Playwright with Chromium (`require('playwright')`) and ffmpeg.
 * Audio requests to the CDN are answered with a local silent mp3 (with range
 * support), so the test is offline and deterministic; times and alignments
 * come from the published data.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { renderJsonToHtml } = require('../lib/json-renderer.js');

const SITE = path.resolve(__dirname, '..');
const PUBLIC = path.join(SITE, 'hugo', 'public');
const DIST = path.join(SITE, '..', 'data', 'dist', 'v1');
const shots = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-audio-')));
fs.mkdirSync(shots, { recursive: true });

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const chapter10 = readJson(path.join(DIST, 'alignments', 'chapters', 'chapter_10.json'));

// ---- a 40-minute silent mp3 stands in for every class recording ----
const media = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-media-')), 'silence.mp3');
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '2400', '-b:a', '8k', media]);
const mediaSize = fs.statSync(media).size;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__media.mp3') {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : mediaSize - 1;
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${mediaSize}` } : {}),
    });
    fs.createReadStream(media, { start, end }).pipe(res);
    return;
  }
  let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const lectureOf = (id) => chapter10.lectures.findIndex((l) => l.id === id);
const refOf = (lineId, lecture) => chapter10.lines.find((l) => l.lineId === lineId)?.refs.find((r) => r.lecture === lecture);
const WALTERS_1 = lectureOf('07 - Chap- 10-1 Atmus Ohr Ein Sof (M).mp3');
const MARKEL_10 = lectureOf('002 Tape016-Side1-Ch10.mp3');

async function newPage(browser, base, opts = {}) {
  const context = await browser.newContext(opts.context ?? { viewport: { width: 1280, height: 900 } });
  if (opts.blockStorage) {
    await context.addInitScript(() => {
      for (const k of ['getItem', 'setItem']) {
        Storage.prototype[k] = () => {
          throw new DOMException('blocked', 'SecurityError');
        };
      }
    });
  }
  await context.route('https://media.shaarhayichudresources.com/**', async (route) => {
    const headers = {};
    const range = route.request().headers()['range'];
    if (range) headers.range = range;
    const response = await route.fetch({ url: `${base}/__media.mp3`, headers });
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { context, page, errors };
}

const audioState = (page) =>
  page.evaluate(() => {
    const a = document.querySelector('[data-listen-audio]');
    return { src: a.currentSrc || a.src, t: a.currentTime, paused: a.paused };
  });

async function waitTime(page, t, tol = 1.5) {
  await page.waitForFunction(
    ([t, tol]) => {
      const a = document.querySelector('[data-listen-audio]');
      return a.readyState >= 1 && Math.abs(a.currentTime - t) < tol;
    },
    [t, tol],
    { timeout: 15000 },
  );
}

/** Seek the player to t and let follow.js react. */
async function seek(page, t) {
  await page.evaluate((t) => {
    document.querySelector('[data-listen-audio]').currentTime = t;
  }, t);
  await waitTime(page, t);
  await page.waitForTimeout(400);
}

const discussing = (page) => page.$$eval('.is-discussing', (els) => els.map((e) => e.id));

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`);
  }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  await check('json-renderer parity: data-t on the same lines as Hugo', async () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'texts', 'chapter-10', 'index.html'), 'utf8');
    const hugo = [...html.matchAll(/<span class="?line"? id="?(\w+)"?(?: data-t="?([\d.]+)"?)?>/g)].map((m) => [m[1], m[2] ?? null]);
    const lineTimes = Object.fromEntries(chapter10.lines.map((l) => [l.lineId, l.refs[0].startSeconds]));
    const src = fs.readFileSync(path.join(SITE, '..', 'data', 'chapters', 'chapter_10.json'), 'utf8');
    const js = await renderJsonToHtml(src, {}, { lineTimes });
    const ours = [...js.matchAll(/<span class="line" id="(\w+)"(?: data-t="([\d.]+)")?>/g)].map((m) => [m[1], m[2] ?? null]);
    assert.deepEqual(hugo, ours);
    assert.ok(hugo.filter(([, t]) => t).length === chapter10.lines.length);
  });

  // ---------------- chapter 10, desktop ----------------
  {
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(`${base}/texts/chapter-10/`);
    await page.waitForSelector('.line-play');

    await check('chapter 10: a play button on every aligned line, none elsewhere', async () => {
      assert.equal(await page.locator('.line-play').count(), chapter10.lines.length);
      assert.equal(await page.locator('.line:not([data-t]) ~ .line-play, .line-play + .line:not([data-t])').count(), 0);
      assert.equal(await page.locator('[data-listen-series] option').count(), 2);
      assert.deepEqual(await page.locator('[data-listen-series] option').allTextContents(), [
        'Rabbi Benyamin Walters Original Class',
        'Rabbi Markel Series (Advanced)',
      ]);
      // Class selector shows only the chosen teacher's classes.
      assert.deepEqual(await page.locator('[data-listen-select] option').allTextContents(), ['Part 1', 'Part 2', 'Part 3']);
    });

    await check('copying chapter text is unchanged by the play buttons', async () => {
      // Select a whole section, with and without the injected buttons.
      const text = await page.evaluate(() => {
        const c = document.getElementById('5i72jwox').closest('.content');
        const copy = () => {
          const r = document.createRange();
          r.selectNodeContents(c);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          const out = s.toString();
          s.removeAllRanges();
          return out;
        };
        const withButtons = copy();
        const buttons = [...c.querySelectorAll('.line-play')];
        const marks = buttons.map((b) => [b, b.nextSibling]);
        buttons.forEach((b) => b.remove());
        const without = copy();
        marks.forEach(([b, next]) => next.before(b));
        return [withButtons, without, buttons.length];
      });
      assert.ok(text[2] > 1);
      assert.equal(text[0], text[1]);
    });

    await check('play button on a line two teachers discuss opens a chooser; picking plays from that time', async () => {
      const r = refOf('njpqigb7', WALTERS_1);
      await page.click('.line-play[data-line="njpqigb7"]');
      const items = page.locator('.line-chooser [role=menuitem]');
      assert.equal(await items.count(), 2);
      assert.match(await items.first().textContent(), /^Rabbi Benyamin Walters Original Class: Part 1/);
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'menuitem');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.line-chooser').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.line), 'njpqigb7');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await waitTime(page, r.startSeconds);
      const s = await audioState(page);
      assert.equal(s.src, chapter10.lectures[WALTERS_1].url);
      assert.equal(s.paused, false);
    });

    await check('a line only Markel covers plays Markel and says so', async () => {
      const r = refOf('gbyeqivs', MARKEL_10);
      await page.click('.line-play[data-line="gbyeqivs"]');
      await waitTime(page, r.startSeconds);
      assert.equal((await audioState(page)).src, chapter10.lectures[MARKEL_10].url);
      assert.match(await page.locator('[data-listen-note]').textContent(), /not in Rabbi Benyamin Walters Original Class's classes yet; playing Rabbi Markel/);
      assert.equal(await page.locator('[data-listen-series]').inputValue(), chapter10.lectures[MARKEL_10].seriesId);
    });

    await check('Listen along: the border follows playback (until-next-line model)', async () => {
      await page.click('[data-listen-along]');
      await page.waitForFunction(() => document.documentElement.classList.contains('is-following'));
      const r = refOf('gbyeqivs', MARKEL_10);
      await seek(page, r.startSeconds + 2);
      assert.deepEqual(await discussing(page), ['gbyeqivs']);
      const border = await page.evaluate(() => getComputedStyle(document.getElementById('gbyeqivs').closest('p, .content')).borderRightWidth);
      assert.equal(border, '3px'); // RTL: inline-start is the right side
      // Zero-length lines at the same instant (collapsed Sofer timestamps) are current together.
      const z = refOf('sykhwqgy', MARKEL_10);
      await seek(page, z.startSeconds + 1);
      assert.deepEqual((await discussing(page)).sort(), ['bgpd7w43', 'sykhwqgy']);
      await page.screenshot({ path: path.join(shots, 'chapter10-desktop-listen-along.png') });
      // Far past the last line: nothing.
      await seek(page, 2300);
      assert.deepEqual(await discussing(page), []);
    });

    await check('Listen along: clicking line text seeks in the current class, or switches class', async () => {
      // Back to the saved teacher's class for a Walters line.
      const w = refOf('wmljth42', WALTERS_1);
      await page.click('[id="wmljth42"]');
      await waitTime(page, w.startSeconds);
      assert.equal((await audioState(page)).src, chapter10.lectures[WALTERS_1].url);
      await page.waitForTimeout(500);
      assert.deepEqual(await discussing(page), ['wmljth42']);
      // Same class: just seeks.
      const n = refOf('7qhwsnef', WALTERS_1);
      await page.click('[id="7qhwsnef"]');
      await waitTime(page, n.startSeconds);
      assert.equal((await audioState(page)).src, chapter10.lectures[WALTERS_1].url);
    });

    await check('selecting text in a line does not seek', async () => {
      const before = (await audioState(page)).src;
      await page.evaluate(() => document.querySelector('[data-listen-audio]').pause());
      const t0 = (await audioState(page)).t;
      // Away from the sticky player.
      await page.evaluate(() => document.getElementById('5i72jwox').scrollIntoView({ block: 'center' }));
      const box = await page.locator('[id="5i72jwox"]').boundingBox();
      // Start inside the first visual line, clear of its play button.
      const [sx, sy] = [box.x + box.width - 60, box.y + 12];
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [sx, sy]), '5i72jwox');
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(box.x + 20, sy, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      const s = await audioState(page);
      assert.ok((await page.evaluate(() => getSelection().toString())).length > 0, 'text was selected');
      assert.equal(s.src, before);
      assert.ok(Math.abs(s.t - t0) < 0.5, `time moved from ${t0} to ${s.t}`);
    });

    await check('the teacher choice is saved and applies on reload', async () => {
      await page.selectOption('[data-listen-series]', chapter10.lectures[MARKEL_10].seriesId);
      assert.match(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.series')), /"id":"37"/);
      await page.reload();
      await page.waitForSelector('.line-play');
      assert.equal(await page.locator('[data-listen-series]').inputValue(), '37');
      assert.equal((await audioState(page)).src, chapter10.lectures[MARKEL_10].url);
      await page.click('.line-play[data-line="njpqigb7"]');
      assert.match(await page.locator('.line-chooser [role=menuitem]').first().textContent(), /^Rabbi Markel/);
      await page.keyboard.press('Escape');
    });

    const withOutline = chapter10.lectures.findIndex((l) => l.outline);
    if (withOutline >= 0) {
      await check('Listen along shows the class outline (auto-generated topics); clicking a topic seeks', async () => {
        const lecture = chapter10.lectures[withOutline];
        const outline = readJson(path.join(DIST, decodeURI(lecture.outline)));
        await page.selectOption('[data-listen-series]', lecture.seriesId);
        await page.selectOption('[data-listen-select]', String(withOutline));
        if ((await page.getAttribute('[data-listen-along]', 'aria-pressed')) !== 'true') await page.click('[data-listen-along]');
        await page.waitForSelector('[data-listen-topics]:not([hidden])');
        assert.match(await page.locator('[data-listen-topics] summary').textContent(), /auto-generated/);
        await page.click('[data-listen-topics] summary');
        assert.equal(await page.locator('[data-listen-topics] li').count(), outline.topics.length);
        const topic = outline.topics[1];
        await page.locator('[data-listen-topics] li button').nth(1).click();
        await waitTime(page, topic.startSeconds);
        await page.waitForTimeout(400);
        assert.equal(await page.locator('[data-listen-now]').textContent(), `Now: ${topic.title}`);
        assert.equal(await page.locator('[data-listen-topics] li[aria-current]').count(), 1);
        await page.screenshot({ path: path.join(shots, 'chapter10-desktop-topics.png') });
      });
    }

    await check('no script errors', async () => assert.deepEqual(errors, []));
    await context.close();
  }

  await check('chapter 10 works with storage blocked', async () => {
    const { context, page, errors } = await newPage(browser, base, { blockStorage: true });
    await page.goto(`${base}/texts/chapter-10/`);
    await page.waitForSelector('.line-play');
    await page.selectOption('[data-listen-series]', '37');
    await page.click('.line-play[data-line="gbyeqivs"]');
    await waitTime(page, refOf('gbyeqivs', MARKEL_10).startSeconds);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ---------------- chapter 10, phone ----------------
  await check('chapter 10 at phone width: no horizontal scroll, tap plays, border shows', async () => {
    const { context, page, errors } = await newPage(browser, base, {
      context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    });
    await page.goto(`${base}/he/texts/chapter-10/`);
    await page.waitForSelector('.line-play');
    await page.screenshot({ path: path.join(shots, 'chapter10-phone-initial.png') });
    await page.tap('[data-listen-along]');
    const r = refOf('4oeagnb6', lectureOf('08 - Chap- 10-2 Atzmus Ohr Ein Sof (M).mp3'));
    await page.locator('.line-play[data-line="4oeagnb6"]').scrollIntoViewIfNeeded();
    await page.tap('.line-play[data-line="4oeagnb6"]');
    const items = page.locator('.line-chooser [role=menuitem]');
    if (await items.count()) await items.first().tap();
    await waitTime(page, r.startSeconds);
    await page.waitForTimeout(800);
    assert.deepEqual(await discussing(page), ['4oeagnb6']);
    // This class has no outline: no topic list, no stale "Now:" from another class.
    if (!chapter10.lectures[r.lecture].outline) {
      assert.ok(await page.locator('[data-listen-topics]').isHidden());
      assert.ok(await page.locator('[data-listen-now]').isHidden());
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    await page.screenshot({ path: path.join(shots, 'chapter10-phone-listen-along.png') });
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ---------------- transcript page ----------------
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    await check(`transcript page (${name}): click a paragraph seeks, border follows`, async () => {
      const { context, page, errors } = await newPage(browser, base, { context: { viewport, hasTouch: name === 'phone' } });
      await page.goto(`${base}/classes/transcripts/001-intro/`);
      assert.equal(await page.locator('.line-play').count(), 0);
      await page.click('[data-listen-along]');
      await page.waitForFunction(() => document.documentElement.classList.contains('is-following'));
      const start = Number(await page.getAttribute('#t3', 'data-start'));
      await page.click('#t3');
      await waitTime(page, start);
      await page.waitForTimeout(500);
      assert.deepEqual(await discussing(page), ['t3']);
      const t6 = Number(await page.getAttribute('#t6', 'data-start'));
      await seek(page, t6 + 0.5);
      assert.deepEqual(await discussing(page), ['t6']);
      const border = await page.evaluate(() => getComputedStyle(document.getElementById('t6')).borderLeftWidth);
      assert.equal(border, '3px'); // LTR transcript: inline-start is the left side
      assert.equal(await page.locator('.tseg .line-play').count(), await page.locator('.tseg').count());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
      await page.screenshot({ path: path.join(shots, `transcript-${name}.png`) });
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  {
    const outlines = readJson(path.join(DIST, 'outlines', 'index.json')).items;
    const intro = outlines.find((i) => i.id === '001 Intro.mp3');
    if (intro) {
      await check('transcript page shows outline topics as headings between paragraphs', async () => {
        const html = fs.readFileSync(path.join(PUBLIC, 'classes', 'transcripts', '001-intro', 'index.html'), 'utf8');
        const topics = readJson(path.join(DIST, decodeURI(intro.path))).topics;
        const headings = [...html.matchAll(/<h2 class="?topic"? data-topic-start="?([\d.]+)"?>([^<]*)</g)];
        assert.deepEqual(headings.map((m) => m[2].trim()), topics.map((t) => t.title));
        assert.ok(html.includes('Topic headings are auto-generated'));
        // Each heading sits just before a paragraph that starts at most 5 s before the topic... or after it.
        for (const m of headings) {
          const after = html.slice(m.index).match(/data-start="?([\d.]+)"?/);
          assert.ok(after && Number(after[1]) >= Number(m[1]) - 5, `heading ${m[2]} placed before ${after?.[1]}`);
        }
      });
    }
  }

  await check('a chapter without alignments is untouched (no player, no script, no data-t)', async () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'texts', 'chapter-1', 'index.html'), 'utf8');
    assert.ok(!/data-listen|data-t=|<script/.test(html));
  });

  await check('class list links to transcripts and the text', async () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'classes', 'rabbi-markel-series-advanced', 'part-1-chapters-10-15', 'index.html'), 'utf8');
    assert.ok(html.includes('/classes/transcripts/001-intro/'));
    assert.ok(html.includes('/classes/transcripts/002-tape016-side1-ch10/'));
    const texts = fs.readFileSync(path.join(PUBLIC, 'texts', 'index.html'), 'utf8');
    assert.ok(/Classes without text[\s\S]*\/classes\/transcripts\/001-intro\//.test(texts));
  });

  await browser.close();
  server.close();
  console.log(results.join('\n'));
  console.log(`\nScreenshots: ${shots}`);
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
