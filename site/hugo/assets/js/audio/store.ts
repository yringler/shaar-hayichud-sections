/**
 * The reader's saved audio choices (localStorage), shared by play.ts and
 * classes.ts. Storage can be blocked (private mode, settings) and then
 * throws: every access is guarded, and a choice then lasts for this page only.
 */

/** localStorage key of Autoplay next on/off ("on" / "off"), shared by chapter pages and class lists. */
export const AUTOPLAY_KEY = 'shaarHayichud.audio.autoplayNext';

export function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked: nothing to do.
  }
}

/**
 * Binds the page's Autoplay next checkboxes to one on/off (saved, default
 * off): changing one saves it and updates the others. Returns whether it is
 * on now.
 */
export function autoplayNext(inputs: readonly HTMLInputElement[]): () => boolean {
  let on = readStore(AUTOPLAY_KEY) === 'on';
  for (const input of inputs) {
    input.checked = on;
    input.addEventListener('change', () => {
      on = input.checked;
      writeStore(AUTOPLAY_KEY, on ? 'on' : 'off');
      for (const other of inputs) other.checked = on;
    });
  }
  return () => on;
}
