/**
 * outlines.js: the series outlines pages (/outlines/<series>/,
 * layouts/outlines/single.html).
 *
 * - Expand all / Collapse all for the classes' `<details>` (the buttons are
 *   `data-js-only`, shown here).
 * - The part in view is marked in the side nav (`aria-current="location"`);
 *   the first part until a part reaches the top 30% of the viewport.
 *
 * Nothing is opened on load, also when the URL names a part: the parts and
 * chapters are headings, always visible.
 */
export {};

const classes = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.outline-class'));
const controls = document.querySelector<HTMLElement>('.outlines-controls');

function setAll(open: boolean): void {
  for (const d of classes) d.open = open;
}

if (controls && classes.length > 0) {
  controls.querySelector('[data-outlines-expand]')?.addEventListener('click', () => setAll(true));
  controls.querySelector('[data-outlines-collapse]')?.addEventListener('click', () => setAll(false));
  controls.hidden = false;
}

// Scroll spy: the current part is the first one crossing the top 30% of the
// viewport; between parts the last one stays marked, and before any part
// gets there (the page top) the first one is.
const parts = Array.from(document.querySelectorAll<HTMLElement>('section.outline-part'));
const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-outlines-part]'));
let current = '';

function mark(id: string): void {
  if (id === current) return;
  current = id;
  for (const a of links) {
    if (a.dataset['outlinesPart'] === id) a.setAttribute('aria-current', 'location');
    else a.removeAttribute('aria-current');
  }
}

if (parts.length > 1 && links.length > 0 && 'IntersectionObserver' in window) {
  const visible = new Set<Element>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      const first = parts.find((p) => visible.has(p));
      if (first) mark(first.id);
    },
    { rootMargin: '0px 0px -70% 0px' },
  );
  for (const p of parts) observer.observe(p);
  if (parts[0]) mark(parts[0].id);
}
