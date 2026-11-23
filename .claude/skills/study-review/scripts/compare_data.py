"""Build the data for the before/after page (pages/compare.html).

  python3 compare_data.py --series markel-advanced --before <git ref> [--after <git ref>] [--chapters 1-19] --out DIR

`--before` is the commit before the change you want reviewed (e.g. the
parent of the first commit of a rewrite); `--after` defaults to the working
tree. Both versions must have the same blocks in the same places (a text
rewrite, not a restructuring). Writes DIR/ch/index.json and one
DIR/ch/<chapter>.json per chapter, loaded by the page on demand.
"""
import argparse
import datetime
import json
import re
from pathlib import Path

from common import audio_view, block_id, blocks, chapter_paths, load_at, parse_chapters, said, series_meta

ap = argparse.ArgumentParser()
ap.add_argument("--series", required=True)
ap.add_argument("--before", required=True)
ap.add_argument("--after")
ap.add_argument("--chapters")
ap.add_argument("--out", required=True)
a = ap.parse_args()

quoted = lambda t: sum(len(m.split()) for m in re.findall(r'"([^"]+)"', t))
words = lambda t: len(t.split())
out = Path(a.out) / "ch"
out.mkdir(parents=True, exist_ok=True)
index = []
for path in chapter_paths(a.series, parse_chapters(a.chapters)):
    before, after = load_at(path, a.before), load_at(path, a.after)
    bb = {(i, j, k): b for i, j, k, *_, b in blocks(before)}
    rows = []
    for i, j, k, s, p, b in blocks(after):
        old = bb.get((i, j, k))
        if old is None or old["audio"][0] != b["audio"][0]:
            raise SystemExit(f"{path.stem} s{i}.p{j}.b{k}: the block moved or changed audio between --before and --after; this page compares text rewrites only")
        flag = b.get("sensitivity")
        rows.append({
            "id": block_id(path.stem, i, j, k), "section": i, "sectionTitle": s["title"], "kind": b["kind"],
            "oldTitle": old.get("title"), "title": b.get("title"), "old": old["text"], "text": b["text"],
            "changed": old["text"] != b["text"] or old.get("title") != b.get("title"),
            "flag": None if flag is None else ("reviewed" if flag.get("reviewed") else "new"),
            "audio": audio_view(b["audio"][0]), "said": said(b["audio"][0]),
        })
    (out / f"{path.stem}.json").write_text(json.dumps(rows, ensure_ascii=False))
    index.append({"chapter": path.stem, "n": int(path.stem.split("_")[1]), "title": after["title"], "blocks": len(rows),
                  "changed": sum(r["changed"] for r in rows),
                  "before": sum(words(r["old"]) for r in rows), "after": sum(words(r["text"]) for r in rows),
                  "qBefore": sum(quoted(r["old"]) for r in rows), "qAfter": sum(quoted(r["text"]) for r in rows)})

meta = series_meta(a.series)
(out / "index.json").write_text(json.dumps({"series": a.series, "title": meta.get("title", a.series), "before": a.before,
                                            "after": a.after or "working tree", "built": datetime.date.today().isoformat(),
                                            "chapters": index}, ensure_ascii=False))
print(f"{sum(c['changed'] for c in index)} of {sum(c['blocks'] for c in index)} blocks changed in {len(index)} chapters -> {out}")
