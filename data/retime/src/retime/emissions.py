"""MMS_FA frame log-probabilities (with the <star> wildcard) for a whole tape.

The model runs on 30 s chunks with 2 s of context on each side (discarded),
so memory stays flat on hour-long tapes. Output: float16 [T, 29] at 50
frames/s (20 ms per frame); the last column is <star>, whose log-prob the
bundle sets to 0. The bundle already applies log_softmax: do not apply it
again (an early prototype did; see fix_double_log_softmax).

This is the expensive step (about 15 min of wall time per audio hour on 4
CPU threads), so the result is cached per tape.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np

SR = 16000
FPS = 50.0
CHUNK_SECONDS = 30
CONTEXT_SECONDS = 2
STAR = 28  # column of <star> in MMS_FA.get_dict(star="*")


def load_model(model_dir: Path, threads: int):
    import torch
    import torchaudio

    torch.set_num_threads(threads)
    torch.hub.set_dir(str(model_dir))
    return torchaudio.pipelines.MMS_FA.get_model(with_star=True).eval()


def compute(wav: np.ndarray, model) -> np.ndarray:
    import torch

    chunk, ctx = CHUNK_SECONDS * SR, CONTEXT_SECONDS * SR
    n = len(wav)
    out = []
    with torch.inference_mode():
        for s in range(0, n, chunk):
            a, b = max(0, s - ctx), min(n, s + chunk + ctx)
            em, _ = model(torch.from_numpy(np.ascontiguousarray(wav[a:b])).unsqueeze(0))
            em = em[0].numpy()
            fps = em.shape[0] / ((b - a) / SR)
            i0 = int(round((s - a) / SR * fps))
            i1 = int(round((min(n, s + chunk) - a) / SR * fps))
            out.append(em[i0:i1])
    return np.concatenate(out).astype(np.float16)


def fix_double_log_softmax(em: np.ndarray) -> np.ndarray:
    """Undo a second log_softmax over [log p(28), 0]: it subtracts log 2 everywhere."""
    if em[:, STAR].max() < -0.1:
        em = em.astype(np.float32) + np.log(2.0)
        em[:, STAR] = 0.0
    return em


def cached(path: Path, wav_loader, model_loader) -> tuple[np.ndarray, bool]:
    """(float32 emissions, computed_now). Computes and writes `path` atomically when missing."""
    if path.exists():
        return fix_double_log_softmax(np.load(path)).astype(np.float32), False
    wav = wav_loader()
    w0 = time.time()
    em = compute(wav, model_loader())
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp{os.getpid()}.npy")
    np.save(tmp, em)
    os.replace(tmp, path)
    print(f"  emissions: {len(wav) / SR:.0f} s audio -> {em.shape[0]} frames in {time.time() - w0:.0f} s", flush=True)
    return em.astype(np.float32), True
