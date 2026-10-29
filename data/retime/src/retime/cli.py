"""retime: forced-alignment re-timing of Sofer transcripts -> data/retimed/.

    retime [--lecture ID]... [--affected] [--all] [--max-minutes N] [--cache DIR]

Per tape: download the audio to the cache (skipped when present), compute
MMS_FA emissions (cached), align, and write data/retimed/<encoded id>.json
atomically. A tape whose output already carries the current transcript's
transcriptSha (and the current method version) is skipped, so rerunning the
same command resumes. --max-minutes stops cleanly after the tape in progress
once that much time has passed (exit status 3: more to do).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from . import align as A
from . import audio, emissions, files


def default_cache() -> Path:
    env = os.environ.get("RETIME_CACHE")
    return Path(env).expanduser() if env else Path.home() / ".cache" / "shaar-hayichud-retime"


def parse_args(argv=None):
    p = argparse.ArgumentParser(prog="retime", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lecture", action="append", default=[], metavar="ID", help="catalog lecture id (repeatable)")
    p.add_argument("--affected", action="store_true", help="every transcript whose Sofer times have piles (20+ words at one start) or synthetic 0.417 s spacing")
    p.add_argument("--all", action="store_true", help="every transcript")
    p.add_argument("--max-minutes", type=float, default=None, help="stop after the current tape once N minutes have passed")
    p.add_argument("--cache", type=Path, default=None, help="audio / emissions / model cache (default $RETIME_CACHE or ~/.cache/shaar-hayichud-retime)")
    p.add_argument("--data", type=Path, default=files.DATA_DIR, help="the repo's data/ directory")
    p.add_argument("--threads", type=int, default=4, help="torch CPU threads (default 4)")
    p.add_argument("--force", action="store_true", help="re-align even when the output is current (emissions stay cached)")
    p.add_argument("--dry-run", action="store_true", help="list what would be done")
    a = p.parse_args(argv)
    if not (a.lecture or a.affected or a.all):
        p.error("select tapes with --lecture, --affected or --all")
    return a


def main(argv=None) -> int:
    a = parse_args(argv)
    t0 = time.time()
    data = a.data.resolve()
    cache = (a.cache or default_cache()).expanduser().resolve()
    by_id = files.transcripts(data)
    todo: list[str] = []
    for lid in a.lecture:
        if lid not in by_id:
            print(f"no transcript for lecture {lid!r} in {data / 'transcripts'}", file=sys.stderr)
            return 2
        todo.append(lid)
    if a.all or a.affected:
        for lid, f in by_id.items():
            if lid in todo:
                continue
            if a.all or A.affected(json.loads(f.read_text("utf-8"))["result"].get("timestamps") or []):
                todo.append(lid)

    for stale in (data / "retimed").glob(".*.tmp*"):
        stale.unlink(missing_ok=True)

    model = None

    def load_model():
        nonlocal model
        if model is None:
            model = emissions.load_model(cache / "torch", a.threads)
        return model

    method = None
    done = skipped = 0
    print(f"{len(todo)} tape(s); cache {cache}", flush=True)
    for k, lid in enumerate(todo):
        if a.max_minutes is not None and done > 0 and time.time() - t0 >= a.max_minutes * 60:
            left = len(todo) - k
            print(f"\nstopped: {a.max_minutes:g} min budget used; {left} tape(s) not looked at yet. Rerun the same command to resume.")
            return 3
        tfile = by_id[lid]
        tr = json.loads(tfile.read_text("utf-8"))
        ts = tr["result"].get("timestamps") or []
        sha = files.transcript_sha(ts)
        out = files.retimed_path(data, tfile)
        current = out.exists() and _is_current(out, sha)
        print(f"[{k + 1}/{len(todo)}] {lid}", flush=True)
        if current and not a.force:
            print("  up to date")
            skipped += 1
            continue
        if not ts:
            print("  skip: transcript has no words")
            skipped += 1
            continue
        mp3 = cache / "audio" / tfile.name.removesuffix(".json")
        em_file = cache / "emissions" / (tfile.name.removesuffix(".json") + ".em.npy")
        if a.dry_run:
            print(f"  would retime ({'emissions cached' if em_file.exists() else 'audio + emissions to compute'})")
            continue
        w0 = time.time()

        def wav():
            audio.download(tr["audioUrl"], mp3)
            return audio.decode(mp3)

        em, _ = emissions.cached(em_file, wav, load_model)
        words, st = A.retime(ts, em)
        if method is None:
            method = A.method()
        doc = {
            "schemaVersion": files.SCHEMA_VERSION,
            "lectureId": lid,
            "transcript": f"transcripts/{tfile.name}",
            "transcriptSha": sha,
            "method": method,
            "stats": st,
            "words": words,
        }
        files.write_atomic(out, files.format_retimed(doc))
        done += 1
        print(
            f"  {st['words']} words: anchors {st['anchors']} ({st['anchorPct']}%), placed {st['placedPct']}%; "
            f"anchor gap median {st['anchorGapMedianSeconds']} s, p90 {st['anchorGapP90Seconds']} s, "
            f"max {st['anchorGapMaxSeconds']} s; Sofer pile words {st['soferPileWords']}; "
            f"vs natural Sofer times median |d| {st['soferNaturalMedianAbsDeltaSeconds']} s "
            f"({st['soferNaturalWithinHalfSecondPct']}% <= 0.5 s); {time.time() - w0:.0f} s -> {out.relative_to(data)}",
            flush=True,
        )
    print(f"\ndone: {done} retimed, {skipped} up to date or skipped, {time.time() - t0:.0f} s")
    return 0


def _is_current(path: Path, sha: str) -> bool:
    try:
        doc = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return False
    return doc.get("transcriptSha") == sha and doc.get("method", {}).get("version") == A.METHOD_VERSION


if __name__ == "__main__":
    sys.exit(main())
