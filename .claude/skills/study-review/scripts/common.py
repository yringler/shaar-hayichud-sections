"""Shared helpers for the study-review scripts (Python 3 stdlib only).

Paths are found from this file, so the scripts run from any directory.
Block ids are positional: "<chapter>.s<i>.p<j>.b<k>" (0-based section,
passage, block). They stay valid as long as no block is added, removed or
moved between building a page and applying its decisions; apply scripts
check each block against what the page showed before changing it.
"""
import json
import re
import subprocess
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
DATA = REPO / "data"
STUDY = DATA / "study"
TOOLS = DATA / "tools"


def series_meta(series: str) -> dict:
    return json.loads((STUDY / series / "series.json").read_text())


def chapter_paths(series: str, chapters: list[int] | None = None) -> list[Path]:
    paths = sorted((STUDY / series).glob("chapter_*.json"))
    if chapters:
        paths = [p for p in paths if int(p.stem.split("_")[1]) in chapters]
    return paths


def parse_chapters(spec: str | None) -> list[int] | None:
    """'1-4,6,10-12' -> [1,2,3,4,6,10,11,12]; None -> all."""
    if not spec:
        return None
    out: list[int] = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b or a) + 1))
    return out


def load_at(path: Path, ref: str | None = None) -> dict:
    """A chapter file from the working tree, or from a git ref."""
    if ref is None:
        return json.loads(path.read_text())
    rel = path.relative_to(REPO).as_posix()
    return json.loads(subprocess.check_output(["git", "-C", str(REPO), "show", f"{ref}:{rel}"]))


def blocks(chapter: dict):
    """Yields (i, j, k, section, passage, block)."""
    for i, s in enumerate(chapter["sections"]):
        for j, p in enumerate(s["passages"]):
            for k, b in enumerate(p.get("blocks", [])):
                yield i, j, k, s, p, b


def block_id(chapter_name: str, i: int, j: int, k: int) -> str:
    return f"{chapter_name}.s{i}.p{j}.b{k}"


def parse_id(block_id_: str) -> tuple[str, int, int, int]:
    m = re.fullmatch(r"(chapter_\d+)\.s(\d+)\.p(\d+)\.b(\d+)", block_id_)
    if not m:
        raise ValueError(f"not a block id: {block_id_}")
    return m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4))


_urls: dict[str, str] | None = None


def lecture_url(lecture: str) -> str | None:
    """The URL the catalog plays (data/dist/v1/catalog.json; run `yarn build-data` first)."""
    global _urls
    if _urls is None:
        _urls = {}
        cat = DATA / "dist" / "v1" / "catalog.json"
        if cat.exists():
            def walk(o):
                if isinstance(o, dict):
                    if o.get("type") == "lecture":
                        _urls[o["id"]] = o["url"]
                    for v in o.values():
                        walk(v)
                elif isinstance(o, list):
                    for v in o:
                        walk(v)
            walk(json.loads(cat.read_text()))
    return _urls.get(lecture)


_words: dict[str, list[str]] = {}


def said(audio: dict) -> str:
    """The transcript words an audio entry cites (word indexes survive re-timing)."""
    lec = audio["lecture"]
    if lec not in _words:
        p = DATA / "transcripts" / (urllib.parse.quote(lec, safe="") + ".json")
        _words[lec] = [w["word"] for w in json.loads(p.read_text())["result"]["timestamps"]]
    lo, hi = audio["words"]
    return " ".join(_words[lec][lo : hi + 1])


def audio_view(audio: dict) -> dict:
    return {"lecture": audio["lecture"], "start": audio.get("start"), "end": audio.get("end"), "url": lecture_url(audio["lecture"])}


def replace_string_field(text: str, key: str, old: str, new: str) -> str:
    """Swap one JSON string value in a file's text without re-serializing it (keeps the file's formatting)."""
    o = f'"{key}": ' + json.dumps(old, ensure_ascii=False)
    if text.count(o) != 1:
        raise ValueError(f'"{key}" value occurs {text.count(o)} times, expected once: {old[:60]!r}')
    return text.replace(o, f'"{key}": ' + json.dumps(new, ensure_ascii=False))


def study_fill(series: str, chapter_names: list[str]) -> None:
    """Re-serialize in the house style (and re-stamp seconds) after a script rewrote a file."""
    for name in chapter_names:
        n = int(name.split("_")[1])
        subprocess.run(["yarn", "study-fill", "--series", series, "--chapter", str(n)], cwd=TOOLS, check=True, capture_output=True)
