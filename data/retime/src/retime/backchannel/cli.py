"""backchannel: remove the listener's standalone "Right." from class audio (fill mode).

    backchannel detect  --lecture ID | --series 37 | --all-markel  [--render]
    backchannel render  (same selection)
    backchannel contact (same selection) [--per-lecture 8] [--reel]

detect writes data/edits/<encoded id>.json atomically; a lecture whose edit list already
holds the current transcriptSha, word-time source and method version is skipped before
anything is downloaded, so rerunning resumes. render fills, encodes and verifies the
edited mp3 into <cache>/edited/<CDN folder>/<stem> (edited).mp3 and records it in the edit
list's `output`; a current, verified render is skipped. Needs `uv sync --extra edit`.
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path

from .. import files
from ..cli import default_cache
from . import catalog, contact as C, editlist, pipeline, render as RD, words

MARKEL_SERIES = "37"


def parse_args(argv=None):
    p = argparse.ArgumentParser(prog="backchannel", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("detect", "render", "contact"):
        s = sub.add_parser(name)
        s.add_argument("--lecture", action="append", default=[], metavar="ID", help="catalog lecture id (repeatable)")
        s.add_argument("--series", action="append", default=[], metavar="N", help="every lecture under the `# ...:N` series")
        s.add_argument("--all-markel", action="store_true", help=f"the whole Rabbi Markel series (:{MARKEL_SERIES})")
        s.add_argument("--shard", default=None, metavar="K/N", help="only every N-th selected lecture, starting at K (0-based)")
        s.add_argument("--max-minutes", type=float, default=None, help="stop after the current lecture once N minutes have passed")
        s.add_argument("--cache", type=Path, default=None, help="cache dir (default $RETIME_CACHE or ~/.cache/shaar-hayichud-retime)")
        s.add_argument("--data", type=Path, default=files.DATA_DIR, help="the repo's data/ directory")
        s.add_argument("--threads", type=int, default=4, help="torch / ctranslate2 CPU threads (default 4)")
        s.add_argument("--force", action="store_true", help="redo even when current")
        s.add_argument("--dry-run", action="store_true", help="list what would be done")
        if name == "detect":
            s.add_argument("--render", action="store_true", help="render each lecture right after detecting it")
            s.add_argument("--features-only", action="store_true", help="only compute and cache the stage-1 features (the slow part)")
        if name == "contact":
            s.add_argument("--per-lecture", type=int, default=8, help="clips per lecture (overlap and capped edits always)")
            s.add_argument("--reel", action="store_true", help="also join all clips into <cache>/contact/review-reel.mp3")
    a = p.parse_args(argv)
    if not (a.lecture or a.series or a.all_markel):
        p.error("select lectures with --lecture, --series or --all-markel")
    return a


def select(a, data: Path, by_id: dict) -> list[str]:
    series = list(a.series) + ([MARKEL_SERIES] if a.all_markel else [])
    todo: list[str] = []
    for lid in a.lecture:
        if lid not in by_id:
            raise SystemExit(f"no transcript for lecture {lid!r} in {data / 'transcripts'}")
        todo.append(lid)
    if series:
        for lec in catalog.lectures(data / "classes.txt"):
            if lec.series in series and lec.id not in todo:
                if lec.id not in by_id:
                    print(f"  (no transcript, skipped: {lec.id})")
                    continue
                todo.append(lec.id)
    if a.shard:
        k, n = (int(x) for x in a.shard.split("/"))
        todo = todo[k::n]
    return todo


def main(argv=None) -> int:
    a = parse_args(argv)
    t0 = time.time()
    data = a.data.resolve()
    cache = (a.cache or default_cache()).expanduser().resolve()
    ctx = pipeline.Context(data, cache, a.threads)
    todo = select(a, data, ctx.by_id)
    for stale in (data / "edits").glob(".*.tmp*"):
        stale.unlink(missing_ok=True)
    print(f"{a.cmd}: {len(todo)} lecture(s); cache {cache}", flush=True)
    done = skipped = 0
    failed: list[str] = []
    reel: list[dict] = []
    for k, lid in enumerate(todo):
        if a.max_minutes is not None and done > 0 and time.time() - t0 >= a.max_minutes * 60:
            print(f"\nstopped: {a.max_minutes:g} min budget used; {len(todo) - k} lecture(s) left. Rerun to resume.")
            return 3
        print(f"[{k + 1}/{len(todo)}] {lid}", flush=True)
        lec = ctx.lecture(lid)
        try:
            if a.cmd == "detect" and a.features_only:
                if not a.dry_run:
                    ctx.features(lec)
                    done += 1
                continue
            if a.cmd == "detect":
                wd = words.load(data, lec.transcript_file)
                if not a.force and ctx.is_current(lec, wd):
                    print("  edit list up to date")
                    doc = editlist.read(ctx.edits_path(lec))
                    skipped += 1
                elif a.dry_run:
                    print(f"  would detect ({wd.source} word times)")
                    continue
                else:
                    w0 = time.time()
                    doc = ctx.detect(lec)
                    st = doc["stats"]
                    print(f"  {st['edits']} edits ({st['isolated']} isolated, {st['overlap']} overlap), "
                          f"{st['editsPerHour']}/h, {st['removedSeconds']} s; seeds {st['seeds']}/{st['transcriptRights']}, "
                          f"bursts {st['bursts']}, {doc['wordTimes']} words; {time.time() - w0:.0f} s -> "
                          f"{ctx.edits_path(lec).relative_to(data)}", flush=True)
                    done += 1
                if a.render and not a.dry_run:
                    RD.render(ctx, lec, doc, force=a.force)
                continue
            doc = editlist.read(ctx.edits_path(lec))
            if doc is None:
                print("  no edit list; run detect first")
                failed.append(lid)
                continue
            if a.dry_run:
                print(f"  would {a.cmd} {len(doc['edits'])} edits")
                continue
            if a.cmd == "render":
                RD.render(ctx, lec, doc, force=a.force)
                done += 1
            else:
                for e in C.contact(ctx, lec, doc, a.per_lecture):
                    reel.append({**e, "dir": lec.transcript_file.name.removesuffix(".json")})
                done += 1
        except Exception as ex:  # one bad lecture must not stop a long run
            traceback.print_exc()
            print(f"  FAILED: {ex}", flush=True)
            failed.append(lid)
    if a.cmd == "contact" and a.reel and reel:
        print(f"review reel: {C.reel(cache, reel)} ({len(reel)} clips)")
    print(f"\n{a.cmd} done: {done} done, {skipped} up to date, {len(failed)} failed, {time.time() - t0:.0f} s")
    for lid in failed:
        print(f"  failed: {lid}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
