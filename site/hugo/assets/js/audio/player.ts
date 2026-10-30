/**
 * DOM helpers shared by classes.ts and play.ts: seeking an <audio> and
 * playing it, and the scrolling conventions (reduced motion, a quiet time
 * after the reader scrolls), which follow.ts uses too.
 *
 * Seeks wait for the metadata when the audio is not loaded yet
 * (preload=none), so a seek can be pending for a while. Each <audio> keeps
 * at most one pending seek: a later playAt() cancels the earlier one, so a
 * slow load can never land on a stale position. classes.js and play.js are
 * separate bundles but never run on the same page. follow.js (loaded by
 * play.js) is a separate bundle with its own copy of this module, so it
 * cannot see play.js's pending seeks: clicking a transcript paragraph (or
 * its play button) sets `currentTime` and calls `play()` directly. A
 * pending playAt() from play.js can then still land afterwards.
 */

/** No automatic scrolling of a scroll region for this long after the reader scrolls it. */
const USER_SCROLL_QUIET_MS = 5000;
const SCROLL_KEYS = ['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '];

/** Cancels the pending seek of each <audio> that has one. */
const pending = new WeakMap<HTMLMediaElement, () => void>();

function cancelSeek(audio: HTMLMediaElement): void {
  pending.get(audio)?.();
  pending.delete(audio);
}

/** Runs `fn` on the next `event` of `audio`, as its pending seek (cancelled by the next playAt or seekOnPlay). */
function armSeek(audio: HTMLMediaElement, event: 'loadedmetadata' | 'play', fn: () => void): void {
  const run = () => {
    pending.delete(audio);
    fn();
  };
  audio.addEventListener(event, run, { once: true });
  pending.set(audio, () => audio.removeEventListener(event, run));
}

/** Seeks to `t` now when the duration is known, else as soon as it is (pending until then). */
function seek(audio: HTMLMediaElement, t: number): void {
  if (audio.readyState >= 1) audio.currentTime = t;
  else armSeek(audio, 'loadedmetadata', () => (audio.currentTime = t));
}

/**
 * Plays `audio` from `t`, replacing any pending seek. Resolves false when
 * the browser refuses to start (autoplay policy).
 */
export function playAt(audio: HTMLMediaElement, t: number): Promise<boolean> {
  cancelSeek(audio);
  seek(audio, t);
  return audio.play().then(
    () => true,
    () => false,
  );
}

/**
 * Arms a seek to `t` for the next time `audio` starts playing by other
 * means (its native controls). Never starts playback itself. A playAt()
 * before then cancels it.
 */
export function seekOnPlay(audio: HTMLMediaElement, t: number): void {
  cancelSeek(audio);
  armSeek(audio, 'play', () => seek(audio, t));
}

export const smoothScroll = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/**
 * Tracks the last time the reader scrolled `el` (wheel, touch or keys),
 * ignoring events inside `ignore` (regions that scroll on their own).
 * Returns whether that was long enough ago for automatic scrolling.
 */
export function scrollWatcher(el: HTMLElement | Window, ignore?: string): () => boolean {
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
