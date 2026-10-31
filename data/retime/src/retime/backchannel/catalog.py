"""Just enough of data/classes.txt (see data/README.md, grammar) to select lectures and name CDN keys."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

FILE_LINE = re.compile(r"^(.+\.(?:mp3|m4a))(?::(\d+(?:\.\d+)?))?$")
HEADING = re.compile(r"^(#{1,3})\s+(.*):(\d+)$")


@dataclass(frozen=True)
class Lecture:
    id: str
    filename: str
    folder: str  # the `>` CDN folder, unencoded
    series: str  # the `#` heading id
    line: int  # 1-based line of the file line in classes.txt
    seconds: float | None


def lectures(classes_txt: Path) -> list[Lecture]:
    out: list[Lecture] = []
    series = folder = pending_id = None
    for n, raw in enumerate(classes_txt.read_text("utf-8").split("\n"), 1):
        s = raw.strip()
        if not s or s.startswith("//"):
            continue
        if s.startswith("#"):
            m = HEADING.match(s)
            if m and len(m.group(1)) == 1:
                series = m.group(3)
            continue
        if s.startswith("> "):
            folder = s[2:].strip()
            continue
        if s.startswith("- "):
            continue
        if s.startswith("@ "):
            pending_id = s[2:].strip()
            continue
        m = FILE_LINE.match(s)
        if m:
            out.append(Lecture(pending_id or m.group(1), m.group(1), folder or "", series or "", n,
                               float(m.group(2)) if m.group(2) else None))
            pending_id = None
    return out


def edited_filename(filename: str) -> str:
    """`<original stem> (edited).mp3`."""
    stem = filename.rsplit(".", 1)[0]
    return f"{stem} (edited).mp3"
