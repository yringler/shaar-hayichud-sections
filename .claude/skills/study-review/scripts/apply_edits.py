"""Apply edit lists written by agents (or by hand) to a series' chapter files.

  python3 apply_edits.py --series markel-advanced EDITS.json [...]

Each file is a JSON array of
  { "chapter": "chapter_NN", "at": "sections[i].passages[j].blocks[k]",
    "old": <exact current text>, "text": <new text>, "title"?: <new title> }
An edit is refused (and nothing of that file is written) if `old` is not the
block's current text, if the block carries a `sensitivity` flag (its text
must stay matched to its public text; change both, by hand), or if the text
occurs more than once. Edits are applied by exact string replacement, so the
file's formatting is kept. Prints words and quoted words before and after.
"""
import argparse
import json
import re
from pathlib import Path

from common import STUDY, replace_string_field

ap = argparse.ArgumentParser()
ap.add_argument("--series", required=True)
ap.add_argument("--allow-flagged", action="store_true", help="also edit flagged blocks (then fix their publishable to match)")
ap.add_argument("edits", nargs="+")
a = ap.parse_args()

quoted = lambda t: sum(len(m.split()) for m in re.findall(r'"([^"]+)"', t))
for g in a.edits:
    by: dict[str, list] = {}
    for e in json.loads(Path(g).read_text()):
        by.setdefault(e["chapter"], []).append(e)
    for ch, es in by.items():
        path = STUDY / a.series / f"{ch}.json"
        text, c = path.read_text(), json.loads(path.read_text())
        ow = nw = oq = nq = 0
        for e in es:
            i, j, k = map(int, re.findall(r"\d+", e["at"]))
            b = c["sections"][i]["passages"][j]["blocks"][k]
            if b["text"] != e["old"]:
                raise SystemExit(f"{g} {ch} {e['at']}: `old` is not the block's current text")
            if "sensitivity" in b and not a.allow_flagged:
                raise SystemExit(f"{g} {ch} {e['at']}: the block is flagged; edit it and its publishable together, by hand")
            text = replace_string_field(text, "text", e["old"], e["text"])
            if e.get("title") and e["title"] != b.get("title"):
                if not b.get("title"):
                    raise SystemExit(f"{g} {ch} {e['at']}: the block has no title to replace")
                text = replace_string_field(text, "title", b["title"], e["title"])
            ow += len(e["old"].split()); nw += len(e["text"].split()); oq += quoted(e["old"]); nq += quoted(e["text"])
        path.write_text(text)
        print(f"{Path(g).name} {ch}: {len(es)} blocks, {ow} -> {nw} words, quoted {oq} -> {nq}")
print(f"now run: cd data/tools && yarn study-check --series {a.series}")
