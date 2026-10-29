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
 *
 * Without JavaScript the boxes keep their plain player, the scrollable text
 * and links to the chapter pages.
 */
import { formatTime, scrollToShow, spanAt, spans, type Span } from './audio/model.ts';

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

/** Tracks the last time the reader scrolled `el` (wheel, touch or keys). */
function scrollWatcher(el: HTMLElement): () => boolean {
  let last = 0;
  const mark = () => {
    last = Date.now();
  };
  el.addEventListener('wheel', mark, { passive: true });
  el.addEventListener('touchmove', mark, { passive: true });
  el.addEventListener('keydown', (e) => {
    if (SCROLL_KEYS.includes(e.key)) mark();
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

function play(audio: HTMLAudioElement, at: number): void {
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
  void audio.play().catch(() => undefined);
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
    if (button) return play(audio, Number(button.dataset['start']));
    const line = target.closest<HTMLElement>('.line.has-audio');
    const t = line && times.get(line.dataset['line']!);
    if (t && isPlainClick(e)) play(audio, t.start);
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
  open(lesson: Lesson, page: string, opener: HTMLElement): Promise<void>;
  /** The lesson's current line changed: move the highlight (when it is open on that lesson). */
  highlight(lesson: Lesson): void;
  /** Playback moved on: keep the current line in view (when open on that lesson). */
  follow(lesson: Lesson): void;
}

/** The in-page reader: the full chapter text over the list, the class docked below it. */
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
        .catch(() => null);
      pages.set(url, p);
    }
    return p;
  };

  const lineEl = (id: string) => body.querySelector<HTMLElement>(`.line[id="${CSS.escape(id)}"]`);

  const highlight = (l: Lesson) => {
    if (l !== lesson) return;
    for (const el of body.querySelectorAll(`.${CURRENT_CLASS}`)) mark(el, false);
    for (const id of l.current?.keys ?? []) mark(lineEl(id), true);
  };

  const closeNow = () => {
    if (!lesson) return;
    lesson.box.classList.remove('is-reading');
    document.documentElement.classList.remove('reader-open');
    root.hidden = true;
    body.replaceChildren();
    lesson = null;
    pushed = false;
    opener?.focus({ preventScroll: true });
    opener = null;
  };
  const close = () => {
    if (pushed) history.back(); // popstate closes it
    else closeNow();
  };
  root.querySelector('[data-reader-close]')!.addEventListener('click', close);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  // The docked player sits outside the dialog: Esc there closes it too.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lesson && (e.target as Element).closest?.('.is-reading')) close();
  });
  window.addEventListener('popstate', () => {
    if (lesson) {
      pushed = false;
      closeNow();
    }
  });

  body.addEventListener('click', (e) => {
    if (!lesson) return;
    const target = e.target as Element;
    const button = target.closest<HTMLElement>('.line-play[data-start]');
    if (button) return play(lesson.audio, Number(button.dataset['start']));
    const line = target.closest<HTMLElement>('.line.has-audio');
    const t = line && lesson.times.get(line.id);
    if (t && isPlainClick(e)) play(lesson.audio, t.start);
  });

  return {
    highlight,
    follow(l: Lesson) {
      if (l !== lesson || !quiet()) return;
      const el = l.current ? lineEl(l.current.keys[0]!) : null;
      if (el) showIn(body, el, smoothScroll());
    },
    async open(l: Lesson, page: string, from: HTMLElement) {
      if (lesson) closeNow();
      lesson = l;
      opener = from;
      const target = l.chapters.find((c) => c.page === page) ?? l.chapters[0];
      title.textContent = [target?.title, l.title].filter(Boolean).join(' · ');
      pageLink.href = target?.link ?? page;
      const status = document.createElement('p');
      status.className = 'reader-status';
      status.textContent = 'Loading the text…';
      body.replaceChildren(status);
      root.hidden = false;
      l.box.classList.add('is-reading');
      document.documentElement.classList.add('reader-open');
      history.pushState({ lessonReader: true }, '');
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
    },
  };
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
  if (lessonBoxes.length === 0) return;
  const reader = createReader();
  for (const box of lessonBoxes) initLesson(box, reader);
}

init();
