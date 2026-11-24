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
 * class), the site nav (Outlines, Search, no Translation item) and search
 * (/search/ over the Pagefind index: transliterations, prefixes, filters,
 * links to a transcript paragraph and a chapter line) and the study guide
 * pages (/study/: built from the public edition only, no Markel or beta
 * anywhere else, every link into and out of them, every line, passage, phrase
 * and block of every guide with its times, readable without JS at desktop and
 * phone width, the Study nav item; with JS: the docked player, highlights
 * following seeks, follow's scroll, detach and Back to now, a far outOfPlace
 * block, class switch, ⏮15/15⏭, Autoplay next, arrival links that never
 * autoplay, phrase taps, blocked storage, phone width; the chapter player's
 * "Study guide →" pill; study passages in search).
 *
 *   E2E_ONLY=<regex> runs only the checks whose name matches.
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
/** E2E_ONLY=<regex>: run only the checks whose name matches (while working on one feature). */
const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;
async function check(name, fn) {
  if (only && !only.test(name)) return;
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

    await check('a line the chosen class does not read: marked, plays another class (Markel) and says so', async () => {
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
        const button = other.page.locator(`.line-play[data-line="${l.lineId}"]`);
        // The default teacher's first class is chosen and doesn't read this
        // line: the button is marked, but still plays (Markel), and says so.
        await other.page.waitForFunction((id) => document.querySelector(`.line-play[data-line="${id}"]`)?.classList.contains('is-other-class'), l.lineId);
        assert.match(await button.getAttribute('title'), /^Not in “.+”: plays another class$/);
        assert.equal(await button.getAttribute('aria-disabled'), null);
        await button.click();
        await waitTime(other.page, l.refs[0].startSeconds);
        assert.equal((await audioState(other.page)).src, ch.lectures[l.refs[0].lecture].url);
        assert.match(await other.page.locator('[data-listen-note]').textContent(), /^This line is not in “.+”; playing Rabbi Markel/);
        assert.equal(await other.page.locator('[data-listen-series]').inputValue(), '37');
        // Now Markel's class is chosen: its lines are no longer marked.
        assert.equal(await button.getAttribute('class'), 'line-play');
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
      // The playing line is the URL's fragment (replaceState: no history entry).
      await page.waitForFunction(() => location.hash === '#gbyeqivs');
      const pathBefore = new URL(page.url()).pathname;
      const historyBefore = await page.evaluate(() => history.length);
      await seek(page, refOf(chapter10.lines.find((l) => l.lineId !== 'gbyeqivs' && refOf(l.lineId, MARKEL_10)).lineId, MARKEL_10).startSeconds + 0.5);
      await page.waitForFunction(() => location.hash !== '#gbyeqivs');
      assert.equal(await page.evaluate(() => history.length), historyBefore);
      assert.equal(new URL(page.url()).pathname, pathBefore);
      assert.equal(await page.evaluate(() => document.getElementById(location.hash.slice(1))?.classList.contains('line')), true);
      await seek(page, r.startSeconds + 2);
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

  await check('a class\'s first line after its intro: plays the line and offers the start; a short lead-in is played; later lines offer nothing', async () => {
    const ch1 = readJson(path.join(DIST, 'alignments', 'chapters', 'chapter_01.json'));
    const at = (id) => ch1.lectures.findIndex((l) => l.id === id);
    const W11 = at('09 - Chap- 1-1 Chochmah Binah Daas.mp3');
    const W17 = at('15 - Chap- 1-7 Chochmah Binah Daas.mp3');
    const firstRef = (lineId, lecture) => ch1.lines.find((l) => l.lineId === lineId).refs.find((r) => r.lecture === lecture);
    // The data this check relies on: 1-1 reads its first line at 1:04, 1-7 at 0:13.
    assert.equal(ch1.lectures[W11].chapterStartSeconds, 0);
    const intro = firstRef('xazelgse', W11);
    const short = firstRef('wctxrksu', W17);
    assert.ok(intro.startSeconds >= 15 && short.startSeconds < 15 && short.startSeconds > 0);
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(`${base}/texts/chapter-1/`);
    await page.waitForSelector('.line-play');
    const offer = page.locator('[data-listen-from-start]');
    assert.ok(await offer.isHidden());

    await page.click('.line-play[data-line="xazelgse"]');
    await waitTime(page, intro.startSeconds);
    assert.equal((await audioState(page)).src, ch1.lectures[W11].url);
    await offer.waitFor({ state: 'visible' });
    assert.equal((await offer.textContent()).trim(), '⏮ From start of class (1:03 earlier)');
    await page.screenshot({ path: path.join(shots, 'from-start-offer.png') });
    await offer.click();
    await waitTime(page, 0);
    assert.ok(await offer.isHidden());
    assert.equal((await audioState(page)).paused, false);

    // Offered again on a new tap, then dropped once playback is past the line.
    await page.click('.line-play[data-line="xazelgse"]');
    await waitTime(page, intro.startSeconds);
    await offer.waitFor({ state: 'visible' });
    await seek(page, Math.max(intro.endSeconds, intro.startSeconds + 10) + 2);
    await offer.waitFor({ state: 'hidden' });

    // A lead-in under 15 s is played: from the start, nothing offered.
    await page.click('.line-play[data-line="wctxrksu"]');
    await waitTime(page, 0);
    assert.equal((await audioState(page)).src, ch1.lectures[W17].url);
    await page.waitForTimeout(300);
    assert.ok(await offer.isHidden());

    // Any later line of a class plays from itself with nothing offered.
    const later = ch1.lines.find((l) => l.refs.length === 1 && l.refs[0].lecture === W11 && l.refs[0].startSeconds > intro.startSeconds);
    await page.click(`.line-play[data-line="${later.lineId}"]`);
    await waitTime(page, later.refs[0].startSeconds);
    assert.ok(await offer.isHidden());
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check('a two-chapter class\'s first line on its later chapter (35): offers the start of its part on it; gone in another class', async () => {
    const ch35 = readJson(path.join(DIST, 'alignments', 'chapters', 'chapter_35.json'));
    const at = (id) => ch35.lectures.findIndex((l) => l.id === id);
    const M202 = at('202 Tape37-Side2-ch 34 35.mp3');
    const M203 = at('203 Tape38-side1 ch 35-.mp3');
    // The data this check relies on: 202 reads chapter 34, then chapter 35 from
    // its chapterStartSeconds; qcjf7kfw is its first chapter-35 line, well after that.
    const part = ch35.lectures[M202].chapterStartSeconds;
    const line = ch35.lines.find((l) => l.lineId === 'qcjf7kfw');
    const ref = line.refs.find((r) => r.lecture === M202);
    assert.equal(line.refs.length, 1);
    assert.equal(ref.startSeconds, Math.min(...ch35.lines.flatMap((l) => l.refs.filter((r) => r.lecture === M202).map((r) => r.startSeconds))));
    assert.ok(part > 0 && ref.startSeconds - part >= 15);
    assert.equal(ch35.lectures[M203].chapterStartSeconds, 0);
    assert.ok(ch35.lectures.every((l) => l.seriesId === ch35.lectures[M202].seriesId));
    const gap = Math.floor(ref.startSeconds - part);
    const mmss = `${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}`;

    // Nothing saved: the default teacher (Walters) has no classes here, so the
    // page shows Markel's, quietly (no note: nothing the reader chose was overridden).
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(`${base}/texts/chapter-35/`);
    await page.waitForSelector('.line-play');
    assert.equal(await page.locator('[data-listen-series]').inputValue(), ch35.lectures[M202].seriesId);
    assert.ok(await page.locator('[data-listen-note]').isHidden());
    const offer = page.locator('[data-listen-from-start]');
    assert.ok(await offer.isHidden());

    await page.click('.line-play[data-line="qcjf7kfw"]');
    await waitTime(page, ref.startSeconds);
    assert.equal((await audioState(page)).src, ch35.lectures[M202].url);
    await offer.waitFor({ state: 'visible' });
    assert.equal((await offer.textContent()).trim(), `⏮ From start of this chapter in the class (${mmss} earlier)`);
    await page.screenshot({ path: path.join(shots, 'from-start-chapter-offer.png') });
    await offer.click();
    await waitTime(page, part);
    assert.ok(await offer.isHidden());
    assert.equal((await audioState(page)).paused, false);
    assert.equal((await audioState(page)).src, ch35.lectures[M202].url);

    // Offered again on a new tap; another class in the Class selector drops it.
    await page.click('.line-play[data-line="qcjf7kfw"]');
    await waitTime(page, ref.startSeconds);
    await offer.waitFor({ state: 'visible' });
    await page.selectOption('[data-listen-select]', String(M203));
    await page.waitForFunction((u) => {
      const a = document.querySelector('[data-listen-audio]');
      return (a.currentSrc || a.src) === u && !a.paused;
    }, ch35.lectures[M203].url);
    await offer.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    // 203 has just started loading: let its media request end quietly.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
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
      // No navigation (the fragment follows the playing line).
      assert.equal(page.url().replace(/#.*/, ''), url.replace(/#.*/, ''));
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
    // The line is not in the chosen class, so the note explains the switch;
    // the bar itself (measured with the note hidden) stays compact.
    const bar = await page.evaluate(async () => {
      const note = document.querySelector('[data-listen-note]');
      const was = note.hidden;
      note.hidden = true;
      await new Promise(requestAnimationFrame);
      const panel = document.querySelector('[data-listen]').getBoundingClientRect().height;
      note.hidden = was;
      return { panel, innerHeight: window.innerHeight, note: !was };
    });
    assert.ok(bar.note, 'the note says the line is in another class');
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
        const entries = await page.evaluate(() => history.length);
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
        // The playing line is the URL's fragment (replaceState: no history entry).
        const lineHash = () => page.evaluate(() => decodeURIComponent(location.hash.slice(1)));
        assert.equal(await lineHash(), await preview.locator('.line.is-discussing').getAttribute('data-line'));
        assert.equal(await page.evaluate(() => history.length), entries);
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
        assert.equal(page.url().replace(/#.*/, ''), list);
        // The entry gone back to had an older fragment: the playing class puts its line back.
        await page.waitForFunction(
          (p) => location.hash.slice(1) === p.querySelector('.line.is-discussing')?.dataset.line,
          await preview.elementHandle(),
        );
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
        assert.equal(page.url().replace(/#.*/, ''), list);
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

  await check('a class page loaded with #<line id>: the first box aligning the line is shown, its text at the line, Play from focused; it plays there', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}${MARKEL_PART_1}`);
      // An aligned line of the third lesson box that no earlier box aligns.
      const { id, boxId, start } = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.track[data-lesson]')];
        const box = boxes[2];
        const earlier = new Set(boxes.slice(0, 2).flatMap((b) => [...b.querySelectorAll('.line[data-start]')].map((l) => l.dataset.line)));
        const lines = [...box.querySelectorAll('.line[data-start]')].filter((l) => !earlier.has(l.dataset.line));
        const line = lines[Math.floor(lines.length / 2)];
        return { id: line.dataset.line, boxId: box.id, start: Number(line.dataset.start) };
      });
      await page.goto('about:blank');
      await page.goto(`${base}${MARKEL_PART_1}#${id}`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      const box = page.locator(`[id="${boxId}"]`);
      const play = box.locator('button.deep-play');
      assert.equal(await play.count(), 1);
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.track button.deep-play')), true);
      const top = await box.evaluate((b) => b.getBoundingClientRect().top);
      assert.ok(top >= -2 && top < 200, `box top at ${top}`);
      const shown = await box.locator(`[data-lesson-text] .line[data-line="${id}"]`).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const p = el.closest('[data-lesson-text]').getBoundingClientRect();
        return r.bottom > p.top && r.top < p.bottom;
      });
      assert.ok(shown, 'the line is in view in the lesson text');
      const audio = box.locator('audio');
      assert.equal(await audio.evaluate((a) => a.paused), true);
      await play.click();
      await page.waitForFunction(([el, t]) => !el.paused && Math.abs(el.currentTime - t) < 1.5, [await audio.elementHandle(), start], { timeout: 15000 });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('a page loaded with #class-… (with and without ?t): closing the reader with Esc or browser Back returns focus to the link', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}${MARKEL_PART_1}`);
      // A box well down the page, with lesson text.
      const id = await page.evaluate(() => [...document.querySelectorAll('.track:has(a[data-lesson-open])')].map((b) => b.id).at(2));
      assert.ok(id, 'a third box with lesson text');
      for (const q of ['', '?t=0']) {
        await page.goto('about:blank'); // a real page load with the hash, not a fragment navigation
        const { box } = await arrive(page, `${MARKEL_PART_1}${q}#${encodeURIComponent(id)}`);
        const link = box.locator('a[data-lesson-open]').first();
        const reader = page.locator('.reader');
        const focusedLink = async (how) => {
          await reader.waitFor({ state: 'hidden' });
          // The history traversal moves focus to the body after popstate; classes.js takes it back.
          await page.waitForFunction((a) => document.activeElement === a, await link.elementHandle(), { timeout: 2000 }).catch(async () => {
            const on = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
            throw new Error(`${q || 'no ?t'}, ${how}: focus on ${on}`);
          });
          await page.waitForTimeout(300);
          assert.equal(await link.evaluate((a) => document.activeElement === a), true, `${q || 'no ?t'}, ${how}: focus moved away again`);
          assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(1)), id);
        };
        await link.click();
        await reader.locator('.line.in-lesson').first().waitFor();
        await reader.locator('.reader-back').focus();
        await page.keyboard.press('Escape');
        await focusedLink('Esc');
        await link.click();
        await reader.locator('.line.in-lesson').first().waitFor();
        await page.goBack();
        await focusedLink('browser Back');
      }
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
          // At the top of the page the first part is the current one.
          const currentPart = () => side.locator('a[aria-current]').evaluateAll((as) => as.map((a) => [a.dataset.outlinesPart, a.getAttribute('aria-current')]));
          const firstPart = await page.locator('section.outline-part').first().getAttribute('id');
          assert.deepEqual(await currentPart(), [[firstPart, 'location']]);
          // Sticky: still there after scrolling far down.
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
          await page.waitForTimeout(300);
          const r = await side.boundingBox();
          assert.ok(r && r.y < 900 && r.y + r.height > 0, `side nav at ${JSON.stringify(r)}`);
          const later = await currentPart();
          assert.ok(later.length === 1 && later[0][0] !== firstPart && later[0][1] === 'location', JSON.stringify(later));
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

  // ---------------- study guide pages ----------------
  const studyIndex = readJson(path.join(DIST, 'study', 'index.json'));
  const studyGuides = studyIndex.series.flatMap((s) =>
    s.chapters.map((c) => ({ series: s, entry: c, url: `/study/${s.id}/chapter-${Number(c.chapter.slice(8))}/`, guide: readJson(path.join(DIST, c.path)) })),
  );
  const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const htmlIds = new Map();
  const idsIn = (file) => {
    if (!htmlIds.has(file)) {
      const html = fs.readFileSync(file, 'utf8');
      htmlIds.set(file, new Set([...html.matchAll(/\sid=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => decodeEntities(m[1] ?? m[2] ?? m[3]))));
    }
    return htmlIds.get(file);
  };
  /** Every built HTML page outside /data/, relative to PUBLIC. */
  const allPages = (() => {
    const out = [];
    const walk = (dir) => {
      for (const d of fs.readdirSync(path.join(PUBLIC, dir), { withFileTypes: true })) {
        const rel = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (rel !== 'data' && rel !== 'pagefind') walk(rel);
        } else if (d.name.endsWith('.html')) out.push(rel);
      }
    };
    walk('');
    return out;
  })();
  const lectureSlug = (id) => id.toLowerCase().replace(/\.(mp3|m4a)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const chapterLineIds = (key) => {
    const ids = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (!n.children) continue;
        for (const c of n.children) if (!c.children) ids.push(c.id);
        walk(n.children);
      }
    };
    walk(readJson(path.join(SITE, '..', 'data', 'chapters', `${key}.json`)));
    return ids;
  };

  await check('study pages: /study/, each public series and guide is built; nothing but the public edition (no Markel, no beta, no sensitivity) outside /data/study-beta/', async () => {
    assert.ok(studyGuides.length >= 20, `${studyGuides.length} public guides`);
    assert.ok(fs.existsSync(path.join(PUBLIC, 'study', 'index.html')));
    for (const s of studyIndex.series) assert.ok(fs.existsSync(path.join(PUBLIC, 'study', s.id, 'index.html')), s.id);
    for (const g of studyGuides) assert.ok(fs.existsSync(path.join(PUBLIC, g.url, 'index.html')), g.url);
    const built = fs.readdirSync(path.join(PUBLIC, 'study'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.deepEqual(built.sort(), studyIndex.series.map((s) => s.id).sort(), 'study series pages = the public index');
    // The beta export is published (unlisted), and Markel (series 37) is in it but not public.
    const beta = readJson(path.join(PUBLIC, 'data', 'study-beta', 'v1', 'study', 'index.json'));
    assert.ok(beta.series.some((s) => s.id === 'markel-advanced'), 'the beta export lists markel-advanced');
    assert.ok(!studyIndex.series.some((s) => s.id === 'markel-advanced' || s.catalogSeriesId === '37'), 'markel-advanced is not public');
    const leaks = [];
    const walk = (dir) => {
      for (const d of fs.readdirSync(path.join(PUBLIC, dir), { withFileTypes: true })) {
        const rel = path.join(dir, d.name);
        if (d.isDirectory()) {
          // The JSON Schemas describe both editions, so they name the beta.
          if (![path.join('data', 'study-beta'), path.join('data', 'v1', 'schema'), 'pagefind'].includes(rel)) walk(rel);
        } else if (/\.(html|js|css|json|xml|txt)$/.test(d.name)) {
          const text = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
          if (/markel-advanced|study-beta/.test(text) && rel !== '_headers') leaks.push(rel);
        }
      }
    };
    walk('');
    assert.deepEqual(leaks, []);
    // The published guides the pages are built from carry no sensitivity flags.
    for (const g of studyGuides) {
      for (const b of g.guide.sections.flatMap((s) => s.passages.flatMap((p) => p.blocks))) assert.ok(!('sensitivity' in b), `${g.url}: a block with sensitivity`);
    }
  });

  await check('study pages: every link to a study page (chapter pages, class boxes, transcripts, outlines, /texts, nav) and every link on one resolves to an existing page, id and class', async () => {
    const broken = [];
    const into = new Map();
    let links = 0;
    for (const rel of allPages) {
      const pageUrl = new URL(`/${rel.replace(/index\.html$/, '')}`, 'http://x');
      const html = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
      const isStudy = rel.startsWith(`study${path.sep}`);
      const main = isStudy ? html.slice(html.indexOf('<main'), html.lastIndexOf('</main>')) : html;
      for (const m of main.matchAll(/<a\s[^>]*?href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        const u = new URL(decodeEntities(m[1] ?? m[2] ?? m[3]), pageUrl);
        if (u.host !== 'x') continue;
        if (!isStudy && !u.pathname.startsWith('/study/')) continue;
        links++;
        if (u.pathname.startsWith('/study/') && !isStudy) {
          const kind = rel.split(path.sep)[0];
          into.set(kind, (into.get(kind) ?? 0) + 1);
        }
        let file = path.join(PUBLIC, decodeURIComponent(u.pathname));
        if (u.pathname.endsWith('/')) file = path.join(file, 'index.html');
        const id = decodeURIComponent(u.hash.slice(1));
        if (!fs.existsSync(file)) {
          broken.push(`${rel}: ${u.pathname} (no page)`);
          continue;
        }
        if (id && !idsIn(file).has(id)) broken.push(`${rel}: ${u.pathname}#${id} (no such id)`);
        const cls = u.searchParams.get('class');
        if (cls) {
          const g = studyGuides.find((x) => x.url === u.pathname);
          if (!g?.entry.lectures.some((l) => lectureSlug(l.id) === cls)) broken.push(`${rel}: ${u.pathname}?class=${cls} (not a class of the guide)`);
        }
      }
    }
    assert.deepEqual(broken.slice(0, 20), [], `${broken.length} broken links`);
    // Links come in from every kind of page that should have them.
    for (const kind of ['texts', 'he', 'classes', 'outlines', 'study']) assert.ok((into.get(kind) ?? 0) > 0 || kind === 'study', `links to the guides from /${kind}/ (${[...into]})`);
    assert.ok(links > 1000, `${links} links checked`);
    // Chapter pages: one "Study guide: <teacher>" line per guide of the chapter.
    for (const g of studyGuides) {
      const n = Number(g.entry.chapter.slice(8));
      const html = fs.readFileSync(path.join(PUBLIC, 'texts', `chapter-${n}`, 'index.html'), 'utf8');
      assert.match(html, new RegExp(`class="?study-guide-link"?>Study guide: <a href="?${g.url}"?><bdi lang="?en"?>${g.series.teacher}</bdi>`), `chapter ${n}`);
    }
    // A class box of a guided class links its guide with ?class=.
    const g = studyGuides[0];
    const l = g.entry.lectures[0];
    const anyPart = allPages.filter((p) => p.startsWith(`classes${path.sep}`)).find((p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8').includes(`${g.url}?class=${lectureSlug(l.id)}`));
    assert.ok(anyPart, `a class page links ${g.url}?class=${lectureSlug(l.id)}`);
  });

  await check('study guide pages: every chapter line once (span.line id), every passage, phrase and block, with times; no writer notes (outOfPlace)', async () => {
    const { context, page, errors } = await newPage(browser, base, { context: { viewport: { width: 1280, height: 900 }, javaScriptEnabled: false } });
    try {
      for (const g of studyGuides) {
        await page.goto(`${base}${g.url}`);
        const got = await page.evaluate(() => ({
          lineIds: [...document.querySelectorAll('.study-text span.line[id]')].map((e) => e.id),
          passages: [...document.querySelectorAll('.study-passage')].map((e) => e.id),
          phrases: [...document.querySelectorAll('.phrase')].map((e) => [e.dataset.lecture ?? null, e.dataset.start ?? null, e.dataset.end ?? null]),
          blocks: [...document.querySelectorAll('.study-block')].map((e) => [e.id, e.dataset.kind, e.dataset.lecture, e.dataset.start, e.dataset.end, e.dataset.outOfPlace ?? null]),
          audio: [...document.querySelectorAll('audio')].map((a) => a.getAttribute('src')),
          classAudio: [...document.querySelectorAll('li.study-class audio')].filter((a) => !a.hidden).map((a) => a.getAttribute('src')),
          text: document.body.innerText,
          ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
        }));
        const label = g.url;
        assert.equal(new Set(got.ids).size, got.ids.length, `${label}: duplicate ids`);
        const lines = chapterLineIds(g.entry.chapter);
        const guideLines = g.guide.sections.flatMap((s) => s.passages.flatMap((p) => p.lines));
        assert.deepEqual(got.lineIds, guideLines.filter((id, i) => lines.includes(id) && guideLines.indexOf(id) === i), `${label}: line ids`);
        if (!g.entry.stale) assert.deepEqual(got.lineIds, lines, `${label}: every chapter line, in order`);
        const passages = g.guide.sections.flatMap((s) => s.passages);
        assert.deepEqual(got.passages, passages.map((p) => `s-${p.lines[0]}`), `${label}: passages`);
        const phrases = passages.flatMap((p) => p.phrases ?? []);
        assert.deepEqual(got.phrases, phrases.map((p) => (p.en ? [p.lecture, String(p.start), String(p.end)] : [null, null, null])), `${label}: phrases`);
        const blocks = passages.flatMap((p) => p.blocks.map((b, i) => [`b-${p.lines[0]}-${i + 1}`, b.kind, b.audio[0].lecture, String(b.audio[0].start), String(b.audio[0].end), b.outOfPlace ? '1' : null]));
        assert.deepEqual(got.blocks, blocks, `${label}: blocks`);
        for (const b of passages.flatMap((p) => p.blocks)) if (b.outOfPlace) assert.ok(!got.text.includes(b.outOfPlace), `${label}: shows a writer's outOfPlace note`);
        assert.equal(got.audio.length, g.entry.lectures.length + 1, `${label}: one <audio> per class, and the docked player's`);
        assert.equal(got.classAudio.length, g.entry.lectures.length, `${label}: one <audio> per class in the class list`);
        if (g.entry.status === 'draft') assert.match(got.text, new RegExp(`Machine-drafted from ${g.series.teacher}’ class and not yet checked against it\\. The recording is the source\\.`));
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  for (const [name, ctx] of [
    ['desktop', { viewport: { width: 1280, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ]) {
    await check(`study guide page without JS (${name}): readable, no sideways scroll, ${name === 'desktop' ? 'side nav' : '"Jump to"'}; ▶ links open the recording at the block; anchors land`, async () => {
      const { context, page, errors } = await newPage(browser, base, { context: { ...ctx, javaScriptEnabled: false } });
      try {
        const g = studyGuides.find((x) => x.entry.chapter === 'chapter_10') ?? studyGuides[0];
        await page.goto(`${base}${g.url}`);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('h1').textContent(), g.guide.title);
        assert.ok(await page.locator('.study-notice').first().isVisible());
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), ctx.viewport.width, 'no sideways scroll');
        const side = page.locator('nav.study-nav');
        const jump = page.locator('details.study-jump');
        assert.equal(await side.isVisible(), name === 'desktop');
        assert.equal(await jump.isVisible(), name !== 'desktop');
        const sections = g.guide.sections.length;
        assert.equal(await side.locator('a[href^="#sec-"]').count(), sections);
        // Hebrew in Taamey D, right to left; the teacher's English left to right.
        const he = await page.locator('.study-text').first().evaluate((e) => [e.getAttribute('lang'), getComputedStyle(e).direction, getComputedStyle(e).fontFamily]);
        assert.deepEqual(he.slice(0, 2), ['he', 'rtl']);
        assert.match(he[2], /Taamey D/);
        assert.equal(await page.locator('.phrase-en').first().evaluate((e) => getComputedStyle(e).direction), 'ltr');
        // A block's ▶ is a link to the class recording at the block's start.
        const block = page.locator('.study-block[data-start]').nth(3);
        const [lecture, start] = await block.evaluate((e) => [e.dataset.lecture, e.dataset.start]);
        const href = await block.locator('a.study-play').first().getAttribute('href');
        const catalogUrl = await page.locator(`li.study-class[data-lecture="${lecture}"] audio`).getAttribute('src');
        assert.equal(href, `${catalogUrl}#t=${start}`);
        // Anchors: a passage, a block and a line.
        const p = g.guide.sections[1].passages[0];
        for (const id of [`s-${p.lines[0]}`, `b-${p.lines[0]}-1`, p.lines[0]]) {
          await page.goto(`${base}${g.url}#${id}`);
          const top = await page.locator(`[id="${id}"]`).evaluate((e) => e.getBoundingClientRect().top);
          assert.ok(top >= -2 && top < 120, `#${id} at ${top}`);
        }
        await page.goto(`${base}${g.url}`);
        await page.screenshot({ path: path.join(shots, `study-top-${name}.png`) });
        await page.goto(`${base}${g.url}#s-${p.lines[0]}`);
        await page.screenshot({ path: path.join(shots, `study-passage-${name}.png`) });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  // ---------------- study guide pages with JS (study.ts) ----------------
  // The timing model the page uses (study-model.ts) picks the moments to test.
  const { pathToFileURL } = require('node:url');
  const studyModel = await import(pathToFileURL(path.join(SITE, 'hugo', 'assets', 'js', 'audio', 'study-model.ts')).href);
  const { formatTime } = await import(pathToFileURL(path.join(SITE, 'hugo', 'assets', 'js', 'audio', 'model.ts')).href);
  const g10 = studyGuides.find((x) => x.entry.chapter === 'chapter_10');
  const g10Passages = studyModel.guidePassages(g10.guide);
  const parts10 = g10.entry.lectures;
  const g10Sections = g10.guide.sections.flatMap((s) => s.passages.map(() => s.title));
  /** "i.bj" (the model's default block key) -> the block's element id. */
  const blockElId = (key) => {
    const [i, j] = key.split('.b').map(Number);
    return `b-${g10Passages[i].lines[0]}-${j + 1}`;
  };
  /** Every whole second of a lecture's part with the model's position. */
  const momentsOf = (lecture, passages = g10Passages) => {
    const part = parts10.find((p) => p.id === lecture);
    const tl = studyModel.studyTimeline(passages, lecture, part);
    const out = [];
    for (let t = Math.ceil(part.start); t < part.end; t++) out.push({ t, tl, ...studyModel.studyAt(tl, t) });
    return out;
  };
  /** Moments of a lecture when a block (in place) alone is current, at least 3 s into it, one per block. */
  const blockMoments = (lecture) => {
    const seen = new Set();
    return momentsOf(lecture).flatMap((m) => {
      if (m.state !== 'playing' || m.phrase !== null || m.block === null || m.outOfPlace || seen.has(m.block)) return [];
      const it = m.tl.byKey.get(m.block);
      if (it.kind !== 'block' || m.t - it.start < 3 || it.end - m.t < 3) return [];
      seen.add(m.block);
      return [{ t: m.t, passage: m.passage, block: m.block, id: blockElId(m.block), start: it.start, end: it.end }];
    });
  };
  /** Moments when a phrase is current, within a second of its start. */
  const phraseMoments = (lecture) =>
    momentsOf(lecture).flatMap((m) => {
      if (m.state !== 'playing' || m.phrase === null) return [];
      const it = m.tl.byKey.get(m.phrase);
      if (m.t - it.start > 1) return [];
      const [i, j] = m.phrase.split('.p').map(Number);
      return [{ t: m.t, passage: m.passage, start: it.start, line: g10Passages[i].phrases[j].lines[0] }];
    });
  /** Where the page plays a block of g10 from ("i.bj" key), with `player` in the player. */
  const blockSeek = (key, player) => {
    const [i, j] = key.split('.b').map(Number);
    return studyModel.studySeekTarget(g10Passages, parts10, { passage: i, block: j }, player);
  };
  const STUDY_AUDIO = '[data-study-audio]';
  const studyState = (page) =>
    page.evaluate((sel) => {
      const a = document.querySelector(sel);
      const bar = document.querySelector('[data-study-player]');
      const pill = document.querySelector('[data-study-back-now]');
      return {
        src: a.getAttribute('src'),
        t: a.currentTime,
        paused: a.paused,
        lecture: document.querySelector('[data-study-select]').value,
        docked: bar.classList.contains('is-active'),
        listenH: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--listen-h')) || 0,
        barH: bar.getBoundingClientRect().height,
        current: [...document.querySelectorAll('.is-discussing')].map((e) => (e.id ? e.id : `phrase@${e.dataset.lecture}@${Number(e.dataset.start)}`)),
        ariaCurrent: [...document.querySelectorAll('.is-discussing')].every((e) => e.getAttribute('aria-current') === 'true'),
        now: document.querySelector('[data-study-now-text]').textContent,
        live: document.querySelector('[data-study-live]').textContent,
        hash: location.hash,
        search: location.search,
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        pill: pill.hidden ? null : pill.textContent,
        focus: document.activeElement?.id || document.activeElement?.className || '',
        focusText: document.activeElement?.matches('button') ? document.activeElement.textContent : '',
        note: document.querySelector('[data-study-note]').hidden ? null : document.querySelector('[data-study-note]').textContent,
      };
    }, STUDY_AUDIO);
  /** The top of an element relative to the visible area (above the docked player). */
  const topOf = (page, id) =>
    page.evaluate((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      const bar = document.querySelector('[data-study-player]');
      const visible = window.innerHeight - (bar.classList.contains('is-active') ? bar.offsetHeight : 0);
      return { top: r.top, bottom: r.bottom, visible };
    }, id);
  const studySeek = async (page, t) => {
    await page.evaluate(([sel, t]) => (document.querySelector(sel).currentTime = t), [STUDY_AUDIO, t]);
    await page.waitForFunction(
      ([sel, t]) => {
        const a = document.querySelector(sel);
        return !a.seeking && Math.abs(a.currentTime - t) < 1.5;
      },
      [STUDY_AUDIO, t],
      { timeout: 15000 },
    );
    await page.waitForTimeout(400);
  };
  const waitPlaying = (page, t, tol = 1.5) =>
    page.waitForFunction(
      ([sel, t, tol]) => {
        const a = document.querySelector(sel);
        return !a.paused && Math.abs(a.currentTime - t) < tol;
      },
      [STUDY_AUDIO, t, tol],
      { timeout: 15000 },
    );
  /** Plays a block from its own ▶ (the first in the block: its head's). */
  const playBlock = async (page, id) => {
    await page.locator(`[id="${id}"] a.study-play`).first().click();
  };
  const reduced = { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' };

  await check('study guide with JS: one docked player for the chapter\'s classes; a block\'s ▶ plays it there; highlights (aria-current), progress, Now:, the live region and the URL follow seeks; never autoplays', async () => {
    const { context, page, errors } = await newPage(browser, base, { context: reduced });
    try {
      await page.goto(`${base}${g10.url}`);
      await page.locator('[data-study-player]').waitFor();
      assert.deepEqual(await page.$$eval('[data-study-select] option', (os) => os.map((o) => o.value)), parts10.map((p) => p.id), 'the chapter\'s classes, in index order');
      assert.equal(await page.locator('li.study-class audio:visible').count(), 0, 'the class list\'s own players are hidden');
      await page.waitForTimeout(500);
      let s = await studyState(page);
      assert.equal(s.paused, true, 'never autoplays');
      assert.equal(s.docked, false);
      assert.equal(s.listenH, 0);
      assert.equal(s.src, await page.getAttribute(`li.study-class[data-lecture="${parts10[0].id}"]`, 'data-url'), 'the first class is in the player');

      const L = parts10[2].id;
      const tl = studyModel.studyTimeline(g10Passages, L, parts10[2]);
      const mid = (b) => Math.round((b.start + b.end) / 2);
      const m = blockMoments(L).find((b) => b.end - b.start > 20 && studyModel.studyAt(tl, mid(b)).block === b.block && studyModel.studyAt(tl, mid(b) + 1).block === b.block);
      assert.ok(m, 'a long block of Part 3');
      await playBlock(page, m.id);
      await waitPlaying(page, blockSeek(m.block, parts10[0].id).seekSeconds);
      await page.waitForTimeout(400);
      s = await studyState(page);
      assert.equal(s.lecture, L);
      assert.ok(s.docked && s.listenH > 0 && Math.abs(s.listenH - s.barH) < 2, 'docked, with --listen-h');
      assert.ok(s.current.includes(m.id), `the block is current (${s.current})`);
      assert.ok(s.ariaCurrent);

      // Into the block: its progress, the section, the passage's line in the URL.
      await studySeek(page, mid(m));
      s = await studyState(page);
      assert.ok(s.current.includes(m.id), `still the block at ${mid(m)} (${s.current})`);
      const p = Number(await page.locator(`[id="${m.id}"]`).evaluate((e) => e.style.getPropertyValue('--p')));
      const want = (mid(m) - m.start) / (m.end - m.start);
      assert.ok(Math.abs(p - want) < 0.1, `--p ${p} ~ ${want}`);
      assert.equal(s.now, `Now: ${g10Sections[m.passage]}`);
      assert.equal(s.live, `Now: ${g10Sections[m.passage]}`, 'the live region names the section');
      assert.equal(s.hash, `#${g10Passages[m.passage].lines[0]}`);

      // A phrase: tinted, its line in the URL; one block and one phrase at most.
      const ph = phraseMoments(L).find((x) => x.passage !== m.passage) ?? phraseMoments(L)[0];
      await studySeek(page, ph.t);
      s = await studyState(page);
      assert.ok(s.current.includes(`phrase@${L}@${ph.start}`), `the phrase is current (${s.current})`);
      assert.equal(s.current.filter((c) => c.startsWith('phrase@')).length, 1);
      assert.ok(s.ariaCurrent);
      assert.equal(s.hash, `#${ph.line}`);
      assert.match(await page.locator('.phrase.is-discussing').evaluate((e) => getComputedStyle(e).backgroundColor), /rgb\(253, 243, 216\)/);

      // Paused: the highlight and the URL stay.
      await page.evaluate((sel) => document.querySelector(sel).pause(), STUDY_AUDIO);
      await page.waitForTimeout(300);
      const after = await studyState(page);
      assert.deepEqual([after.current, after.hash], [s.current, s.hash]);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('study guide follow: a new off-screen block scrolls to 25%; scrolling it away detaches (Back to now, nothing moves) until the pill; a reader scroll pauses it; Follow off and on', async () => {
    const { context, page, errors } = await newPage(browser, base, { context: reduced });
    try {
      await page.goto(`${base}${g10.url}`);
      const L = parts10[4].id;
      const bm = blockMoments(L);
      const [a, c, d, e] = [bm[0], bm[Math.floor(bm.length / 3)], bm[Math.floor((2 * bm.length) / 3)], bm[bm.length - 1]];
      assert.ok(new Set([a.id, c.id, d.id, e.id]).size === 4, 'four blocks');
      await playBlock(page, a.id);
      await waitPlaying(page, blockSeek(a.block, parts10[0].id).seekSeconds);

      // Follow: a block that is not on screen is scrolled to 25% of the visible area.
      await studySeek(page, c.t);
      let r = await topOf(page, c.id);
      assert.ok(Math.abs(r.top - 0.25 * r.visible) < 30, `block top at ${r.top} of ${r.visible}`);

      // The reader scrolls the current block away: detached, Back to now.
      await page.mouse.move(640, 300);
      await page.mouse.wheel(0, -5000);
      await page.waitForTimeout(700);
      let s = await studyState(page);
      assert.match(s.pill ?? '', /^↓ Back to now · |^↑ Back to now · /);
      r = await topOf(page, c.id);
      assert.ok(r.top > r.visible, 'the block is below the screen');
      assert.match(s.pill, /^↓/);
      const y = s.scrollY;
      await studySeek(page, d.t);
      await page.waitForTimeout(600);
      s = await studyState(page);
      assert.equal(s.scrollY, y, 'detached: the page stays put');
      assert.ok(s.current.includes(d.id), 'highlights still follow');
      assert.ok(s.pill, 'the pill stays');
      await page.click('[data-study-back-now]');
      await page.waitForTimeout(400);
      s = await studyState(page);
      r = await topOf(page, d.id);
      assert.ok(r.top >= 0 && r.bottom > 0 && r.top < r.visible / 2, `back to the block (${r.top})`);
      assert.equal(s.pill, null);
      assert.equal(s.focus, await page.locator(`[id="${d.id}"]`).evaluate((e) => e.closest('div.study-block').id), 'focus moves to the block');

      // A small scroll by the reader (the block stays on screen): the next block does not scroll the page.
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(300);
      const y2 = (await studyState(page)).scrollY;
      await studySeek(page, e.t);
      await page.waitForTimeout(500);
      s = await studyState(page);
      assert.equal(s.scrollY, y2, 'quiet for 5 s after the reader scrolls');
      assert.equal(s.pill, null, 'not detached by a scroll that kept the item on screen');

      // Follow off (saved) and on again: on scrolls to the current block.
      await page.click('[data-study-follow]');
      assert.equal(await page.getAttribute('[data-study-follow]', 'aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.followAlong')), 'off');
      await page.click('[data-study-follow]');
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => localStorage.getItem('shaarHayichud.audio.followAlong')), 'on');
      r = await topOf(page, e.id);
      assert.ok(Math.abs(r.top - 0.25 * r.visible) < 30, `Follow on shows the block (${r.top})`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('study guide follow: an outOfPlace block far from the passage followed is highlighted, not scrolled to ("Now: aside on another passage · Go to")', async () => {
    // No public guide has one today, so one is made: the last passage's first
    // block gets a time inside a block of Part 2 and outOfPlace.
    const L = parts10[1].id;
    const last = g10Passages.length - 1;
    const fakeId = `b-${g10Passages[last].lines[0]}-1`;
    let pick = null;
    for (const m of blockMoments(L)) {
      if (Math.abs(m.passage - last) <= 1) continue;
      const start = m.start + 2;
      const passages = g10Passages.map((p, i) =>
        i === last ? { ...p, blocks: p.blocks.map((b, j) => (j === 0 ? { ...b, outOfPlace: 'x', audio: [{ lecture: L, start, end: start + 10 }] } : b)) } : p,
      );
      const tl = studyModel.studyTimeline(passages, L, parts10[1]);
      const at = studyModel.studyAt(tl, start + 0.7);
      const before = studyModel.studyAt(tl, start - 1.5);
      if (at.block === `${last}.b0` && at.phrase === null && at.outOfPlace && before.block === m.block && before.phrase === null) {
        pick = { m, start };
        break;
      }
    }
    assert.ok(pick, 'a block of Part 2 to borrow a time from');
    const { context, page, errors } = await newPage(browser, base, { context: reduced });
    try {
      await page.addInitScript(
        ([id, lecture, start]) => {
          new MutationObserver((_, obs) => {
            const el = document.getElementById(id);
            if (!el) return;
            Object.assign(el.dataset, { lecture, start: String(start), end: String(start + 10), outOfPlace: '1' });
            obs.disconnect();
          }).observe(document, { childList: true, subtree: true });
        },
        [fakeId, L, pick.start],
      );
      await page.goto(`${base}${g10.url}`);
      await playBlock(page, pick.m.id);
      await waitPlaying(page, blockSeek(pick.m.block, parts10[0].id).seekSeconds);
      await studySeek(page, pick.start - 1.5);
      // Played on (not a seek, which would follow the new position at once).
      const y = (await studyState(page)).scrollY;
      await page.waitForFunction(([sel, t]) => document.querySelector(sel).currentTime > t, [STUDY_AUDIO, pick.start + 0.6], { timeout: 10000 });
      await page.waitForTimeout(300);
      const s = await studyState(page);
      assert.ok(s.current.includes(fakeId), `the far block is highlighted (${s.current})`);
      assert.equal(s.now, 'Now: aside on another passage');
      assert.ok(await page.locator('[data-study-goto]').isVisible(), 'Go to');
      assert.equal(s.scrollY, y, 'the page stays put');
      await page.click('[data-study-goto]');
      await page.waitForTimeout(300);
      const r = await topOf(page, fakeId);
      assert.ok(r.top >= 0 && r.top < r.visible / 2, `Go to shows it (${r.top})`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('study guide: switching class plays it from its part, ⏮15 / 15⏭, Autoplay next plays the next class from 0:00 and after the last offers the next chapter\'s guide', async () => {
    const { context, page, errors } = await newPage(browser, base, { context: reduced });
    try {
      await page.goto(`${base}${g10.url}`);
      const b1 = blockMoments(parts10[0].id)[1];
      await playBlock(page, b1.id);
      await waitPlaying(page, blockSeek(b1.block, parts10[0].id).seekSeconds);
      await page.selectOption('[data-study-select]', parts10[1].id);
      await waitPlaying(page, parts10[1].start);
      let s = await studyState(page);
      const url = await page.getAttribute(`li.study-class[data-lecture="${parts10[1].id}"]`, 'data-url');
      assert.equal(s.src, url);
      assert.ok(!s.current.includes(b1.id), 'the other class\'s block is no longer current');
      const b2 = blockMoments(parts10[1].id)[1];
      await studySeek(page, b2.t);
      assert.ok((await studyState(page)).current.includes(b2.id));

      const t0 = (await studyState(page)).t;
      await page.click('[data-study-skip="15"]');
      await page.waitForFunction(([sel, t]) => Math.abs(document.querySelector(sel).currentTime - t) < 1.5, [STUDY_AUDIO, t0 + 15]);
      await page.click('[data-study-skip="-15"]');
      await page.waitForFunction(([sel, t]) => Math.abs(document.querySelector(sel).currentTime - t) < 2.5, [STUDY_AUDIO, t0]);

      // Autoplay next (the shared setting).
      await page.check('[data-study-player] [data-autoplay-next]');
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), AUTOPLAY_KEY), 'on');
      const n = parts10.length;
      await page.selectOption('[data-study-select]', parts10[n - 2].id);
      await waitPlaying(page, parts10[n - 2].start);
      const audio = await page.locator(STUDY_AUDIO).elementHandle();
      await playToEnd(audio);
      await page.waitForFunction(([sel, id]) => document.querySelector('[data-study-select]').value === id && !document.querySelector(sel).paused, [STUDY_AUDIO, parts10[n - 1].id], { timeout: 15000 });
      s = await studyState(page);
      assert.ok(s.t < 5, `from the start (${s.t})`);
      const label = await page.getAttribute(`li.study-class[data-lecture="${parts10[n - 1].id}"]`, 'data-label');
      assert.equal(s.note, `Playing next: ${label}`);
      await playToEnd(audio);
      await page.waitForFunction((sel) => document.querySelector(sel).ended, STUDY_AUDIO, { timeout: 15000 });
      await page.waitForTimeout(300);
      s = await studyState(page);
      assert.equal(s.note, 'That was the last class on this chapter.');
      const next = studyGuides.find((x) => x.series.id === g10.series.id && x.entry.chapter === 'chapter_11');
      const link = page.locator('[data-study-next]');
      assert.ok(await link.isVisible(), 'a link to the next chapter\'s guide');
      assert.equal(await link.getAttribute('href'), next.url);
      assert.equal(await link.textContent(), 'Next: Chapter 11’s guide →');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('study guide arrival: ?class=&t= and #<line id> / #s-… mark the item with a focused "▶ Play from" (the player\'s own play starts there too); ?class= alone shows its divider; never autoplays; the parameters are dropped', async () => {
    const { context, page, errors } = await newPage(browser, base, { context: reduced });
    try {
      const L = parts10[3].id;
      const m = blockMoments(L)[2];
      const arrive = async (u) => {
        await page.goto('about:blank');
        await page.goto(`${base}${g10.url}${u}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(400);
        return studyState(page);
      };
      // A moment of a class.
      let s = await arrive(`?class=${lectureSlug(L)}&t=${m.t}`);
      assert.equal(s.search, '', 'class and t dropped');
      assert.equal(s.paused, true, 'never autoplays');
      assert.equal(s.lecture, L);
      assert.equal(s.focusText, `▶ Play from ${formatTime(m.t)}`);
      assert.deepEqual(await page.$$eval('.is-selected', (els) => els.map((e) => e.id)), [m.id]);
      let r = await topOf(page, m.id);
      assert.ok(r.top > 0 && r.top < r.visible, `the block is shown (${r.top})`);
      await page.waitForTimeout(800);
      assert.equal((await studyState(page)).paused, true);
      // The player's own play button starts there.
      await page.evaluate((sel) => document.querySelector(sel).play(), STUDY_AUDIO);
      await waitPlaying(page, m.t, 2);
      await page.waitForTimeout(300);
      assert.ok((await studyState(page)).current.includes(m.id));

      // A line: where its passage's first phrase on it plays from.
      const onFirstLine = (p) => (p.phrases ?? []).findIndex((ph) => (p.lines.includes(ph.lines[0]) ? ph.lines[0] : p.lines[0]) === p.lines[0]);
      const k = g10Passages.findIndex((p, i) => {
        const ph = p.phrases?.[onFirstLine(p)];
        return i > 10 && ph?.en && typeof ph.start === 'number';
      });
      const line = g10Passages[k].lines[0];
      const j = onFirstLine(g10Passages[k]);
      const seekLine = studyModel.studySeekTarget(g10Passages, parts10, { passage: k, phrase: j }, null);
      s = await arrive(`#${line}`);
      assert.equal(s.paused, true);
      assert.equal(s.lecture, seekLine.lecture);
      assert.equal(s.focusText, `▶ Play from ${formatTime(seekLine.seekSeconds)}`);
      assert.equal(s.hash, `#${line}`);
      await page.click('button.study-deep-play');
      await waitPlaying(page, seekLine.seekSeconds);
      assert.ok((await studyState(page)).docked);

      // A passage anchor (search results).
      const seekPassage = studyModel.studySeekTarget(g10Passages, parts10, { passage: k }, null);
      s = await arrive(`#s-${line}`);
      assert.equal(s.paused, true);
      assert.equal(s.focusText, `▶ Play from ${formatTime(seekPassage.seekSeconds)}`);

      // A class alone: its divider.
      s = await arrive(`?class=${lectureSlug(L)}`);
      assert.equal(s.search, '');
      assert.equal(s.lecture, L);
      assert.equal(await page.locator('button.study-deep-play').count(), 0);
      r = await topOf(page, `c-${lectureSlug(L)}`);
      assert.ok(r.top >= 0 && r.top < r.visible / 2, `the divider is shown (${r.top})`);

      // An unknown class: nothing, quietly.
      s = await arrive('?class=no-such-class&t=5');
      assert.equal(s.search, '');
      assert.equal(s.lecture, parts10[0].id);
      assert.equal(await page.locator('button.study-deep-play').count(), 0);
      assert.equal(s.paused, true);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('study guide: tapping a phrase plays from it; a double-click (selecting a word) does not', async () => {
    const { context, page, errors } = await newPage(browser, base, { context: reduced });
    try {
      await page.goto(`${base}${g10.url}`);
      const L = parts10[1].id;
      const [ph, ph2] = phraseMoments(L).filter((x, i, all) => i === 0 || x.passage !== all[0].passage);
      const phrase = (x) => page.locator(`.phrase[data-lecture="${L}"]`).filter({ has: page.locator('.phrase-en') }).and(page.locator(`[data-start="${x.start}"]`));
      await phrase(ph2).locator('.phrase-en').dblclick();
      await page.waitForTimeout(700);
      assert.equal((await studyState(page)).paused, true, 'a double-click selects, never plays');
      await page.evaluate(() => window.getSelection().removeAllRanges());
      await phrase(ph).locator('.phrase-en').click();
      await waitPlaying(page, ph.start);
      const s = await studyState(page);
      assert.equal(s.lecture, L);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('study guide with storage blocked: plays, follows and toggles Follow for the page only', async () => {
    const { context, page, errors } = await newPage(browser, base, { context: reduced, blockStorage: true });
    try {
      await page.goto(`${base}${g10.url}`);
      assert.equal(await page.getAttribute('[data-study-follow]', 'aria-pressed'), 'true', 'Follow is on by default');
      const m = blockMoments(parts10[0].id)[1];
      await playBlock(page, m.id);
      await waitPlaying(page, blockSeek(m.block, parts10[0].id).seekSeconds);
      await page.waitForTimeout(300);
      assert.ok((await studyState(page)).current.includes(m.id));
      await page.click('[data-study-follow]');
      assert.equal(await page.getAttribute('[data-study-follow]', 'aria-pressed'), 'false');
      await page.check('[data-study-player] [data-autoplay-next]');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  for (const [name, ctx] of [
    ['desktop', { viewport: { width: 1280, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ]) {
    await check(`study guide playing (${name}): docked bar, no sideways scroll, highlighted block and phrase, Back to now (screenshots)`, async () => {
      const { context, page, errors } = await newPage(browser, base, { context: { ...ctx, reducedMotion: 'reduce' } });
      try {
        await page.goto(`${base}${g10.url}`);
        await page.evaluate(() => document.fonts.ready);
        const L = parts10[6].id;
        const ph = phraseMoments(L).find((x) => {
          const at = studyModel.studyAt(studyModel.studyTimeline(g10Passages, L, parts10[6]), x.t + 0.3);
          return at.block !== null && !at.outOfPlace && Number(at.block.split('.')[0]) === x.passage;
        });
        assert.ok(ph, 'a moment with a phrase and a block');
        const block = blockMoments(L)[0];
        if (name === 'phone') await page.locator(`[id="${block.id}"] a.study-play`).first().tap();
        else await playBlock(page, block.id);
        await waitPlaying(page, blockSeek(block.block, parts10[0].id).seekSeconds);
        await studySeek(page, ph.t + 0.3);
        let s = await studyState(page);
        assert.equal(s.current.length, 2, `a block and a phrase (${s.current})`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), ctx.viewport.width, 'no sideways scroll');
        assert.ok(s.barH <= (name === 'phone' ? 0.3 : 0.25) * s.innerHeight, `bar is ${s.barH}px of ${s.innerHeight}`);
        // Every control of the bar is inside the screen.
        const out = await page.$$eval('[data-study-player] select, [data-study-player] button:not([hidden]), [data-study-player] audio', (els) =>
          els.filter((e) => e.checkVisibility()).map((e) => e.getBoundingClientRect()).filter((r) => r.left < 0 || r.right > window.innerWidth).length,
        );
        assert.equal(out, 0, 'bar controls fit');
        // Show the phrase with its block for the screenshot.
        await page.locator('.phrase.is-discussing').evaluate((e) => window.scrollBy(0, e.getBoundingClientRect().top - 90));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(shots, `study-playing-${name}.png`) });
        if (name === 'phone') {
          await page.evaluate(() => window.scrollBy(0, 3000));
        } else {
          await page.mouse.move(640, 300);
          await page.mouse.wheel(0, 3000);
        }
        await page.waitForTimeout(600);
        s = await studyState(page);
        assert.match(s.pill ?? '', /^↑ Back to now · /);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), ctx.viewport.width, 'no sideways scroll with the pill');
        const pill = await page.locator('[data-study-back-now]').boundingBox();
        assert.ok(pill.x >= 0 && pill.x + pill.width <= ctx.viewport.width, 'the pill fits');
        await page.screenshot({ path: path.join(shots, `study-back-to-now-${name}.png`) });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }

  await check('chapter page: the "Study guide →" pill for the teacher in the player carries ?class= and, once played, &t=; it lands on the moment without playing', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}/texts/chapter-10/`);
      const pill = page.locator('[data-listen-study]');
      await page.waitForFunction(() => document.querySelector('[data-listen-study]').getAttribute('href')?.includes('?class='));
      const first = chapter10.lectures.find((l) => l.seriesId === '0');
      assert.ok(await pill.isVisible());
      assert.equal(await pill.getAttribute('href'), `${g10.url}?class=${lectureSlug(first.id)}`);
      await page.evaluate(() => document.querySelector('[data-listen-audio]').play());
      await seek(page, 125.6);
      const pillT = async () => {
        const [href, t] = await Promise.all([pill.getAttribute('href'), page.evaluate(() => Math.floor(document.querySelector('[data-listen-audio]').currentTime))]);
        return [href.replace(/&t=\d+$/, ''), Math.abs(Number(/&t=(\d+)$/.exec(href)?.[1]) - t) <= 1];
      };
      assert.deepEqual(await pillT(), [`${g10.url}?class=${lectureSlug(first.id)}`, true]);
      // A teacher with no public guide: no pill.
      await page.selectOption('[data-listen-series]', '37');
      await page.waitForTimeout(300);
      assert.equal(await pill.isVisible(), false);
      await page.selectOption('[data-listen-series]', '0');
      await page.evaluate(() => document.querySelector('[data-listen-audio]').play());
      await seek(page, 125.6);
      await page.evaluate(() => document.querySelector('[data-listen-audio]').pause());
      await page.waitForTimeout(200);
      const href = await pill.getAttribute('href');
      assert.deepEqual(await pillT(), [`${g10.url}?class=${lectureSlug(first.id)}`, true], 'kept when paused');
      await pill.click();
      await page.waitForURL(`${base}${g10.url}`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(400);
      const s = await studyState(page);
      assert.equal(s.paused, true, 'never autoplays');
      assert.match(s.focusText, /^▶ Play from /, href);
      assert.equal(await page.locator('.is-selected').count(), 1);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('/study/ and the series page list the public guides; the Study nav item on English and Hebrew pages', async () => {
    for (const [rel, label] of [['index.html', 'Study'], ['he/index.html', 'מדריך לימוד'], ['texts/chapter-10/index.html', 'Study']]) {
      const nav = /<nav>([\s\S]*?)<\/nav>/.exec(fs.readFileSync(path.join(PUBLIC, rel), 'utf8'))?.[1] ?? '';
      assert.match(nav, new RegExp(`<a href="?/classes/"?>[^<]*</a>\\s*<a href="?/study/"?>${label}</a>\\s*<a href="?/outlines/"?>`), `${rel}: Study between Classes and Outlines`);
    }
    const { context, page, errors } = await newPage(browser, base);
    try {
      await page.goto(`${base}/study/`);
      const cards = page.locator('.study-series-card');
      assert.equal(await cards.count(), studyIndex.series.length);
      await cards.first().locator('h2 a').click();
      await page.waitForURL(`${base}/study/${studyIndex.series[0].id}/`);
      const items = page.locator('.study-chapter-list a');
      assert.equal(await items.count(), studyIndex.series[0].chapters.length);
      await items.first().click();
      await page.waitForURL(`${base}${studyGuides[0].url}`);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

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

  // ---------------- search ----------------
  /** Runs a search on /search/ and returns the status text and the results' kind, href and text. */
  const searchFor = async (page, q, where = '') => {
    await page.goto(`${base}/search/?q=${encodeURIComponent(q)}${where ? `&in=${where}` : ''}`);
    // The count shows before the first results render.
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-search-status]')?.textContent ?? '';
      return status === 'No results.' || (/\d+ results?/.test(status) && document.querySelector('.search-result'));
    });
    const status = (await page.textContent('[data-search-status]')) ?? '';
    const results = await page.$$eval('.search-result', (els) =>
      els.map((e) => ({
        kind: [...e.classList].find((c) => c.startsWith('is-'))?.slice(3),
        href: e.querySelector('a')?.getAttribute('href') ?? '',
        marks: [...e.querySelectorAll('mark')].map((m) => m.textContent),
      })),
    );
    return { status, results };
  };

  await check('search: the Search nav item on English and Hebrew pages; the index is built and the manifest removed', async () => {
    for (const [rel, label] of [['index.html', 'Search'], ['he/index.html', 'חיפוש']]) {
      const nav = /<nav>([\s\S]*?)<\/nav>/.exec(fs.readFileSync(path.join(PUBLIC, rel), 'utf8'))?.[1] ?? '';
      assert.match(nav, new RegExp(`<a href="?/search/"?>${label}</a>`), rel);
    }
    assert.ok(fs.existsSync(path.join(PUBLIC, 'pagefind', 'pagefind.js')), 'pagefind index (yarn build runs yarn search-index)');
    assert.ok(!fs.existsSync(path.join(PUBLIC, 'search', 'manifest.json')), 'the indexer deletes the manifest');
  });

  await check('search: transliterations, prefixes, gershayim and filters; marked words; URL kept', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      const translit = await searchFor(page, 'chochmah');
      const hebrew = await searchFor(page, 'חכמה');
      assert.ok(translit.results.length > 0);
      assert.equal(translit.status, hebrew.status, 'chochmah and חכמה find the same');
      assert.ok(translit.results.some((r) => r.marks.length > 0), 'matching words are marked');
      assert.ok(hebrew.results.some((r) => r.marks.some((m) => /[והבכלמשד]חכמה/.test(m ?? ''))), 'prefixed forms are found and marked');
      assert.ok((await searchFor(page, 'אבי"ע')).results.length > 0);
      assert.ok((await searchFor(page, "אבי''ע")).results.length > 0);

      const text = await searchFor(page, 'מקום פנוי', 'text');
      assert.ok(text.results.length > 0);
      for (const r of text.results) {
        assert.equal(r.kind, 'text');
        assert.match(r.href, /^\/texts\/chapter-\d+\/#[a-z0-9]+$/);
      }
      assert.equal(new URL(page.url()).searchParams.get('in'), 'text');

      const markel = await searchFor(page, 'ממלא וסובב', 's37');
      assert.ok(markel.results.length > 0, 'a prefixed glossary term in a multi-word query');
      for (const r of markel.results) assert.match(r.href, /^\/classes\//);

      // Typing updates the results and the URL.
      await page.fill('#search-q', 'reshimu');
      await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'reshimu');
      await page.waitForSelector('.search-result');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(shots, 'search.png') });
    } finally {
      await context.close();
    }
  });

  await check('search: a transcript result opens its paragraph (:target) and the player starts there; a text result opens its line', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      const { results } = await searchFor(page, 'reshimu', 'classes');
      const hit = results.find((r) => r.kind === 'class');
      assert.ok(hit, 'a transcript result');
      assert.match(hit.href, /^\/classes\/transcripts\/[^/]+\/#t\d+$/);
      await page.click(`.search-result a[href="${hit.href}"]`);
      await page.waitForURL(`${base}${hit.href}`);
      const start = await page.evaluate(() => Number(document.querySelector('.tseg:target')?.dataset.start));
      assert.ok(Number.isFinite(start), 'the paragraph is the :target');
      await page.evaluate(() => document.querySelector('[data-listen-audio]').play());
      await page.waitForFunction(() => document.querySelector('[data-listen-audio]').currentTime > 0);
      const t = await page.evaluate(() => document.querySelector('[data-listen-audio]').currentTime);
      assert.ok(Math.abs(t - start) < 3, `plays from the paragraph (${t} vs ${start})`);

      const text = await searchFor(page, 'צמצום', 'text');
      const line = text.results[0];
      assert.ok(line);
      await page.click('.search-result a');
      await page.waitForURL(`${base}${line.href}`);
      assert.ok(await page.evaluate(() => document.querySelector(':target')?.classList.contains('line')));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  await check('search: study guide passages (filter Study guides, and under the teacher); a result opens the passage with Play from; the site stays well under 20,000 files', async () => {
    const { context, page, errors } = await newPage(browser, base);
    try {
      const study = await searchFor(page, 'hiyuli', 'study');
      assert.ok(study.results.length > 0, 'hiyuli is in the guides');
      for (const r of study.results) {
        assert.equal(r.kind, 'study');
        assert.match(r.href, /^\/study\/[a-z0-9-]+\/chapter-\d+\/#s-[a-z2-7]{8}$/);
        assert.ok(studyGuides.some((g) => r.href.startsWith(g.url)), `${r.href}: a public guide`);
      }
      assert.ok(study.results.some((r) => r.marks.length > 0), 'marked words');
      assert.ok((await searchFor(page, 'צמצום', 'study')).results.length > 0, 'the Hebrew of the passages');
      assert.ok((await searchFor(page, 'hiyuli', 's0')).results.some((r) => r.kind === 'study'), 'under the teacher');
      assert.ok((await searchFor(page, 'hiyuli', 'classes')).results.every((r) => r.kind !== 'study'), 'not under All classes');
      const hit = (await searchFor(page, 'hiyuli', 'study')).results[0];
      await page.click(`.search-result a[href="${hit.href}"]`);
      await page.waitForURL(`${base}${hit.href}`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.querySelector(':target')?.classList.contains('study-passage')));
      assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /^▶ Play from \d+:\d\d$/);
      assert.equal(await page.evaluate(() => document.querySelector('[data-study-audio]').paused), true);
      let files = 0;
      const walk = (dir) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          if (d.isDirectory()) walk(path.join(dir, d.name));
          else files++;
        }
      };
      walk(PUBLIC);
      assert.ok(files < 15000, `${files} files (Cloudflare Pages allows 20,000)`);
      results.push(`     (${files} files in the site)`);
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
