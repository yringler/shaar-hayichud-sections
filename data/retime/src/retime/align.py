"""Forced alignment of a Sofer transcript's words to MMS_FA emissions, and re-timing.

1. CTC Viterbi alignment (torchaudio forced_align) of the romanized words,
   with a <star> token between words that absorbs untranscribed speech and
   noise. To keep memory linear it runs in windows of BLOCK words: each
   window starts at the end of the last committed word and is generously
   long; only the first COMMIT share of it (up to the last confident long
   word there) is kept, then the next window starts from there. Each word
   gets a span and a score (mean per-frame posterior of its characters).
2. Anchors: words with at least MIN_CHARS romanized characters, score at
   least MIN_SCORE, a plausible duration, and a speaking rate below MAX_RATE
   words/s against the neighbouring candidates.
3. Soft anchors: any other aligned word scoring at least SOFT_SCORE also
   keeps its own aligned time.
4. Every other word is interpolated by character count between the placed
   words. The aligner is monotone, so the result never reorders words.

Bump METHOD_VERSION when any of this changes the output.
"""
from __future__ import annotations

import numpy as np

from .emissions import FPS, STAR
from .romanize import TRANSLITERATION, romanize

METHOD_VERSION = 1
BLOCK = 600
COMMIT = 0.7
WINDOW_RATE = 2.4  # words/s used to size a window (x2, plus 60 s)
MIN_CHARS = 4
MIN_SCORE = 0.5
MIN_DURATION = 0.12
DURATION_PER_CHAR = 0.12
DURATION_SLACK = 0.6
MAX_RATE = 7.0
SOFT_SCORE = 0.25
INTERP_GAP_WEIGHT = 2  # characters' worth of weight between words
INTERP_MAX_DURATION = 0.5

# Per-word kinds in data/retimed/ files.
INTERPOLATED, SOFT, ANCHOR = 0, 1, 2


def method() -> dict:
    import torchaudio

    from . import emissions

    return {
        "name": "mms-fa-ctc-windowed",
        "version": METHOD_VERSION,
        "model": "torchaudio.pipelines.MMS_FA (with <star>)",
        "torchaudio": torchaudio.__version__.split("+")[0],
        "frameSeconds": 1 / FPS,
        "emissions": {"chunkSeconds": emissions.CHUNK_SECONDS, "contextSeconds": emissions.CONTEXT_SECONDS},
        "transliteration": TRANSLITERATION,
        "window": {"blockWords": BLOCK, "commitShare": COMMIT, "minScore": MIN_SCORE, "minChars": MIN_CHARS},
        "anchor": {
            "minChars": MIN_CHARS,
            "minScore": MIN_SCORE,
            "minDurationSeconds": MIN_DURATION,
            "maxDurationSeconds": f"{DURATION_PER_CHAR} * chars + {DURATION_SLACK}",
            "maxWordsPerSecond": MAX_RATE,
        },
        "softScore": SOFT_SCORE,
        "interpolation": {"gapWeightChars": INTERP_GAP_WEIGHT, "maxDurationSeconds": INTERP_MAX_DURATION},
    }


def _dict():
    import torchaudio

    return torchaudio.pipelines.MMS_FA.get_dict(star="*")


def align(words: list[tuple[str, bool]], em: np.ndarray):
    """Per word: (start_frame, end_frame, score) or None for words with nothing to align."""
    import warnings

    import torch
    import torchaudio.functional as F

    warnings.filterwarnings("ignore", message=".*forced_align has been deprecated")
    d = _dict()
    toks, owner = [STAR], [-1]
    for i, (r, _) in enumerate(words):
        if not r:
            continue
        for ch in r:
            toks.append(d[ch])
            owner.append(i)
        toks.append(STAR)
        owner.append(-1)
    ali, scores = F.forced_align(
        torch.from_numpy(np.ascontiguousarray(em, dtype=np.float32)).unsqueeze(0),
        torch.tensor([toks], dtype=torch.int32),
        blank=0,
    )
    ali, scores = ali[0].numpy(), scores[0].exp().numpy()
    spans: dict[int, list] = {}
    pos, prev = -1, 0
    for t, (a, s) in enumerate(zip(ali, scores)):
        if a == 0:
            prev = 0
            continue
        if a != prev or pos < 0 or toks[pos] != a:
            pos += 1
            while toks[pos] != a:
                pos += 1
        prev = a
        w = owner[pos]
        if w >= 0:
            sp = spans.setdefault(w, [t, t, []])
            sp[1] = t
            sp[2].append(s)
    out = [None] * len(words)
    for w, (a, b, sc) in spans.items():
        out[w] = (a, b + 1, float(np.mean(sc)))
    return out


def align_windowed(words: list[tuple[str, bool]], em: np.ndarray):
    n, T = len(words), len(em)
    out = [None] * n
    w0, f0 = 0, 0
    while w0 < n:
        w1 = min(n, w0 + BLOCK)
        span = int((BLOCK / WINDOW_RATE * 2 + 60) * FPS)
        while True:
            f1 = T if w1 == n else min(T, f0 + span)
            sub = words[w0:w1]
            nchar = sum(len(r) + 1 for r, _ in sub)
            if f1 - f0 < nchar * 2 + 10 and f1 < T:
                span *= 2
                continue
            res = align(sub, em[f0:f1])
            if w1 == n:
                commit_to = n
                break
            lim = w0 + int((w1 - w0) * COMMIT)
            commit_to = None
            for k in range(lim - w0, 0, -1):
                r = res[k - 1]
                if r and r[2] >= MIN_SCORE and len(sub[k - 1][0]) >= MIN_CHARS:
                    commit_to = w0 + k
                    break
            if commit_to is None and f1 < T:
                span *= 2
                continue
            if commit_to is None:
                commit_to = lim
            break
        for k in range(w0, commit_to):
            r = res[k - w0]
            if r:
                out[k] = (r[0] + f0, r[1] + f0, r[2])
        last = max([out[k][1] for k in range(w0, commit_to) if out[k]] or [f0])
        w0, f0 = commit_to, last
    return out


def retime(timestamps: list[dict], em: np.ndarray) -> tuple[list[list], dict]:
    """Sofer words + emissions -> ([start, end, score, kind] per word, stats)."""
    n = len(timestamps)
    total = len(em) / FPS
    words = [romanize(w["word"]) for w in timestamps]
    spans = align_windowed(words, em) if n else []

    fa = [None if sp is None else (sp[0] / FPS, sp[1] / FPS, sp[2]) for sp in spans]
    cand = []
    for i, ((r, _), f) in enumerate(zip(words, fa)):
        if f is None or len(r) < MIN_CHARS or f[2] < MIN_SCORE:
            continue
        dur = f[1] - f[0]
        if MIN_DURATION <= dur <= DURATION_PER_CHAR * len(r) + DURATION_SLACK:
            cand.append(i)
    kind = [INTERPOLATED] * n
    for k, i in enumerate(cand):
        ok = True
        for nb in (cand[k - 1] if k > 0 else None, cand[k + 1] if k + 1 < len(cand) else None):
            if nb is None:
                continue
            dw, dt = abs(i - nb), abs(fa[i][0] - fa[nb][0])
            if dw >= 3 and dw / max(dt, 1e-3) > MAX_RATE:
                ok = False
        if ok:
            kind[i] = ANCHOR
    for i, f in enumerate(fa):
        if kind[i] != ANCHOR and f is not None and f[2] >= SOFT_SCORE:
            kind[i] = SOFT

    cum = np.cumsum([0] + [len(r) + INTERP_GAP_WEIGHT for r, _ in words])
    placed = [i for i in range(n) if kind[i] != INTERPOLATED]
    at = [fa[i][0] for i in placed]
    xs = [cum[0]] + [cum[i] for i in placed] + [cum[n]]
    ys = [min(0.0, at[0] if at else 0.0)] + at + [max(total, at[-1] if at else total)]
    interp = np.maximum.accumulate(np.interp(cum[:n], xs, ys)) if n else np.array([])
    starts = [fa[i][0] if kind[i] != INTERPOLATED else float(interp[i]) for i in range(n)]
    out = []
    for i in range(n):
        if kind[i] != INTERPOLATED:
            end = fa[i][1]
        else:
            nxt = starts[i + 1] if i + 1 < n else total
            end = min(nxt, starts[i] + INTERP_MAX_DURATION)
        s = round(starts[i], 2)
        out.append([s, max(s, round(end, 2)), None if fa[i] is None else round(fa[i][2], 2), kind[i]])
    # Rounding can never reorder (it is monotone), but make it explicit.
    for i in range(1, n):
        if out[i][0] < out[i - 1][0]:
            out[i][0] = out[i - 1][0]
            out[i][1] = max(out[i][1], out[i][0])
    return out, stats(timestamps, out, total)


def stats(timestamps: list[dict], out: list[list], total: float) -> dict:
    n = len(out)
    anchors = [w[0] for w in out if w[3] == ANCHOR]
    gaps = np.diff(anchors) if len(anchors) > 1 else np.array([0.0])
    # Where Sofer's own times look natural (both neighbours at distinct,
    # increasing times), how close are the anchors to them?
    s = [w["start"] for w in timestamps]
    nat = [
        out[i][0] - s[i]
        for i in range(1, n - 1)
        if out[i][3] == ANCHOR and s[i] - s[i - 1] > 0 and s[i + 1] - s[i] > 0
        and abs((s[i] - s[i - 1]) - (s[i + 1] - s[i])) > 1e-3
    ]
    nat_abs = np.abs(nat) if nat else np.array([np.nan])
    return {
        "words": n,
        "aligned": sum(1 for w in out if w[2] is not None),
        "anchors": len(anchors),
        "soft": sum(1 for w in out if w[3] == SOFT),
        "interpolated": sum(1 for w in out if w[3] == INTERPOLATED),
        "anchorPct": round(100 * len(anchors) / max(1, n), 1),
        "placedPct": round(100 * sum(1 for w in out if w[3] != INTERPOLATED) / max(1, n), 1),
        "anchorGapMedianSeconds": round(float(np.median(gaps)), 2),
        "anchorGapP90Seconds": round(float(np.percentile(gaps, 90)), 2),
        "anchorGapMaxSeconds": round(float(gaps.max()), 2),
        "audioSeconds": round(total, 2),
        "soferPileWords": pile_words(timestamps),
        "soferNaturalAnchors": len(nat),
        "soferNaturalMedianAbsDeltaSeconds": None if not nat else round(float(np.median(nat_abs)), 2),
        "soferNaturalWithinHalfSecondPct": None if not nat else round(float(np.mean(nat_abs <= 0.5)) * 100, 1),
    }


PILE_WORDS = 20
SYNTHETIC_SPACING = 0.417


def pile_words(timestamps: list[dict]) -> int:
    """Words in runs of >= PILE_WORDS consecutive words that share one start time."""
    total, run = 0, 1
    s = [w["start"] for w in timestamps]
    for k in range(1, len(s) + 1):
        if k < len(s) and s[k] == s[k - 1]:
            run += 1
            continue
        if run >= PILE_WORDS:
            total += run
        run = 1
    return total


def affected(timestamps: list[dict]) -> bool:
    """Sofer's times are broken: a pile of words at one start time, or a run at the synthetic 0.417 s spacing."""
    if pile_words(timestamps) > 0:
        return True
    s = [w["start"] for w in timestamps]
    run = 0
    for k in range(1, len(s)):
        run = run + 1 if abs((s[k] - s[k - 1]) - SYNTHETIC_SPACING) < 0.0015 else 0
        if run >= PILE_WORDS - 1:
            return True
    return False
