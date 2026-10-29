"""Download a tape to the cache and decode it to 16 kHz mono float32 (needs curl and ffmpeg)."""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import numpy as np

from .emissions import SR


def download(url: str, dest: Path) -> None:
    """curl to a temp file, then rename; retries with backoff 2/4/8/16 s. Skips an existing file."""
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".{dest.name}.part{os.getpid()}")
    for attempt, wait in enumerate([2, 4, 8, 16, None]):
        r = subprocess.run(["curl", "-sS", "-f", "-L", "-o", str(tmp), url])
        if r.returncode == 0:
            os.replace(tmp, dest)
            return
        tmp.unlink(missing_ok=True)
        if wait is None:
            raise RuntimeError(f"download failed ({r.returncode}): {url}")
        print(f"  download failed (curl {r.returncode}); retry in {wait} s", flush=True)
        time.sleep(wait)


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)
