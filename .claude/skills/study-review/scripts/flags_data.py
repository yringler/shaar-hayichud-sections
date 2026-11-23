"""Build the data for the sensitivity review page (pages/flags.html).

  python3 flags_data.py --series markel-advanced [--chapters 1-19] --out DIR

Writes DIR/flags.json: { series, title, teacher, built, flags: [...] }, one
entry per block with a `sensitivity` flag: where it is, the block as written,
the flag, the passage, the transcript of the block's audio and a listen URL.
"""
import argparse
import datetime
import json
from pathlib import Path

from common import audio_view, block_id, blocks, chapter_paths, load_at, parse_chapters, said, series_meta

ap = argparse.ArgumentParser()
ap.add_argument("--series", required=True)
ap.add_argument("--chapters")
ap.add_argument("--out", required=True)
a = ap.parse_args()

meta = series_meta(a.series)
flags = []
for path in chapter_paths(a.series, parse_chapters(a.chapters)):
    c = load_at(path)
    for i, j, k, s, p, b in blocks(c):
        if "sensitivity" not in b:
            continue
        flags.append({
            "id": block_id(path.stem, i, j, k),
            "chapter": path.stem,
            "chapterTitle": c["title"],
            "section": s["title"],
            "passageHe": " ".join(ph.get("he", "") for ph in p.get("phrases", [])),
            "passageEn": " ".join(ph["en"] for ph in p.get("phrases", []) if ph.get("en")),
            "kind": b["kind"],
            "title": b.get("title"),
            "text": b["text"],
            "sensitivity": b["sensitivity"],
            "audio": [audio_view(x) for x in b["audio"]],
            "said": said(b["audio"][0]),
        })

out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
doc = {"series": a.series, "title": meta.get("title", a.series), "teacher": meta.get("teacher"),
       "built": datetime.date.today().isoformat(), "flags": flags}
(out / "flags.json").write_text(json.dumps(doc, ensure_ascii=False))
print(f"{len(flags)} flags, {sum(1 for f in flags if f['sensitivity'].get('reviewed'))} already reviewed -> {out / 'flags.json'}")
