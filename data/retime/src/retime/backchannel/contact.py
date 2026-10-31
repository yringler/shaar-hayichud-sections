"""Review clips: for chosen edits, 3 s of the original, a beep, the same 3 s of the rendered file.

Per lecture, into <cache>/contact/<encoded id>/: every overlap (partial-fill) edit, every capped
edit, the lowest speaker scores and an even sample of the rest, up to --per-lecture clips, plus
index.json. `--reel` also joins every clip of the run into one review-reel.mp3 with its index.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import media

CLIP = 1.5  # s each side of the edit centre
BEEP = 0.25


def beep(sr: int) -> np.ndarray:
    n = int(BEEP * sr)
    b = (0.1 * np.sin(2 * np.pi * 1000 * np.arange(n) / sr)).astype(np.float32)
    r = min(n // 2, int(0.01 * sr))
    b[:r] *= np.linspace(0, 1, r)
    b[-r:] *= np.linspace(1, 0, r)
    return b


def choose(edits: list[dict], n: int) -> list[tuple[str, dict]]:
    """(why, edit) pairs in time order: every overlap and capped edit, the 3 weakest speaker scores,
    then an even spread of the rest up to n in all."""
    picked: dict[int, str] = {}
    for i, e in enumerate(edits):
        if e["class"] == "overlap":
            picked.setdefault(i, "overlap")
        if "cappedFrom" in e.get("scores", {}):
            picked.setdefault(i, "capped")
    by_spk = sorted(range(len(edits)), key=lambda i: edits[i].get("scores", {}).get("spk", 0))
    for i in by_spk[:3]:
        picked.setdefault(i, "low-speaker")
    rest = [i for i in range(len(edits)) if i not in picked]
    if rest and len(picked) < n:
        for j in np.unique(np.linspace(0, len(rest) - 1, n - len(picked)).astype(int)):
            picked.setdefault(rest[j], "sample")
    return [(picked[i], edits[i]) for i in sorted(picked)]


def contact(ctx, lec, doc: dict, per_lecture: int, log=print) -> list[dict]:
    o = doc.get("output")
    if not o:
        log("  contact: not rendered yet, skipped")
        return []
    out = ctx.output_path(lec, o["filename"])
    sr = o["sampleRate"]
    x = media.decode(lec.mp3, sr, 1)[:, 0]
    y = media.decode(out, sr, 1)[:, 0]
    d = ctx.cache / "contact" / lec.transcript_file.name.removesuffix(".json")
    d.mkdir(parents=True, exist_ok=True)
    for f in d.glob("*.mp3"):
        f.unlink()
    bp = beep(sr)
    index = []
    for k, (why, e) in enumerate(choose(doc["edits"], per_lecture)):
        c = (e["start"] + e["end"]) / 2
        a, b = max(0, int((c - CLIP) * sr)), min(len(x), int((c + CLIP) * sr))
        clip = np.concatenate([x[a:b], bp, y[a:b]])
        name = f"{k:02d}_{why}_{e['start']:.2f}.mp3"
        media.encode(clip, sr, 64 if sr >= 32000 else 32, d / name)
        index.append({"file": name, "why": why, "lectureId": lec.id, "start": e["start"], "end": e["end"],
                      "class": e["class"], "action": e["action"], "scores": e.get("scores", {}),
                      "clipStart": round(a / sr, 2)})
    (d / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), "utf-8")
    log(f"  contact: {len(index)} clips -> {d}")
    return index


def reel(cache: Path, entries: list[dict], name: str = "review-reel") -> Path:
    """All clips, 16 kHz mono, 1 s of silence between, with an index of where each starts."""
    sr = 16000
    parts, idx, t = [], [], 0.0
    gap = np.zeros(sr, np.float32)
    for e in entries:
        f = cache / "contact" / e["dir"] / e["file"]
        pcm = media.decode(f, sr, 1)[:, 0]
        idx.append({**{k: v for k, v in e.items() if k != "dir"}, "reelSeconds": round(t, 2)})
        parts += [pcm, gap]
        t += (len(pcm) + len(gap)) / sr
    out = cache / "contact" / f"{name}.mp3"
    if parts:
        media.encode(np.concatenate(parts), sr, 32, out)
    (cache / "contact" / f"{name}.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1), "utf-8")
    return out

