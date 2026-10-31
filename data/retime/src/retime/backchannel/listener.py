"""Who said it: burst speaker scores (ECAPA), keyword decisions, and a per-tape 10 ms listener posterior.

The listener (not the teacher) says the standalone "Right."s. Bursts that sit alone in the
bracket of a transcript "Right." seed the listener centroid; the teacher's centroid comes
from 0.4 s slices of long speech. A burst's score is cos(listener) - cos(teacher), with the
burst itself left out of the listener centroid. Tapes with few seeds borrow the pooled
listener seeds of the reference tapes (the same listener throughout the series).
"""
from __future__ import annotations

import re

import numpy as np

from . import dsp

SPK_TH = 0.10  # burst speaker score above which a burst is the listener's
CTC_TH = -1.0  # CTC "right" score floor (and "right" must be the best of CTC_WORDS)
MIN_SEEDS = 30  # fewer own seeds: add the pooled listener centroid with this weight
RIGHTISH = re.compile(r"r[iy]ght|ride|rive|ight\b|^[a-z]*right|alright|bright|write")

# Frame posterior (10 ms): a small MLP on +-5 frames of 40 log-mel bands, trained per tape.
CTX = 5
POS_SPK = 0.15  # listener frames come from "right" bursts scoring above this
NEG_SPK = -0.05  # teacher frames from "rabbi" bursts scoring below this
MIN_POS_FRAMES = 1000  # fewer: add the reference tapes' listener frames
EPOCHS = 30


def seeds(bursts: list[dict], rights: list[dict]) -> dict[int, dict]:
    """Burst index -> transcript right, for brackets holding exactly one burst."""
    out = {}
    for r in rights:
        if not r["standalone"]:
            continue
        inb = [k for k, b in enumerate(bursts) if b["start"] >= r["lo"] - 0.1 and b["end"] <= r["hi"] + 0.1]
        if len(inb) == 1:
            out[inb[0]] = r
    return out


def speaker_scores(E: np.ndarray, R: np.ndarray, seed_idx: list[int], pool: np.ndarray | None) -> np.ndarray:
    rc = R.mean(0)
    rc /= np.linalg.norm(rc)
    S = np.array(sorted(seed_idx), dtype=int)
    lc_all = E[S].sum(0) if len(S) else np.zeros(E.shape[1])
    if len(S) < MIN_SEEDS and pool is not None and len(pool):
        lc_all = lc_all + pool.mean(0) * MIN_SEEDS
    ss = set(S.tolist())
    sc = np.zeros(len(E))
    for k in range(len(E)):
        lc = lc_all - (E[k] if k in ss else 0)
        lc = lc / (np.linalg.norm(lc) + 1e-12)
        sc[k] = E[k] @ lc - E[k] @ rc
    return sc


def decide(feat: dict, sc: np.ndarray, seed_idx) -> list[dict]:
    """Label each burst: right (listener + keyword), listener-other (listener, no keyword) or rabbi."""
    out = []
    for j, b in enumerate(feat["bursts"]):
        wh = " ".join(w for w, _ in feat["whisper"][j]).strip()
        c = feat["ctc"][j]
        best = max(c, key=c.get)
        whr = bool(RIGHTISH.search(wh.lower()))
        ctcr = c["right"] > CTC_TH and best == "right"
        lab = "rabbi"
        if sc[j] > SPK_TH:
            lab = "right" if (whr or ctcr) else "listener-other"
        out.append(dict(b, spk=round(float(sc[j]), 3), whisper=wh, ctcRight=round(c["right"], 2), ctcBest=best,
                        seed=j in seed_idx, label=lab, idx=j))
    return out


# --------------------------------------------------------------------------
# Frame posterior


def logmel(w: np.ndarray) -> np.ndarray:
    import torch
    import torchaudio

    mel = torchaudio.transforms.MelSpectrogram(dsp.SR, n_fft=400, win_length=400, hop_length=dsp.HOP, n_mels=40,
                                               f_min=60, f_max=7600)
    with torch.inference_mode():
        m = mel(torch.from_numpy(np.ascontiguousarray(w)).float())
    return torch.log(m + 1e-8).T.numpy()  # [T, 40]


def stack(F: np.ndarray, idx: np.ndarray) -> np.ndarray:
    ii = np.clip(idx[:, None] + np.arange(-CTX, CTX + 1)[None, :], 0, len(F) - 1)
    return F[ii].reshape(len(idx), -1)


def listener_frames(F: np.ndarray, dec: list[dict]) -> np.ndarray:
    """Normalised, stacked frames of this tape's confident "right" bursts (shared with other tapes as pool)."""
    Fn = (F - F.mean(0)) / (F.std(0) + 1e-6)
    parts = [stack(Fn, np.arange(int(d["start"] * 100), int(d["end"] * 100)))
             for d in dec if d["label"] == "right" and d["spk"] > POS_SPK]
    return np.concatenate(parts).astype(np.float32) if parts else np.zeros((0, F.shape[1] * (2 * CTX + 1)), np.float32)


def train(F: np.ndarray, e: np.ndarray, floor: np.ndarray, dec: list[dict], refs: np.ndarray, rights: list[dict],
          pool_frames: np.ndarray | None):
    """Per-tape listener-vs-teacher MLP. Returns (net, mu, sd, stats)."""
    import torch

    mu, sd = F.mean(0), F.std(0) + 1e-6
    Fn = (F - mu) / sd
    act = e > floor + 10
    na = len(act)

    def active(fr):
        return fr[act[np.clip(fr, 0, na - 1)]]

    pos, neg = [], []
    for d in dec:
        fr = active(np.arange(int(d["start"] * 100), int(d["end"] * 100)))
        if d["label"] == "right" and d["spk"] > POS_SPK:
            pos.append(fr)
        elif d["label"] == "rabbi" and d["spk"] < NEG_SPK:
            neg.append(fr)
    for a, b in refs:
        neg.append(active(np.arange(int(a * 100), int(b * 100))))
    # more teacher frames: random active frames > 2 s from any transcript right or listener burst
    rng = np.random.default_rng(0)
    bad = np.zeros(na, bool)
    for r in rights:
        bad[max(0, int(r["lo"] * 100) - 200):int(r["hi"] * 100) + 200] = True
    for d in dec:
        if d["label"] != "rabbi":
            bad[max(0, int(d["start"] * 100) - 200):int(d["end"] * 100) + 200] = True
    cand = np.where(act & ~bad)[0]
    neg.append(rng.choice(cand, min(6000, len(cand)), replace=False))
    P = np.concatenate(pos) if pos else np.zeros(0, int)
    N = np.concatenate(neg).astype(int)
    X = np.concatenate([stack(Fn, P), stack(Fn, N)])
    y = np.concatenate([np.ones(len(P)), np.zeros(len(N))])
    own_pos = len(P)
    if len(P) < MIN_POS_FRAMES and pool_frames is not None and len(pool_frames):
        X = np.concatenate([X, pool_frames])
        y = np.concatenate([y, np.ones(len(pool_frames))])
        P = np.concatenate([P, np.zeros(len(pool_frames), int)])
    if len(P) == 0:
        raise RuntimeError("no listener frames to train on")
    Xt, yt = torch.from_numpy(X).float(), torch.from_numpy(y).float()
    wts = torch.where(yt > 0, len(N) / len(P), 1.0)
    perm = rng.permutation(len(X))
    va, tr = perm[: len(X) // 5], perm[len(X) // 5:]
    torch.manual_seed(0)
    net = torch.nn.Sequential(torch.nn.Linear(X.shape[1], 64), torch.nn.ReLU(), torch.nn.Dropout(0.2), torch.nn.Linear(64, 1))
    opt = torch.optim.Adam(net.parameters(), 1e-3, weight_decay=1e-4)
    for _ in range(EPOCHS):
        net.train()
        for k in range(0, len(tr), 256):
            b = tr[k:k + 256]
            loss = (torch.nn.functional.binary_cross_entropy_with_logits(net(Xt[b])[:, 0], yt[b], reduction="none") * wts[b]).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
    net.eval()
    with torch.inference_mode():
        pv = torch.sigmoid(net(Xt[va])[:, 0]).numpy()
    yv = y[va]
    stats = {"posFrames": own_pos, "pooledPosFrames": len(P) - own_pos, "negFrames": int(len(N)),
             "valTpr": round(float((pv[yv == 1] > 0.5).mean()), 3) if (yv == 1).any() else None,
             "valFpr": round(float((pv[yv == 0] > 0.5).mean()), 3)}
    return net, mu, sd, stats


def posterior(net, mu, sd, F: np.ndarray) -> np.ndarray:
    """Listener posterior per 10 ms frame, whole tape (in chunks)."""
    import torch

    Fn = (F - mu) / sd
    out = []
    with torch.inference_mode():
        for a in range(0, len(F), 20000):
            idx = np.arange(a, min(a + 20000, len(F)))
            out.append(torch.sigmoid(net(torch.from_numpy(stack(Fn, idx)).float())[:, 0]).numpy())
    return np.concatenate(out) if out else np.zeros(0)
