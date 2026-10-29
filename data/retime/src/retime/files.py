"""data/ paths, the transcript hash and the data/retimed/ file format.

data/retimed/<encoded lecture id>.json (schema/sources/retimed.schema.json):

    {
      "schemaVersion": 1,
      "lectureId": "...",
      "transcript": "transcripts/<encoded id>.json",
      "transcriptSha": "<64 hex>",
      "method": {...},
      "stats": {...},
      "words": [
        [start, end, score, kind],      one per Sofer word, in order
        ...
      ]
    }

`start`/`end` are seconds (2 decimals), `score` the mean frame posterior of
the word's characters (null when the word had nothing to align, e.g.
punctuation), `kind` 2 = anchor, 1 = soft anchor (own aligned time),
0 = interpolated.

transcriptSha = sha256 (lowercase hex) of the UTF-8 bytes of, for every
entry w of the transcript's result.timestamps in order,

    w.word + "\\t" + ms(w.start) + "\\t" + ms(w.end) + "\\n"

where ms(x) = floor(x * 1000 + 0.5) written as a base-10 integer. It is
recomputed by data/tools/src/retimed.ts (transcriptSha); keep both in step.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

SCHEMA_VERSION = 1

# data/retime/src/retime/files.py -> data/
DATA_DIR = Path(__file__).resolve().parents[3]


def _ms(x: float) -> str:
    return str(math.floor(x * 1000 + 0.5))


def transcript_sha(timestamps: list[dict]) -> str:
    h = hashlib.sha256()
    for w in timestamps:
        h.update(f"{w['word']}\t{_ms(w['start'])}\t{_ms(w['end'])}\n".encode("utf-8"))
    return h.hexdigest()


def transcripts(data_dir: Path) -> dict[str, Path]:
    """Lecture id -> transcript file, for every data/transcripts/*.json."""
    out = {}
    for f in sorted((data_dir / "transcripts").glob("*.json")):
        out[json.loads(f.read_text("utf-8"))["lectureId"]] = f
    return out


def retimed_path(data_dir: Path, transcript_file: Path) -> Path:
    """Same encoded name as the transcript."""
    return data_dir / "retimed" / transcript_file.name


def read_sha(path: Path) -> str | None:
    try:
        return json.loads(path.read_text("utf-8")).get("transcriptSha")
    except (OSError, ValueError):
        return None


def format_retimed(doc: dict) -> str:
    """Two-space JSON with one word per line."""
    marker = "__WORDS__"
    body = json.dumps({**doc, "words": marker}, ensure_ascii=False, indent=2)
    words = doc["words"]
    inner = "[]" if not words else "[\n" + ",\n".join("    " + json.dumps(w, separators=(",", ":")) for w in words) + "\n  ]"
    return body.replace(f'"{marker}"', inner) + "\n"


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp{os.getpid()}")
    tmp.write_text(text, "utf-8")
    os.replace(tmp, path)
