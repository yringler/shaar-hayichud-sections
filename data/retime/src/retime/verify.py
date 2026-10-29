"""retime-verify: independent check of a data/retimed/ file with faster-whisper.

    retime-verify --lecture ID [--n 40] [--model base] [--cache DIR]

Needs the `verify` extra (uv sync --extra verify) and the tape's audio in the
cache (a retime run puts it there). For a random sample of English words
(4+ letters) in each group (anchor / interpolated / Sofer's original time /
control = anchor time + 20 s) it cuts an 8 s clip centred on the claimed
time, transcribes it with word timestamps, and reports how often the word is
heard in the clip and how far from the claimed time. A good file has most
anchors heard within 1 s and the control group rarely heard.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

import numpy as np

from . import audio, files
from .align import ANCHOR
from .cli import default_cache
from .emissions import SR
from .romanize import romanize


def _norm(s: str) -> str:
    return re.sub(r"[^a-z']", "", s.lower())


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="retime-verify")
    p.add_argument("--lecture", required=True)
    p.add_argument("--n", type=int, default=40)
    p.add_argument("--model", default="base")
    p.add_argument("--cache", type=Path, default=None)
    p.add_argument("--data", type=Path, default=files.DATA_DIR)
    a = p.parse_args(argv)
    from faster_whisper import WhisperModel

    cache = (a.cache or default_cache()).expanduser()
    tfile = files.transcripts(a.data)[a.lecture]
    ts = json.loads(tfile.read_text("utf-8"))["result"]["timestamps"]
    rt = json.loads(files.retimed_path(a.data, tfile).read_text("utf-8"))["words"]
    wav = audio.decode(cache / "audio" / tfile.name.removesuffix(".json"))
    model = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=4)
    rng = random.Random(1)
    eng = [(i, romanize(w["word"])[0]) for i, w in enumerate(ts) if not romanize(w["word"])[1]]
    eng = [(i, r) for i, r in eng if len(r) >= 4]
    pick = lambda xs: rng.sample(xs, min(a.n, len(xs)))
    anchors = pick([x for x in eng if rt[x[0]][3] == ANCHOR])
    groups = {
        "anchor": [(r, rt[i][0]) for i, r in anchors],
        "interp": [(r, rt[i][0]) for i, r in pick([x for x in eng if rt[x[0]][3] != ANCHOR])],
        "sofer": [(r, ts[i]["start"]) for i, r in pick(eng)],
        "control": [(r, rt[i][0] + 20) for i, r in anchors],
    }
    for g, items in groups.items():
        deltas = []
        for rom, t in items:
            lo, hi = max(0, int((t - 4) * SR)), min(len(wav), int((t + 4) * SR))
            segs, _ = model.transcribe(wav[lo:hi], language="en", word_timestamps=True, beam_size=1,
                                       vad_filter=False, condition_on_previous_text=False)
            best = None
            for s in segs:
                for x in s.words or []:
                    if _norm(x.word) == rom or (len(rom) >= 5 and _norm(x.word)[:5] == rom[:5]):
                        d = lo / SR + x.start - t
                        if best is None or abs(d) < abs(best):
                            best = d
            if best is not None:
                deltas.append(best)
        dl = np.abs(deltas)
        print(f"{g:8s} heard {len(deltas)}/{len(items)}, within 1 s {int((dl <= 1).sum())}, "
              f"median |d| {float(np.median(dl)) if deltas else float('nan'):.2f} s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
