/**
 * follow.js: "Follow along". Loaded on demand by play.js when Follow along
 * is turned on (by the button, or on page load when the reader left it on).
 * While the player plays, the line (chapter pages) or paragraph (transcript
 * pages) under discussion gets the `is-discussing` class, which CSS draws as
 * a side border. The current item is scrolled into view unless the reader
 * scrolled the page recently. Scrolling inside the player panel (its topic
 * list or transcript) does not count: play.ts handles that region itself.
 */
import { formatTime, spanAt, type Span } from './audio/model.ts';

export interface FollowOptions {
  audio: HTMLAudioElement;
  /** Spans of the recording now in the player (keyed by its src attribute). */
  spansFor: (src: string) => Span[];
  /** Elements that get `is-discussing` for a span key. */
  elementsFor: (key: string) => Element[];
  /** Transcript pages: clicking one of these (or its injected play button) seeks to its start. */
  seekTargets?: { el: HTMLElement; start: number }[];
}

export interface FollowController {
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  /** Re-evaluate now (after the source changed). */
  refresh(): void;
}

export const CURRENT_CLASS = 'is-discussing';
/** No automatic scrolling for this long after the reader scrolls. */
const USER_SCROLL_QUIET_MS = 5000;

export function startFollow(o: FollowOptions): FollowController {
  const { audio } = o;
  let enabled = false;
  let current: Element[] = [];
  let currentSpan: Span | null = null;
  let lastUserScroll = 0;
  const cache = new Map<string, Span[]>();

  // The src attribute changes at once; currentSrc only once the new source loads.
  const srcOf = () => audio.getAttribute('src') || audio.currentSrc;
  const spansNow = (): Span[] => {
    const src = srcOf();
    let s = cache.get(src);
    if (!s) {
      s = o.spansFor(src);
      cache.set(src, s);
    }
    return s;
  };

  const clear = () => {
    for (const el of current) {
      el.classList.remove(CURRENT_CLASS);
      el.removeAttribute('aria-current');
    }
    current = [];
    currentSpan = null;
  };

  const offscreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    const bar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--listen-h')) || 0;
    return r.bottom < 0 || r.top > window.innerHeight - bar;
  };

  const update = () => {
    if (!enabled) return;
    const span = spanAt(spansNow(), audio.currentTime);
    if (span === currentSpan) return;
    clear();
    if (!span) return;
    currentSpan = span;
    current = span.keys.flatMap((k) => o.elementsFor(k));
    for (const el of current) {
      el.classList.add(CURRENT_CLASS);
      el.setAttribute('aria-current', 'true');
    }
    const first = current[0];
    if (first && !audio.paused && Date.now() - lastUserScroll > USER_SCROLL_QUIET_MS && offscreen(first)) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      first.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    }
  };

  for (const ev of ['timeupdate', 'seeked', 'play', 'loadedmetadata'] as const) audio.addEventListener(ev, update);
  audio.addEventListener('emptied', () => {
    clear();
  });

  const markScroll = (e: Event) => {
    if (e.target instanceof Element && e.target.closest('[data-listen]')) return;
    lastUserScroll = Date.now();
  };
  window.addEventListener('wheel', markScroll, { passive: true });
  window.addEventListener('touchmove', markScroll, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(e.key)) markScroll(e);
  });

  // Transcript paragraphs: click / Enter seeks there.
  const seek = (start: number) => {
    audio.currentTime = start;
    void audio.play().catch(() => undefined);
  };
  for (const { el, start } of o.seekTargets ?? []) {
    el.addEventListener('click', (e) => {
      if (!enabled) return;
      const sel = window.getSelection();
      if ((sel && !sel.isCollapsed) || e.detail > 1 || (e.target as Element).closest('a')) return;
      seek(start);
    });
  }

  // Keyboard / screen reader access: a play button at the start of each
  // paragraph (no text content, so copying the transcript is unchanged).
  const buttons: HTMLButtonElement[] = [];
  const setTargetsFocusable = (on: boolean) => {
    if (on && buttons.length === 0) {
      for (const { el, start } of o.seekTargets ?? []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'line-play';
        b.setAttribute('aria-label', `Play from ${formatTime(start)}`);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          seek(start);
        });
        el.prepend(b);
        buttons.push(b);
      }
    }
    for (const b of buttons) b.hidden = !on;
  };

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean) {
      enabled = on;
      document.documentElement.classList.toggle('is-following', on);
      setTargetsFocusable(on);
      if (on) update();
      else clear();
    },
    refresh() {
      currentSpan = null;
      clear();
      update();
    },
  };
}
