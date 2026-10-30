#!/usr/bin/env node
/**
 * Browser test of the audio features on the built site (hugo/public/):
 * chapter 10 play-from-here (the saved or default teacher, no menu), the
 * teacher/class selectors and their saved choice, ?teacher= links, Follow along (the
 * is-discussing border, saved on/off), the transcript region in the docked
 * panel, new-tab transcript links, blocked storage, a transcript page, phone
 * width, pages without audio staying untouched, the class lists (contents,
 * lesson text preview, the in-page reader, the topic lists), Autoplay next on
 * both, topic deep links (?t=…#class-…: arrival at desktop and phone width,
 * Play from, the native play's seek, a topic click winning over it, a
 * hash-only link), the outlines pages (every link checked against the built
 * HTML, Expand/Collapse all, side nav or "Jump to", a topic link to its
 * class) and the site nav (Outlines, no Translation item).
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
// Index/URL paths are encoded per segment; decodeURI would leave e.g. %26 (&) encoded.
const decodePath = (p) => p.split('/').map(decodeURIComponent).join('/');
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

const discussing = (page) => page.$$eval('[data-aligned-text] .is-discussing, [data-transcript] .is-discussing', (els) => els.map((e) => e.id));

const PANE = '[data-listen-transcript-pane]';
const transcriptOf = (lecture) => readJson(path.join(DIST, decodePath(chapter10.lectures[lecture].transcript)));
/** Transcript region: visibility, size, scroll, current paragraph(s) and whether the first is fully in view. */
const paneState = (page) =>
  page.evaluate((sel) => {
    const pane = document.querySelector(sel);
    const r = pane.getBoundingClientRect();
    const cur = [...pane.querySelectorAll('.tseg.is-discussing')];
    const c = cur[0]?.getBoundingClientRect();
    return {
      hidden: pane.hidden,
      height: r.height,
      scrollTop: pane.scrollTop,
      paras: pane.querySelectorAll('.tseg').length,
      current: cur.map((e) => Number(e.dataset.i)),
      currentVisible: !!c && c.top >= r.top - 1 && c.bottom <= r.bottom + 1,
      firstText: pane.querySelector('.tseg')?.textContent ?? '',
      listenH: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--listen-h')) || 0,
      panel: document.querySelector('[data-listen]').getBoundingClientRect().height,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
    };
  }, PANE);
const followOn = (page) =>
  page.waitForFunction(() => document.documentElement.classList.contains('is-following') && document.querySelector('[data-follow-along]').getAttribute('aria-pressed') === 'true');
/** No chooser menu of any kind appeared. */
const noMenu = async (page) => {
  assert.equal(await page.locator('[role=menu], [role=menuitem], .line-chooser').count(), 0);
};

/** Play an <audio> and jump to its last second, so it ends shortly. */
const playToEnd = (handle) =>
  handle.evaluate(async (a) => {
    await a.play();
    if (a.readyState < 1) await new Promise((r) => a.addEventListener('loadedmetadata', r, { once: true }));
    a.currentTime = a.duration - 1;
  });
const AUTOPLAY_KEY = 'shaarHayichud.audio.autoplayNext';

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
    await page.screenshot({ path: path.join(shots, 'chapter10-desktop-initial.png') });

    await check('chapter 10: a play button on every aligned line, none elsewhere', async () => {
      assert.equal(await page.locator('.line-play').count(), chapter10.lines.length);
      assert.equal(await page.locator('.line:not([data-t]) ~ .line-play, .line-play + .line:not([data-t])').count(), 0);
      assert.equal(await page.locator('[data-listen-series] option').count(), 2);
      assert.deepEqual(await page.locator('[data-listen-series] option').allTextContents(), [
        'Rabbi Benyamin Walters Original Class',
        'Rabbi Markel Series (Advanced)',
      ]);
      // Class selector shows only the chosen teacher's classes.
      assert.deepEqual(
        await page.locator('[data-listen-select] option').allTextContents(),
        chapter10.lectures.filter((l) => l.seriesId === '0').map((l) => l.title),
      );
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

    await check('nothing saved: ▶ on a line two teachers discuss plays the default teacher at once, no menu', async () => {
      assert.equal(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.series')), null);
      const r = refOf('njpqigb7', WALTERS_1);
      const b = page.locator('.line-play[data-line="njpqigb7"]');
      assert.equal(await b.getAttribute('aria-haspopup'), null);
      assert.equal(await b.getAttribute('aria-label'), 'Play from here');
      await b.focus();
      await page.keyboard.press('Enter');
      await waitTime(page, r.startSeconds);
      await noMenu(page);
      const s = await audioState(page);
      assert.equal(s.src, chapter10.lectures[WALTERS_1].url);
      assert.equal(s.paused, false);
      assert.equal(await page.locator('[data-listen-series]').inputValue(), '0');
      assert.ok(await page.locator('[data-listen-note]').isHidden());
    });

    await check('a line only Markel covers plays Markel and says so', async () => {
      // Every chapter 10 line is in a Walters class now, so use the first chapter that has a Markel-only line.
      const found = fs
        .readdirSync(path.join(DIST, 'alignments', 'chapters'))
        .filter((f) => /^chapter_\d+\.json$/.test(f))
        .sort()
        .map((f) => readJson(path.join(DIST, 'alignments', 'chapters', f)))
        .flatMap((ch) =>
          ch.lectures.some((l) => l.seriesId === '0')
            ? ch.lines.filter((l) => l.refs.every((r) => ch.lectures[r.lecture].seriesId === '37')).map((l) => ({ ch, l }))
            : [],
        )[0];
      assert.ok(found, 'some chapter has a line only Markel covers');
      const { ch, l } = found;
      const n = Number(/\d+$/.exec(ch.chapter)[0]);
      const other = await newPage(browser, base);
      try {
        await other.page.goto(`${base}/texts/chapter-${n}/`);
        await other.page.click(`.line-play[data-line="${l.lineId}"]`);
        await waitTime(other.page, l.refs[0].startSeconds);
        assert.equal((await audioState(other.page)).src, ch.lectures[l.refs[0].lecture].url);
        assert.match(await other.page.locator('[data-listen-note]').textContent(), /not in Rabbi Benyamin Walters Original Class's classes yet; playing Rabbi Markel/);
        assert.equal(await other.page.locator('[data-listen-series]').inputValue(), '37');
      } finally {
        await other.context.close();
      }
    });

    await check('Follow along: the border follows playback (until-next-line model); on/off is saved', async () => {
      assert.equal(await page.locator('[data-follow-along]').textContent(), 'Follow along');
      await page.click('[data-follow-along]');
      await followOn(page);
      assert.equal(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.followAlong')), 'on');
      // Play the Markel class (lines in it are also in Walters classes, so pick the teacher first).
      await page.selectOption('[data-listen-series]', chapter10.lectures[MARKEL_10].seriesId);
      await page.selectOption('[data-listen-select]', String(MARKEL_10));
      const r = refOf('gbyeqivs', MARKEL_10);
      await page.click('.line-play[data-line="gbyeqivs"]');
      await waitTime(page, r.startSeconds);
      assert.equal((await audioState(page)).src, chapter10.lectures[MARKEL_10].url);
      await seek(page, r.startSeconds + 2);
      assert.deepEqual(await discussing(page), ['gbyeqivs']);
      const border = await page.evaluate(() => getComputedStyle(document.getElementById('gbyeqivs').closest('p, .content')).borderRightWidth);
      assert.equal(border, '3px'); // RTL: inline-start is the right side
      // Lines that start at the same instant are current together. Re-timing removed the
      // collapsed Sofer timestamps that used to cause this in Markel 002, so only check it
      // when the data still has such a pair (model.ts' unit tests cover it either way).
      const starts = new Map();
      for (const l of chapter10.lines) {
        const r = l.refs.find((x) => x.lecture === MARKEL_10);
        if (r) starts.set(r.startSeconds, [...(starts.get(r.startSeconds) ?? []), l.lineId]);
      }
      const same = [...starts.entries()].find(([, ids]) => ids.length > 1);
      if (same) {
        await seek(page, same[0] + 1);
        assert.deepEqual((await discussing(page)).sort(), [...same[1]].sort());
      }
      await page.screenshot({ path: path.join(shots, 'chapter10-desktop-follow-along.png') });
      // Far past the last line: nothing.
      await seek(page, 2300);
      assert.deepEqual(await discussing(page), []);
      // Picking Markel above saved it as the teacher; the next checks start from Walters again.
      await page.selectOption('[data-listen-series]', '0');
    });

    await check('Follow along: clicking line text seeks in the current class, or switches class', async () => {
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

    await check('transcript links open in a new tab and say so', async () => {
      const link = page.locator('[data-listen-transcript]');
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal(await link.getAttribute('rel'), 'noopener');
      assert.equal(await link.locator('svg[aria-hidden="true"]').count(), 1);
      assert.equal((await link.locator('.visually-hidden').textContent()).trim(), '(opens in a new tab)');
      assert.equal(await link.getAttribute('href'), '/classes/transcripts/07-chap-10-1-atmus-ohr-ein-sof-m/');
      // Visually hidden: takes no room.
      const box = await link.locator('.visually-hidden').boundingBox();
      assert.ok(box.width <= 1 && box.height <= 1);
    });

    await check('transcript region: show, click to seek, follows inside the region only, pauses after a region scroll, swaps with the class, hide', async () => {
      const t1 = transcriptOf(WALTERS_1);
      const toggle = page.locator('[data-listen-transcript-toggle]');
      assert.equal(await toggle.textContent(), 'Show transcript');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.ok(await page.locator(PANE).isHidden());
      const before = await paneState(page);
      await toggle.click();
      await page.waitForSelector(`${PANE} .tseg`);
      assert.equal(await toggle.textContent(), 'Hide transcript');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      let st = await paneState(page);
      assert.equal(st.paras, t1.segments.length);
      assert.equal(st.firstText.trim(), t1.segments[0].text);
      assert.deepEqual(
        await page.$$eval(`${PANE} .tseg`, (els) => els.map((e) => Number(e.dataset.start))),
        t1.segments.map((x) => x.startSeconds),
      );
      // About half the screen, and the page padding / --listen-h grew with the panel.
      assert.ok(st.height > 0.4 * st.innerHeight && st.height <= 0.51 * st.innerHeight, `region ${st.height}px of ${st.innerHeight}`);
      assert.ok(Math.abs(st.listenH - st.panel) < 2 && st.listenH > before.listenH, `--listen-h ${st.listenH} panel ${st.panel}`);
      assert.ok(st.panel <= 0.85 * st.innerHeight + 1);
      // The panel itself does not scroll (only the region does).
      assert.equal(await page.evaluate(() => { const p = document.querySelector('[data-listen]'); return p.scrollHeight - p.clientHeight; }), 0);

      // Click a paragraph: seeks there and marks it.
      await page.locator(`${PANE} .tseg[data-i="3"]`).click();
      await waitTime(page, t1.segments[3].startSeconds);
      await page.waitForTimeout(400);
      st = await paneState(page);
      assert.deepEqual(st.current, [3]);
      assert.equal(await page.evaluate((sel) => getComputedStyle(document.querySelector(`${sel} .tseg[data-i="3"]`)).borderLeftWidth, PANE), '3px');
      assert.equal((await audioState(page)).paused, false);

      // Following: a far paragraph scrolls into view inside the region, and the page does not move.
      await page.mouse.move(640, 150);
      await page.mouse.wheel(0, 1); // pauses the page's own auto-scroll (follow.ts)
      await page.waitForTimeout(300);
      const y0 = (await paneState(page)).scrollY;
      const far = t1.segments.length - 3;
      await seek(page, t1.segments[far].startSeconds + 1);
      await page.waitForTimeout(900);
      st = await paneState(page);
      assert.deepEqual(st.current, [far]);
      assert.ok(st.scrollTop > 0 && st.currentVisible, `scrollTop ${st.scrollTop}, visible ${st.currentVisible}`);
      assert.equal(st.scrollY, y0, 'the page scrolled');
      await page.screenshot({ path: path.join(shots, 'chapter10-desktop-transcript-following.png') });

      // The reader scrolls the region: no automatic scrolling for a while.
      const paneBox = await page.locator(PANE).boundingBox();
      await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2);
      await page.mouse.wheel(0, -5000);
      await page.waitForTimeout(500);
      const top0 = (await paneState(page)).scrollTop;
      await seek(page, t1.segments[far - 1].startSeconds + 1);
      await page.waitForTimeout(700);
      st = await paneState(page);
      assert.deepEqual(st.current, [far - 1]);
      assert.equal(st.scrollTop, top0);
      assert.equal(st.currentVisible, false);

      // The last chapter lines can still scroll above the taller panel.
      const reach = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const lines = document.querySelectorAll('[data-aligned-text] .line');
        const last = lines[lines.length - 1].getBoundingClientRect();
        const h = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--listen-h'));
        return { bottom: last.bottom, limit: window.innerHeight - h };
      });
      assert.ok(reach.bottom <= reach.limit, `last line ends at ${reach.bottom}, panel starts at ${reach.limit}`);

      // Switching class swaps the transcript.
      const part2 = lectureOf('08 - Chap- 10-2 Atzmus Ohr Ein Sof (M).mp3');
      await page.selectOption('[data-listen-select]', String(part2));
      await page.waitForFunction(
        ([sel, n]) => document.querySelectorAll(`${sel} .tseg`).length === n,
        [PANE, transcriptOf(part2).segments.length],
      );
      assert.equal((await paneState(page)).firstText.trim(), transcriptOf(part2).segments[0].text);

      // Hide: the region goes, the panel shrinks back.
      await toggle.click();
      await page.waitForFunction(() => {
        const h = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--listen-h'));
        return Math.abs(h - document.querySelector('[data-listen]').offsetHeight) < 2;
      });
      st = await paneState(page);
      assert.ok(st.hidden);
      assert.equal(await toggle.textContent(), 'Show transcript');
      assert.ok(st.listenH < 0.35 * st.innerHeight, `--listen-h ${st.listenH}`);
      await page.selectOption('[data-listen-select]', String(WALTERS_1));
    });

    await check('the teacher choice and Follow along are saved and apply on reload; ▶ plays the saved teacher', async () => {
      await page.selectOption('[data-listen-series]', chapter10.lectures[MARKEL_10].seriesId);
      assert.match(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.series')), /"id":"37"/);
      await page.reload();
      await page.waitForSelector('.line-play');
      assert.equal(await page.locator('[data-listen-series]').inputValue(), '37');
      assert.equal((await audioState(page)).src, chapter10.lectures[MARKEL_10].url);
      // Follow along comes back on by itself, without starting playback.
      await followOn(page);
      assert.equal((await audioState(page)).paused, true);
      // The transcript region's shown/hidden is not saved.
      assert.ok(await page.locator(PANE).isHidden());
      assert.equal(await page.getAttribute('[data-listen-transcript-toggle]', 'aria-expanded'), 'false');
      const r = refOf('njpqigb7', MARKEL_10);
      await page.click('.line-play[data-line="njpqigb7"]');
      await waitTime(page, r.startSeconds);
      await noMenu(page);
      assert.equal((await audioState(page)).src, chapter10.lectures[MARKEL_10].url);
      await page.waitForTimeout(500);
      assert.deepEqual(await discussing(page), ['njpqigb7']);
    });

    const withOutline = chapter10.lectures.findIndex((l) => l.outline);
    if (withOutline >= 0) {
      await check('Follow along shows the class outline (auto-generated topics); clicking a topic seeks', async () => {
        const lecture = chapter10.lectures[withOutline];
        const outline = readJson(path.join(DIST, decodePath(lecture.outline)));
        await page.selectOption('[data-listen-series]', lecture.seriesId);
        await page.selectOption('[data-listen-select]', String(withOutline));
        if ((await page.getAttribute('[data-follow-along]', 'aria-pressed')) !== 'true') await page.click('[data-follow-along]');
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

  await check('chapter 10 works with storage blocked (default teacher, Follow along, transcript region)', async () => {
    const { context, page, errors } = await newPage(browser, base, { blockStorage: true });
    await page.goto(`${base}/texts/chapter-10/`);
    await page.waitForSelector('.line-play');
    assert.equal(await page.locator('[data-listen-series]').inputValue(), '0');
    await page.click('[data-follow-along]');
    await followOn(page);
    await page.click('.line-play[data-line="njpqigb7"]');
    await waitTime(page, refOf('njpqigb7', WALTERS_1).startSeconds);
    await noMenu(page);
    await page.click('[data-listen-transcript-toggle]');
    await page.waitForSelector(`${PANE} .tseg.is-discussing`);
    await page.selectOption('[data-listen-series]', '37');
    await page.click('.line-play[data-line="gbyeqivs"]');
    await waitTime(page, refOf('gbyeqivs', MARKEL_10).startSeconds);
    assert.equal(await page.locator(`${PANE} .tseg`).count(), transcriptOf(MARKEL_10).segments.length);
    // Nothing could be saved: a reload starts from the defaults.
    await page.reload();
    await page.waitForSelector('.line-play');
    assert.equal(await page.locator('[data-listen-series]').inputValue(), '0');
    assert.equal(await page.getAttribute('[data-follow-along]', 'aria-pressed'), 'false');
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('Follow along saved on: the border still follows when follow.js loads before the alignments', async () => {
    const { context, page, errors } = await newPage(browser, base);
    await context.addInitScript(() => localStorage.setItem('shaarHayichud.audio.followAlong', 'on'));
    let release;
    const held = new Promise((r) => (release = r));
    await context.route('**/data/v1/alignments/chapters/chapter_10.json', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${base}/texts/chapter-10/`);
    await followOn(page);
    await page.waitForTimeout(500); // follow.js has run its first update with no data yet
    release();
    await page.waitForSelector('.line-play');
    await page.click('.line-play[data-line="njpqigb7"]');
    await waitTime(page, refOf('njpqigb7', WALTERS_1).startSeconds);
    await page.waitForTimeout(500);
    assert.deepEqual(await discussing(page), ['njpqigb7']);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('the transcript toggle is hidden for a class without a published transcript', async () => {
    const { context, page, errors } = await newPage(browser, base);
    const part2 = lectureOf('08 - Chap- 10-2 Atzmus Ohr Ein Sof (M).mp3');
    await context.route('**/data/v1/alignments/chapters/chapter_10.json', async (route) => {
      const d = structuredClone(chapter10);
      delete d.lectures[part2].transcript;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(d) });
    });
    await page.goto(`${base}/texts/chapter-10/`);
    await page.waitForSelector('.line-play');
    const toggle = page.locator('[data-listen-transcript-toggle]');
    assert.ok(await toggle.isVisible());
    await toggle.click();
    await page.waitForSelector(`${PANE} .tseg`);
    await page.selectOption('[data-listen-select]', String(part2));
    assert.ok(await toggle.isHidden());
    assert.ok(await page.locator(PANE).isHidden());
    // Back to a class with one: the region comes back with its transcript.
    await page.selectOption('[data-listen-select]', String(WALTERS_1));
    await page.waitForSelector(`${PANE} .tseg`);
    assert.equal(await page.locator(`${PANE} .tseg`).count(), transcriptOf(WALTERS_1).segments.length);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('Autoplay next (chapter 10): saved; plays the teacher\'s next class from the start, in sync; stops after the last', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}/texts/chapter-10/`);
      await page.waitForSelector('.line-play');
      const toggle = page.locator('[data-listen] [data-autoplay-next]');
      // Shown only while the player plays.
      assert.equal(await toggle.isVisible(), false);
      await page.evaluate(() => document.querySelector('[data-listen-audio]').play());
      await toggle.waitFor();
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await page.evaluate(() => document.querySelector('[data-listen-audio]').nextElementSibling.matches('label.autoplay-next')), true);
      assert.equal((await page.locator('label.autoplay-next').textContent()).trim(), 'Autoplay next');
      // Keyboard: Space toggles it; the choice is saved and comes back on reload.
      await toggle.focus();
      await page.keyboard.press('Space');
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), AUTOPLAY_KEY), 'on');
      await page.reload();
      await page.waitForSelector('.line-play');
      assert.equal(await toggle.isChecked(), true);

      const walters = chapter10.lectures.flatMap((l, i) => (l.seriesId === '0' ? [i] : []));
      const [first, second] = walters;
      const last = walters[walters.length - 1];
      assert.ok(walters.length > 2 && chapter10.lectures[second].transcript);
      await page.click('[data-follow-along]');
      await followOn(page);
      await page.click('[data-listen-transcript-toggle]');
      await page.waitForSelector(`${PANE} .tseg`);
      assert.equal((await audioState(page)).src, chapter10.lectures[first].url);
      const audio = await page.$('[data-listen-audio]');
      await playToEnd(audio);
      await page.waitForFunction(
        (url) => {
          const a = document.querySelector('[data-listen-audio]');
          // From the start (the first class ended at 40:00); loose, as playback runs on under load.
          return a.currentSrc === url && !a.paused && a.currentTime < 30;
        },
        chapter10.lectures[second].url,
        { timeout: 30000 },
      );
      assert.equal(await page.locator('[data-listen-select]').inputValue(), String(second));
      assert.equal(await page.locator('[data-listen-note]').textContent(), `Playing next: ${chapter10.lectures[second].title}`);
      // The transcript region, Follow along and the outline move to the new class, as with the selector.
      await page.waitForFunction(([sel, n]) => document.querySelectorAll(`${sel} .tseg`).length === n, [PANE, transcriptOf(second).segments.length]);
      assert.equal((await paneState(page)).firstText.trim(), transcriptOf(second).segments[0].text);
      const line = chapter10.lines.find((l) => l.refs.some((r) => r.lecture === second));
      await seek(page, refOf(line.lineId, second).startSeconds + 0.5);
      assert.ok((await discussing(page)).includes(line.lineId));
      if (chapter10.lectures[second].outline) {
        const outline = readJson(path.join(DIST, decodePath(chapter10.lectures[second].outline)));
        await page.waitForFunction((n) => document.querySelectorAll('[data-listen-topics]:not([hidden]) li').length === n, outline.topics.length);
      }
      await page.screenshot({ path: path.join(shots, 'chapter10-desktop-autoplay.png') });

      // The teacher's last class on the chapter: stop there, no navigation.
      await page.selectOption('[data-listen-select]', String(last));
      const url = page.url();
      await playToEnd(audio);
      await page.waitForFunction(() => document.querySelector('[data-listen-audio]').ended, null, { timeout: 15000 });
      await page.waitForTimeout(500);
      let s = await audioState(page);
      assert.equal(s.src, chapter10.lectures[last].url);
      assert.equal(s.paused, true);
      assert.equal(page.url(), url);
      assert.equal(await page.locator('[data-listen-select]').inputValue(), String(last));
      assert.match(await page.locator('[data-listen-note]').textContent(), /last class of Rabbi Benyamin Walters Original Class on this chapter/);

      // Off: a class that ends stays. (The toggle shows only while playing.)
      await page.evaluate(() => document.querySelector('[data-listen-audio]').play());
      await toggle.click();
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), AUTOPLAY_KEY), 'off');
      await page.selectOption('[data-listen-select]', String(first));
      await playToEnd(audio);
      await page.waitForFunction(() => document.querySelector('[data-listen-audio]').ended, null, { timeout: 15000 });
      await page.waitForTimeout(500);
      s = await audioState(page);
      assert.equal(s.src, chapter10.lectures[first].url);
      assert.equal(s.paused, true);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  // ---------------- chapter 10, phone ----------------
  await check('chapter 10 at phone width: compact bar, no horizontal scroll, tap plays (no menu), border and transcript region', async () => {
    const { context, page, errors } = await newPage(browser, base, {
      context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    });
    await page.goto(`${base}/he/texts/chapter-10/`);
    await page.waitForSelector('.line-play');
    await page.screenshot({ path: path.join(shots, 'chapter10-phone-initial.png') });
    await page.tap('[data-follow-along]');
    const r = refOf('4oeagnb6', lectureOf('08 - Chap- 10-2 Atzmus Ohr Ein Sof (M).mp3'));
    await page.locator('.line-play[data-line="4oeagnb6"]').scrollIntoViewIfNeeded();
    await page.tap('.line-play[data-line="4oeagnb6"]');
    await waitTime(page, r.startSeconds);
    await noMenu(page);
    assert.equal((await audioState(page)).src, chapter10.lectures[r.lecture].url);
    await page.waitForTimeout(800);
    assert.deepEqual(await discussing(page), ['4oeagnb6']);
    // The docked bar stays compact: about a fifth of the screen at most.
    await page.screenshot({ path: path.join(shots, 'chapter10-phone-follow-along.png') });
    const bar = await paneState(page);
    assert.ok(bar.panel <= 0.25 * bar.innerHeight, `bar is ${bar.panel}px of ${bar.innerHeight}`);
    // This class has no outline: no topic list, no stale "Now:" from another class.
    if (!chapter10.lectures[r.lecture].outline) {
      assert.ok(await page.locator('[data-listen-topics]').isHidden());
      assert.ok(await page.locator('[data-listen-now]').isHidden());
    }
    // Transcript region: about half the screen above the controls; tap a paragraph to seek.
    await page.tap('[data-listen-transcript-toggle]');
    await page.waitForSelector(`${PANE} .tseg.is-discussing`);
    let st = await paneState(page);
    assert.ok(st.currentVisible);
    assert.ok(st.height > 0.4 * st.innerHeight && st.height <= 0.51 * st.innerHeight, `region ${st.height}px of ${st.innerHeight}`);
    assert.ok(st.panel <= 0.85 * st.innerHeight + 1);
    const t2 = transcriptOf(r.lecture);
    const i = st.current[0] + 2;
    await page.locator(`${PANE} .tseg[data-i="${i}"]`).tap();
    await waitTime(page, t2.segments[i].startSeconds);
    await page.waitForTimeout(500);
    st = await paneState(page);
    assert.deepEqual(st.current, [i]);
    assert.ok(st.currentVisible);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    await page.screenshot({ path: path.join(shots, 'chapter10-phone-transcript-following.png') });
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ---------------- transcript page ----------------
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    await check(`transcript page (${name}): click a paragraph seeks, border follows, Follow along survives a reload`, async () => {
      const { context, page, errors } = await newPage(browser, base, { context: { viewport, hasTouch: name === 'phone' } });
      await page.goto(`${base}/classes/transcripts/001-intro/`);
      assert.equal(await page.locator('.line-play').count(), 0);
      assert.equal(await page.locator('[data-listen-transcript-toggle]').count(), 0);
      await page.click('[data-follow-along]');
      await followOn(page);
      await page.reload();
      await followOn(page);
      await page.waitForSelector('.tseg .line-play');
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
        const topics = readJson(path.join(DIST, decodePath(intro.path))).topics;
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
    const aligned = new Set(fs.readdirSync(path.join(DIST, 'alignments', 'chapters')));
    const n = Array.from({ length: 54 }, (_, i) => i + 1).find((i) => !aligned.has(`chapter_${String(i).padStart(2, '0')}.json`));
    assert.ok(n, 'some chapter has no alignments');
    const html = fs.readFileSync(path.join(PUBLIC, 'texts', `chapter-${n}`, 'index.html'), 'utf8');
    assert.ok(!/data-listen|data-t=|<script/.test(html));
  });

  await check('class list links to transcripts (new tab, with icon and hidden text) and the text', async () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'classes', 'rabbi-markel-series-advanced', 'part-1-chapters-10-15', 'index.html'), 'utf8');
    assert.ok(html.includes('/classes/transcripts/001-intro/'));
    assert.ok(html.includes('/classes/transcripts/002-tape016-side1-ch10/'));
    const links = [...html.matchAll(/<a (?:class="?audio-link"? )?href="?\/classes\/transcripts\/[^ >]+ ([^>]*)>Transcript(.*?)<\/a>/g)];
    assert.ok(links.length >= 2);
    for (const [, attrs, inner] of links) {
      assert.match(attrs, /target="?_blank"?/);
      assert.match(attrs, /rel="?noopener"?/);
      assert.match(inner, /<svg[^>]*aria-hidden="true"/);
      assert.match(inner, /class="?visually-hidden"?> \(opens in a new tab\)</);
    }
    const texts = fs.readFileSync(path.join(PUBLIC, 'texts', 'index.html'), 'utf8');
    assert.ok(/Classes without text[\s\S]*\/classes\/transcripts\/001-intro\//.test(texts));
  });

  await check('/texts groups classes without text by teacher and catalog heading, collapsed', async () => {
    const { context, page } = await newPage(browser, base, { context: { viewport: { width: 390, height: 844 } } });
    try {
      await page.goto(`${base}/texts/`);
      const teachers = await page.locator('.index-teacher').allTextContents();
      assert.ok(teachers.length >= 1);
      const groups = page.locator('details.index-group');
      assert.ok((await groups.count()) >= 2);
      // Collapsed by default: no transcript link visible until a group opens.
      assert.equal(await page.locator('details.index-group a:visible').count(), 0);
      // Every group's count matches its links, and each link is a transcript page.
      for (let i = 0; i < (await groups.count()); i++) {
        const g = groups.nth(i);
        const n = Number(await g.locator('.index-group-count').textContent());
        assert.equal(await g.locator('li a').count(), n);
        for (const href of await g.locator('li a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
          assert.match(href, /^\/classes\/transcripts\/[^/]+\/$/);
        }
      }
      await groups.first().locator('summary').click();
      assert.ok((await groups.first().locator('a:visible').count()) > 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: path.join(shots, 'texts-groups-phone.png'), fullPage: true });
    } finally {
      await context.close();
    }
  });

  await check('?teacher=RabbiMarkel opens chapter 10 with Markel without saving it; picking a teacher saves it and drops the parameter', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}/texts/chapter-10/?teacher=RabbiMarkel`);
      await page.waitForSelector('.line-play');
      assert.equal(await page.locator('[data-listen-series]').inputValue(), '37');
      assert.equal((await audioState(page)).src, chapter10.lectures[MARKEL_10].url);
      assert.equal(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.series')), null);
      // Not saved: without the parameter the default teacher comes back.
      await page.goto(`${base}/texts/chapter-10/`);
      await page.waitForSelector('.line-play');
      assert.equal(await page.locator('[data-listen-series]').inputValue(), '0');
      // An unknown teacher falls back with a note.
      await page.goto(`${base}/texts/chapter-10/?teacher=Nobody`);
      await page.waitForSelector('.line-play');
      assert.equal(await page.locator('[data-listen-series]').inputValue(), '0');
      assert.match(await page.locator('[data-listen-note]').textContent(), /Nobody/);
      // The reader's own pick is saved and replaces the link's.
      await page.goto(`${base}/texts/chapter-10/?teacher=RabbiMarkel`);
      await page.waitForSelector('.line-play');
      await page.locator('[data-listen-series]').selectOption('0');
      assert.equal(new URL(page.url()).search, '');
      assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.series'))).id, '0');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('class list: contents links, chapter links carry ?teacher=, lesson text preview', async () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'classes', 'rabbi-markel-series-advanced', 'part-1-chapters-10-15', 'index.html'), 'utf8');
    assert.match(html, /<nav class="?class-toc"?[\s\S]*?href="?#chapter-10"?/);
    assert.match(html, /id="?chapter-10"?/);
    assert.match(html, /href="?\/texts\/chapter-10\/\?teacher=RabbiMarkelSeriesAdvanced"?/);
    const t = fs.readFileSync(path.join(PUBLIC, 'classes', 'transcripts', '002-tape016-side1-ch10', 'index.html'), 'utf8');
    assert.match(t, /href="?\/texts\/chapter-10\/\?teacher=RabbiMarkelSeriesAdvanced"?/);
  });

  for (const [name, ctx] of [
    ['desktop', { viewport: { width: 1280, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ]) {
    await check(`class list (${name}): preview plays from a line and follows; the reader keeps the class playing; Back returns`, async () => {
      const { context, page, errors } = await newPage(browser, base, { context: ctx });
      const list = `${base}/classes/rabbi-benyamin-walters-original-class/chapters-10-15/`;
      try {
        await page.goto(list);
        const box = page.locator('.track[data-lesson]').first();
        const preview = box.locator('[data-lesson-text]');
        // About three phrases tall, scrolling on its own.
        const ph = await preview.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight }));
        assert.ok(ph.h < 200 && ph.sh > ph.h, JSON.stringify(ph));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        // Play from the third aligned line of the preview.
        const third = preview.locator('.line-play').nth(2);
        const start = Number(await third.getAttribute('data-start'));
        await third.click();
        const audio = box.locator('audio');
        await page.waitForFunction(
          ([el, t]) => !el.paused && Math.abs(el.currentTime - t) < 1.5,
          [await audio.elementHandle(), start],
          { timeout: 15000 },
        );
        await page.waitForTimeout(500);
        assert.equal(await preview.locator('.line.is-discussing').count(), 1);
        // The current line is in view inside the box, and the page did not scroll for it.
        const vis = await preview.evaluate((el) => {
          const c = el.querySelector('.is-discussing').getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return c.top >= r.top - 1 && c.top <= r.bottom;
        });
        assert.ok(vis);
        // Another class starting pauses this one.
        const other = page.locator('.track audio').nth(3);
        await other.evaluate((a) => a.play());
        await page.waitForTimeout(300);
        assert.equal(await audio.evaluate((a) => a.paused), true);
        await other.evaluate((a) => a.pause());
        await audio.evaluate((a) => a.play());

        // Open the reader: no reload, same audio keeps playing, the current line is marked and in view.
        await page.evaluate(() => (window.__noReload = true));
        const before = await audio.evaluate((a) => a.currentTime);
        await box.locator('a[data-lesson-open]').first().click();
        const reader = page.locator('.reader');
        await reader.locator('.line.in-lesson').first().waitFor();
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => window.__noReload), true);
        assert.equal(await audio.evaluate((a) => a.paused), false);
        assert.ok((await audio.evaluate((a) => a.currentTime)) >= before);
        const cur = reader.locator('.line.is-discussing');
        assert.equal(await cur.count(), 1);
        const inView = await cur.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < window.innerHeight;
        });
        assert.ok(inView);
        // The docked player (the <audio> with its Autoplay next toggle) is on screen, above the reader.
        const docked = await audio.evaluate((a) => {
          const p = a.closest('.track-player');
          const r = p.getBoundingClientRect();
          const t = p.querySelector('[data-autoplay-next]').getBoundingClientRect();
          return getComputedStyle(p).position === 'fixed' && r.bottom <= window.innerHeight + 1 && r.top > 0 && t.top >= r.top && t.bottom <= r.bottom;
        });
        assert.ok(docked);
        // Clicking a reader line of the lesson seeks.
        const line = reader.locator('.line.has-audio').first();
        const lineStart = Number(await reader.locator('.line-play').first().getAttribute('data-start'));
        await line.click();
        await page.waitForFunction(([el, t]) => Math.abs(el.currentTime - t) < 1.5, [await audio.elementHandle(), lineStart], { timeout: 15000 });
        await page.screenshot({ path: path.join(shots, `classes-reader-${name}.png`) });
        // Browser Back closes it; the class still plays; the page is the list.
        await page.goBack();
        await reader.waitFor({ state: 'hidden' });
        assert.equal(page.url(), list);
        assert.equal(await page.evaluate(() => window.__noReload), true);
        assert.equal(await audio.evaluate((a) => a.paused), false);
        assert.equal(await audio.evaluate((a) => getComputedStyle(a.closest('.track-player')).position), 'static');
        // Esc closes it too.
        await box.locator('a[data-lesson-open]').first().click();
        await reader.locator('.line.in-lesson').first().waitFor();
        // Focus stays in the reader and the docked player (the list behind is inert).
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press('Tab');
          const where = await page.evaluate(() => {
            const el = document.activeElement;
            return !el || el === document.body || !!el.closest('.reader, .track.is-reading .track-player');
          });
          assert.ok(where, `focus escaped the reader at Tab ${i + 1}`);
        }
        // (Chromium's native audio controls keep Esc to themselves: press it from the dialog.)
        await reader.locator('.reader-back').focus();
        await page.keyboard.press('Escape');
        await reader.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => history.state), null);
        assert.equal(await page.locator('[inert]').count(), 0);
        // Opening the reader pauses a class playing elsewhere (it would be out of reach behind it).
        await other.evaluate((a) => a.play());
        await page.waitForFunction((a) => !a.paused, await other.elementHandle());
        await box.locator('a[data-lesson-open]').first().click();
        await reader.locator('.line.in-lesson').first().waitFor();
        assert.equal(await other.evaluate((a) => a.paused), true);
        await reader.locator('.reader-back').click();
        await reader.waitFor({ state: 'hidden' });
        // A double-click on Back closes the reader once and stays on the list.
        await box.locator('a[data-lesson-open]').first().click();
        await reader.locator('.line.in-lesson').first().waitFor();
        await reader.locator('.reader-back').dblclick();
        await reader.waitFor({ state: 'hidden' });
        await page.waitForTimeout(300);
        assert.equal(page.url(), list);
        await page.screenshot({ path: path.join(shots, `classes-list-${name}.png`) });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  await check('Autoplay next (class list): one synced toggle per box; the next box plays (across headings), scrolled into view unless the page was scrolled; the reader moves on (no new history entry) and is reachable while open', async () => {
    const { context, page, errors } = await newPage(browser, base);
    const list = `${base}/classes/rabbi-benyamin-walters-original-class/chapters-10-15/`;
    // Box 12 (chapter 11) stands in for a class without lesson text.
    let plain = null;
    await context.route(list, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const m = [...html.matchAll(/<div class="?track"? id="?([^" >]+)"? data-lesson>/g)][12];
      plain = m[1];
      await route.fulfill({ response, body: html.replace(m[0], m[0].replace(' data-lesson>', '>')) });
    });
    try {
      await page.goto(list);
      const boxes = page.locator('.track');
      const n = await boxes.count();
      const toggles = page.locator('.track [data-autoplay-next]');
      assert.equal(await toggles.count(), n);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.track audio')].every((a) => a.nextElementSibling?.matches('label.autoplay-next'))), true);
      const states = () => toggles.evaluateAll((els) => els.map((e) => e.checked));
      assert.deepEqual(await states(), Array(n).fill(false));
      // Shown only in the box whose class plays.
      const playBox = async (i) => {
        await boxes.nth(i).locator('audio').evaluate((a) => a.play());
        await toggles.nth(i).waitFor();
      };
      assert.equal(await page.locator('.track .autoplay-next:visible').count(), 0);
      await playBox(2);
      assert.equal(await page.locator('.track .autoplay-next:visible').count(), 1);
      // Changing one changes them all, and it is saved.
      await toggles.nth(2).click();
      assert.deepEqual(await states(), Array(n).fill(true));
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), AUTOPLAY_KEY), 'on');
      await playBox(4);
      assert.equal(await toggles.nth(2).isVisible(), false);
      await toggles.nth(4).click();
      assert.deepEqual(await states(), Array(n).fill(false));
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), AUTOPLAY_KEY), 'off');
      await toggles.nth(4).click();

      const audioOf = (i) => boxes.nth(i).locator('audio').elementHandle();
      const playing = () => page.$$eval('.track audio', (as) => as.flatMap((a, i) => (a.paused ? [] : [i])));
      const waitPlaying = (i) =>
        page.waitForFunction(
          (i) => {
            const a = document.querySelectorAll('.track audio')[i];
            return !a.paused && a.currentTime < 5;
          },
          i,
          { timeout: 15000 },
        );
      const below = (i) => boxes.nth(i).evaluate((b) => b.getBoundingClientRect().top >= window.innerHeight);
      // Box 5 at the bottom of the screen: when it ends, box 6 plays from the start and comes into view.
      await boxes.nth(5).evaluate((b) => b.scrollIntoView({ block: 'end' }));
      assert.ok(await below(6));
      await playToEnd(await audioOf(5));
      await waitPlaying(6);
      assert.deepEqual(await playing(), [6]);
      await page.waitForFunction(() => document.querySelectorAll('.track')[6].getBoundingClientRect().bottom <= window.innerHeight + 1);
      // The reader scrolled the page just now: box 7 plays but the page stays put.
      await boxes.nth(6).evaluate((b) => b.scrollIntoView({ block: 'end' }));
      await page.mouse.move(100, 300); // the page margin, outside any box
      await page.mouse.wheel(0, 1);
      await page.waitForTimeout(300);
      assert.ok(await below(7));
      const y = await page.evaluate(() => window.scrollY);
      await playToEnd(await audioOf(6));
      await waitPlaying(7);
      assert.deepEqual(await playing(), [7]);
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => window.scrollY), y);
      await (await audioOf(7)).evaluate((a) => a.pause());

      // The reader, open on the last class of chapter 10: the toggle is reachable in the docked player.
      await boxes.nth(10).locator('a[data-lesson-open]').first().click();
      const reader = page.locator('.reader');
      await reader.locator('.line.in-lesson').first().waitFor();
      await (await audioOf(10)).evaluate((a) => a.play());
      await toggles.nth(10).waitFor();
      const h = await page.evaluate(() => history.length);
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => !!document.activeElement?.matches('.track.is-reading [data-autoplay-next]'));
      }
      assert.ok(reached, 'Tab reaches the docked Autoplay next toggle');
      await page.keyboard.press('Space');
      assert.deepEqual(await states(), Array(n).fill(false));
      await page.keyboard.press('Space');
      assert.deepEqual(await states(), Array(n).fill(true));
      await page.screenshot({ path: path.join(shots, 'classes-reader-autoplay-desktop.png') });

      // It ends: the reader moves on to the next lesson (chapter 11, the next heading), same history entry.
      const title11 = (await boxes.nth(11).locator('.track-title').textContent()).trim();
      await playToEnd(await audioOf(10));
      await waitPlaying(11);
      await page.waitForFunction((t) => document.querySelector('.reader-title').textContent.includes(t), title11);
      await reader.locator('.line.in-lesson').first().waitFor();
      assert.deepEqual(await playing(), [11]);
      assert.equal(await page.evaluate(() => history.length), h);
      assert.equal(await page.evaluate(() => history.state?.lessonReader), true);
      assert.ok(await reader.isVisible());
      assert.equal(await page.locator('.track.is-reading').count(), 1);
      assert.equal(await boxes.nth(11).evaluate((b) => b.classList.contains('is-reading') && !b.querySelector('.track-player').closest('[inert]')), true);
      assert.match(await reader.locator('.reader-title').textContent(), /Chapter 11/);
      assert.ok((await page.locator('.track[inert], .chapter-section[inert]').count()) > 0);

      // The next class has no lesson text: the reader closes (back over its entry) and it plays.
      assert.equal(await boxes.nth(12).getAttribute('id'), plain);
      await playToEnd(await audioOf(11));
      await waitPlaying(12);
      await reader.waitFor({ state: 'hidden' });
      assert.deepEqual(await playing(), [12]);
      assert.equal(page.url(), list);
      assert.equal(await page.evaluate(() => history.state), null);
      assert.equal(await page.locator('[inert]').count(), 0);
      assert.equal(await page.locator('.track.is-reading').count(), 0);
      // Focus moved to the class now playing, and it is on screen.
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        return { box: el.closest('.track')?.id, onScreen: r.bottom > 0 && r.top < window.innerHeight };
      });
      assert.deepEqual(focus, { box: plain, onScreen: true });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  for (const [name, viewport] of [
    ['360', { width: 360, height: 740 }],
    ['390', { width: 390, height: 844 }],
  ]) {
    await check(`Autoplay next at ${name} px: compact chapter panel, no sideways scroll, toggle inside the class box`, async () => {
      const { context, page, errors } = await newPage(browser, base, { context: { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
      try {
        await page.goto(`${base}/he/texts/chapter-10/`);
        await page.waitForSelector('.line-play');
        await page.tap('.line-play[data-line="njpqigb7"]');
        await waitTime(page, refOf('njpqigb7', WALTERS_1).startSeconds);
        await page.tap('[data-listen] .autoplay-next');
        assert.equal(await page.isChecked('[data-listen] [data-autoplay-next]'), true);
        await page.waitForTimeout(300);
        const st = await paneState(page);
        // The phone width check's limit (at 360 px the buttons already take a third row).
        if (name === '390') assert.ok(st.panel <= 0.25 * st.innerHeight, `panel is ${st.panel}px of ${st.innerHeight}`);
        const panelToggle = await page.locator('[data-listen] .autoplay-next').boundingBox();
        assert.ok(panelToggle.height >= 23 && panelToggle.y + panelToggle.height <= st.innerHeight, JSON.stringify(panelToggle));
        assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
        await page.screenshot({ path: path.join(shots, `chapter10-phone-${name}-autoplay.png`) });

        await page.goto(`${base}/classes/rabbi-benyamin-walters-original-class/chapters-10-15/`);
        const box = page.locator('.track').first();
        assert.equal(await box.locator('[data-autoplay-next]').isChecked(), true);
        await box.locator('audio').evaluate((a) => a.play());
        await box.locator('.autoplay-next').waitFor();
        const [b, t] = await Promise.all([box.boundingBox(), box.locator('.autoplay-next').boundingBox()]);
        assert.ok(t.x >= b.x && t.x + t.width <= b.x + b.width, `toggle ${JSON.stringify(t)} box ${JSON.stringify(b)}`);
        assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
        await box.screenshot({ path: path.join(shots, `classes-box-phone-${name}.png`) });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  // ---------------- class page topics and topic deep links ----------------
  const MARKEL_PART_1 = '/classes/rabbi-markel-series-advanced/part-1-chapters-10-15/';

  await check('class page topics: hidden without JS, shown with it; a topic plays from its start; the current one gets aria-current while playing', async () => {
    const html = fs.readFileSync(path.join(PUBLIC, decodePath(MARKEL_PART_1), 'index.html'), 'utf8');
    const lists = [...html.matchAll(/<details [^>]*data-track-topics[^>]*>/g)].map((m) => m[0]);
    assert.ok(lists.length > 3);
    for (const d of lists) assert.match(d, /data-js-only hidden/);
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}${MARKEL_PART_1}`);
      const box = page.locator('.track:has([data-track-topics])').first();
      const topics = box.locator('details[data-track-topics]');
      await topics.locator('summary').waitFor();
      assert.equal(await page.locator('.track [data-track-topics][hidden]').count(), 0);
      assert.equal(await topics.evaluate((d) => d.open), false);
      assert.match(await topics.locator('summary').textContent(), /Topics in this class.*auto-generated/);
      await topics.locator('summary').click();
      const items = topics.locator('li');
      assert.ok((await items.count()) >= 3);
      assert.equal(await topics.locator('li[aria-current]').count(), 0);
      const start = Number(await items.nth(1).locator('button').getAttribute('data-start'));
      await items.nth(1).locator('button').click();
      const audio = await box.locator('audio').elementHandle();
      await page.waitForFunction(([a, t]) => !a.paused && Math.abs(a.currentTime - t) < 1.5, [audio, start], { timeout: 15000 });
      await page.waitForTimeout(300);
      assert.equal(await items.nth(1).getAttribute('aria-current'), 'true');
      assert.equal(await topics.locator('li[aria-current]').count(), 1);
      // Playback moves on into the next topic: the mark follows.
      const next = Number(await items.nth(2).locator('button').getAttribute('data-start'));
      await audio.evaluate((a, t) => (a.currentTime = t), next + 1);
      await page.waitForFunction((li) => li.getAttribute('aria-current') === 'true', await items.nth(2).elementHandle());
      assert.equal(await topics.locator('li[aria-current]').count(), 1);
      await page.screenshot({ path: path.join(shots, 'classes-topics-desktop.png') });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  // Topic deep links as the outlines page renders them, grouped by class box.
  const outlineLinks = (series) => {
    const html = fs.readFileSync(path.join(PUBLIC, 'outlines', series, 'index.html'), 'utf8');
    const boxes = new Map();
    for (const m of html.matchAll(/<a href="?([^" >]*\?t=(\d+)#(class-[^" >]+))"?>/g)) {
      const href = m[1].replaceAll('&amp;', '&');
      const box = decodeURIComponent(m[3]);
      if (!boxes.has(box)) boxes.set(box, []);
      boxes.get(box).push({ href, path: href.split('?')[0], t: Number(m[2]), box });
    }
    return [...boxes.values()];
  };
  // A class well down its page (not the first box), with a few topics.
  const deepBox = outlineLinks('rabbi-markel-series-advanced').filter((links) => links.length >= 4)[4];

  /** Load a deep link; return the box, its topic items and its <audio>, once classes.js is done with the arrival. */
  async function arrive(page, href) {
    await page.goto(`${base}${href}`);
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.waitForTimeout(300); // the re-scroll and focus after load
    const box = page.locator(`[id="${new URL(href, base).hash.slice(1)}"]`);
    return { box, items: box.locator('[data-track-topics] li'), audio: await box.locator('audio').elementHandle() };
  }
  const audioAt = (page, audio, t, tol = 1.5) =>
    page.waitForFunction(([a, t, tol]) => !a.paused && Math.abs(a.currentTime - t) < tol, [audio, t, tol], { timeout: 15000 });

  for (const [name, ctx] of [
    ['desktop', { viewport: { width: 1280, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ]) {
    await check(`topic deep link (${name}): topics open, the topic selected, Play from focused, ?t dropped (hash kept), no autoplay; the button plays there`, async () => {
      assert.ok(deepBox, 'a Markel class with 4+ topics');
      const k = 2;
      const link = deepBox[k];
      const { context, page, errors } = await newPage(browser, base, { context: ctx });
      try {
        const { box, items, audio } = await arrive(page, link.href);
        assert.equal(await box.locator('details[data-track-topics]').evaluate((d) => d.open && !d.hidden), true);
        assert.equal(await items.nth(k).getAttribute('aria-current'), 'true');
        assert.equal(await items.nth(k).evaluate((li) => li.classList.contains('is-selected')), true);
        assert.equal(await box.locator('[data-track-topics] li[aria-current], [data-track-topics] li.is-selected').count(), 1);
        const start = Number(await items.nth(k).locator('button').getAttribute('data-start'));
        assert.equal(Math.floor(start), link.t);
        const time = (await items.nth(k).locator('.listen-topic-time').textContent()).trim();
        const play = box.locator('button.deep-play');
        assert.equal(await play.count(), 1);
        assert.equal((await play.textContent()).trim(), `▶ Play from ${time}`);
        assert.equal(await page.evaluate(() => document.activeElement?.matches('.track button.deep-play')), true);
        const url = new URL(page.url());
        assert.equal(url.pathname, link.path);
        assert.equal(url.search, '');
        assert.equal(decodeURIComponent(url.hash.slice(1)), link.box);
        // The box is on screen, near the top (the topic lists above it opened after the fragment scroll).
        const top = await box.evaluate((b) => b.getBoundingClientRect().top);
        assert.ok(top >= -2 && top < 200, `box top at ${top}`);
        // No autoplay.
        await page.waitForTimeout(700);
        assert.deepEqual(await page.$$eval('.track audio', (as) => as.filter((a) => !a.paused || a.currentTime > 0).length), 0);
        await page.screenshot({ path: path.join(shots, `classes-deep-link-${name}.png`) });
        // The button plays the class from the topic's exact start.
        if (name === 'phone') await play.tap();
        else await page.keyboard.press('Enter');
        await audioAt(page, audio, start);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  await check('topic deep link: the native play seeks to the target once; a topic click after arrival wins over the pending seek', async () => {
    const k = 2;
    const link = deepBox[k];
    const { context, page, errors } = await newPage(browser, base);
    try {
      let { items, audio } = await arrive(page, link.href);
      const start = Number(await items.nth(k).locator('button').getAttribute('data-start'));
      // The native controls' play (the same play event): seeks to the topic.
      await audio.evaluate((a) => a.play());
      await audioAt(page, audio, start);
      // Only the first play: later plays continue where the reader is.
      await audio.evaluate((a) => {
        a.pause();
        a.currentTime = 10;
      });
      await audio.evaluate((a) => a.play());
      await page.waitForTimeout(800);
      await audioAt(page, audio, 10, 2.5);

      // Again from the link, but the reader picks another topic first.
      ({ items, audio } = await arrive(page, link.href));
      const other = Number(await items.nth(k + 1).locator('button').getAttribute('data-start'));
      await items.nth(k + 1).locator('button').click();
      await audioAt(page, audio, other);
      await page.waitForTimeout(1000);
      await audioAt(page, audio, other, 2.5);
      assert.equal(await items.nth(k + 1).getAttribute('aria-current'), 'true');
      assert.equal(await items.nth(k).evaluate((li) => li.hasAttribute('aria-current') || li.classList.contains('is-selected')), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('a #class-… link without ?t opens the topics and shows the box, selecting nothing; so does a hashchange', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      const { box, audio } = await arrive(page, `${deepBox[0].path}#${deepBox[0].box}`);
      assert.equal(await box.locator('details[data-track-topics]').evaluate((d) => d.open), true);
      assert.equal(await page.locator('.deep-play, [data-track-topics] li[aria-current], [data-track-topics] li.is-selected').count(), 0);
      const top = await box.evaluate((b) => b.getBoundingClientRect().top);
      assert.ok(top >= -2 && top < 200, `box top at ${top}`);
      assert.equal(await audio.evaluate((a) => a.paused), true);
      // Another box on the same page, by hash.
      const other = await page.evaluate((id) => [...document.querySelectorAll('.track:has([data-track-topics])')].map((b) => b.id).filter((x) => x !== id).at(-1), deepBox[0].box);
      await page.evaluate((id) => (location.hash = `#${id}`), other);
      await page.waitForFunction((id) => document.getElementById(id).querySelector('[data-track-topics]').open, other);
      assert.equal(await page.locator('.deep-play').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  // ---------------- outlines pages ----------------
  const outlineSeries = fs.readdirSync(path.join(PUBLIC, 'outlines'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

  await check('outlines pages: every link (series, parts, chapters, Open class, every topic) points to an existing page and id', async () => {
    const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const ids = new Map();
    const idsOf = (file) => {
      if (!ids.has(file)) {
        const html = fs.readFileSync(file, 'utf8');
        ids.set(file, new Set([...html.matchAll(/\sid=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => decodeHtml(m[1] ?? m[2] ?? m[3]))));
      }
      return ids.get(file);
    };
    const pages = ['index.html', ...outlineSeries.map((s) => path.join(s, 'index.html'))];
    assert.ok(outlineSeries.length >= 1);
    let topics = 0;
    let links = 0;
    const broken = [];
    for (const rel of pages) {
      const pageUrl = new URL(`/outlines/${rel.replace(/index\.html$/, '')}`, 'http://x');
      const html = fs.readFileSync(path.join(PUBLIC, 'outlines', rel), 'utf8');
      // Only the page's own content: the header nav and footer are the same on every page.
      const main = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
      assert.ok(main.length > 0, `${rel} has a <main>`);
      for (const m of main.matchAll(/<a\s[^>]*?href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        const u = new URL(decodeHtml(m[1] ?? m[2] ?? m[3]), pageUrl);
        if (u.host !== 'x') continue;
        links++;
        let file = path.join(PUBLIC, decodeURIComponent(u.pathname));
        if (u.pathname.endsWith('/')) file = path.join(file, 'index.html');
        const id = decodeURIComponent(u.hash.slice(1));
        if (!fs.existsSync(file)) broken.push(`${rel}: ${u.pathname} (no page)`);
        else if (id && !idsOf(file).has(id)) broken.push(`${rel}: ${u.pathname}#${id} (no such id)`);
        if (u.searchParams.has('t')) {
          topics++;
          assert.match(u.searchParams.get('t'), /^\d+$/);
          assert.match(id, /^class-/);
        }
      }
    }
    assert.deepEqual(broken.slice(0, 20), [], `${broken.length} broken links`);
    // Every topic of every outlines page was checked: the counts the pages show add up.
    const index = fs.readFileSync(path.join(PUBLIC, 'outlines', 'index.html'), 'utf8');
    const shown = [...index.matchAll(/(\d+) topics/g)].reduce((n, m) => n + Number(m[1]), 0);
    assert.ok(topics > 100 && topics === shown, `${topics} topic links, the index says ${shown}`);
    assert.ok(links > topics);
  });

  await check('/outlines/ lists each series page; its links open the series page and part', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}/outlines/`);
      const cards = page.locator('.outline-series-card');
      assert.equal(await cards.count(), outlineSeries.length);
      const hrefs = await cards.locator('h2 a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      assert.deepEqual([...hrefs].sort(), outlineSeries.map((s) => `/outlines/${s}/`).sort());
      for (let i = 0; i < (await cards.count()); i++) assert.ok((await cards.nth(i).locator('.part-list a').count()) >= 1);
      // A part link: the series page, scrolled to that part.
      const part = cards.nth(0).locator('.part-list a').nth(1);
      const href = await part.getAttribute('href');
      await part.click();
      await page.waitForURL(`${base}${href}`);
      const id = new URL(href, base).hash.slice(1);
      const top = await page.locator(`[id="${id}"]`).evaluate((s) => s.getBoundingClientRect().top);
      assert.ok(top >= -2 && top < 100, `part top at ${top}`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  for (const [name, ctx] of [
    ['desktop', { viewport: { width: 1280, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ]) {
    await check(`outlines series page (${name}): renders collapsed; Expand/Collapse all; ${name === 'desktop' ? 'side nav' : '"Jump to", no sideways scroll'}; a topic opens its class with the topic selected`, async () => {
      const { context, page, errors } = await newPage(browser, base, { context: ctx });
      try {
        await page.goto(`${base}/outlines/rabbi-markel-series-advanced/`);
        assert.equal((await page.locator('h1').textContent()).trim(), 'Rabbi Markel Series (Advanced)');
        assert.ok((await page.locator('section.outline-part h2').count()) >= 2);
        assert.ok((await page.locator('section.outline-chapter h3').count()) >= 2);
        const classes = page.locator('details.outline-class');
        const n = await classes.count();
        assert.ok(n > 10);
        const open = () => classes.evaluateAll((ds) => ds.filter((d) => d.open).length);
        assert.equal(await open(), 0);
        // Expand all / Collapse all (shown by outlines.js).
        await page.locator('[data-outlines-expand]').waitFor();
        await page.locator('[data-outlines-expand]').click();
        assert.equal(await open(), n);
        assert.ok(await page.locator('ol.outline-topics a').first().isVisible());
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok((await overflow()) <= 0, `page scrolls sideways by ${await overflow()}px (all expanded)`);
        await page.screenshot({ path: path.join(shots, `outlines-expanded-${name}.png`) });
        await page.locator('[data-outlines-collapse]').click();
        assert.equal(await open(), 0);

        const side = page.locator('nav.outlines-nav');
        const jump = page.locator('details.outlines-jump');
        if (name === 'desktop') {
          assert.ok(await side.isVisible());
          assert.ok(await jump.isHidden());
          // Sticky: still there after scrolling far down.
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
          await page.waitForTimeout(300);
          const r = await side.boundingBox();
          assert.ok(r && r.y < 900 && r.y + r.height > 0, `side nav at ${JSON.stringify(r)}`);
          await page.evaluate(() => window.scrollTo(0, 0));
        } else {
          assert.ok(await side.isHidden());
          assert.ok(await jump.isVisible());
          await jump.locator('summary').tap();
          const a = jump.locator('a[data-outlines-part]').nth(1);
          assert.ok(await a.isVisible());
          assert.ok((await overflow()) <= 0, `page scrolls sideways by ${await overflow()}px`);
          await page.screenshot({ path: path.join(shots, `outlines-jump-${name}.png`) });
          const id = await a.getAttribute('data-outlines-part');
          await a.tap();
          await page.waitForFunction((id) => location.hash === `#${id}`, id);
          await page.waitForFunction((id) => Math.abs(document.getElementById(id).getBoundingClientRect().top) < 100, id);
        }

        // A topic link: the class page with that topic selected and Play from focused.
        const cls = classes.nth(3);
        await cls.locator('summary').click();
        const topic = cls.locator('ol.outline-topics a').nth(1);
        const href = await topic.getAttribute('href');
        const title = (await topic.textContent()).replace(/^\s*[\d:]+\s*/, '').trim();
        if (name === 'phone') await topic.tap();
        else await topic.click();
        const u = new URL(href, base);
        await page.waitForURL((url) => url.pathname === u.pathname);
        await page.waitForFunction(() => document.activeElement?.matches('.track button.deep-play'));
        const box = page.locator(`[id="${decodeURIComponent(u.hash.slice(1))}"]`);
        const sel = box.locator('[data-track-topics] li.is-selected');
        assert.equal(await sel.getAttribute('aria-current'), 'true');
        assert.equal((await sel.locator('button').textContent()).replace(/^\s*[\d:]+\s*/, '').trim(), title);
        assert.equal(new URL(page.url()).search, '');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  // ---------------- site nav ----------------
  await check('site nav: Outlines on English and Hebrew pages, no Translation; the Texts page links the translation', async () => {
    const pages = [
      ['index.html', 'Outlines'],
      ['texts/chapter-10/index.html', 'Outlines'],
      ['classes/index.html', 'Outlines'],
      ['outlines/index.html', 'Outlines'],
      ['he/index.html', 'תקצירי שיעורים'],
      ['he/texts/chapter-10/index.html', 'תקצירי שיעורים'],
    ];
    for (const [rel, label] of pages) {
      const html = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
      const nav = /<nav>([\s\S]*?)<\/nav>/.exec(html)?.[1];
      assert.ok(nav, `${rel}: site nav`);
      assert.match(nav, new RegExp(`<a href="?/outlines/"?>${label}</a>`), `${rel}: Outlines link`);
      assert.doesNotMatch(nav, /translation|Translation|תרגום/, `${rel}: no Translation item`);
    }
    const texts = fs.readFileSync(path.join(PUBLIC, 'texts', 'index.html'), 'utf8');
    assert.match(texts, /<a href="?\/translation\/"?>English translation/);
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}/he/texts/chapter-10/`);
      const link = page.locator('body > nav a[href="/outlines/"]');
      assert.ok(await link.isVisible());
      await link.click();
      await page.waitForURL(`${base}/outlines/`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
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
