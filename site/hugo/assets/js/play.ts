/**
 * play.js: progressive enhancement for pages with a `[data-listen]` panel
 * (chapter pages with published alignments, and transcript pages).
 *
 * Chapter pages: shows the class selector, adds a small play button to every
 * aligned line (`.line[data-t]`) that plays the best class from that line, or
 * opens a chooser when several classes discuss it. Transcript pages: only the
 * Listen along button. Listen along loads follow.js on demand.
 *
 * Without JavaScript the page keeps a plain <audio> player and its text.
 */
import {
  chapterSeries,
  formatTime,
  lectureItems,
  rankRefs,
  spans,
  topicAt,
  type ChapterAlignments,
  type Outline,
  type Ref,
  type Span,
  type Topic,
} from './audio/model.ts';
import type { FollowController, FollowOptions } from './follow.ts';

type FollowModule = { startFollow: (o: FollowOptions) => FollowController };


function init(panel: HTMLElement): void {
  const audio = panel.querySelector<HTMLAudioElement>('[data-listen-audio]');
  if (!audio) return;
  for (const el of panel.querySelectorAll<HTMLElement>('[data-js-only]')) el.hidden = false;
  for (const el of panel.querySelectorAll<HTMLElement>('[data-no-js]')) el.hidden = true;

  // Keep the panel's height in a CSS variable (sticky offset, scroll margins).
  const setHeight = () =>
    document.documentElement.style.setProperty('--listen-h', `${panel.classList.contains('is-active') ? panel.offsetHeight : 0}px`);
  const activate = () => {
    panel.classList.add('is-active');
    setHeight();
  };
  audio.addEventListener('play', activate);
  window.addEventListener('resize', setHeight);

  const chapterUrl = panel.dataset['chapterAlignments'];
  const chapter = chapterUrl ? initChapter(panel, audio, chapterUrl, activate) : null;

  // Listen along
  const along = panel.querySelector<HTMLButtonElement>('[data-listen-along]');
  let follow: FollowController | null = null;
  let loading: Promise<FollowController | null> | null = null;
  const loadFollow = (): Promise<FollowController | null> => {
    loading ??= (async () => {
      const src = panel.dataset['followSrc'];
      if (!src) return null;
      const mod = (await import(/* @vite-ignore */ src)) as FollowModule;
      const options: FollowOptions = chapter
        ? {
            audio,
            spansFor: (s) => chapter.spansFor(s),
            elementsFor: (key) => {
              const el = document.getElementById(key);
              return el ? [el] : [];
            },
          }
        : transcriptOptions(audio);
      follow = mod.startFollow(options);
      if (chapter) chapter.onSourceChange(() => follow?.refresh());
      return follow;
    })();
    return loading;
  };
  along?.addEventListener('click', async () => {
    const on = along.getAttribute('aria-pressed') !== 'true';
    along.setAttribute('aria-pressed', String(on));
    document.documentElement.classList.toggle('is-listening-along', on);
    chapter?.setListening(on);
    const f = await loadFollow();
    f?.setEnabled(on);
    if (on && audio.paused) {
      activate();
      void audio.play().catch(() => undefined);
    }
  });
}

/** Transcript pages: paragraphs with data-start / data-end. */
function transcriptOptions(audio: HTMLAudioElement): FollowOptions {
  const paras = [...document.querySelectorAll<HTMLElement>('[data-transcript] [data-start]')];
  const items = paras.map((el, i) => ({
    key: el.id || `p${i}`,
    start: Number(el.dataset['start']),
    end: Number(el.dataset['end'] ?? el.dataset['start']),
    el,
  }));
  const byKey = new Map(items.map((it) => [it.key, it.el]));
  const all = spans(items);
  return {
    audio,
    spansFor: () => all,
    elementsFor: (key) => {
      const el = byKey.get(key);
      return el ? [el] : [];
    },
    seekTargets: items.map((it) => ({ el: it.el, start: it.start })),
  };
}

interface ChapterPlayer {
  spansFor(src: string): Span[];
  onSourceChange(fn: () => void): void;
  /** Listen along on/off: shows the current class's topic outline. */
  setListening(on: boolean): void;
}

/** localStorage key of the reader's teacher (catalog series id), shared by every chapter page. */
const SERIES_KEY = 'shaarHayichud.audio.series';

interface SavedSeries {
  id: string;
  title: string;
}

function readSavedSeries(): SavedSeries | null {
  try {
    const raw = window.localStorage.getItem(SERIES_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedSeries>;
    return typeof v.id === 'string' && typeof v.title === 'string' ? { id: v.id, title: v.title } : null;
  } catch {
    return null;
  }
}

function saveSeries(s: SavedSeries): void {
  try {
    window.localStorage.setItem(SERIES_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked (private mode, settings): the choice lasts for this page only.
  }
}

function initChapter(panel: HTMLElement, audio: HTMLAudioElement, url: string, activate: () => void): ChapterPlayer {
  const seriesSelect = panel.querySelector<HTMLSelectElement>('[data-listen-series]');
  const select = panel.querySelector<HTMLSelectElement>('[data-listen-select]');
  const transcriptLink = panel.querySelector<HTMLAnchorElement>('[data-listen-transcript]');
  const note = panel.querySelector<HTMLElement>('[data-listen-note]');
  // Every class option, as rendered; the class selector shows one series at a time.
  const allOptions = select ? [...select.querySelectorAll('option')] : [];
  const listeners: (() => void)[] = [];
  let data: ChapterAlignments | null = null;

  const showNote = (text: string | null) => {
    if (!note) return;
    note.textContent = text ?? '';
    note.hidden = !text;
  };

  const lectureOfSrc = (src: string): number | null => {
    if (!data || !src) return null;
    const i = data.lectures.findIndex((l) => l.url === src);
    return i >= 0 ? i : null;
  };
  // The src attribute changes at once; currentSrc only once the new source starts loading.
  const currentLecture = () => lectureOfSrc(audio.getAttribute('src') || audio.currentSrc || '');
  const selectedSeries = (): string | null => seriesSelect?.value || null;
  const seriesTitle = (id: string | null) =>
    [...(seriesSelect?.options ?? [])].find((o) => o.value === id)?.textContent?.trim() ?? '';

  /** Shows the classes of `seriesId` in the class selector. */
  const fillClasses = (seriesId: string) => {
    if (!select) return;
    select.replaceChildren(...allOptions.filter((o) => o.dataset['series'] === seriesId));
  };

  const syncControls = (lecture: number) => {
    const opt = allOptions.find((o) => o.value === String(lecture));
    if (!opt) return;
    if (seriesSelect && opt.dataset['series'] && seriesSelect.value !== opt.dataset['series']) {
      // Playing another series' class (fallback): show it, keep the saved choice.
      seriesSelect.value = opt.dataset['series'];
      fillClasses(opt.dataset['series']);
    }
    if (select) select.value = String(lecture);
    if (transcriptLink) {
      const href = opt.dataset['transcript'];
      transcriptLink.hidden = !href;
      if (href) transcriptLink.href = href;
    }
  };

  const setLecture = (lecture: number, autoplayAt: number | null) => {
    const l = data?.lectures[lecture];
    if (!l) return;
    if ((audio.getAttribute('src') || audio.currentSrc) !== l.url) {
      audio.src = l.url;
      for (const fn of listeners) fn();
    }
    syncControls(lecture);
    if (autoplayAt === null) return;
    activate();
    const seekTo = autoplayAt;
    if (audio.readyState >= 1) {
      audio.currentTime = seekTo;
    } else {
      // Not loaded yet: seek as soon as the duration is known.
      audio.addEventListener(
        'loadedmetadata',
        () => {
          audio.currentTime = seekTo;
        },
        { once: true },
      );
    }
    void audio.play().catch(() => undefined);
  };

  /** The reader's saved teacher (possibly not on this chapter). */
  let preferred: SavedSeries | null = readSavedSeries();
  /** The teacher this page plays first: the saved one when it covers the chapter. */
  let wanted: SavedSeries | null = null;

  const playRef = (r: Ref) => {
    const l = data?.lectures[r.lecture];
    if (!l) return;
    showNote(
      wanted && l.seriesId !== wanted.id
        ? `This line is not in ${wanted.title}'s classes yet; playing ${l.series}: ${l.title}.`
        : null,
    );
    setLecture(r.lecture, r.startSeconds);
  };

  const ranked = (lineId: string): Ref[] => {
    const line = data?.lines.find((x) => x.lineId === lineId);
    if (!data || !line) return [];
    const seriesId = wanted?.id ?? selectedSeries();
    return rankRefs(line.refs, data.lectures, { currentLecture: currentLecture(), seriesId });
  };

  const dataReady = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<ChapterAlignments>) : null))
    .then((d) => {
      data = d;
      if (!d) return d;
      // Apply the saved teacher, or fall back (visibly) to the first one here.
      const here = chapterSeries(d);
      const chosen = here.find((s) => s.id === preferred?.id) ?? here[0];
      if (chosen && seriesSelect) {
        wanted = chosen;
        seriesSelect.value = chosen.id;
        fillClasses(chosen.id);
        const first = d.lectures.findIndex((l) => l.seriesId === chosen.id);
        if (audio.paused && currentLecture() !== first) setLecture(first, null);
        else syncControls(currentLecture() ?? first);
        if (preferred && chosen.id !== preferred.id) {
          showNote(`${preferred.title} has no published classes on this chapter yet; showing ${chosen.title}.`);
        }
      }
      decorate(d);
      return d;
    })
    .catch(() => null);

  seriesSelect?.addEventListener('change', () => {
    const id = seriesSelect.value;
    preferred = { id, title: seriesTitle(id) };
    wanted = preferred;
    saveSeries(preferred);
    showNote(null);
    fillClasses(id);
    void dataReady.then((d) => {
      if (!d) return;
      const wasPlaying = !audio.paused;
      setLecture(d.lectures.findIndex((l) => l.seriesId === id), null);
      if (wasPlaying) void audio.play().catch(() => undefined);
    });
  });

  select?.addEventListener('change', () => {
    const i = Number(select.value);
    const wasPlaying = !audio.paused;
    showNote(null);
    void dataReady.then(() => {
      setLecture(i, null);
      if (wasPlaying) void audio.play().catch(() => undefined);
    });
  });

  // ---- per-line play buttons and the chooser ----
  let chooser: HTMLElement | null = null;
  let chooserTrigger: HTMLElement | null = null;
  const closeChooser = (focusBack: boolean) => {
    chooser?.remove();
    chooser = null;
    chooserTrigger?.setAttribute('aria-expanded', 'false');
    if (focusBack) chooserTrigger?.focus();
    chooserTrigger = null;
  };
  const openChooser = (button: HTMLElement, refs: Ref[]) => {
    closeChooser(false);
    if (!data) return;
    const d = data;
    const menu = document.createElement('div');
    menu.className = 'line-chooser';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Play this line from');
    menu.dir = 'ltr';
    for (const r of refs) {
      const l = d.lectures[r.lecture]!;
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.className = 'line-chooser-item';
      const name = document.createElement('span');
      name.textContent = `${l.series}: ${l.title}`;
      const time = document.createElement('span');
      time.className = 'line-chooser-time';
      time.textContent = formatTime(r.startSeconds);
      item.append(name, time);
      item.addEventListener('click', () => {
        closeChooser(true);
        playRef(r);
      });
      menu.append(item);
    }
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        closeChooser(true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items[next]?.focus();
      } else if (e.key === 'Tab') {
        closeChooser(false);
      }
    });
    document.body.append(menu);
    const r = button.getBoundingClientRect();
    const width = Math.min(menu.offsetWidth, document.documentElement.clientWidth - 16);
    const left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - width - 8));
    menu.style.left = `${left + window.scrollX}px`;
    menu.style.top = `${r.bottom + window.scrollY + 4}px`;
    chooser = menu;
    chooserTrigger = button;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  };
  document.addEventListener('click', (e) => {
    if (chooser && !chooser.contains(e.target as Node) && e.target !== chooserTrigger) closeChooser(false);
  });

  const decorate = (d: ChapterAlignments) => {
    const text = document.querySelector('[data-aligned-text]');
    if (!text) return;
    text.classList.add('audio-ready');
    for (const line of d.lines) {
      const span = document.getElementById(line.lineId);
      if (!span || !span.classList.contains('line')) continue;
      span.classList.add('has-audio');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'line-play';
      b.dataset['line'] = line.lineId;
      const best = line.refs[0]!;
      if (line.refs.length > 1) {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        b.setAttribute('aria-label', `Play from here: ${line.refs.length} classes`);
        b.classList.add('has-choices');
      } else {
        const l = d.lectures[best.lecture]!;
        b.setAttribute('aria-label', `Play from here (${l.series}: ${l.title}, ${formatTime(best.startSeconds)})`);
      }
      span.before(b);
    }
  };

  // One delegated handler: play buttons always; the line text itself only
  // while Listen along is on (so ordinary reading clicks and text selection
  // are never hijacked).
  let pendingClick: number | undefined;
  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    const button = target.closest<HTMLElement>('.line-play[data-line]');
    if (button) {
      const refs = ranked(button.dataset['line']!);
      if (refs.length > 1) {
        if (chooser && chooserTrigger === button) closeChooser(true);
        else openChooser(button, refs);
      } else if (refs[0]) playRef(refs[0]);
      return;
    }
    const line = target.closest<HTMLElement>('.line.has-audio');
    if (!line || !document.documentElement.classList.contains('is-listening-along')) return;
    const sel = window.getSelection();
    if ((sel && !sel.isCollapsed) || target.closest('a')) return;
    // Wait out a double-click (word selection) before acting.
    window.clearTimeout(pendingClick);
    if (e.detail > 1) return;
    pendingClick = window.setTimeout(() => {
      const s = window.getSelection();
      if (s && !s.isCollapsed) return;
      const best = ranked(line.id)[0];
      if (best) playRef(best);
    }, 250);
  });

  // ---- auto-generated topic outline of the class in the player ----
  // Topics follow the class timeline, not the chapter lines.
  const nowEl = panel.querySelector<HTMLElement>('[data-listen-now]');
  const topicsEl = panel.querySelector<HTMLDetailsElement>('[data-listen-topics]');
  const topicList = topicsEl?.querySelector<HTMLOListElement>('ol') ?? null;
  const outlines = new Map<string, Promise<Outline | null>>();
  let listening = false;
  let shown: { lecture: number; topics: Topic[] } | null = null;

  const loadOutline = (path: string): Promise<Outline | null> => {
    let p = outlines.get(path);
    if (!p) {
      p = fetch(`/data/v1/${path}`)
        .then((r) => (r.ok ? (r.json() as Promise<Outline>) : null))
        .catch(() => null);
      outlines.set(path, p);
    }
    return p;
  };

  const updateNow = () => {
    if (!nowEl) return;
    const t = shown ? topicAt(shown.topics, audio.currentTime) : null;
    nowEl.hidden = !listening || !t;
    if (t) nowEl.textContent = `Now: ${t.title}`;
    for (const li of topicList?.children ?? []) {
      const b = li.querySelector('button');
      const on = !!t && b?.dataset['start'] === String(t.startSeconds);
      if (on) li.setAttribute('aria-current', 'true');
      else li.removeAttribute('aria-current');
    }
  };

  const showOutline = async () => {
    const lecture = currentLecture();
    const path = lecture === null ? undefined : data?.lectures[lecture]?.outline;
    if (!listening || lecture === null || !path) {
      shown = null;
      if (topicsEl) topicsEl.hidden = true;
      updateNow();
      return;
    }
    if (shown?.lecture === lecture) return updateNow();
    const outline = await loadOutline(path);
    if (!outline || currentLecture() !== lecture) return;
    shown = { lecture, topics: outline.topics };
    topicList?.replaceChildren(
      ...outline.topics.map((t) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset['start'] = String(t.startSeconds);
        const time = document.createElement('span');
        time.className = 'listen-topic-time';
        time.textContent = formatTime(t.startSeconds);
        b.append(time, ` ${t.title}`);
        b.addEventListener('click', () => setLecture(lecture, t.startSeconds));
        li.append(b);
        return li;
      }),
    );
    if (topicsEl) topicsEl.hidden = false;
    updateNow();
  };
  audio.addEventListener('timeupdate', updateNow);
  audio.addEventListener('seeked', updateNow);
  listeners.push(() => {
    shown = null;
    void showOutline();
  });

  const spanCache = new Map<number, Span[]>();
  return {
    setListening(on: boolean) {
      listening = on;
      void dataReady.then(() => showOutline());
    },
    spansFor(src: string): Span[] {
      const i = lectureOfSrc(src);
      if (i === null || !data) return [];
      let s = spanCache.get(i);
      if (!s) {
        s = spans(lectureItems(data, i));
        spanCache.set(i, s);
      }
      return s;
    },
    onSourceChange(fn: () => void) {
      listeners.push(fn);
    },
  };
}

// Last, so every module-level constant above is initialized.
const root = document.querySelector<HTMLElement>('[data-listen]');
if (root) init(root);
