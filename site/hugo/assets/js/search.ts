/**
 * search.js: the /search/ page. Runs the query through analyzeQuery()
 * (search/text.ts) and searches the Pagefind index that
 * scripts/search-index.ts writes to /pagefind/ after Hugo. Results show the
 * original text with the matching words marked (matcher, snippet), RESULTS_PAGE
 * at a time. The query and the "in" choice are kept in the URL (?q=&in=,
 * replaceState), so a search can be linked and reloaded.
 */
import { analyzeQuery, matcher, snippet, type SnippetPart } from './search/text.ts';

/** The parts of Pagefind's browser API used here (pagefind.js has no types). */
interface PagefindData {
  url: string;
  meta: Record<string, string | undefined>;
}
interface PagefindResult {
  id: string;
  data(): Promise<PagefindData>;
}
interface Pagefind {
  options(o: Record<string, unknown>): Promise<void>;
  search(term: string, o?: { filters?: Record<string, string> }): Promise<{ results: PagefindResult[] } | null>;
}

const PAGEFIND_URL = '/pagefind/pagefind.js';
const RESULTS_PAGE = 20;
const DEBOUNCE_MS = 250;
const KIND_LABEL: Record<string, string> = { text: 'Text', translation: 'Translation', class: 'Class', topic: 'Topic' };

let pagefindLoad: Promise<Pagefind> | null = null;
function loadPagefind(): Promise<Pagefind> {
  pagefindLoad ??= (async () => {
    // In a variable so esbuild leaves the import to the browser.
    const url = PAGEFIND_URL;
    const pf = (await import(url)) as Pagefind;
    // One record per paragraph or section: rank by matching terms more than by length.
    await pf.options({ ranking: { termSaturation: 1.6, pageLength: 0.4 } });
    return pf;
  })();
  return pagefindLoad;
}

function renderParts(el: HTMLElement, parts: SnippetPart[]): void {
  for (const p of parts) {
    if (p.hit) {
      const m = document.createElement('mark');
      m.textContent = p.text;
      el.append(m);
    } else {
      el.append(p.text);
    }
  }
}

/** [href, time (or ""), text], as scripts/search-index.ts writes meta.parts. */
type Part = [string, string, string];

function parseParts(json: string | undefined): Part[] {
  try {
    const v: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? (v as Part[]) : [];
  } catch {
    return [];
  }
}

/**
 * One result: the record's first part with a marked word (else its first
 * part) gives the link, the time and the text. Text sections show the
 * window of the whole section around it; topics show the topic as the title.
 */
function renderResult(d: PagefindData, isHit: (w: string) => boolean): HTMLLIElement {
  const kind = d.meta['kind'] ?? 'class';
  const parts = parseParts(d.meta['parts']);
  const part = parts.find(([, , t]) => t.split(/\s+/).some(isHit)) ?? parts[0];
  const url = part?.[0] ?? d.url;
  const text = kind === 'text' ? parts.map((p) => p[2]).join(' ') : (part?.[2] ?? '');

  const li = document.createElement('li');
  li.className = `search-result is-${kind}`;
  const a = document.createElement('a');
  a.href = url;
  a.className = 'search-result-link';
  const badge = document.createElement('span');
  badge.className = 'search-kind';
  badge.textContent = KIND_LABEL[kind] ?? kind;
  const title = document.createElement('span');
  title.className = 'search-title';
  title.dir = 'auto';
  if (kind === 'topic') renderParts(title, snippet(text, isHit, 1000));
  else title.textContent = d.meta['title'] ?? '';
  a.append(badge, ' ', title);
  const context = [kind === 'topic' ? `${d.meta['title'] ?? ''} · ${d.meta['context'] ?? ''}` : d.meta['context'], part?.[1]]
    .filter(Boolean)
    .join(' · ');
  if (context) {
    const c = document.createElement('span');
    c.className = 'search-context';
    c.dir = 'auto';
    c.textContent = context;
    a.append(' ', c);
  }
  li.append(a);
  if (kind !== 'topic' && text) {
    const p = document.createElement('p');
    p.className = 'search-snippet';
    if (kind === 'text') {
      p.dir = 'rtl';
      p.lang = 'he';
    } else {
      p.dir = 'ltr';
    }
    renderParts(p, snippet(text, isHit));
    li.append(p);
  }
  return li;
}

function init(): void {
  const form = document.querySelector<HTMLFormElement>('[data-search-form]');
  const input = form?.querySelector<HTMLInputElement>('input[name="q"]');
  const where = form?.querySelector<HTMLSelectElement>('select[name="in"]');
  const status = document.querySelector<HTMLElement>('[data-search-status]');
  const list = document.querySelector<HTMLOListElement>('[data-search-results]');
  const more = document.querySelector<HTMLButtonElement>('[data-search-more]');
  if (!form || !input || !where || !status || !list || !more) return;

  const params = new URLSearchParams(window.location.search);
  input.value = params.get('q') ?? '';
  const inParam = params.get('in') ?? '';
  if ([...where.options].some((o) => o.value === inParam)) where.value = inParam;

  /** Bumped per search, so a slow earlier search does not overwrite a later one. */
  let generation = 0;
  let pending: PagefindResult[] = [];
  let isHit: (w: string) => boolean = () => false;

  const filters = (): Record<string, string> => {
    const v = where.value;
    if (v === 'text') return { in: 'Text' };
    if (v === 'classes') return { in: 'Classes' };
    const teacher = where.selectedOptions[0]?.dataset['teacher'];
    return teacher ? { teacher } : {};
  };

  const showMore = async (gen: number) => {
    const batch = pending.slice(0, RESULTS_PAGE);
    pending = pending.slice(RESULTS_PAGE);
    const data = await Promise.all(batch.map((r) => r.data()));
    if (gen !== generation) return;
    for (const d of data) list.append(renderResult(d, isHit));
    more.hidden = pending.length === 0;
  };

  const keepInUrl = () => {
    const u = new URL(window.location.href);
    const q = input.value.trim();
    if (q) u.searchParams.set('q', q);
    else u.searchParams.delete('q');
    if (where.value) u.searchParams.set('in', where.value);
    else u.searchParams.delete('in');
    history.replaceState(history.state, '', u);
  };

  const run = async () => {
    const gen = ++generation;
    keepInUrl();
    const q = input.value.trim();
    list.replaceChildren();
    more.hidden = true;
    pending = [];
    if (q === '') {
      status.textContent = '';
      return;
    }
    const { query } = analyzeQuery(q);
    if (query === '') {
      status.textContent = 'Type a word to search for.';
      return;
    }
    status.textContent = 'Searching…';
    let pf: Pagefind;
    try {
      pf = await loadPagefind();
    } catch {
      if (gen === generation) status.textContent = 'Search is not available here: the search index is built by yarn build.';
      return;
    }
    const res = await pf.search(query, { filters: filters() });
    if (gen !== generation || !res) return;
    isHit = matcher(q);
    pending = res.results;
    const n = pending.length;
    status.textContent = n === 0 ? 'No results.' : `${n} result${n === 1 ? '' : 's'}`;
    await showMore(gen);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  });
  where.addEventListener('change', () => void run());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    void run();
  });
  more.addEventListener('click', () => void showMore(generation));
  if (input.value.trim()) void run();
}

init();
