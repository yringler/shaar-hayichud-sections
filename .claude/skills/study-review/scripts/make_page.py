"""Copy a page template into a build directory, with its name filled in.

  python3 make_page.py flags|compare --title "Markel Sensitivity Review" [--heading "..."] --out DIR

The title is the artifact's name (2-4 words, specific: keep it the same when
you republish to the same artifact). Publish DIR/<page>.html with the
Artifact tool, its data files beside it (see SKILL.md).
"""
import argparse
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("page", choices=["flags", "compare"])
ap.add_argument("--title", required=True)
ap.add_argument("--heading")
ap.add_argument("--out", required=True)
a = ap.parse_args()
src = Path(__file__).resolve().parents[1] / "pages" / f"{a.page}.html"
html = src.read_text().replace("{{TITLE}}", a.title).replace("{{HEADING}}", a.heading or a.title)
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
(out / f"{a.page}.html").write_text(html)
print(out / f"{a.page}.html")
