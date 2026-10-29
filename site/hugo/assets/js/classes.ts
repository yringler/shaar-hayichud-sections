/**
 * classes.js: the class lists (/classes/<series>/…). Progressive enhancement
 * of the lesson boxes (partials/class-track.html):
 *
 * - One class plays at a time: starting one pauses the others.
 * - The lesson text preview (`[data-lesson-text]`, the chapter lines the
 *   class reads, in a short box that scrolls on its own) gets a play button
 *   on each aligned line; clicking one, or the line's text, plays the class
 *   from there. While the class plays, the line under discussion gets
 *   `is-discussing` and the box scrolls itself to keep it in view (never the
 *   page), except for 5 s after the reader scrolls the box.
 * - "Follow in the text" (`[data-lesson-open]`) opens the in-page reader: the
 *   full chapter text (taken from the chapter page) over the list, with the
 *   lesson's lines marked and the same <audio> docked at the bottom by CSS
 *   (it is never moved in the DOM, so playback, position and paused/playing
 *   carry over untouched). Back, Esc or the browser's Back button close it.
 *   A modified click (new tab, etc.) still follows the link to the chapter page.
 * - Autoplay next (one saved on/off for every box): when a class ends, the
 *   next box on the page plays from the start. If the reader was open on the
 *   class, it moves on to the next lesson (or closes when that one has no
 *   text); otherwise the next box is scrolled into view, unless the reader
 *   scrolled the page in the last 5 s.
 *
 * Without JavaScript the boxes keep their plain player, the scrollable text
 * and links to the chapter pages.
 */
import { formatTime, scrollToShow, spanAt, spans, type Span } from './audio/model.ts';
import { autoplayNext, markPlaying } from './audio/store.ts';

/** No automatic scrolling of a scroll region for this long after the reader scrolls it. */
const USER_SCROLL_QUIET_MS = 5000;
const CURRENT_CLASS = 'is-discussing';
const SCROLL_KEYS = ['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '];

const smoothScroll = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** A click meant to play: not part of a text selection or a double-click, not on a link. */
const isPlainClick = (e: MouseEvent): boolean => {
  const sel = window.getSelection();
  return !(sel && !sel.isCollapsed) && e.detail <= 1 && !(e.target as Element).closest('a');
};

/**
 * Tracks the last time the reader scrolled `el` (wheel, touch or keys),
 * ignoring events inside `ignore` (regions that scroll on their own).
 * Returns whether that was long enough ago for automatic scrolling.
 */
function scrollWatcher(el: HTMLElement | Window, ignore?: string): () => boolean {
  let last = 0;
  const mark = (e: Event) => {
    if (ignore && e.target instanceof Element && e.target.closest(ignore)) return;
    last = Date.now();
  };
  el.addEventListener('wheel', mark, { passive: true });
  el.addEventListener('touchmove', mark, { passive: true });
  el.addEventListener('keydown', (e) => {
    if (SCROLL_KEYS.includes((e as KeyboardEvent).key)) mark(e);
  });
  return () => Date.now() - last > USER_SCROLL_QUIET_MS;
}

/** scrollTo inside `region` (never the page) so `el` is in view; see scrollToShow(). */
function showIn(region: HTMLElement, el: HTMLElement, behavior: ScrollBehavior): void {
  const top = el.getBoundingClientRect().top - region.getBoundingClientRect().top + region.scrollTop;
  const to = scrollToShow(region.scrollTop, region.clientHeight, top, el.offsetHeight);
  if (to !== null) region.scrollTo({ top: to, behavior });
}

function playButton(start: number): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'line-play';
  b.dataset['start'] = String(start);
  b.setAttribute('aria-label', `Play from ${formatTime(start)}`);
  return b;
}

interface Chapter {
  /** Chapter page to take the text from (no query string). */
  page: string;
  /** Chapter page link for the reader's header (with ?teacher=). */
  link: string;
  title: string;
}

interface Lesson {
  box: HTMLElement;
  audio: HTMLAudioElement;
  /** The <audio> and its Autoplay next toggle: docked together while the reader is open. */
  player: HTMLElement;
  preview: HTMLElement;
  title: string;
  chapters: Chapter[];
  /** Line id -> start / end (seconds) in this class, for its aligned lines. */
  times: Map<string, { start: number; end: number }>;
  /** Line ids of the lesson's range, aligned or not. */
  range: Set<string>;
  spans: Span[];
  /** Highlighted span; null when none. */
  current: Span | null;
}

/** Plays from `at`; resolves false when the browser refuses to start (autoplay policy). */
function play(audio: HTMLAudioElement, at: number): Promise<boolean> {
  if (audio.readyState >= 1) {
    audio.currentTime = at;
  } else {
    // Not loaded yet: seek as soon as the duration is known.
    audio.addEventListener(
      'loadedmetadata',
      () => {
        audio.currentTime = at;
      },
      { once: true },
    );
  }
  return audio.play().then(
    () => true,
    () => false,
  );
}

function initLesson(box: HTMLElement, reader: Reader): Lesson | null {
  const audio = box.querySelector<HTMLAudioElement>('audio');
  const preview = box.querySelector<HTMLElement>('[data-lesson-text]');
  if (!audio || !preview) return null;
  const times = new Map<string, { start: number; end: number }>();
  const range = new Set<string>();
  for (const line of preview.querySelectorAll<HTMLElement>('.line[data-line]')) {
    const id = line.dataset['line']!;
    range.add(id);
    if (line.dataset['start'] === undefined) continue;
    const start = Number(line.dataset['start']);
    times.set(id, { start, end: Number(line.dataset['end'] ?? start) });
    line.classList.add('has-audio');
    line.before(playButton(start));
  }
  const lesson: Lesson = {
    box,
    audio,
    player: audio.closest<HTMLElement>('.track-player') ?? audio,
    preview,
    title: box.querySelector('.track-title')?.textContent?.trim() ?? '',
    chapters: [...preview.querySelectorAll<HTMLElement>('[data-chapter-page]')].map((c) => ({
      page: c.dataset['chapterPage']!,
      link: c.dataset['chapterLink'] ?? c.dataset['chapterPage']!,
      title: c.dataset['chapterTitle'] ?? '',
    })),
    times,
    range,
    spans: spans([...times].map(([key, t]) => ({ key, ...t }))),
    current: null,
  };

  const quiet = scrollWatcher(preview);
  const previewLine = (id: string) => preview.querySelector<HTMLElement>(`.line[data-line="${CSS.escape(id)}"]`);

  const update = () => {
    const span = spanAt(lesson.spans, audio.currentTime);
    if (span !== lesson.current) {
      for (const id of lesson.current?.keys ?? []) mark(previewLine(id), false);
      for (const id of span?.keys ?? []) mark(previewLine(id), true);
      lesson.current = span;
      reader.highlight(lesson);
    }
    const el = span ? previewLine(span.keys[0]!) : null;
    if (el && !audio.paused && quiet()) showIn(preview, el, smoothScroll());
    if (!audio.paused) reader.follow(lesson);
  };
  for (const ev of ['timeupdate', 'seeked', 'play'] as const) audio.addEventListener(ev, update);

  // Play buttons always; the line text too (selection-safe).
  preview.addEventListener('click', (e) => {
    const target = e.target as Element;
    const button = target.closest<HTMLElement>('.line-play[data-start]');
    if (button) return void play(audio, Number(button.dataset['start']));
    const line = target.closest<HTMLElement>('.line.has-audio');
    const t = line && times.get(line.dataset['line']!);
    if (t && isPlainClick(e)) void play(audio, t.start);
  });

  for (const link of box.querySelectorAll<HTMLAnchorElement>('a[data-lesson-open]')) {
    link.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      void reader.open(lesson, link.dataset['lessonOpen']!, link);
    });
  }
  return lesson;
}

function mark(el: Element | null | undefined, on: boolean): void {
  if (!el) return;
  el.classList.toggle(CURRENT_CLASS, on);
  if (on) el.setAttribute('aria-current', 'true');
  else el.removeAttribute('aria-current');
}

interface Reader {
  /** The lesson the reader is open on, or null when closed. */
  readonly lesson: Lesson | null;
  open(lesson: Lesson, page: string, opener: HTMLElement): Promise<void>;
  /** Autoplay next: show `lesson` instead (same history entry); closing returns focus to `link`. */
  swap(lesson: Lesson, link: HTMLAnchorElement): Promise<void>;
  /** Close it (going back over its history entry), focusing `focus` (default: the link that opened it); resolves once closed. */
  close(focus?: HTMLElement): Promise<void>;
  /** The lesson's current line changed: move the highlight (when it is open on that lesson). */
  highlight(lesson: Lesson): void;
  /** Playback moved on: keep the current line in view (when open on that lesson). */
  follow(lesson: Lesson): void;
}

/** The in-page reader: the full chapter text over the list, the class's player docked below it. */
function createReader(): Reader {
  const root = document.createElement('div');
  root.className = 'reader';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'reader-title');
  root.innerHTML = `
    <div class="reader-bar" dir="ltr">
      <button type="button" class="reader-back" data-reader-close>← Back to classes</button>
      <h2 class="reader-title" id="reader-title" tabindex="-1"></h2>
      <a class="audio-link reader-page" data-reader-page href="">Chapter page</a>
    </div>
    <div class="reader-body" data-reader-body tabindex="0"></div>`;
  document.body.append(root);
  const title = root.querySelector<HTMLElement>('.reader-title')!;
  const pageLink = root.querySelector<HTMLAnchorElement>('[data-reader-page]')!;
  const body = root.querySelector<HTMLElement>('[data-reader-body]')!;
  const quiet = scrollWatcher(body);
  const pages = new Map<string, Promise<HTMLElement | null>>();

  let lesson: Lesson | null = null;
  let opener: HTMLElement | null = null;
  /** The reader added a history entry that closing should go back over. */
  let pushed = false;

  /** The chapter text of a chapter page (`[data-aligned-text]`), fetched once. */
  const loadPage = (url: string): Promise<HTMLElement | null> => {
    let p = pages.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.text() : null))
        .then((html) => {
          if (html === null) return null;
          const doc = new DOMParser().parseFromString(html, 'text/html');
          return doc.querySelector<HTMLElement>('[data-aligned-text]');
        })
        .catch(() => null)
        .then((text) => {
          if (!text) pages.delete(url); // try again on the next open
          return text;
        });
      pages.set(url, p);
    }
    return p;
  };

  // While open, everything but the reader and the docked player (<audio>
  // and its Autoplay next toggle) is inert, so focus stays in the dialog and
  // the player (aria-modal alone does not).
  let inerted: HTMLElement[] = [];
  const setInert = (player: HTMLElement | null) => {
    for (const el of inerted) el.inert = false;
    inerted = [];
    if (!player) return;
    for (let el: HTMLElement | null = player; el && el !== document.body; el = el.parentElement) {
      for (const sib of el.parentElement?.children ?? []) {
        if (sib === el || sib === root || !(sib instanceof HTMLElement) || sib.inert) continue;
        sib.inert = true;
        inerted.push(sib);
      }
    }
  };

  const lineEl = (id: string) => body.querySelector<HTMLElement>(`.line[id="${CSS.escape(id)}"]`);

  const highlight = (l: Lesson) => {
    if (l !== lesson) return;
    for (const el of body.querySelectorAll(`.${CURRENT_CLASS}`)) mark(el, false);
    for (const id of l.current?.keys ?? []) mark(lineEl(id), true);
  };

  /** Waiting for close() (it goes back in history first). */
  let onClosed: (() => void)[] = [];
  const closeNow = () => {
    for (const fn of onClosed.splice(0)) fn();
    if (!lesson) return;
    lesson.box.classList.remove('is-reading');
    setInert(null);
    document.documentElement.classList.remove('reader-open');
    root.hidden = true;
    body.replaceChildren();
    lesson = null;
    pushed = false;
    if (opener) {
      // After autoplay moved the reader on, the link can be far from where
      // the page was left: bring it on screen, once the history traversal
      // has restored the page's scroll position.
      const el = opener;
      el.focus({ preventScroll: true });
      window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: 'center' });
      }, 0);
    }
    opener = null;
  };
  const close = (focus?: HTMLElement): Promise<void> => {
    if (!lesson) return Promise.resolve();
    if (focus) opener = focus;
    const closed = new Promise<void>((resolve) => onClosed.push(resolve));
    if (pushed) {
      pushed = false; // a second close (double-click) must not go back again
      history.back(); // popstate closes it
    } else closeNow();
    return closed;
  };
  root.querySelector('[data-reader-close]')!.addEventListener('click', () => void close());
  // Esc wherever focus is: the dialog or the body. (While the docked
  // player's native controls have focus, Chromium keeps Esc to itself.)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lesson) void close();
  });
  window.addEventListener('popstate', () => {
    if (lesson) {
      pushed = false;
      closeNow();
    }
  });
  // Reloaded (or restored without bfcache) on the reader's history entry:
  // the reader is closed, so make the entry an ordinary one.
  if ((history.state as { lessonReader?: boolean } | null)?.lessonReader) history.replaceState(null, '');

  body.addEventListener('click', (e) => {
    if (!lesson) return;
    const target = e.target as Element;
    const button = target.closest<HTMLElement>('.line-play[data-start]');
    if (button) return void play(lesson.audio, Number(button.dataset['start']));
    const line = target.closest<HTMLElement>('.line.has-audio');
    const t = line && lesson.times.get(line.id);
    if (t && isPlainClick(e)) void play(lesson.audio, t.start);
  });

  const open = async (l: Lesson, page: string, from: HTMLElement) => {
    // Already open (reached from the docked player): swap the lesson, keep the history entry.
    const reuse = pushed;
    if (lesson) {
      const keep = opener;
      pushed = false;
      closeNow();
      opener = keep;
    }
    lesson = l;
    opener ??= from;
    // Only the docked class can be controlled while the reader is open.
    for (const a of document.querySelectorAll<HTMLAudioElement>('.track audio')) if (a !== l.audio) a.pause();
    const target = l.chapters.find((c) => c.page === page) ?? l.chapters[0];
    title.textContent = [target?.title, l.title].filter(Boolean).join(' · ');
    pageLink.href = target?.link ?? page;
    const status = document.createElement('p');
    status.className = 'reader-status';
    status.textContent = 'Loading the text…';
    body.replaceChildren(status);
    root.hidden = false;
    l.box.classList.add('is-reading');
    setInert(l.player);
    document.documentElement.classList.add('reader-open');
    if (!reuse) history.pushState({ lessonReader: true }, '');
    pushed = true;
    title.focus({ preventScroll: true });

    const texts = await Promise.all(l.chapters.map((c) => loadPage(c.page)));
    if (lesson !== l) return; // closed or switched meanwhile
    if (texts.some((t) => !t)) {
      status.textContent = 'The text could not be loaded. Open the chapter page instead.';
      return;
    }
    body.replaceChildren(
      ...l.chapters.flatMap((c, i) => {
        const text = texts[i]!.cloneNode(true) as HTMLElement;
        text.removeAttribute('data-aligned-text');
        text.lang = 'he';
        text.dataset['chapterPage'] = c.page;
        for (const line of text.querySelectorAll<HTMLElement>('.line')) {
          line.removeAttribute('data-t');
          if (!l.range.has(line.id)) continue;
          line.classList.add('in-lesson');
          const t = l.times.get(line.id);
          if (!t) continue;
          line.classList.add('has-audio');
          line.before(playButton(t.start));
        }
        if (l.chapters.length < 2) return [text];
        const h = document.createElement('h3');
        h.className = 'reader-chapter';
        h.textContent = c.title;
        return [h, text];
      }),
    );
    highlight(l);
    // The current line if the class has started, else where the lesson starts in the chosen chapter.
    const current = l.current ? lineEl(l.current.keys[0]!) : null;
    const start = body.querySelector<HTMLElement>(
      `[data-chapter-page="${CSS.escape(target?.page ?? '')}"] .line.in-lesson`,
    );
    const el = current ?? start;
    if (el) showIn(body, el, 'auto');
  };

  return {
    get lesson() {
      return lesson;
    },
    highlight,
    follow(l: Lesson) {
      if (l !== lesson || !quiet()) return;
      const el = l.current ? lineEl(l.current.keys[0]!) : null;
      if (el) showIn(body, el, smoothScroll());
    },
    open,
    swap(l: Lesson, link: HTMLAnchorElement) {
      opener = link;
      return open(l, link.dataset['lessonOpen'] ?? l.chapters[0]?.page ?? '', link);
    },
    close,
  };
}

/**
 * Autoplay next: when a class ends, the next box on the page (document
 * order, across headings) plays from the start. The reader, when open on
 * the class that ended, moves on with it.
 */
function initAutoplay(boxes: readonly HTMLElement[], lessons: ReadonlyMap<HTMLAudioElement, Lesson>, reader: Reader | null): void {
  for (const el of document.querySelectorAll<HTMLElement>('.track [data-js-only]')) el.hidden = false;
  const on = autoplayNext([...document.querySelectorAll<HTMLInputElement>('.track [data-autoplay-next]')]);
  const tracks = boxes.flatMap((box) => {
    const audio = box.querySelector<HTMLAudioElement>('audio');
    return audio ? [{ box, audio }] : [];
  });
  for (const { box, audio } of tracks) markPlaying(audio, box);
  // Page scrolls only: the lesson text boxes and the reader scroll on their own.
  const quiet = scrollWatcher(window, '[data-lesson-text], .reader, .track-player');
  const reveal = (box: HTMLElement) => {
    if (quiet()) box.scrollIntoView({ block: 'nearest', behavior: smoothScroll() });
  };

  document.addEventListener(
    'ended',
    (e) => {
      if (!on()) return;
      const i = tracks.findIndex((t) => t.audio === e.target);
      const next = i >= 0 ? tracks[i + 1] : undefined;
      if (!next) return; // the page's last class: stop
      const open = reader?.lesson ?? null;
      // A class hidden behind the reader (not the docked one) does not move on.
      if (open && open.audio !== e.target) return;
      const focusNext = () => next.box.querySelector<HTMLElement>('a, audio') ?? undefined;
      void play(next.audio, 0).then((started) => {
        if (!started) {
          // Refused (autoplay policy): show the next class so it can be started by hand.
          if (reader?.lesson) void reader.close(focusNext()).then(() => reveal(next.box));
          else reveal(next.box);
          return;
        }
        if (!reader || !open) return reveal(next.box);
        if (reader.lesson !== open) return; // closed or moved meanwhile
        // The reader was on the class that ended: show the next lesson (the
        // same history entry, its player docked), or close for a class without text.
        const lesson = lessons.get(next.audio);
        const link = lesson?.box.querySelector<HTMLAnchorElement>('a[data-lesson-open]');
        if (lesson && link) void reader.swap(lesson, link);
        else void reader.close(focusNext()).then(() => reveal(next.box));
      });
    },
    true,
  );
}

function init(): void {
  const boxes = [...document.querySelectorAll<HTMLElement>('.track')];
  if (boxes.length === 0) return;
  // One class at a time (media events do not bubble: listen in the capture phase).
  document.addEventListener(
    'play',
    (e) => {
      for (const a of document.querySelectorAll<HTMLAudioElement>('.track audio')) if (a !== e.target) a.pause();
    },
    true,
  );
  const lessonBoxes = boxes.filter((b) => b.hasAttribute('data-lesson'));
  const reader = lessonBoxes.length > 0 ? createReader() : null;
  const lessons = new Map<HTMLAudioElement, Lesson>();
  for (const box of lessonBoxes) {
    const lesson = reader && initLesson(box, reader);
    if (lesson) lessons.set(lesson.audio, lesson);
  }
  initAutoplay(boxes, lessons, reader);
}

init();
