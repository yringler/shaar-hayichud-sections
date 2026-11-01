"""ffprobe / ffmpeg wrappers: probe a file, decode at its native rate and channels, encode CBR mp3."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

import numpy as np

# libmp3lame CBR rates (kb/s) by MPEG version, i.e. by sample rate.
MP3_RATES = {
    "mpeg1": (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),  # 32 / 44.1 / 48 kHz
    "mpeg2": (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),  # 16 / 22.05 / 24 kHz
    "mpeg25": (8, 16, 24, 32, 40, 48, 56, 64),  # 8 / 11.025 / 12 kHz
}
HEADROOM = 1.25  # re-encoding loses some quality: encode at least this times the source rate


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    j = json.loads(out)
    st, fm = j["streams"][0], j["format"]
    br = st.get("bit_rate") or fm.get("bit_rate")
    return {"codec": st.get("codec_name"), "sampleRate": int(st["sample_rate"]), "channels": int(st["channels"]),
            "bitrate": int(br) if br else None, "durationSeconds": round(float(fm["duration"]), 3)}


def mp3_bitrate(source_bps: int | None, sample_rate: int) -> int:
    """Smallest CBR rate (kb/s) valid at this sample rate and >= HEADROOM x the source rate."""
    if sample_rate >= 32000:
        rates = MP3_RATES["mpeg1"]
    elif sample_rate >= 16000:
        rates = MP3_RATES["mpeg2"]
    else:
        rates = MP3_RATES["mpeg25"]
    want = (source_bps or 0) / 1000 * HEADROOM
    for r in rates:
        if r >= want:
            return r
    return rates[-1]


def decode(path: Path, sr: int, channels: int) -> np.ndarray:
    """float32 PCM, shape [samples, channels]."""
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path), "-ac", str(channels), "-ar", str(sr), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, channels)  # read-only view, no second copy


def encode(y: np.ndarray, sr: int, kbps: int, out: Path, metadata_from: Path | None = None) -> None:
    """CBR libmp3lame at the given rate, same rate and channels as y; global tags copied from metadata_from.
    Written to a temp file and renamed."""
    ch = 1 if y.ndim == 1 else y.shape[1]
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.stem}.tmp{os.getpid()}.mp3")
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-"]
    if metadata_from is not None:
        cmd += ["-i", str(metadata_from), "-map", "0:a", "-map_metadata", "1"]
    cmd += ["-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-ar", str(sr), "-ac", str(ch), "-id3v2_version", "3", str(tmp)]
    try:
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        step = 1 << 18  # stream in chunks: no second full copy of a long tape
        for a in range(0, len(y), step):
            p.stdin.write(np.ascontiguousarray(y[a:a + step], dtype=np.float32).tobytes())
        p.stdin.close()
        if p.wait() != 0:
            raise RuntimeError(f"ffmpeg exited {p.returncode} encoding {out}")
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)


def encoder_version() -> str:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-version"], capture_output=True, text=True).stdout.split("\n")[0]
    return f"libmp3lame via {' '.join(out.split()[:3])}"


def tags(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", str(path)],
                         capture_output=True, text=True).stdout
    try:
        return json.loads(out).get("format", {}).get("tags", {}) or {}
    except ValueError:
        return {}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
