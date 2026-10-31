"""Stage 1, per tape and independent of every other tape: energy bursts, their speaker embeddings, the
teacher's reference embeddings, and two keyword checks on each burst. Cached, since it is the slow part.

Keyword checks, both on the burst padded with local room tone:
  * MMS_FA CTC: forced-alignment score of "right" against a few other short words;
  * faster-whisper base on one "reel" per tape: every burst clip, separated by 0.8 s of room tone,
    decoded in a single pass; the words that overlap each clip are its hits.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import numpy as np

from . import dsp

CTC_WORDS = ("right", "yeah", "okay", "yes", "so", "and")
REF_SLICES = 200  # teacher reference slices, 0.4 s each, from active stretches longer than 2 s
REEL_GAP = 0.8
FEATURES_VERSION = 1


def embed(enc, clips: list[np.ndarray]) -> np.ndarray:
    """L2-normalised ECAPA embeddings, one clip at a time."""
    import torch

    out = []
    with torch.inference_mode():
        for c in clips:
            x = torch.from_numpy(np.ascontiguousarray(c)).float().unsqueeze(0)
            out.append(enc.encode_batch(x)[0, 0].numpy())
    out = np.array(out).reshape(len(clips), -1)
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def ctc_scores(model, d, clips: list[np.ndarray]) -> list[dict]:
    """Mean frame score of each word in CTC_WORDS force-aligned (between <star>s) into each clip."""
    import warnings

    import torch
    import torchaudio

    res = []
    with torch.inference_mode(), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for c in clips:
            em, _ = model(torch.from_numpy(c).float().unsqueeze(0))
            row = {}
            for wd in CTC_WORDS:
                tok = torch.tensor([[d["*"]] + [d[ch] for ch in wd] + [d["*"]]], dtype=torch.int32)
                try:
                    ali, sc = torchaudio.functional.forced_align(em, tok, blank=0)
                    lab, s = ali[0].numpy(), sc[0].numpy()
                    m = (lab != 0) & (lab != d["*"])
                    row[wd] = float(s[m].mean()) if m.any() else -99.0
                except Exception:
                    row[wd] = -99.0
            res.append(row)
    return res


def whisper_reel(model, clips: list[np.ndarray], gapsig: np.ndarray) -> list[list]:
    """[[word, probability], ...] heard over each clip (+-0.2 s) in one decode of the reel."""
    gap = gapsig[: int(REEL_GAP * dsp.SR)]
    parts, offs, t = [], [], 0.0
    for c in clips:
        parts += [gap, c]
        t += len(gap) / dsp.SR
        offs.append((t, t + len(c) / dsp.SR))
        t += len(c) / dsp.SR
    if not clips:
        return []
    reel = np.concatenate(parts + [gap]).astype(np.float32)
    segs, _ = model.transcribe(reel, language="en", word_timestamps=True, beam_size=1, vad_filter=False,
                               condition_on_previous_text=False)
    ws = [(x.start, x.end, x.word, x.probability) for s in segs for x in (s.words or [])]
    return [[[wd, round(float(p), 3)] for s, e, wd, p in ws if min(e, b + 0.2) - max(s, a - 0.2) > 0] for a, b in offs]


def compute(w: np.ndarray, models, log=print) -> dict:
    """All stage-1 features of one 16 kHz tape."""
    t0 = time.time()
    e, floor = dsp.energy_floor(w)
    bursts = dsp.bursts_from_energy(e, floor)
    enc = models.ecapa()
    E = embed(enc, [w[int(b["start"] * dsp.SR):int(b["end"] * dsp.SR)] for b in bursts])
    rng = np.random.default_rng(0)
    long = [(a, b) for a, b in dsp.runs(e > floor + 7) if b - a > 200]
    refs = []
    for _ in range(REF_SLICES if long else 0):
        a, b = long[rng.integers(len(long))]
        s = rng.integers(a, b - 40)
        refs.append((s / 100, s / 100 + 0.4))
    R = embed(enc, [w[int(a * dsp.SR):int(b * dsp.SR)] for a, b in refs])
    t1 = time.time()
    rng = np.random.default_rng(0)
    clips = []
    for b in bursts:
        core = w[max(0, int((b["start"] - 0.05) * dsp.SR)):int((b["end"] + 0.05) * dsp.SR)]
        rt = dsp.kw_room_tone(w, b["start"], 0.3, rng)
        clips.append(np.concatenate([rt[: int(0.15 * dsp.SR)], core, rt[int(0.15 * dsp.SR):]]).astype(np.float32))
    model, d = models.ctc()
    ctc = ctc_scores(model, d, clips)
    t2 = time.time()
    gapsig = np.concatenate([dsp.kw_room_tone(w, 60.0, 0.3, rng) for _ in range(4)])
    wh = whisper_reel(models.whisper(), clips, gapsig)
    t3 = time.time()
    log(f"  features: {len(bursts)} bursts; embeddings {t1 - t0:.0f} s, ctc {t2 - t1:.0f} s, whisper {t3 - t2:.0f} s")
    return {"version": FEATURES_VERSION, "bursts": bursts, "E": E, "R": R, "refs": np.array(refs).reshape(-1, 2),
            "ctc": ctc, "whisper": wh, "seconds": round(t3 - t0, 1)}


def save(path: Path, f: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {k: f[k] for k in ("version", "bursts", "ctc", "whisper", "seconds")}
    tmp = path.with_name(f".{path.name}.tmp{os.getpid()}.npz")
    np.savez(tmp, E=f["E"], R=f["R"], refs=f["refs"], meta=np.array(json.dumps(meta)))
    os.replace(tmp, path)


def load(path: Path) -> dict | None:
    try:
        z = np.load(path)
        meta = json.loads(str(z["meta"]))
    except (OSError, ValueError, KeyError):
        return None
    if meta.get("version") != FEATURES_VERSION:
        return None
    return {**meta, "E": z["E"], "R": z["R"], "refs": z["refs"]}
