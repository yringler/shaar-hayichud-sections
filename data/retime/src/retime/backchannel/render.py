"""Render an edit list: fill each edit with room tone at the tape's native rate and channels, encode, verify.

The output, `<original stem> (edited).mp3`, goes to <cache>/edited/<CDN folder>/ and its sha256,
duration, bitrate and verification are written back into the edit list's `output`.

Verification (all must hold):
  * the decoded output has exactly as many samples as the decoded original (duration unchanged);
  * cross-correlation of output against the edited PCM peaks at lag 0 at five places (no shift);
  * no digital silence (a zero run of 10 ms or more) inside any edit;
  * outside the edits (100 ms guard) the output matches the original to at least MIN_SNR_DB.
"""
from __future__ import annotations

import time

import numpy as np

from . import catalog, dsp, editlist, media

MIN_SNR_DB = 10.0


def verify(xm: np.ndarray, ym: np.ndarray, om: np.ndarray, sr: int, spans: list[tuple[float, float]]) -> dict:
    """Channel means of the original, the edited PCM and the decoded output."""
    lg = dsp.lags(ym, om, sr)
    zr = 0
    for a, b in spans:
        zr = max(zr, dsp.max_zero_run(om[int(a * sr):int(b * sr)]))
    snr = dsp.snr_outside(xm, om, sr, spans)
    v = {
        "samples": int(len(xm)), "samplesOut": int(len(om)), "lengthDiff": int(len(om) - len(xm)), "lags": lg,
        "maxZeroRunInEdits": int(zr), "snrOutsideDb": round(snr, 1),
    }
    v["ok"] = v["lengthDiff"] == 0 and all(t == 0 for t in lg) and zr < 0.01 * sr and snr >= MIN_SNR_DB
    return v


def is_current(doc: dict, out_file) -> bool:
    o = doc.get("output")
    return bool(o) and out_file.exists() and o.get("editsSha") == editlist.edits_sha(doc["edits"]) and \
        o.get("verify", {}).get("ok") is True and media.sha256(out_file) == o.get("sha256")


def render(ctx, lec, doc: dict, force: bool = False, log=print) -> dict:
    t0 = time.time()
    fname = catalog.edited_filename(lec.filename)
    out = ctx.output_path(lec, fname)
    if not force and is_current(doc, out):
        log("  render up to date")
        return doc
    ctx.wav16(lec)  # downloads when missing
    if media.sha256(lec.mp3) != doc["source"]["sha256"]:
        raise RuntimeError("cached audio differs from the edit list's source.sha256; rerun detect")
    src = media.probe(lec.mp3)
    sr, ch = src["sampleRate"], src["channels"]
    x = media.decode(lec.mp3, sr, ch)
    spans = [(e["start"], e["end"]) for e in doc["edits"]]
    y, info = dsp.apply_fill(x, sr, spans, lec.id)
    xm, ym = x.mean(1, dtype=np.float32), y.mean(1, dtype=np.float32)
    del x
    kbps = media.mp3_bitrate(src["bitrate"], sr)
    media.encode(y, sr, kbps, out, metadata_from=lec.mp3)
    del y
    om = media.decode(out, sr, ch).mean(1, dtype=np.float32)
    v = verify(xm, ym, om, sr, spans)
    po = media.probe(out)
    v["durationDiffSeconds"] = round(po["durationSeconds"] - src["durationSeconds"], 3)
    tone = {}
    for i in info:
        tone[i["toneFrom"]] = tone.get(i["toneFrom"], 0) + 1
    doc = dict(doc)
    doc["output"] = {
        "filename": fname, "sha256": media.sha256(out), "bytes": out.stat().st_size, "durationSeconds": po["durationSeconds"],
        "bitrate": kbps * 1000, "sampleRate": sr, "channels": ch, "encoder": f"{media.encoder_version()}, CBR",
        "editsSha": editlist.edits_sha(doc["edits"]), "toneFrom": tone, "verify": v,
    }
    log(f"  render: {len(info)} fills, {kbps} kb/s {sr} Hz x{ch}; len diff {v['lengthDiff']}, lags {v['lags']}, "
        f"zero-run {v['maxZeroRunInEdits']}, snr {v['snrOutsideDb']} dB, ok={v['ok']}; {time.time() - t0:.0f} s -> {out}")
    if not v["ok"]:
        out.unlink(missing_ok=True)
        raise RuntimeError(f"verification failed: {v}")
    editlist.write(ctx.edits_path(lec), doc)
    return doc
