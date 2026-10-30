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
import { scrollWatcher, smoothScroll } from './audio/player.ts';

export interface FollowOptions {
  audio: HTMLAudioElement;
  /**
   * Spans of the recording now in the player (keyed by its src attribute).
   * Asked on every update, so it must be cheap; it may return [] until the
   * caller's data has loaded.
   */
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

export function startFollow(o: FollowOptions): FollowController {
  const { audio } = o;
  let enabled = false;
  let current: Element[] = [];
  let currentSpan: Span | null = null;
  // The reader has not scrolled the page lately (scrolling inside the panel does not count).
  const quiet = scrollWatcher(window, '[data-listen]');

  // The src attribute changes at once; currentSrc only once the new source loads.
  const srcOf = () => audio.getAttribute('src') || audio.currentSrc;
  // Not cached here: follow.js can load before the chapter alignments, and an
  // empty answer from then must not stick (play.ts caches once data is in).
  const spansNow = (): Span[] => o.spansFor(srcOf());

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
    if (first && !audio.paused && quiet() && offscreen(first)) {
      first.scrollIntoView({ block: 'center', behavior: smoothScroll() });
    }
  };

  for (const ev of ['timeupdate', 'seeked', 'play', 'loadedmetadata'] as const) audio.addEventListener(ev, update);
  audio.addEventListener('emptied', () => {
    clear();
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
