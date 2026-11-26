/**
 * play.js: progressive enhancement for the `[data-listen]` panel of chapter
 * pages with published alignments.
 *
 * Shows the teacher and class selectors, adds a small play button to every
 * aligned line (`.line[data-t]`) that plays the teacher's best class from
 * that line (the `?teacher=` one, else the saved one), and the "Study guide"
 * pill of the teacher in the player. Autoplay next plays the teacher's next
 * class on the chapter when one ends. Follow along loads follow.js on
 * demand; its on/off state is saved for every page.
 *
 * Without JavaScript the page keeps a plain <audio> player and its text.
 */
import {
  chapterSeries,
  chooseSeries,
  formatTime,
  lectureItems,
  lineInClass,
  nextInSeries,
  playableRefs,
  playStart,
  resolveTeacher,
  spanAt,
  spans,
  topicAt,
  type ChapterAlignments,
  type Outline,
  type Ref,
  type Span,
  type Topic,
} from './audio/model.ts';
import { playAt, replaceHash } from './audio/player.ts';
import { autoplayNext, FOLLOW_KEY, markPlaying, readStore, writeStore } from './audio/store.ts';
import { studyLinkHref } from './audio/study-model.ts';
import type { FollowController, FollowOptions } from './follow.ts';

type FollowModule = { startFollow: (o: FollowOptions) => FollowController };

/** localStorage key of the reader's teacher (catalog series id), shared by every chapter page. */
const SERIES_KEY = 'shaarHayichud.audio.series';
/** URL parameter naming the teacher for this page load only (series id or teacherKey; never saved). */
const TEACHER_PARAM = 'teacher';

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
  if (!chapterUrl) return;
  const chapter = initChapter(panel, audio, chapterUrl, activate);

  // Follow along
  const followButton = panel.querySelector<HTMLButtonElement>('[data-follow-along]');
  let follow: FollowController | null = null;
  let loading: Promise<FollowController | null> | null = null;
  const loadFollow = (): Promise<FollowController | null> => {
    loading ??= (async () => {
      const src = panel.dataset['followSrc'];
      if (!src) return null;
      const mod = (await import(/* @vite-ignore */ src)) as FollowModule;
      const options: FollowOptions = {
        audio,
        spansFor: (s) => chapter.spansFor(s),
        elementsFor: (key) => {
          const el = document.getElementById(key);
          return el ? [el] : [];
        },
      };
      follow = mod.startFollow(options);
      chapter.onSourceChange(() => follow?.refresh());
      return follow;
    })();
    return loading;
  };
  const setFollow = async (on: boolean, byReader: boolean) => {
    followButton?.setAttribute('aria-pressed', String(on));
    chapter.setFollowing(on);
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

interface ChapterPlayer {
  spansFor(src: string): Span[];
  onSourceChange(fn: () => void): void;
  /** Follow along on/off: shows the current class's topic outline. */
  setFollowing(on: boolean): void;
}

interface SavedSeries {
  id: string;
  title: string;
  /** The series' teacher, when known: another series of theirs stands in where this one has no classes. */
  teacher?: string;
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
    if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
    return typeof v.teacher === 'string' ? { id: v.id, title: v.title, teacher: v.teacher } : { id: v.id, title: v.title };
  } catch {
    return null;
  }
}

const saveSeries = (s: SavedSeries): void => writeStore(SERIES_KEY, JSON.stringify(s));

/** The panel's data-study-guides: catalog series id -> its public guide of the chapter. */
function readGuides(json: string | undefined): Record<string, { url: string; lectures: string[] } | undefined> {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' ? (v as Record<string, { url: string; lectures: string[] }>) : {};
  } catch {
    return {};
  }
}

function initChapter(panel: HTMLElement, audio: HTMLAudioElement, url: string, activate: () => void): ChapterPlayer {
  const seriesSelect = panel.querySelector<HTMLSelectElement>('[data-listen-series]');
  const select = panel.querySelector<HTMLSelectElement>('[data-listen-select]');
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
  /** The class chosen in the Class selector (the one in the player): line buttons play only it. */
  const chosenLecture = (): number | null => {
    const v = select?.value;
    return v ? Number(v) : currentLecture();
  };
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
    updateLineStates();
    syncStudy();
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

  // ---- "Study guide": the guide of the teacher in the player, at the class
  // and (once it has played) the moment: ?class=<slug>&t=<s> ----
  const studyLink = panel.querySelector<HTMLAnchorElement>('[data-listen-study]');
  const guides = readGuides(panel.dataset['studyGuides']);
  const syncStudy = () => {
    if (!studyLink) return;
    const l = data?.lectures[currentLecture() ?? -1];
    const g = l ? guides[l.seriesId] : undefined;
    studyLink.hidden = !g;
    if (!g || !l) return;
    const inGuide = g.lectures.includes(l.id);
    const played = !audio.paused || audio.currentTime > 0;
    studyLink.href = studyLinkHref(g.url, inGuide ? l.id : null, inGuide && played ? audio.currentTime : null);
  };
  for (const ev of ['timeupdate', 'seeked', 'pause'] as const) audio.addEventListener(ev, syncStudy);

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

  // ---- "From start of class": a tap on a class's first line on the chapter
  // that comes well after the class's part on it starts (an intro, or the
  // hand-off from the previous chapter) plays the line and offers that start
  // (playStart in audio/model.ts). The offer goes once playback is past the
  // line's range (at least 10 s), in another class, or after another tap. ----
  const fromStart = panel.querySelector<HTMLButtonElement>('[data-listen-from-start]');
  let offer: { url: string; start: number; until: number; armed: boolean } | null = null;
  const hideOffer = () => {
    offer = null;
    if (fromStart) fromStart.hidden = true;
  };
  const showOffer = (url: string, start: number, line: Ref) => {
    if (!fromStart) return;
    const what = start === 0 ? 'class' : 'this chapter in the class';
    const label = `From start of ${what} (${formatTime(line.startSeconds - start)} earlier)`;
    fromStart.replaceChildren(
      Object.assign(document.createElement('span'), { textContent: '⏮' }),
      document.createTextNode(` ${label}`),
    );
    fromStart.firstElementChild?.setAttribute('aria-hidden', 'true');
    fromStart.title = `Play from ${formatTime(start)}`;
    // Armed by the seek to the line, so the old position before it does not count.
    offer = { url, start, until: Math.max(line.endSeconds, line.startSeconds + 10), armed: false };
    fromStart.hidden = false;
  };
  fromStart?.addEventListener('click', () => {
    if (!offer) return;
    const t = offer.start;
    hideOffer();
    void playAt(audio, t);
  });
  audio.addEventListener('seeked', () => {
    if (offer) offer.armed = true;
  });
  audio.addEventListener('timeupdate', () => {
    if (!offer) return;
    if ((audio.getAttribute('src') || audio.currentSrc) !== offer.url) hideOffer();
    else if (offer.armed && !audio.seeking && (audio.currentTime > offer.until || audio.currentTime < offer.start - 1)) hideOffer();
  });

  const playRef = (r: Ref) => {
    const l = data?.lectures[r.lecture];
    if (!l || !data) return;
    // Leaving the chosen class for a line it doesn't read says so first.
    const chosen = chosenLecture();
    const from = chosen === null || chosen === r.lecture ? undefined : data?.lectures[chosen];
    showNote(
      from
        ? `This line is not in “${from.title}”; playing ${l.series}: ${l.title}.`
        : wanted && l.seriesId !== wanted.id
          ? `This line is not in ${wanted.title}'s classes yet; playing ${l.series}: ${l.title}.`
          : null,
    );
    const start = playStart(data, r);
    setLecture(r.lecture, start.seekSeconds);
    if (start.offerStartSeconds === null) hideOffer();
    else showOffer(l.url, start.offerStartSeconds, r);
  };

  const ranked = (lineId: string): Ref[] => {
    const line = data?.lines.find((x) => x.lineId === lineId);
    if (!data || !line) return [];
    const seriesId = wanted?.id ?? selectedSeries();
    return playableRefs(line.refs, data.lectures, { currentLecture: currentLecture(), seriesId }, chosenLecture());
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
        : chooseSeries(here, preferred?.id ?? null, preferred?.teacher ?? null);
      // A choice saved before series had teachers learns its teacher here.
      const own = preferred && here.find((s) => s.id === preferred!.id);
      if (preferred && preferred.teacher === undefined && own?.teacher !== undefined) {
        preferred = { ...preferred, teacher: own.teacher };
        saveSeries(preferred);
      }
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
    const teacher = data ? chapterSeries(data).find((s) => s.id === id)?.teacher : undefined;
    preferred = teacher === undefined ? { id, title: seriesTitle(id) } : { id, title: seriesTitle(id), teacher };
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
      lineRefs.set(line.lineId, line.refs);
    }
    updateLineStates();
  };

  /** Each decorated line's refs, by line id. */
  const lineRefs = new Map<string, ChapterAlignments['lines'][number]['refs']>();

  /** The hint on a line the chosen class doesn't read. */
  const otherClassHint = (): string => {
    const l = data?.lectures[chosenLecture() ?? -1];
    return l ? `Not in “${l.title}”: plays another class` : '';
  };

  /**
   * Line buttons of lines the chosen class doesn't read are marked
   * (.is-other-class, drawn hollow) with a title; they still play, another
   * class, and the note says so.
   */
  const updateLineStates = () => {
    const chosen = chosenLecture();
    const hint = otherClassHint();
    for (const b of document.querySelectorAll<HTMLButtonElement>('.line-play[data-line]')) {
      const refs = lineRefs.get(b.dataset['line']!);
      if (!refs) continue;
      const other = !lineInClass(refs, chosen);
      b.classList.toggle('is-other-class', other);
      if (other) {
        b.title = hint;
        b.setAttribute('aria-label', `Play from here (${hint})`);
      } else {
        b.removeAttribute('title');
        b.setAttribute('aria-label', 'Play from here');
      }
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
