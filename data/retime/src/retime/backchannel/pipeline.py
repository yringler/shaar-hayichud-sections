"""One lecture end to end: audio, stage-1 features, the listener pool, detection -> edit list."""
from __future__ import annotations

import fcntl
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

import numpy as np

from .. import audio as retime_audio
from .. import files
from . import detect as D
from . import dsp, editlist, features, listener, media, words
from .models import Models, describe

METHOD_NAME = "audio-led-listener"
METHOD_VERSION = 1

# Reference tapes for the pooled listener (embeddings and posterior training frames). A tape with
# fewer than listener.MIN_SEEDS transcript seeds, or too few listener frames, borrows from these.
# They are the three hand-labelled evaluation tapes.
POOL_LECTURES = ("063 Ch5 part4.mp3", "002 Tape016-Side1-Ch10.mp3", "214 Tape46-Side1 Ch41&42.mp3")


def method() -> dict:
    return {"name": METHOD_NAME, "version": METHOD_VERSION, "thresholds": D.thresholds(), "models": describe(),
            "pool": list(POOL_LECTURES)}


@dataclass
class Lecture:
    id: str
    transcript_file: Path
    audio_url: str
    folder: str  # CDN folder, from the audioUrl path (unencoded)
    filename: str
    mp3: Path  # cached original


class Context:
    def __init__(self, data: Path, cache: Path, threads: int, log=print):
        self.data, self.cache, self.log = data, cache, log
        self.by_id = files.transcripts(data)
        self.models = Models(cache, threads)
        self.work = cache / "backchannel"
        self._pool = None

    def lecture(self, lid: str) -> Lecture:
        tf = self.by_id[lid]
        url = json.loads(tf.read_text("utf-8"))["audioUrl"]
        parts = [unquote(p) for p in urlsplit(url).path.lstrip("/").split("/")]
        return Lecture(lid, tf, url, "/".join(parts[:-1]), parts[-1], self.cache / "audio" / tf.name.removesuffix(".json"))

    def edits_path(self, lec: Lecture) -> Path:
        return editlist.edits_path(self.data, lec.transcript_file)

    def output_path(self, lec: Lecture, filename: str) -> Path:
        """Rendered mp3, mirroring the CDN key (folder/filename) under <cache>/edited/."""
        return self.cache / "edited" / lec.folder / filename

    def wav16(self, lec: Lecture) -> np.ndarray:
        retime_audio.download(lec.audio_url, lec.mp3)
        return np.ascontiguousarray(retime_audio.decode(lec.mp3))

    def features(self, lec: Lecture, w: np.ndarray | None = None) -> dict:
        path = self.work / "features" / (lec.transcript_file.name.removesuffix(".json") + ".npz")
        f = features.load(path)
        if f is None:
            f = features.compute(self.wav16(lec) if w is None else w, self.models, self.log)
            features.save(path, f)
            f = features.load(path)
        return f

    # ------------------------------------------------------------------ pool

    def pool(self) -> dict:
        """{lecture id: (listener embeddings, listener frames)} of the reference tapes (built once, cached)."""
        if self._pool is not None:
            return self._pool
        path = self.work / f"pool-v{METHOD_VERSION}.npz"
        self.work.mkdir(parents=True, exist_ok=True)
        with open(self.work / "pool.lock", "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            if not path.exists():
                self._build_pool(path)
        z = np.load(path)
        self._pool = {lid: (z[f"emb{k}"], z[f"frames{k}"]) for k, lid in enumerate(POOL_LECTURES)}
        return self._pool

    def _build_pool(self, path: Path) -> None:
        self.log(f"building the listener pool from {len(POOL_LECTURES)} reference tapes")
        info = {}
        for lid in POOL_LECTURES:
            lec = self.lecture(lid)
            feat = self.features(lec)
            rights = words.transcript_rights(words.load(self.data, lec.transcript_file))
            info[lid] = (lec, feat, rights, listener.seeds(feat["bursts"], rights))

        def rows(lid, pool_e):
            _, feat, _, sd = info[lid]
            sc = listener.speaker_scores(feat["E"], feat["R"], list(sd), pool_e)
            dec = listener.decide(feat, sc, sd)
            return dec, feat["E"][[d["idx"] for d in dec if d["label"] == "right" and d["spk"] > listener.POS_SPK]]

        emb = {}
        first = [lid for lid in POOL_LECTURES if len(info[lid][3]) >= listener.MIN_SEEDS]
        for lid in first:
            emb[lid] = rows(lid, None)[1]
        base = np.concatenate([emb[x] for x in first]) if first else None
        for lid in POOL_LECTURES:
            if lid not in emb:
                emb[lid] = rows(lid, base)[1]
        frames = {}
        for lid in POOL_LECTURES:
            others = np.concatenate([emb[x] for x in POOL_LECTURES if x != lid])
            dec, _ = rows(lid, others)
            F = listener.logmel(self.wav16(info[lid][0]))
            frames[lid] = listener.listener_frames(F, dec)
            self.log(f"  {lid}: {len(info[lid][3])} seeds, {len(emb[lid])} listener embeddings, {len(frames[lid])} frames")
        arrays = {}
        for k, lid in enumerate(POOL_LECTURES):
            arrays[f"emb{k}"], arrays[f"frames{k}"] = emb[lid], frames[lid]
        tmp = path.with_name(f".{path.name}.tmp{os.getpid()}.npz")
        np.savez(tmp, **arrays)
        os.replace(tmp, path)

    def pooled_for(self, lid: str) -> tuple[np.ndarray, np.ndarray]:
        p = self.pool()
        others = [v for k, v in p.items() if k != lid]
        return np.concatenate([e for e, _ in others]), np.concatenate([f for _, f in others])

    # ------------------------------------------------------------------ detect

    def is_current(self, lec: Lecture, wd: words.Words) -> bool:
        doc = editlist.read(self.edits_path(lec))
        return bool(doc) and doc.get("transcriptSha") == wd.transcript_sha and doc.get("wordTimes") == wd.source and \
            doc.get("method", {}).get("version") == METHOD_VERSION and doc.get("method", {}).get("name") == METHOD_NAME

    def analyse(self, lec: Lecture) -> dict:
        """Everything detection needs short of the final selection (candidates, frames, decisions)."""
        t0 = time.time()
        wd = words.load(self.data, lec.transcript_file)
        w = self.wav16(lec)
        feat = self.features(lec, w)
        rights = words.transcript_rights(wd)
        seeds = listener.seeds(feat["bursts"], rights)
        pool_e, pool_f = self.pooled_for(lec.id)
        sc = listener.speaker_scores(feat["E"], feat["R"], list(seeds), pool_e)
        dec = listener.decide(feat, sc, seeds)
        F = listener.logmel(w)
        e, fl = dsp.energy_floor(w)
        net, mu, sd, tstats = listener.train(F, e, fl, dec, feat["refs"], rights, pool_f)
        from scipy.ndimage import uniform_filter1d

        Ps = uniform_filter1d(listener.posterior(net, mu, sd, F), 5)
        fr = D.Frames(Ps, e, fl)
        post = self.work / "posterior" / (lec.transcript_file.name.removesuffix(".json") + ".npy")
        post.parent.mkdir(parents=True, exist_ok=True)
        np.save(post, np.stack([fr.Ps, fr.e, fr.fl]).astype(np.float16))
        cands = D.candidates(w, fr, dec, rights, feat["E"], feat["R"], self.models.ecapa())
        return dict(wd=wd, feat=feat, rights=rights, seeds=seeds, dec=dec, tstats=tstats, fr=fr, cands=cands, t0=t0)

    def detect(self, lec: Lecture, an: dict | None = None) -> dict:
        an = an or self.analyse(lec)
        wd, feat, rights, seeds, dec, tstats, fr, cands, t0 = (an[k] for k in (
            "wd", "feat", "rights", "seeds", "dec", "tstats", "fr", "cands", "t0"))
        edits, kept = D.select(cands, fr)
        src = media.probe(lec.mp3)
        removed = sum(x["end"] - x["start"] for x in edits)
        hours = src["durationSeconds"] / 3600
        stats = {
            "bursts": len(feat["bursts"]), "transcriptRights": sum(r["standalone"] for r in rights), "seeds": len(seeds),
            "pooledSpeaker": len(seeds) < listener.MIN_SEEDS, "listenerBursts": sum(d["label"] != "rabbi" for d in dec),
            "posterior": tstats, "edits": len(edits), "isolated": sum(x["class"] == "isolated" for x in edits),
            "overlap": sum(x["class"] == "overlap" for x in edits), "editsPerHour": round(len(edits) / hours, 1) if hours else None,
            "removedSeconds": round(removed, 2), "seconds": round(time.time() - t0 + feat.get("seconds", 0), 1),
        }
        old = editlist.read(self.edits_path(lec)) or {}
        doc = {
            "schemaVersion": editlist.SCHEMA_VERSION,
            "lectureId": lec.id,
            "mode": editlist.MODE,
            "transcript": f"transcripts/{lec.transcript_file.name}",
            "transcriptSha": wd.transcript_sha,
            "wordTimes": wd.source,
            "method": method(),
            "source": {"url": lec.audio_url, "sha256": media.sha256(lec.mp3), "sampleRate": src["sampleRate"],
                       "channels": src["channels"], "durationSeconds": src["durationSeconds"], "bitrate": src["bitrate"]},
            "stats": stats,
            "edits": edits,
            "kept": kept,
            "output": None,
        }
        out = old.get("output")
        if out and out.get("editsSha") == editlist.edits_sha(edits) and old.get("source", {}).get("sha256") == doc["source"]["sha256"]:
            doc["output"] = out
        errs = editlist.check(doc)
        if errs:
            raise RuntimeError("; ".join(errs))
        editlist.write(self.edits_path(lec), doc)
        return doc
