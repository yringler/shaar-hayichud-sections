"""backchannel-upload: put rendered `(edited).mp3` files next to their originals on the CDN bucket (R2, S3 API).

    uv run --with boto3 backchannel-upload --all-markel                  # plan only: read-only checks
    uv run --with boto3 backchannel-upload --all-markel --execute        # upload
    uv run backchannel-upload --all-markel --classes-patch OUT.patch     # the classes.txt change (no bucket)

The bucket key is the lecture's catalog `>` folder + "/" + filename, unencoded (the CDN URL is
that key percent-encoded). Credentials come only from the environment (R2_ENDPOINT, R2_BUCKET,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) or from a KEY=VALUE file named by --env-file or
$R2_ENV_FILE; never from the command line, and they are never printed.

Plan checks, per lecture: a verified render is recorded in the edit list, the cached file's
sha256 matches it, the original's key exists with the cached original's size, and the edited
key does not exist yet. --execute refuses any lecture that fails a check, uploads with
Content-Type audio/mpeg and If-None-Match: * (never overwrites), then HEADs the new object and
checks its size and ETag (the MD5 of a single-part upload).

--classes-patch writes a unified diff of data/classes.txt that renames each rendered lecture's
file line to the edited filename, with an `@ <old id>` line before it so the lecture keeps its
ID (data/README.md, Stable IDs); durations are unchanged. Apply it only after the upload.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import sys
from pathlib import Path

from .. import files
from ..cli import default_cache
from . import catalog, editlist

ENV_KEYS = ("R2_ENDPOINT", "R2_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")


def read_env(env_file: str | None) -> dict:
    env = {k: os.environ[k] for k in ENV_KEYS if os.environ.get(k)}
    f = env_file or os.environ.get("R2_ENV_FILE")
    if f:
        for line in Path(f).expanduser().read_text("utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    missing = [k for k in ENV_KEYS if not env.get(k)]
    if missing:
        raise SystemExit(f"missing credentials: {', '.join(missing)} (environment or --env-file)")
    return env


def client(env: dict):
    import boto3
    from botocore.config import Config

    return boto3.client("s3", endpoint_url=env["R2_ENDPOINT"], aws_access_key_id=env["AWS_ACCESS_KEY_ID"],
                        aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"], region_name="auto",
                        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 5, "mode": "standard"}))


def head(s3, bucket: str, key: str) -> dict | None:
    from botocore.exceptions import ClientError

    try:
        return s3.head_object(Bucket=bucket, Key=key)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def plan_items(data: Path, cache: Path, series: list[str], ids: list[str]) -> list[dict]:
    """One item per selected lecture, with the local problems found (no bucket access)."""
    by_id = files.transcripts(data)
    out = []
    for lec in catalog.lectures(data / "classes.txt"):
        if not (lec.series in series or lec.id in ids):
            continue
        item = {"lectureId": lec.id, "line": lec.line, "folder": lec.folder, "filename": lec.filename,
                "originalKey": f"{lec.folder}/{lec.filename}", "problems": []}
        tf = by_id.get(lec.id)
        doc = editlist.read(editlist.edits_path(data, tf)) if tf else None
        o = (doc or {}).get("output")
        if not o or not o.get("verify", {}).get("ok"):
            item["problems"].append("no verified render in the edit list")
            out.append(item)
            continue
        item.update(editedFilename=o["filename"], editedKey=f"{lec.folder}/{o['filename']}", edits=len(doc["edits"]))
        local = cache / "edited" / lec.folder / o["filename"]
        item["local"] = str(local)
        if o["filename"] != catalog.edited_filename(lec.filename):
            item["problems"].append(f"output filename {o['filename']!r} is not {catalog.edited_filename(lec.filename)!r}")
        if not local.exists():
            item["problems"].append("rendered file missing from the cache")
        elif sha256(local) != o["sha256"]:
            item["problems"].append("cached rendered file differs from the edit list's output.sha256")
        else:
            item["bytes"] = local.stat().st_size
        orig = cache / "audio" / tf.name.removesuffix(".json")
        item["originalBytes"] = orig.stat().st_size if orig.exists() else None
        out.append(item)
    return out


def check_bucket(s3, bucket: str, items: list[dict]) -> None:
    for it in items:
        h = head(s3, bucket, it["originalKey"])
        it["originalExists"] = h is not None
        if h is None:
            it["problems"].append("original key not found in the bucket")
        elif it.get("originalBytes") is not None and h["ContentLength"] != it["originalBytes"]:
            it["problems"].append(f"original object is {h['ContentLength']} bytes, the cached original {it['originalBytes']}")
        if "editedKey" in it:
            e = head(s3, bucket, it["editedKey"])
            it["editedExists"] = e is not None
            if e is not None:
                it["problems"].append("edited key already exists (refusing to overwrite)")


def upload(s3, bucket: str, it: dict) -> None:
    local = Path(it["local"])
    if head(s3, bucket, it["editedKey"]) is not None:
        raise RuntimeError("edited key appeared since the plan; not overwriting")
    with open(local, "rb") as f:
        s3.put_object(Bucket=bucket, Key=it["editedKey"], Body=f, ContentType="audio/mpeg", IfNoneMatch="*")
    h = head(s3, bucket, it["editedKey"])
    want = md5(local)
    if h is None or h["ContentLength"] != local.stat().st_size or h["ETag"].strip('"') != want:
        raise RuntimeError(f"verification failed after upload: {None if h is None else (h['ContentLength'], h['ETag'])}")


def classes_patch(data: Path, items: list[dict]) -> str:
    """Unified diff renaming rendered lectures' file lines, each with an `@ <old id>` line before it."""
    path = data / "classes.txt"
    lines = path.read_text("utf-8").split("\n")
    by_line = {it["line"]: it for it in items if "editedFilename" in it}
    out = []
    for n, raw in enumerate(lines, 1):
        it = by_line.get(n)
        if it is None:
            out.append(raw)
            continue
        s = raw.strip()
        indent = raw[: len(raw) - len(raw.lstrip())]
        if it["lectureId"] == it["filename"]:  # otherwise an `@` line already holds the id
            out.append(f"{indent}@ {it['lectureId']}")
        out.append(indent + it["editedFilename"] + s[len(it["filename"]):])
    new = "\n".join(out)
    return "".join(difflib.unified_diff(
        [x + "\n" for x in lines], [x + "\n" for x in new.split("\n")], "a/data/classes.txt", "b/data/classes.txt"))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="backchannel-upload", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lecture", action="append", default=[], metavar="ID")
    p.add_argument("--series", action="append", default=[], metavar="N")
    p.add_argument("--all-markel", action="store_true")
    p.add_argument("--cache", type=Path, default=None)
    p.add_argument("--data", type=Path, default=files.DATA_DIR)
    p.add_argument("--env-file", default=None, help="KEY=VALUE credentials file (or $R2_ENV_FILE)")
    p.add_argument("--plan-json", type=Path, default=None, help="write the plan here")
    p.add_argument("--classes-patch", type=Path, default=None, help="write the classes.txt diff here and stop")
    p.add_argument("--execute", action="store_true", help="upload (default: plan only)")
    a = p.parse_args(argv)
    series = list(a.series) + (["37"] if a.all_markel else [])
    if not (series or a.lecture):
        p.error("select lectures with --lecture, --series or --all-markel")
    data = a.data.resolve()
    cache = (a.cache or default_cache()).expanduser().resolve()
    items = plan_items(data, cache, series, a.lecture)
    if a.classes_patch:
        ok = [it for it in items if not it["problems"]]
        a.classes_patch.write_text(classes_patch(data, ok), "utf-8")
        print(f"{a.classes_patch}: {len(ok)} of {len(items)} lecture(s) renamed")
        return 0
    env = read_env(a.env_file)
    s3 = client(env)
    bucket = env["R2_BUCKET"]
    check_bucket(s3, bucket, items)
    ready = [it for it in items if not it["problems"]]
    total = sum(it.get("bytes", 0) for it in ready)
    for it in items:
        flag = "ok " if not it["problems"] else "NO "
        print(f"{flag} {it.get('editedKey', it['originalKey'])}" + (f"  <- {'; '.join(it['problems'])}" if it["problems"] else ""))
    print(f"\n{len(ready)} of {len(items)} ready to upload, {total / 1e6:.1f} MB")
    if a.plan_json:
        a.plan_json.write_text(json.dumps(items, ensure_ascii=False, indent=1), "utf-8")
    if not a.execute:
        print("plan only (pass --execute to upload)")
        return 0 if len(ready) == len(items) else 1
    failed = 0
    for it in ready:
        try:
            upload(s3, bucket, it)
            print(f"uploaded {it['editedKey']}")
        except Exception as ex:
            failed += 1
            print(f"FAILED {it['editedKey']}: {ex}", file=sys.stderr)
    print(f"\n{len(ready) - failed} uploaded, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
