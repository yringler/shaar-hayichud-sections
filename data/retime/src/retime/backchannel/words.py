"""Word times for a lecture (retimed when a current data/retimed/ file exists, else Sofer's) and the
transcript's standalone "Right." sentences with the bracket between the teacher's neighbouring words."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .. import files


def norm(s: str) -> str:
    return re.sub(r"[^a-z']", "", s.lower())


@dataclass
class Words:
    timestamps: list[dict]  # Sofer's result.timestamps
    times: list[list]  # [start, end, score, kind] per word (retimed, or Sofer's with kind 0)
    source: str  # "retimed" | "sofer"
    transcript_sha: str


def load(data_dir: Path, transcript_file: Path) -> Words:
    ts = json.loads(transcript_file.read_text("utf-8"))["result"].get("timestamps") or []
    sha = files.transcript_sha(ts)
    rpath = files.retimed_path(data_dir, transcript_file)
    if rpath.exists():
        doc = json.loads(rpath.read_text("utf-8"))
        if doc.get("transcriptSha") == sha and len(doc["words"]) == len(ts):
            return Words(ts, doc["words"], "retimed", sha)
    return Words(ts, [[w["start"], w["end"], None, 0] for w in ts], "sofer", sha)


def transcript_rights(w: Words) -> list[dict]:
    """Every "right" word; `standalone` when it is its own sentence ("... end. Right. Next ...").

    lo / hi: end of the previous word and start of the next, the bracket the listener's
    "right" sits in (the teacher's neighbouring words are usually well placed).
    """
    ts, rt = w.timestamps, w.times
    out = []
    for i, x in enumerate(ts):
        if norm(x["word"]) != "right":
            continue
        prev = ts[i - 1]["word"] if i else "."
        nxt = ts[i + 1]["word"] if i + 1 < len(ts) else "X"
        standalone = prev[-1:] in (".", "?", "!") and x["word"][-1:] in (".", ",") and (
            nxt[:1].isupper() or not nxt[:1].isascii())
        lo = rt[i - 1][1] if i else 0.0
        hi = rt[i + 1][0] if i + 1 < len(ts) else rt[i][1]
        out.append({"i": i, "standalone": standalone, "t": rt[i][0], "kind": rt[i][3], "lo": lo, "hi": hi})
    return out


def anchors(w: Words) -> list[tuple[float, float]]:
    """Spans of the teacher's well-placed words (retimed anchors or soft anchors, back-channel tokens excluded)."""
    skip = {"right", "yeah", "okay", "mhm"}
    return [(t[0], t[1]) for x, t in zip(w.timestamps, w.times) if t[3] >= 1 and norm(x["word"]) not in skip]
