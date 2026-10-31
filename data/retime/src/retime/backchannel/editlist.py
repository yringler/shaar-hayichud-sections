"""The data/edits/<encoded lecture id>.json format (schema/sources/audio-edits.schema.json).

    {
      "schemaVersion": 1,
      "lectureId": "...",
      "mode": "fill",
      "transcript": "transcripts/<encoded id>.json",
      "transcriptSha": "<64 hex>",           files.transcript_sha of the transcript used
      "wordTimes": "retimed" | "sofer",
      "method": {"name", "version", "thresholds", "models"},
      "source": {"url", "sha256", "sampleRate", "channels", "durationSeconds", "bitrate"},
      "stats": {...},
      "edits": [ {"start", "end", "class", "action", "src", "scores"}, ... ],   one per line
      "kept":  [ {"start", "end", "reason"}, ... ],                            one per line
      "output": null | {"filename", "sha256", "durationSeconds", "bitrate", "sampleRate", "channels",
                        "encoder", "editsSha", "verify"}
    }

Times are seconds in the original audio (2 decimals). `output` is filled in by
`backchannel render`; `output.editsSha` ties it to the edits it was made from.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .. import files

SCHEMA_VERSION = 1
MODE = "fill"
ACTIONS = ("fill", "partial-fill")
CLASSES = ("isolated", "overlap")


def edits_path(data_dir: Path, transcript_file: Path) -> Path:
    """Same encoded name as the transcript."""
    return data_dir / "edits" / transcript_file.name


def edits_sha(edits: list[dict]) -> str:
    """sha256 of the spans and actions (what the render depends on)."""
    h = hashlib.sha256()
    for e in edits:
        h.update(f"{e['start']:.2f}\t{e['end']:.2f}\t{e['action']}\n".encode())
    return h.hexdigest()


def format_doc(doc: dict) -> str:
    """Two-space JSON with one edit / kept entry per line."""
    marks = {k: f"__{k.upper()}__" for k in ("edits", "kept")}
    body = json.dumps({**doc, **marks}, ensure_ascii=False, indent=2)
    for k, m in marks.items():
        items = doc[k]
        inner = "[]" if not items else "[\n" + ",\n".join(
            "    " + json.dumps(x, ensure_ascii=False, separators=(", ", ": ")) for x in items) + "\n  ]"
        body = body.replace(f'"{m}"', inner)
    return body + "\n"


def read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def write(path: Path, doc: dict) -> None:
    files.write_atomic(path, format_doc(doc))


def check(doc: dict) -> list[str]:
    """Structural problems (the data build checks the schema; this is the tool's own guard)."""
    errs = []
    prev = -1.0
    for i, e in enumerate(doc.get("edits", [])):
        if not (0 <= e["start"] < e["end"]):
            errs.append(f"edit {i}: bad span {e['start']}-{e['end']}")
        if e["start"] < prev:
            errs.append(f"edit {i}: overlaps or is out of order")
        if e["action"] not in ACTIONS or e["class"] not in CLASSES:
            errs.append(f"edit {i}: unknown action/class")
        dur = doc.get("source", {}).get("durationSeconds")
        if dur is not None and e["end"] > dur + 0.05:
            errs.append(f"edit {i}: past the end of the audio")
        prev = e["end"]
    return errs
