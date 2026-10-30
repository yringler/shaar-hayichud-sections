/**
 * play.js: progressive enhancement for pages with a `[data-listen]` panel
 * (chapter pages with published alignments, and transcript pages).
 *
 * Chapter pages: shows the teacher and class selectors, adds a small play
 * button to every aligned line (`.line[data-t]`) that plays the teacher's
 * best class from that line (the `?teacher=` one, else the saved one), and a Show transcript toggle that
 * shows the class in the player's transcript in the docked panel.
 * Autoplay next plays the teacher's next class on the chapter when one ends.
 * Transcript pages: only the Follow along button. Follow along loads
 * follow.js on demand; its on/off state is saved for every page.
 *
 * Without JavaScript the page keeps a plain <audio> player and its text.
 */
import {
  chapterSeries,
  chooseSeries,
  formatTime,
  lectureItems,
  nextInSeries,
  rankRefs,
  resolveTeacher,
  scrollToShow,
  segmentItems,
  spanAt,
  spans,
  topicAt,
  type ChapterAlignments,
  type Outline,
  type Ref,
  type Span,
  type Topic,
  type Transcript,
} from './audio/model.ts';
import { playAt, replaceHash, scrollWatcher, smoothScroll } from './audio/player.ts';
import { autoplayNext, markPlaying, readStore, writeStore } from './audio/store.ts';
import type { FollowController, FollowOptions } from './follow.ts';

type FollowModule = { startFollow: (o: FollowOptions) => FollowController };

/** localStorage key of the reader's teacher (catalog series id), shared by every chapter page. */
const SERIES_KEY = 'shaarHayichud.audio.series';
/** URL parameter naming the teacher for this page load only (series id or teacherKey; never saved). */
const TEACHER_PARAM = 'teacher';
/** localStorage key of Follow along on/off ("on" / "off"), shared by chapter and transcript pages. */
const FOLLOW_KEY = 'shaarHayichud.audio.followAlong';

function init(panel: HTMLElement): void {
  const audio = panel.querySelector<HTMLAudioElement>('[data-listen-audio]');
  if (!audio) return;
  for (const el of panel.querySelectorAll<HTMLElement>('[data-js-only]')) el.hidden = false;
  for (const el of panel.querySelectorAll<HTMLElement>('[data-no-js]')) el.hidden = true;

  // Keep the docked panel's height in a CSS variable (page bottom padding,
  // scroll margins, follow.ts's visible area).
  const setHeight = () =>
    document.documentElement.style.setProperty('--listen-h', `${panel.classList.contains('is-active') ? panel.offsetHeight : 0}px`);
  const activate = () => {
    if (panel.classList.contains('is-active')) return;
    // Docking takes the panel out of the flow; if it was above the viewport
    // that shifts the text up, so scroll back by the same amount.
    const { bottom, height } = panel.getBoundingClientRect();
    const taken = height + (Number.parseFloat(getComputedStyle(panel).marginBlockEnd) || 0);
    panel.classList.add('is-active');
    setHeight();
    if (bottom <= 0) window.scrollBy(0, -taken);
  };
  audio.addEventListener('play', activate);
  window.addEventListener('resize', setHeight);
  // The panel's height changes when the topic list opens or a note appears.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(setHeight).observe(panel);

  const chapterUrl = panel.dataset['chapterAlignments'];
  const chapter = chapterUrl ? initChapter(panel, audio, chapterUrl, activate) : null;

  // Follow along
  const followButton = panel.querySelector<HTMLButtonElement>('[data-follow-along]');
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
  const setFollow = async (on: boolean, byReader: boolean) => {
    followButton?.setAttribute('aria-pressed', String(on));
    chapter?.setFollowing(on);
    if (byReader && on && audio.paused) {
      activate();
      void audio.play().catch(() => undefined);
    }
    const f = await loadFollow();
    // The reader may have toggled again while follow.js loaded.
    f?.setEnabled(followButton?.getAttribute('aria-pressed') === 'true');
  };
  followButton?.addEventListener('click', () => {
    const on = followButton.getAttribute('aria-pressed') !== 'true';
    writeStore(FOLLOW_KEY, on ? 'on' : 'off');
    void setFollow(on, true);
  });
  // Left on last time: turn it on again (without starting playback).
  if (followButton && readStore(FOLLOW_KEY) === 'on') void setFollow(true, false);
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
  /** Follow along on/off: shows the current class's topic outline, and the transcript region follows. */
  setFollowing(on: boolean): void;
}

interface SavedSeries {
  id: string;
  title: string;
}

/**
 * The teacher the page plays and where that choice came from: the page's
 * `?teacher=` link (applies to this page only, never saved) or the reader's
 * own pick in the selector (saved for every chapter page).
 */
interface Teacher extends SavedSeries {
  source: 'query' | 'selected';
}

function readSavedSeries(): SavedSeries | null {
  const raw = readStore(SERIES_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SavedSeries>;
    return typeof v.id === 'string' && typeof v.title === 'string' ? { id: v.id, title: v.title } : null;
  } catch {
    return null;
  }
}

const saveSeries = (s: SavedSeries): void => writeStore(SERIES_KEY, JSON.stringify(s));

function initChapter(panel: HTMLElement, audio: HTMLAudioElement, url: string, activate: () => void): ChapterPlayer {
  const seriesSelect = panel.querySelector<HTMLSelectElement>('[data-listen-series]');
  const select = panel.querySelector<HTMLSelectElement>('[data-listen-select]');
  const transcriptLink = panel.querySelector<HTMLAnchorElement>('[data-listen-transcript]');
  const note = panel.querySelector<HTMLElement>('[data-listen-note]');
  // Every class option, as rendered; the class selector shows one series at a time.
  const allOptions = select ? [...select.querySelectorAll('option')] : [];
  const listeners: (() => void)[] = [];
  let data: ChapterAlignments | null = null;
  /** Follow along is on. */
  let following = false;

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
    syncTranscript();
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
    void playAt(audio, autoplayAt);
  };

  /** The reader's saved teacher (possibly not on this chapter). */
  let preferred: SavedSeries | null = readSavedSeries();
  /** `?teacher=` of this page load, if any (dropped once the reader picks a teacher). */
  const teacherParam = new URLSearchParams(window.location.search).get(TEACHER_PARAM);
  /**
   * The teacher the line buttons play: the `?teacher=` one when it covers the
   * chapter, else the saved one when it does, else the default teacher
   * (Walters original class).
   */
  let wanted: Teacher | null = null;

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
      // Apply the linked (?teacher=) teacher, else the saved one, else the
      // default; a linked or saved teacher with no classes here falls back visibly.
      const here = chapterSeries(d);
      const linked = resolveTeacher(here, teacherParam);
      const { series: chosen, fellBack } = linked
        ? { series: linked, fellBack: false }
        : chooseSeries(here, preferred?.id ?? null);
      if (chosen && seriesSelect) {
        wanted = { ...chosen, source: linked ? 'query' : 'selected' };
        seriesSelect.value = chosen.id;
        fillClasses(chosen.id);
        const first = d.lectures.findIndex((l) => l.seriesId === chosen.id);
        if (audio.paused && currentLecture() !== first) setLecture(first, null);
        else syncControls(currentLecture() ?? first);
        if (teacherParam && !linked) {
          showNote(`The linked teacher (“${teacherParam}”) has no published classes on this chapter yet; showing ${chosen.title}.`);
        } else if (preferred && fellBack) {
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
    wanted = { ...preferred, source: 'selected' };
    saveSeries(preferred);
    // The reader's own pick replaces the link's: drop ?teacher= so a reload
    // or a copied URL does not bring the linked teacher back.
    if (teacherParam !== null) {
      const u = new URL(window.location.href);
      u.searchParams.delete(TEACHER_PARAM);
      window.history.replaceState(window.history.state, '', u);
    }
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

  // ---- Autoplay next: the same teacher's next class (the next option in
  // the Class selector) from the start; after the last one, stop ----
  const autoplayOn = autoplayNext([...panel.querySelectorAll<HTMLInputElement>('[data-autoplay-next]')]);
  markPlaying(audio, panel);
  audio.addEventListener('ended', () => {
    const lecture = currentLecture();
    if (!autoplayOn() || !data || lecture === null) return;
    const next = nextInSeries(data.lectures, lecture);
    const l = next === null ? undefined : data.lectures[next];
    if (next === null || !l) {
      showNote(`That was the last class of ${data.lectures[lecture]?.series ?? 'this teacher'} on this chapter.`);
      return;
    }
    showNote(`Playing next: ${l.title}`);
    setLecture(next, 0);
  });

  // ---- per-line play buttons ----
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
      b.setAttribute('aria-label', 'Play from here');
      span.before(b);
    }
  };

  // One delegated handler: play buttons always (the saved teacher's best
  // class, no menu); the line text itself only while Follow along is on (so
  // ordinary reading clicks and text selection are never hijacked).
  let pendingClick: number | undefined;
  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    const button = target.closest<HTMLElement>('.line-play[data-line]');
    if (button) {
      const best = ranked(button.dataset['line']!)[0];
      if (best) playRef(best);
      return;
    }
    const line = target.closest<HTMLElement>('.line.has-audio');
    if (!line || !following) return;
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

  // ---- transcript of the class in the player, in the docked panel ----
  const toggle = panel.querySelector<HTMLButtonElement>('[data-listen-transcript-toggle]');
  const pane = panel.querySelector<HTMLElement>('[data-listen-transcript-pane]');
  const transcripts = new Map<string, Promise<Transcript | null>>();
  /** The reader asked to see the transcript (kept while a class without one plays). */
  let paneWanted = false;
  /** Class whose transcript is rendered in the pane, its spans and paragraphs. */
  let paneLecture: number | null = null;
  let paneSpans: Span[] = [];
  let paneParas: HTMLElement[] = [];
  let paneSpan: Span | null = null;
  /** The reader has not scrolled the region for a while (see scrollWatcher()). */
  const paneQuiet = pane ? scrollWatcher(pane) : () => true;

  const loadTranscript = (path: string): Promise<Transcript | null> => {
    let p = transcripts.get(path);
    if (!p) {
      p = fetch(`/data/v1/${path}`)
        .then((r) => (r.ok ? (r.json() as Promise<Transcript>) : null))
        .catch(() => null);
      transcripts.set(path, p);
    }
    return p;
  };

  /** Mark the current paragraph; with Follow along on, keep it in view inside the region (never the page). */
  const updatePane = (reposition: boolean) => {
    if (!pane || pane.hidden || paneLecture === null || paneLecture !== currentLecture()) return;
    const span = spanAt(paneSpans, audio.currentTime);
    if (span !== paneSpan) {
      for (const k of paneSpan?.keys ?? []) {
        paneParas[Number(k)]?.classList.remove('is-discussing');
        paneParas[Number(k)]?.removeAttribute('aria-current');
      }
      for (const k of span?.keys ?? []) {
        paneParas[Number(k)]?.classList.add('is-discussing');
        paneParas[Number(k)]?.setAttribute('aria-current', 'true');
      }
      paneSpan = span;
    } else if (!reposition) return;
    const el = span ? paneParas[Number(span.keys[0])] : undefined;
    if (!el) return;
    const auto = following && !audio.paused && paneQuiet();
    if (!reposition && !auto) return;
    const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    const to = scrollToShow(pane.scrollTop, pane.clientHeight, top, el.offsetHeight);
    if (to !== null) pane.scrollTo({ top: to, behavior: reposition ? 'auto' : smoothScroll() });
  };

  const renderPane = async (lecture: number, path: string) => {
    if (!pane) return;
    paneLecture = lecture;
    paneSpans = [];
    paneParas = [];
    paneSpan = null;
    const loading = document.createElement('p');
    loading.className = 'listen-transcript-status';
    loading.textContent = 'Loading transcript…';
    pane.replaceChildren(loading);
    const t = await loadTranscript(path);
    if (paneLecture !== lecture) return; // the class changed meanwhile
    if (!t) {
      loading.textContent = 'The transcript could not be loaded.';
      return;
    }
    let prev = '';
    paneParas = t.segments.map((seg, i) => {
      const p = document.createElement('p');
      p.className = 'tseg';
      p.dataset['start'] = String(seg.startSeconds);
      p.dataset['end'] = String(seg.endSeconds);
      p.dataset['i'] = String(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'line-play';
      b.setAttribute('aria-label', `Play from ${formatTime(seg.startSeconds)}`);
      p.append(b);
      const sp = seg.speaker ?? '';
      if (sp && sp !== prev) {
        const label = document.createElement('span');
        label.className = 'tseg-speaker';
        label.textContent = sp;
        p.append(label);
      }
      prev = sp;
      p.append(seg.text);
      return p;
    });
    paneSpans = spans(segmentItems(t));
    pane.replaceChildren(...paneParas);
    pane.scrollTop = 0;
    updatePane(true);
  };

  /** Toggle visibility and text, and the pane's content, for the class in the player. */
  function syncTranscript(): void {
    if (!toggle || !pane) return;
    const lecture = currentLecture();
    const path = lecture === null ? undefined : data?.lectures[lecture]?.transcript;
    toggle.hidden = !path;
    const show = paneWanted && !!path;
    toggle.setAttribute('aria-expanded', String(show));
    toggle.textContent = show ? 'Hide transcript' : 'Show transcript';
    const wasHidden = pane.hidden;
    pane.hidden = !show;
    if (!show || lecture === null || !path) return;
    if (paneLecture !== lecture) void renderPane(lecture, path);
    else if (wasHidden) updatePane(true);
  }

  toggle?.addEventListener('click', () => {
    paneWanted = toggle.getAttribute('aria-expanded') !== 'true';
    if (paneWanted) activate(); // the transcript lives in the docked panel
    syncTranscript();
  });

  // Click a paragraph (or its play button) to play from there; selection-safe.
  pane?.addEventListener('click', (e) => {
    const target = e.target as Element;
    const p = target.closest<HTMLElement>('.tseg');
    if (!p || paneLecture === null) return;
    if (!target.closest('.line-play')) {
      const sel = window.getSelection();
      if ((sel && !sel.isCollapsed) || e.detail > 1) return;
    }
    showNote(null);
    setLecture(paneLecture, Number(p.dataset['start']));
  });
  audio.addEventListener('timeupdate', () => updatePane(false));
  audio.addEventListener('seeked', () => updatePane(false));

  // ---- auto-generated topic outline of the class in the player ----
  // Topics follow the class timeline, not the chapter lines.
  const nowEl = panel.querySelector<HTMLElement>('[data-listen-now]');
  const topicsEl = panel.querySelector<HTMLDetailsElement>('[data-listen-topics]');
  const topicList = topicsEl?.querySelector<HTMLOListElement>('ol') ?? null;
  const outlines = new Map<string, Promise<Outline | null>>();
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
    nowEl.hidden = !following || !t;
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
    if (!following || lecture === null || !path) {
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
  const spansFor = (src: string): Span[] => {
    const i = lectureOfSrc(src);
    if (i === null || !data) return [];
    let s = spanCache.get(i);
    if (!s) {
      s = spans(lectureItems(data, i));
      spanCache.set(i, s);
    }
    return s;
  };

  // ---- the line under discussion in the URL (#<line id>, no history entry) ----
  // Whether or not Follow along is on; kept when playback pauses or stops, so
  // a reload or a copied link lands on that line.
  const showLineInUrl = () => {
    if (audio.paused) return;
    const span = spanAt(spansFor(audio.getAttribute('src') || audio.currentSrc), audio.currentTime);
    const id = span?.keys.find((k) => document.getElementById(k)?.classList.contains('line'));
    if (id) replaceHash(id);
  };
  for (const ev of ['timeupdate', 'seeked', 'play'] as const) audio.addEventListener(ev, showLineInUrl);

  return {
    setFollowing(on: boolean) {
      following = on;
      void dataReady.then(() => showOutline());
      if (on) updatePane(true);
    },
    spansFor,
    onSourceChange(fn: () => void) {
      listeners.push(fn);
    },
  };
}

// Last, so every module-level constant above is initialized.
const root = document.querySelector<HTMLElement>('[data-listen]');
if (root) init(root);
