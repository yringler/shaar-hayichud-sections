"""Stage 2: candidates and the edit list of one tape.

Candidates:
  * audio-led: every burst labelled listener ("right" or listener-other), trimmed to its listener
    core by the frame posterior (Ps > 0.5), extended through listener frames, padded 20 ms into
    anything that is not clear teacher speech, and kept inside the burst's own energy edges;
  * transcript residuals: a standalone transcript "Right." whose bracket got no audio-led edit is
    looked for inside the bracket as the strongest run of listener frames, and confirmed by an
    ECAPA score on that run.

Edits (precision first; every other candidate goes to `kept` with its reason):
  * isolated: audio-led "right"s, and transcript residuals not touching teacher speech;
  * overlap (partial-fill): transcript residuals that touch teacher speech, trimmed so they never
    cut into a preceding teacher tail and run at most 100 ms into a following onset;
  * a transcript residual needs a loud listener core: at least MIN_CORE frames with Ps > CAP_P and
    energy CORE_DB over the floor. The posterior runs high on quiet frames and on the decaying
    tail of the teacher's words, which it was never trained on; a core that is only such frames
    is not a "right" (the experiment's one false overlap edit);
  * every edit is capped: an edit longer than MAX_EDIT is cut down to its loud listener core plus
    at most TAIL frames of its decay (the experiment's one bad isolated candidate ran 0.5 s past
    the "right" into the teacher's next words, which the posterior also scored as listener).
"""
from __future__ import annotations

import numpy as np

from . import dsp, features, listener

PAD = 2  # frames of padding into non-teacher audio
EXT = 5  # frames the burst's energy edges may extend the posterior core
RABBI_P, RABBI_DB = 0.3, 12.0  # clear teacher frame: posterior below, energy above floor + this
LIS_P, LIS_DB = 0.5, 7.0
AUDIO_MIN_P = 0.6  # mean posterior of an audio-led edit (0.75 when its speaker score is under POS_SPK)
TX_SPK = 0.05  # residual speaker score to count as "right"
TX_MAX = 0.6  # s, longest residual edit (after capping)
OVL_MIN = 0.06  # s, shortest partial-fill
MAX_EDIT = 0.6  # s, longest edit; longer ones are capped to the loud listener core
CAP_P = 0.8  # listener core: posterior above this ...
CORE_DB = 20.0  # ... and energy this far over the floor
MIN_CORE = 5  # frames of loud listener core a transcript residual needs
TAIL = 15  # frames a capped edit may run past its core while the energy stays over floor + LIS_DB
NEAR = 0.6  # s around a transcript bracket


def thresholds() -> dict:
    return {
        "burstHiDb": dsp.BURST_HI_DB, "burstLoDb": dsp.BURST_LO_DB, "burstMinPause": dsp.BURST_MIN_PAUSE,
        "burstDur": [dsp.BURST_MIN_DUR, dsp.BURST_MAX_DUR], "speaker": listener.SPK_TH, "ctcRight": listener.CTC_TH,
        "minSeeds": listener.MIN_SEEDS, "posFrameSpeaker": listener.POS_SPK, "audioMinPosterior": AUDIO_MIN_P,
        "residualSpeaker": TX_SPK, "residualMaxSeconds": TX_MAX, "residualMinCoreFrames": MIN_CORE,
        "maxEditSeconds": MAX_EDIT, "corePosterior": CAP_P, "coreDb": CORE_DB, "capTailFrames": TAIL, "padFrames": PAD,
    }


def emb1(enc, x: np.ndarray) -> np.ndarray:
    return features.embed(enc, [x])[0]


def merge_runs(mask: np.ndarray, gap: int) -> list[list[int]]:
    rr: list[list[int]] = []
    for x, y in dsp.runs(mask):
        if rr and x - rr[-1][1] <= gap:
            rr[-1][1] = y
        else:
            rr.append([x, y])
    return rr


class Frames:
    """Per-frame posterior Ps, energy e and floor fl of one tape, with the masks the rules use."""

    def __init__(self, Ps: np.ndarray, e: np.ndarray, fl: np.ndarray):
        T = min(len(Ps), len(e))
        self.T = T
        self.Ps, self.e, self.fl = Ps[:T], e[:T], fl[:T]
        act = self.e > self.fl + LIS_DB
        self.lis = act & (self.Ps > LIS_P)
        self.rabc = (self.Ps < RABBI_P) & (self.e > self.fl + RABBI_DB)

    def pad(self, a: int, b: int) -> tuple[int, int]:
        for _ in range(PAD):
            if a > 0 and not self.rabc[a - 1]:
                a -= 1
            if b < self.T and not self.rabc[b]:
                b += 1
        return a, b

    def refine(self, a: int, b: int):
        """Burst frames [a, b) -> listener core extended through listener frames, padded. None without a core."""
        core = np.where(self.Ps[a:b] > LIS_P)[0]
        if len(core) < 5:
            return None
        a, b = a + core[0], a + core[-1] + 1
        k = 0
        while a > 0 and self.lis[a - 1] and k < 10:
            a -= 1
            k += 1
        k = 0
        while b < self.T and self.lis[b] and k < 10:
            b += 1
            k += 1
        return self.pad(a, b)

    def touches_rabbi(self, a: int, b: int, gap: int = 3) -> bool:
        r = self.rabc
        return bool(r[max(0, a - gap):a].any() or r[b:b + gap].any() or r[a:b].sum() >= 3)

    def core(self, a: int, b: int) -> np.ndarray:
        """Loud listener frames of [a, b): Ps > CAP_P and energy CORE_DB over the floor."""
        return (self.Ps[a:b] > CAP_P) & (self.e[a:b] - self.fl[a:b] > CORE_DB)

    def cap(self, a: int, b: int, max_frames: int) -> tuple[int, int]:
        """An over-long span -> its strongest loud listener core (gaps <= 30 ms joined), PAD frames before it
        and at most TAIL frames of decay after it, at most max_frames in all. (a, a) when it has no core."""
        if b - a <= max_frames:
            return a, b
        rr = merge_runs(self.core(a, b), 3)
        if not rr:
            return a, a
        x, y = max(rr, key=lambda q: float(self.Ps[a + q[0]:a + q[1]].sum()))
        x, y = max(a, a + x - PAD), a + y
        k = 0
        while y < b and k < TAIL and self.e[y] - self.fl[y] > LIS_DB:
            y += 1
            k += 1
        return x, min(y, x + max_frames)

    def partial(self, a: int, b: int):
        """Trim an overlap span: never into a preceding teacher tail, at most 100 ms into a following onset."""
        core = np.where(self.Ps[a:b] > LIS_P)[0]
        if not len(core):
            return None
        ca, cb = a + core[0], a + core[-1] + 1
        pre = np.where(self.rabc[a:ca])[0]
        if len(pre):
            a = a + pre[-1] + 1
        post = np.where(self.rabc[cb:b])[0]
        if len(post):
            b = min(b, cb + post[0] + 10)
        return a, b


def candidates(w: np.ndarray, fr: Frames, dec: list[dict], rights: list[dict], E: np.ndarray, R: np.ndarray, enc) -> list[dict]:
    lidx = [d["idx"] for d in dec if d["label"] == "right"]
    rc = R.mean(0)
    rc /= np.linalg.norm(rc)
    if lidx:
        lc = E[lidx].mean(0)
        lc /= np.linalg.norm(lc)
    else:
        lc = None
    Ps = fr.Ps
    cands, used = [], []
    for d in dec:
        if d["label"] == "rabbi":
            continue
        c = (d["start"] + d["end"]) / 2
        base = dict(src="audio", spk=d["spk"], whisper=d["whisper"], ctcRight=d["ctcRight"])
        ab = fr.refine(int(d["start"] * 100), int(d["end"] * 100))
        if ab is None:
            cands.append(dict(base, start=d["start"], end=d["end"], label="low-P", cls="?"))
            continue
        a, b = ab
        ba, bb = int(d["start"] * 100), int(d["end"] * 100)
        a, b = min(a, max(ba, a - EXT)), max(b, min(bb, b + EXT))
        a, b = max(a, ba - PAD), min(b, bb + PAD)
        pm = float(Ps[a:b].mean())
        if pm < AUDIO_MIN_P or (d["spk"] < listener.POS_SPK and pm < 0.75):
            cands.append(dict(base, start=a / 100, end=b / 100, label="low-P", cls="?", P=round(pm, 3)))
            continue
        near = [r for r in rights if r["lo"] - NEAR < c < r["hi"] + NEAR]
        label, src = d["label"], "audio"
        if label == "listener-other" and near and d["spk"] > 0.2:
            label, src = "right", "audio+tx"
        cands.append(dict(base, start=a / 100, end=b / 100, src=src if label == "right" else "audio", label=label,
                          cls="isolated", P=round(pm, 3), inTranscript=bool(near)))
        if label == "right":
            used.append(c)
    for r in rights:
        if not r["standalone"] or any(r["lo"] - NEAR < c < r["hi"] + NEAR for c in used):
            continue
        fa = int(max(0, min(r["lo"], r["t"]) - NEAR) * 100)
        fb = int((max(r["hi"], r["t"] + 0.5) + NEAR) * 100)
        if fb - fa > 500:
            cc = int((r["lo"] + r["hi"]) * 50)
            fa, fb = max(0, cc - 250), cc + 250
        fb = min(fb, fr.T)
        rr = [(x + fa, y + fa) for x, y in merge_runs(fr.lis[fa:fb], 3) if y - x >= 8]
        if not rr or lc is None:
            cands.append(dict(start=r["lo"], end=r["hi"], src="tx", label="unlocalized", cls="?", t=r["t"]))
            continue
        x, y = max(rr, key=lambda q: Ps[q[0]:q[1]].sum())
        pad = max(0, (25 - (y - x)) // 2)
        sp = float(emb1(enc, w[max(0, x - pad) * dsp.HOP:(y + pad) * dsp.HOP]) @ (lc - rc))
        a, b = fr.pad(x, y)
        cands.append(dict(start=a / 100, end=b / 100, src="tx", label="right" if sp > TX_SPK else "tx-lowspk",
                          cls="overlap" if fr.touches_rabbi(a, b) else "isolated", spk=round(sp, 3),
                          P=round(float(Ps[a:b].mean()), 3), t=r["t"]))
    cands.sort(key=lambda c: c["start"])
    return cands


def r2(x) -> float:
    return round(float(x), 2)


def select(cands: list[dict], fr: Frames) -> tuple[list[dict], list[dict]]:
    """(edits, kept) from the candidates."""
    edits, kept = [], []
    maxf = int(round(MAX_EDIT * 100))

    def scores(c, **extra):
        s = {k: c[k] for k in ("spk", "P", "ctcRight") if k in c}
        if c.get("whisper"):
            s["whisper"] = c["whisper"]
        s.update(extra)
        return s

    def keep(c, reason):
        kept.append({"start": r2(c["start"]), "end": r2(c["end"]), "reason": reason})

    for c in cands:
        a, b = int(round(c["start"] * 100)), int(round(c["end"] * 100))
        if c["label"] == "right" and c["src"] in ("audio", "audio+tx"):
            x, y = fr.cap(a, b, maxf)
            if y - x < 6:
                keep(c, "audio:right:no posterior core")
                continue
            ex = {"cappedFrom": [r2(c["start"]), r2(c["end"])]} if (x, y) != (a, b) else {}
            edits.append({"start": r2(x / 100), "end": r2(y / 100), "class": "isolated", "action": "fill",
                          "src": c["src"], "scores": scores(c, **ex)})
            continue
        if c["src"] == "tx" and c["label"] == "right":
            x, y = fr.cap(a, b, maxf)
            ex = {"cappedFrom": [r2(c["start"]), r2(c["end"])]} if (x, y) != (a, b) else {}
            if y - x < 6 or (y - x) / 100 > TX_MAX:
                keep(c, "tx:right:no compact listener run")
                continue
            if int(fr.core(x, y).sum()) < MIN_CORE:
                keep(c, "tx:right:no loud listener core")
                continue
            cls = "overlap" if fr.touches_rabbi(x, y) else "isolated"
            if cls == "isolated":
                edits.append({"start": r2(x / 100), "end": r2(y / 100), "class": "isolated", "action": "fill",
                              "src": "tx", "scores": scores(c, **ex)})
                continue
            p = fr.partial(x, y)
            if p is None or (p[1] - p[0]) / 100 < OVL_MIN:
                keep(c, "tx:right:overlap:no pause part")
                continue
            edits.append({"start": r2(p[0] / 100), "end": r2(p[1] / 100), "class": "overlap", "action": "partial-fill",
                          "src": "tx", "scores": scores(c, **ex)})
            continue
        keep(c, f"{c['src']}:{c['label']}:{c['cls']}" + (f" heard {c['whisper']!r}" if c.get("whisper") else ""))
    edits.sort(key=lambda x: x["start"])
    # never two overlapping edits
    out: list[dict] = []
    for e in edits:
        if out and e["start"] < out[-1]["end"]:
            out[-1]["end"] = max(out[-1]["end"], e["end"])
            continue
        out.append(e)
    return out, kept
