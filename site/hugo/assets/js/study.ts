/**
 * study.js: the docked class player of a study guide page
 * (/study/<series>/chapter-N/, layouts/study/single.html) and follow.
 *
 * Without JS the page is complete: each class has its own <audio> in
 * "Classes on this chapter" and every ▶ is a link to the recording. This
 * script hides those players, shows the bar ([data-study-player],
 * partials/study/player.html: class selector, ⏮15 / player / 15⏭, "Now:",
 * Follow, Autoplay next) and drives it:
 *
 * - The guide is read from the page's data-* attributes into the
 *   StudyPassage[] of audio/study-model.ts, which says what is current
 *   (studyAt), which passage the page follows (followPassage), where "play
 *   from here" starts (studySeekTarget) and Autoplay next (nextStudyPart).
 * - The current block gets `is-discussing` (side border, filled by
 *   progress through `--p`), the current phrase `is-discussing` (a tint),
 *   both aria-current. A polite live region announces section changes only.
 * - Follow (the shared Follow along setting) scrolls the page, never
 *   anything else, and only when the current item changes and is off
 *   screen: a block's top to 25% of the visible area, a phrase to 30%; a
 *   passage change waits for followPassage's hold; an outOfPlace block more
 *   than one passage away is not scrolled to (the bar says "Now: aside on
 *   another passage · Go to"). Nothing moves for 5 s after the reader
 *   scrolls (scrollWatcher); a reader who scrolls the current item off
 *   screen detaches follow, and a "Back to now" pill appears until they tap
 *   it, bring the item back into view, press any ▶ or toggle Follow.
 * - Taps: a phrase plays from it (selection-safe); a ▶ link plays its block,
 *   class start or overview moment in the bar. Never autoplays.
 * - Arrival: `?class=<transcript slug>&t=<s>`, `#<line id>`, `#s-…`,
 *   `#b-…` select the class, mark the item and put a focused "▶ Play from
 *   m:ss" button next to it (and seekOnPlay); `?class` alone scrolls to the
 *   class's divider. `class` and `t` are then dropped from the URL.
 * - While playing, the fragment is the current line id (replaceHash).
 */
import { formatTime } from './audio/model.ts';
import { playAt, replaceHash, scrollWatcher, seekOnPlay, smoothScroll } from './audio/player.ts';
import { autoplayNext, FOLLOW_KEY, markPlaying, readStore, writeStore } from './audio/store.ts';
import {
  followPassage,
  itemProgress,
  nextStudyPart,
  parseStudyLink,
  partForSlug,
  scrollTopFor,
  shouldScrollTo,
  studyAt,
  studySeekTarget,
  studyTimeline,
  transcriptSlug,
  type FollowState,
  type StudyAudio,
  type StudyElement,
  type StudyPart,
  type StudyPassage,
  type StudyPosition,
  type StudySeek,
  type StudyTimeline,
} from './audio/study-model.ts';

/** A class of the chapter (li.study-class), in study/index.json order. */
interface Part extends StudyPart {
  label: string;
  url: string;
  /** The guide the class reads on into (continuesIn), if public. */
  continuesUrl: string | null;
}

/** The guide as the page renders it. */
interface Guide {
  passages: StudyPassage[];
  passEls: HTMLElement[];
  /** Phrase and block key -> element. */
  els: Map<string, HTMLElement>;
  /** Phrase and block element -> its place in `passages`. */
  where: Map<HTMLElement, StudyElement>;
}

/** Scroll positions for a new current item, as a share of the visible area from its top. */
const BLOCK_AT = 0.25;
const PHRASE_AT = 0.3;
/** A block taller than the visible area scrolls in proportion, its progress point here, at most every… */
const TALL_AT = 0.4;
const TALL_EVERY_MS = 4000;
/** "From start of class" goes once playback is this far past where the tap played from. */
const OFFER_SECONDS = 30;

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

function readGuide(root: HTMLElement): Guide {
  const passEls = [...root.querySelectorAll<HTMLElement>('.study-passage')];
  const els = new Map<string, HTMLElement>();
  const where = new Map<HTMLElement, StudyElement>();
  const passages = passEls.map((p, i): StudyPassage => {
    const lines = [...p.querySelectorAll<HTMLElement>('.study-text .line[data-line]')].map((l) => l.dataset['line'] ?? '');
    const phrases = [...p.querySelectorAll<HTMLElement>('.phrase')].map((el, j) => {
      const key = `${p.id}.p${j}`;
      els.set(key, el);
      where.set(el, { passage: i, phrase: j });
      const line = el.closest<HTMLElement>('.line')?.dataset['line'];
      return {
        key,
        lines: line ? [line] : [],
        en: el.querySelector('.phrase-en') !== null,
        lecture: el.dataset['lecture'],
        start: num(el.dataset['start']),
        end: num(el.dataset['end']),
      };
    });
    const blocks = [...p.querySelectorAll<HTMLElement>('.study-block')].map((el, j) => {
      els.set(el.id, el);
      where.set(el, { passage: i, block: j });
      const audio: StudyAudio[] = [{ lecture: el.dataset['lecture'] ?? '', start: num(el.dataset['start']), end: num(el.dataset['end']) }];
      const more = el.dataset['tellings'];
      if (more) {
        try {
          audio.push(...(JSON.parse(more) as StudyAudio[]));
        } catch {
          // A malformed attribute only loses the further tellings.
        }
      }
      return { key: el.id, audio, outOfPlace: el.dataset['outOfPlace'] === '1' };
    });
    return { key: p.id, lines, phrases, blocks };
  });
  return { passages, passEls, els, where };
}

function readParts(root: HTMLElement): Part[] {
  return [...root.querySelectorAll<HTMLElement>('li.study-class[data-lecture]')].map((li) => ({
    id: li.dataset['lecture'] ?? '',
    start: num(li.dataset['start']) ?? 0,
    end: num(li.dataset['end']) ?? Number.POSITIVE_INFINITY,
    continuesIn: li.dataset['continuesIn'],
    label: li.dataset['label'] ?? '',
    url: li.dataset['url'] ?? '',
    continuesUrl: li.dataset['continuesUrl'] ?? null,
  }));
}

function init(root: HTMLElement, bar: HTMLElement): void {
  const audio = bar.querySelector<HTMLAudioElement>('[data-study-audio]');
  const select = bar.querySelector<HTMLSelectElement>('[data-study-select]');
  const parts = readParts(root);
  if (!audio || !select || parts.length === 0) return;
  const guide = readGuide(root);
  const q = <T extends Element>(sel: string) => bar.querySelector<T>(sel);
  const followBtn = q<HTMLButtonElement>('[data-study-follow]');
  const nowEl = q<HTMLElement>('[data-study-now]');
  const nowText = q<HTMLElement>('[data-study-now-text]');
  const gotoBtn = q<HTMLButtonElement>('[data-study-goto]');
  const note = q<HTMLElement>('[data-study-note]');
  const fromStart = q<HTMLButtonElement>('[data-study-from-start]');
  const nextLink = q<HTMLAnchorElement>('[data-study-next]');
  const pill = document.querySelector<HTMLButtonElement>('[data-study-back-now]');
  const live = document.querySelector<HTMLElement>('[data-study-live]');

  bar.hidden = false;
  root.classList.add('is-enhanced');
  for (const el of root.querySelectorAll<HTMLElement>('[data-no-js]')) el.hidden = true;

  // ---- docking (as play.ts does for the chapter panel) ----
  /** Until then, scroll events are ours (or the browser's), not the reader's. */
  let autoUntil = 0;
  const docked = () => bar.classList.contains('is-active');
  const setHeight = () => document.documentElement.style.setProperty('--listen-h', `${docked() ? bar.offsetHeight : 0}px`);
  const activate = () => {
    if (docked()) return;
    // Docking takes the bar out of the flow; if it was above the viewport
    // that shifts the text up, so scroll back by the same amount.
    const { bottom, height } = bar.getBoundingClientRect();
    const taken = height + (Number.parseFloat(getComputedStyle(bar).marginBlockEnd) || 0);
    bar.classList.add('is-active');
    if (nowEl) nowEl.hidden = false;
    setHeight();
    if (bottom <= 0) {
      autoUntil = Date.now() + 300;
      window.scrollBy(0, -taken);
    }
  };
  audio.addEventListener('play', activate);
  window.addEventListener('resize', setHeight);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(setHeight).observe(bar);

  const visible = () => window.innerHeight - (docked() ? bar.offsetHeight : 0);
  /** Wholly outside the visible area. */
  const offscreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom <= 0 || r.top >= visible();
  };
  /** Not usefully on screen: at most a sliver at an edge. */
  const mostlyOff = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom < 32 || r.top > visible() - 48;
  };
  const scrollPage = (top: number, behavior: ScrollBehavior) => {
    autoUntil = Date.now() + (behavior === 'smooth' ? 1500 : 150);
    window.scrollTo({ top, behavior });
  };
  window.addEventListener('scrollend', () => (autoUntil = 0));
  const scrollToShow = (el: Element, ratio: number, behavior: ScrollBehavior = smoothScroll()) =>
    scrollPage(scrollTopFor(window.scrollY, el.getBoundingClientRect().top, visible(), ratio), behavior);

  // ---- the class in the player ----
  const partOf = (id: string) => parts.find((p) => p.id === id) ?? null;
  const timelines = new Map<string, StudyTimeline>();
  const timeline = (id: string): StudyTimeline => {
    let tl = timelines.get(id);
    if (!tl) {
      tl = studyTimeline(guide.passages, id, partOf(id));
      timelines.set(id, tl);
    }
    return tl;
  };
  let lecture = parts[0]!.id;

  const showNote = (text: string | null) => {
    if (!note) return;
    note.textContent = text ?? '';
    note.hidden = !text;
  };
  const showNext = (href: string | null, text: string) => {
    if (!nextLink) return;
    nextLink.hidden = !href;
    if (href) {
      nextLink.href = href;
      nextLink.textContent = text;
    }
  };
  const showNextGuide = () => {
    const url = bar.dataset['nextUrl'];
    showNext(url ?? null, `Next: ${bar.dataset['nextLabel'] ?? 'the next chapter'}’s guide →`);
  };

  // ---- "From start of class" (studySeekTarget's offerStartSeconds) ----
  let offer: { start: number; until: number } | null = null;
  const hideOffer = () => {
    offer = null;
    if (fromStart) fromStart.hidden = true;
  };
  const showOffer = (start: number, from: number) => {
    if (!fromStart) return;
    const what = start === 0 ? 'class' : 'this chapter in the class';
    fromStart.textContent = `⏮ From start of ${what} (${formatTime(from - start)} earlier)`;
    fromStart.title = `Play from ${formatTime(start)}`;
    offer = { start, until: from + OFFER_SECONDS };
    fromStart.hidden = false;
  };
  fromStart?.addEventListener('click', () => {
    if (!offer) return;
    const t = offer.start;
    hideOffer();
    attach();
    seekingTo = t;
    void playAt(audio, t);
  });

  // ---- what is current ----
  let curPhrase: HTMLElement | null = null;
  let curBlock: HTMLElement | null = null;
  let follow: FollowState | null = null;
  let section: Element | null = null;
  let following = readStore(FOLLOW_KEY) !== 'off';
  /** The reader scrolled the current item off screen: highlights go on, the page stays put. */
  let detached = false;
  let lastTall = 0;
  let selected: HTMLElement | null = null;
  /**
   * A seek of ours not landed yet (playAt() waits for the metadata, and
   * play() starts at the old position meanwhile): no update until it lands,
   * so the page never scrolls to where playback was before it.
   */
  let seekingTo: number | null = null;
  const quiet = scrollWatcher(window, '[data-study-player]');

  const setCurrent = (phrase: HTMLElement | null, block: HTMLElement | null) => {
    for (const [old, now] of [
      [curPhrase, phrase],
      [curBlock, block],
    ] as const) {
      if (old === now) continue;
      old?.classList.remove('is-discussing');
      old?.removeAttribute('aria-current');
      old?.style.removeProperty('--p');
      now?.classList.add('is-discussing');
      now?.setAttribute('aria-current', 'true');
    }
    curPhrase = phrase;
    curBlock = block;
  };
  /** The current item: the phrase being said, else the block. */
  const currentEl = () => curPhrase ?? curBlock;

  const sectionOf = (passage: number | null) =>
    passage === null ? null : guide.passEls[passage]?.closest('.study-section') ?? null;
  const sectionTitle = (s: Element | null) => s?.querySelector(':scope > h2')?.textContent?.trim() ?? '';

  /** Far: an outOfPlace block alone, more than one passage from the one followed. */
  const far = (p: StudyPosition) =>
    p.state === 'playing' &&
    p.outOfPlace &&
    p.phrase === null &&
    p.passage !== null &&
    !shouldScrollTo(follow?.passage ?? null, p.passage);

  const showNow = (p: StudyPosition) => {
    if (!nowText) return;
    let text: string;
    if (p.state === 'before') text = 'Now: the start of the class, before this chapter';
    else if (p.state === 'gap') text = 'Now: not in the guide';
    else if (p.state === 'after') text = p.continuesIn ? 'Now: the class goes on into the next chapter' : 'Now: past this chapter in the class';
    else if (far(p)) text = 'Now: aside on another passage';
    else text = `Now: ${sectionTitle(sectionOf(p.passage))}`;
    nowText.textContent = text;
    nowEl?.classList.toggle('is-muted', p.state !== 'playing');
    if (gotoBtn) gotoBtn.hidden = !far(p);
    const part = partOf(lecture);
    if (p.state === 'after' && part?.continuesUrl) {
      showNext(part.continuesUrl, `This class goes on in ${chapterLabel(part.continuesIn)}’s guide →`);
    } else if (p.state !== 'after' && nextLink && !nextLink.dataset['sticky']) nextLink.hidden = true;
  };
  gotoBtn?.addEventListener('click', () => {
    if (curBlock) scrollToShow(curBlock, BLOCK_AT);
  });

  /** A short name of the current item for the Back to now pill. */
  const itemLabel = (el: HTMLElement): string => {
    if (el.classList.contains('phrase')) {
      const en = el.querySelector('.phrase-en')?.textContent?.trim() ?? '';
      return en ? `“${en}”` : sectionTitle(el.closest('.study-section'));
    }
    const head = el.matches('div') ? el.querySelector(':scope > .study-block-head') : el;
    const tag = head?.querySelector('.study-tag')?.textContent?.trim();
    const title = head?.querySelector('.study-block-title, .study-join-title')?.textContent?.trim();
    const kind = tag ? tag.charAt(0) + tag.slice(1).toLowerCase() : 'Explanation';
    return title ? `${kind}: ${title}` : kind;
  };

  const updatePill = () => {
    if (!pill) return;
    const el = currentEl();
    const show = !!el && detached && following && !audio.paused && offscreen(el);
    pill.hidden = !show;
    if (!show || !el) return;
    const up = el.getBoundingClientRect().bottom <= 0;
    pill.textContent = `${up ? '↑' : '↓'} Back to now · ${itemLabel(el)}`;
  };

  /** Follow again (the reader pressed ▶, Back to now, or Follow), from the position now. */
  const attach = () => {
    detached = false;
    follow = null;
    updatePill();
  };

  const autoScroll = (p: StudyPosition, phraseChanged: boolean, blockChanged: boolean, passageChanged: boolean) => {
    if (!following || detached || audio.paused || p.state !== 'playing' || !quiet()) return;
    const followed = follow?.passage ?? null;
    const blockPassage = curBlock ? guide.where.get(curBlock)?.passage ?? null : null;
    const phrasePassage = curPhrase ? guide.where.get(curPhrase)?.passage ?? null : null;
    if (curBlock && (blockChanged || passageChanged) && blockPassage !== null) {
      const ok = p.outOfPlace ? shouldScrollTo(followed, blockPassage) && !far(p) : blockPassage === followed;
      if (ok && mostlyOff(curBlock)) return scrollToShow(curBlock, BLOCK_AT);
    }
    if (curPhrase && (phraseChanged || passageChanged) && phrasePassage === followed) {
      if (mostlyOff(curPhrase)) return scrollToShow(curPhrase, PHRASE_AT);
    }
    // A block taller than the visible area: keep its progress point in view.
    if (curBlock && !curPhrase && !blockChanged && blockPassage === followed && curBlock.offsetHeight > visible()) {
      if (Date.now() - lastTall < TALL_EVERY_MS) return;
      const r = curBlock.getBoundingClientRect();
      const pr = Number(curBlock.style.getPropertyValue('--p')) || 0;
      const y = r.top + pr * r.height;
      if (Math.abs(y - visible() * TALL_AT) > visible() * 0.15) {
        lastTall = Date.now();
        scrollPage(scrollTopFor(window.scrollY, y, visible(), TALL_AT), smoothScroll());
      }
    }
  };

  const update = (seeked = false) => {
    const t = audio.currentTime;
    if (seekingTo !== null) {
      if (Math.abs(t - seekingTo) > 1.5) return;
      seekingTo = null;
    }
    const tl = timeline(lecture);
    const p = studyAt(tl, t);
    const before = follow?.passage ?? null;
    if (seeked) follow = null;
    follow = followPassage(follow, p, t);
    const phrase = p.phrase === null ? null : guide.els.get(p.phrase) ?? null;
    const block = p.block === null ? null : guide.els.get(p.block) ?? null;
    const phraseChanged = phrase !== curPhrase;
    const blockChanged = block !== curBlock;
    setCurrent(phrase, block);
    if (block && p.block !== null) {
      const it = tl.byKey.get(p.block);
      if (it) block.style.setProperty('--p', itemProgress(it.start, it.end, t).toFixed(3));
    }
    if (selected && (phrase || block) && selected !== phrase && selected !== block && !audio.paused) {
      selected.classList.remove('is-selected');
      selected = null;
    }
    showNow(p);
    // Announce a change of section only (never each block).
    if (p.state === 'playing') {
      const s = sectionOf(p.passage);
      if (s && s !== section && !audio.paused) {
        section = s;
        if (live) live.textContent = `Now: ${sectionTitle(s)}`;
      }
    }
    if (!audio.paused && (p.state === 'playing' || p.state === 'gap')) {
      const line = p.lines[0];
      if (line) replaceHash(line);
    }
    if (offer && t > offer.until) hideOffer();
    const el = currentEl();
    if (detached && el && !offscreen(el)) detached = false;
    autoScroll(p, phraseChanged, blockChanged, before !== follow.passage);
    updatePill();
  };
  audio.addEventListener('timeupdate', () => update());
  audio.addEventListener('seeked', () => {
    seekingTo = null;
    update(true);
  });
  audio.addEventListener('play', () => {
    detached = false;
    update();
  });
  audio.addEventListener('pause', updatePill);

  // The reader's own scrolling: the current item scrolled wholly off screen
  // detaches follow; back in view re-attaches it.
  window.addEventListener(
    'scroll',
    () => {
      if (Date.now() < autoUntil) return;
      const el = currentEl();
      if (!el) return;
      const off = offscreen(el);
      if (!detached && off && following && !audio.paused) detached = true;
      else if (detached && !off) detached = false;
      updatePill();
    },
    { passive: true },
  );
  pill?.addEventListener('click', () => {
    const el = currentEl();
    attach();
    if (!el) return;
    scrollToShow(el, el === curBlock ? BLOCK_AT : PHRASE_AT);
    const focusable = el.closest<HTMLElement>('div.study-block, .study-passage') ?? el;
    if (!focusable.hasAttribute('tabindex')) focusable.tabIndex = -1;
    focusable.focus({ preventScroll: true });
  });

  // ---- Follow ----
  const setFollow = (on: boolean) => {
    following = on;
    followBtn?.setAttribute('aria-pressed', String(on));
    attach();
    if (on && !audio.paused) {
      const el = currentEl();
      if (el && mostlyOff(el)) scrollToShow(el, el === curBlock ? BLOCK_AT : PHRASE_AT);
    }
  };
  followBtn?.setAttribute('aria-pressed', String(following));
  followBtn?.addEventListener('click', () => {
    const on = followBtn.getAttribute('aria-pressed') !== 'true';
    writeStore(FOLLOW_KEY, on ? 'on' : 'off');
    setFollow(on);
  });

  // ---- choosing and playing a class ----
  const setLecture = (id: string) => {
    const part = partOf(id);
    if (!part) return;
    if (id !== lecture || audio.getAttribute('src') !== part.url) {
      lecture = id;
      audio.src = part.url;
      follow = null;
      section = null;
      seekingTo = null;
      setCurrent(null, null);
      hideOffer();
      if (nextLink) {
        nextLink.hidden = true;
        delete nextLink.dataset['sticky'];
      }
    }
    select.value = id;
  };
  /** The player's own play button starts at `t` (seekOnPlay). */
  const armStart = (t: number) => {
    seekingTo = t;
    seekOnPlay(audio, t);
  };
  /** Plays `id` from `t` in the bar, following from there. */
  const play = (id: string, t: number, offerStart: number | null = null) => {
    setLecture(id);
    attach();
    activate();
    hideOffer();
    seekingTo = t;
    void playAt(audio, t);
    if (offerStart !== null) showOffer(offerStart, t);
  };
  const playSeek = (s: StudySeek | null) => {
    if (s) play(s.lecture, s.seekSeconds, s.offerStartSeconds);
  };

  select.addEventListener('change', () => {
    const wasPlaying = !audio.paused;
    showNote(null);
    setLecture(select.value);
    const start = partOf(select.value)?.start ?? 0;
    if (wasPlaying) play(select.value, start);
    else if (start > 0) armStart(start);
  });

  for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-study-skip]')) {
    b.addEventListener('click', () => {
      const d = Number(b.dataset['studySkip']);
      if (audio.readyState < 1) return;
      const end = Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY;
      audio.currentTime = Math.min(end, Math.max(0, audio.currentTime + d));
    });
  }

  // ---- Autoplay next: the chapter's next class (index order) from 0:00 ----
  const autoplayOn = autoplayNext([...bar.querySelectorAll<HTMLInputElement>('[data-autoplay-next]')]);
  markPlaying(audio, bar);
  audio.addEventListener('ended', () => {
    const next = nextStudyPart(parts, lecture);
    if (next && autoplayOn()) {
      showNote(`Playing next: ${next.label}`);
      play(next.id, 0);
      return;
    }
    if (!next) {
      if (autoplayOn()) showNote('That was the last class on this chapter.');
      showNextGuide();
      if (nextLink && !nextLink.hidden) nextLink.dataset['sticky'] = '1';
    }
    updatePill();
  });

  // ---- taps: ▶ links and phrases ----
  const seekOf = (el: StudyElement) => studySeekTarget(guide.passages, parts, el, lecture);
  let pendingClick: number | undefined;
  root.addEventListener('click', (e) => {
    const target = e.target as Element;
    const a = target.closest<HTMLAnchorElement>('a.study-play');
    if (a) {
      // A modified click (new tab) still opens the recording.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      showNote(null);
      const block = a.closest<HTMLElement>('.study-block');
      const el = block ? guide.where.get(block) : undefined;
      if (el) return playSeek(seekOf(el));
      const host = a.closest<HTMLElement>('[data-lecture]');
      const id = a.dataset['lecture'] ?? host?.dataset['lecture'];
      const start = num(a.dataset['start']) ?? num(host?.dataset['start']) ?? 0;
      if (id && partOf(id)) play(id, start);
      else if (id) window.location.href = a.href; // not a class of this chapter: the recording itself
      return;
    }
    const phrase = target.closest<HTMLElement>('.phrase');
    if (!phrase || target.closest('a, button')) return;
    const el = guide.where.get(phrase);
    if (!el) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    // Wait out a double-click (word selection) before acting.
    window.clearTimeout(pendingClick);
    if (e.detail > 1) return;
    pendingClick = window.setTimeout(() => {
      const s = window.getSelection();
      if (s && !s.isCollapsed) return;
      showNote(null);
      playSeek(seekOf(el));
    }, 250);
  });

  // "Where it starts" links (#c-<slug>) in the class list pick that class
  // when nothing plays.
  window.addEventListener('hashchange', () => {
    const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    const id = el?.matches('.study-divider[data-lecture]') ? el.dataset['lecture'] : undefined;
    if (id && audio.paused && partOf(id)) setLecture(id);
  });

  // The first class is in the player until another is chosen.
  setLecture(lecture);

  // ---- arrival links ----
  arrive(guide, parts, {
    select: setLecture,
    lecture: () => lecture,
    timeline,
    armStart,
    play,
    mark: (el) => {
      selected?.classList.remove('is-selected');
      selected = el;
      el.classList.add('is-selected');
    },
  });
}

/** "chapter_11" -> "Chapter 11". */
function chapterLabel(key: string | undefined): string {
  const n = /(\d+)$/.exec(key ?? '')?.[1];
  return n ? `Chapter ${Number(n)}` : 'the next chapter';
}

interface ArrivalHooks {
  select(id: string): void;
  lecture(): string;
  timeline(id: string): StudyTimeline;
  armStart(t: number): void;
  play(id: string, t: number): void;
  mark(el: HTMLElement): void;
}

/**
 * `?class=<slug>&t=<s>`: the item current at t in that class; `#<line id>`,
 * `#s-…` (passage) and `#b-…` (block): where that element plays from
 * (studySeekTarget). The item is marked (`is-selected`), shown, and a
 * focused "▶ Play from m:ss" button is put before it; the player's own
 * play button starts there too (seekOnPlay). `?class` alone selects the
 * class and shows its divider. Never autoplays. `class` and `t` are dropped
 * from the URL afterwards (the fragment is kept).
 */
function arrive(guide: Guide, parts: readonly Part[], h: ArrivalHooks): void {
  const link = parseStudyLink(window.location.search, window.location.hash);
  const part = partForSlug(parts, link.classSlug);
  let target: { el: HTMLElement; lecture: string; t: number } | null = null;
  let show: HTMLElement | null = null;
  if (part) {
    h.select(part.id);
    if (link.t !== null) {
      const p = studyAt(h.timeline(part.id), link.t);
      const el =
        (p.phrase !== null ? guide.els.get(p.phrase) : undefined) ??
        (p.block !== null ? guide.els.get(p.block) : undefined) ??
        (p.passage !== null ? guide.passEls[p.passage] : undefined);
      if (el) target = { el, lecture: part.id, t: link.t };
    } else {
      show = document.getElementById(`c-${transcriptSlug(part.id)}`);
    }
  } else if (link.anchor && document.getElementById(link.anchor)?.matches('.study-divider[data-lecture]')) {
    // "Where it starts" (#c-<slug>): that class, no item.
    h.select(document.getElementById(link.anchor)?.dataset['lecture'] ?? '');
  } else if (link.anchor) {
    const el = document.getElementById(link.anchor);
    const passEl = el?.closest<HTMLElement>('.study-passage');
    const passage = passEl ? guide.passEls.indexOf(passEl) : -1;
    if (el && passage >= 0) {
      let at: StudyElement = { passage };
      if (el.classList.contains('study-block')) at = guide.where.get(el) ?? at;
      else if (el.classList.contains('line')) {
        const ph = el.querySelector<HTMLElement>('.phrase');
        if (ph) at = guide.where.get(ph) ?? at;
      }
      const seek = studySeekTarget(guide.passages, parts, at, null);
      if (seek) {
        h.select(seek.lecture);
        target = { el, lecture: seek.lecture, t: seek.seekSeconds };
      }
    }
  }
  if (link.classSlug !== null || link.t !== null) {
    const u = new URL(window.location.href);
    u.searchParams.delete('class');
    u.searchParams.delete('t');
    window.history.replaceState(window.history.state, '', u);
  }
  let button: HTMLButtonElement | null = null;
  if (target) {
    const { lecture, t } = target;
    h.mark(target.el);
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'audio-link deep-play study-deep-play';
    button.textContent = `▶ Play from ${formatTime(t)}`;
    button.addEventListener('click', () => h.play(lecture, t));
    // Not inside the Hebrew lines or a joined paragraph: before the passage's
    // text, or before the block.
    const block = target.el.closest<HTMLElement>('div.study-block');
    const passage = target.el.closest<HTMLElement>('.study-passage');
    if (block) block.before(button);
    else passage?.prepend(button);
    h.armStart(t);
    show = target.el;
  }
  if (!show) return;
  const el = show;
  const go = () => {
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: scrollTopFor(window.scrollY, r.top, window.innerHeight, BLOCK_AT) });
    button?.focus({ preventScroll: true });
  };
  go();
  // The browser's own fragment navigation on load runs after this script
  // and moves focus to the body: do it again then.
  if (document.readyState !== 'complete') window.addEventListener('load', () => window.setTimeout(go, 0), { once: true });
}

// Last, so every module-level constant above is initialized.
const studyRoot = document.querySelector<HTMLElement>('[data-study]');
const studyBar = document.querySelector<HTMLElement>('[data-study-player]');
if (studyRoot && studyBar) init(studyRoot, studyBar);
