"""Write the sensitivity page's decisions into the chapter files.

  python3 apply_decisions.py --series markel-advanced --flags DIR/flags.json --dump DUMP [--date YYYY-MM-DD] [--dry-run]

DUMP is the directory ArtifactData wrote with
  action "query", collection "reviews", out_dir DUMP_PARENT
(one <block id>.json per decision). FLAGS is the flags.json the page was
published with: a decision is applied only if the block still carries the
same flag (same reason) and the same text the reviewer saw.

  raw  -> the flag is removed: the block prints as said
  soft -> action "replace", the reviewer's own publishable/publishableTitle
          if they wrote one, reviewed = DATE
  drop -> action "omit" (publishable removed), reviewed = DATE
The writer's lean (recommend, judgmentNote) is removed in every case.
Notes are printed, not applied: read them and act on them yourself.
"""
import argparse
import datetime
import json
from pathlib import Path

from common import STUDY, parse_id, study_fill

ap = argparse.ArgumentParser()
ap.add_argument("--series", required=True)
ap.add_argument("--flags", required=True)
ap.add_argument("--dump", required=True)
ap.add_argument("--date", default=datetime.date.today().isoformat())
ap.add_argument("--dry-run", action="store_true")
a = ap.parse_args()

shown = {f["id"]: f for f in json.loads(Path(a.flags).read_text())["flags"]}
LEGACY = {"print": "raw", "accept": None, "edit": None}  # the first page version's names
files: dict[str, dict] = {}
counts = {"raw": 0, "soft": 0, "drop": 0, "unchanged": 0}
skipped, notes = [], []

for p in sorted(Path(a.dump).glob("*.json")):
    doc = json.loads(p.read_text())
    d = doc.get("data", doc)
    bid = p.stem
    if d.get("note"):
        notes.append((bid, d["note"]))
    dec = d.get("decision")
    if not dec:
        continue
    f = shown.get(bid)
    if f is None:
        skipped.append((bid, "not on the published page (flag removed since?)"))
        continue
    if dec in LEGACY:
        dec = LEGACY[dec] or ("drop" if (d.get("action") or f["sensitivity"]["action"]) == "omit" else "soft")
    ch, i, j, k = parse_id(bid)
    c = files.setdefault(ch, json.loads((STUDY / a.series / f"{ch}.json").read_text()))
    b = c["sections"][i]["passages"][j]["blocks"][k]
    s = b.get("sensitivity")
    if s is None or s["reason"] != f["sensitivity"]["reason"] or b["text"] != f["text"]:
        skipped.append((bid, "the block or its flag changed since the page was built; rebuild the page"))
        continue
    old = dict(s)
    core = lambda x: {key: v for key, v in x.items() if key not in ("reviewed", "recommend", "judgmentNote")}
    if dec == "raw":
        del b["sensitivity"]
        counts["raw"] += 1
        continue
    if dec not in ("soft", "drop"):
        skipped.append((bid, f"unknown decision {dec!r}"))
        continue
    new = core(old)
    if dec == "drop":
        new["action"] = "omit"
        new.pop("publishable", None)
        new.pop("publishableTitle", None)
    else:
        if d.get("publishable"):
            new["publishable"] = d["publishable"]
            if d.get("publishableTitle"):
                new["publishableTitle"] = d["publishableTitle"]
        new["action"] = "replace"
        if not new.get("publishable"):
            skipped.append((bid, "softened, but there is no softened text"))
            continue
    # Keep an existing review date when nothing about the flag changes; otherwise this is a new review.
    new["reviewed"] = old["reviewed"] if old.get("reviewed") and new == core(old) else a.date
    b["sensitivity"] = new
    counts[dec if new != old else "unchanged"] += 1

print(f"raw {counts['raw']}, softened {counts['soft']}, dropped {counts['drop']}, already as decided {counts['unchanged']}")
for bid, why in skipped:
    print(f"SKIPPED {bid}: {why}")
for bid, note in notes:
    print(f"NOTE {bid}: {note}")
if a.dry_run:
    print("(dry run: nothing written)")
else:
    for ch, c in files.items():
        (STUDY / a.series / f"{ch}.json").write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n")
    study_fill(a.series, list(files))
    print(f"wrote {len(files)} chapter file(s); now run: cd data/tools && yarn study-check --series {a.series}")
