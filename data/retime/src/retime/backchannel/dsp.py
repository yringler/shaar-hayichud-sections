"""Pure numpy/scipy signal helpers: 10 ms energy frames, burst detection, room-tone fill, verification.

Times in seconds; frames are 10 ms (HOP samples at the model rate SR). Nothing
here loads a model or touches the file system, so it is unit-tested directly.
"""
from __future__ import annotations

import numpy as np

SR = 16000  # model / analysis rate
HOP = 160  # 10 ms at SR
FPS = 100  # frames per second

# Bursts: speech-band energy over a rolling 3 s 10th-percentile floor, hysteresis.
BURST_HI_DB = 14.0
BURST_LO_DB = 7.0
BURST_MIN_PAUSE = 0.1  # s of quiet each side
BURST_MIN_DUR = 0.08
BURST_MAX_DUR = 0.7

# Fill.
XFADE = 0.015  # raised-cosine crossfade, s
TONE_MIN, TONE_MAX = 0.3, 2.0  # room-tone source length, s
TONE_SEARCH = 10.0  # s each side
QUIET_DB = 4.0  # frames within this of the local floor count as room tone
GAIN_LIMIT_DB = 6.0


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[a, b) index ranges where mask is true."""
    m = np.concatenate([[0], np.asarray(mask).astype(np.int8), [0]])
    d = np.diff(m)
    return list(zip(np.where(d == 1)[0].tolist(), np.where(d == -1)[0].tolist()))


def band_db(w: np.ndarray, lo: float = 300, hi: float = 3400, nfft: int = 512) -> np.ndarray:
    """Speech-band energy (dB) per 10 ms frame of 16 kHz audio."""
    from scipy.signal import stft

    f, _, z = stft(w, fs=SR, nperseg=400, noverlap=400 - HOP, nfft=nfft, boundary=None, padded=False)
    m = (f >= lo) & (f <= hi)
    return 10 * np.log10(np.mean(np.abs(z[m]) ** 2, axis=0) + 1e-12)


def energy_floor(w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(smoothed band energy, rolling 3 s 10th-percentile floor), both per frame."""
    from scipy.ndimage import percentile_filter, uniform_filter1d

    e = uniform_filter1d(band_db(w), 3)
    return e, percentile_filter(e, 10, size=301)


def hysteresis(e: np.ndarray, floor: np.ndarray, hi: float, lo: float) -> list[tuple[int, int]]:
    """Runs above floor + lo that reach floor + hi somewhere."""
    core = e > floor + hi
    return [(a, b) for a, b in runs(e > floor + lo) if core[a:b].any()]


def bursts_from_energy(e: np.ndarray, floor: np.ndarray, hi: float = BURST_HI_DB, lo: float = BURST_LO_DB,
                       min_pause: float = BURST_MIN_PAUSE, dmin: float = BURST_MIN_DUR,
                       dmax: float = BURST_MAX_DUR) -> list[dict]:
    """Short energy bursts with a pause on both sides (candidate back-channels)."""
    rs = [(a, b) for a, b in hysteresis(e, floor, hi, lo) if b - a >= 6]  # drop blips < 60 ms
    merged: list[list[int]] = []
    for a, b in rs:  # join gaps < 60 ms
        if merged and a - merged[-1][1] < 6:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    out = []
    for k, (a, b) in enumerate(merged):
        dur = (b - a) / FPS
        if not (dmin <= dur <= dmax):
            continue
        pre = (a - merged[k - 1][1]) / FPS if k else 9.0
        post = (merged[k + 1][0] - b) / FPS if k + 1 < len(merged) else 9.0
        if pre < min_pause or post < min_pause:
            continue
        out.append({
            "start": round(a / FPS, 2), "end": round(b / FPS, 2), "dur": round(dur, 2), "pre": round(pre, 2),
            "post": round(post, 2), "peak": round(float(e[a:b].max() - floor[a:b].mean()), 1),
        })
    return out


def kw_room_tone(w: np.ndarray, t: float, dur: float, rng: np.random.Generator) -> np.ndarray:
    """Quietest 0.3 s stretch within +-5 s of t, tiled from random rotations to dur (keyword-clip padding)."""
    a, b = max(0, int((t - 5) * SR)), min(len(w), int((t + 5) * SR))
    seg = w[a:b]
    n = int(0.3 * SR)
    hop = n // 4
    rms = [np.sqrt(np.mean(seg[i:i + n] ** 2)) for i in range(0, len(seg) - n, hop)]
    i = int(np.argmin(rms)) * hop
    base = seg[i:i + n]
    reps = int(np.ceil(dur * SR / n)) + 1
    return np.concatenate([np.roll(base, rng.integers(n)) for _ in range(reps)])[:int(dur * SR)]


# --------------------------------------------------------------------------
# Fill


def frame_db(x: np.ndarray, hop: int) -> np.ndarray:
    """RMS level (dB) per hop-sample frame (in chunks, so a long 32 kHz tape stays small)."""
    nf = len(x) // hop
    out = np.empty(nf)
    step = 1 << 16
    for a in range(0, nf, step):
        b = min(nf, a + step)
        fr = x[a * hop:b * hop].reshape(b - a, hop).astype(np.float64)
        out[a:b] = 20 * np.log10(np.sqrt((fr * fr).mean(1)) + 1e-10)
    return out


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.asarray(x, dtype=np.float64) ** 2) + 1e-20))


def raised(n: int) -> np.ndarray:
    """Raised-cosine ramp 0 -> 1 over n samples (symmetric: ramp + ramp[::-1] == 1)."""
    return 0.5 - 0.5 * np.cos(np.pi * (np.arange(n) + 0.5) / n)


def loop_tone(tone: np.ndarray, n: int, rng: np.random.Generator, xf: int) -> np.ndarray:
    """n samples of tone chunks from random offsets, joined with xf-sample crossfades."""
    out = np.zeros(n + xf, dtype=np.float64)
    pos, ramp, size = 0, raised(xf), len(tone)
    while pos < n:
        ln = min(size, n + xf - pos)
        off = int(rng.integers(0, size - ln + 1))
        ch = tone[off:off + ln].astype(np.float64).copy()
        if pos > 0:
            k = min(xf, ln)
            ch[:k] *= ramp[:k]
            out[pos:pos + k] *= 1 - ramp[:k]
        out[pos:pos + ln] += ch
        pos += ln - xf
        if ln <= xf:
            break
    return out[:n]


def find_tone(db: np.ndarray, hop: int, fps: float, s: int, e: int, blocked: np.ndarray) -> tuple[int, int, str]:
    """(a, b) sample range of room tone near samples [s, e). `blocked`: frame mask of edit regions."""
    f0, f1 = s // hop, -(-e // hop)
    lo, hi = max(0, f0 - int(TONE_SEARCH * fps)), min(len(db), f1 + int(TONE_SEARCH * fps))
    seg = np.convolve(db[lo:hi], np.ones(5) / 5, mode="same")  # 50 ms smoothing
    ok = ~blocked[lo:hi]
    near = ok.copy()
    near[: max(0, f0 - lo - int(3 * fps))] = False
    near[f1 - lo + int(3 * fps):] = False
    floor = np.percentile(seg[near if near.sum() > 50 else ok], 10)
    nmin, nmax = int(TONE_MIN * fps), int(TONE_MAX * fps)
    for slack in (QUIET_DB, QUIET_DB * 2):
        cands = []
        for a, b in runs((seg < floor + slack) & ok):
            if b - a < nmin:
                continue
            a, b = a + lo, b + lo
            same_pause = b >= f0 - 15 and a <= f1 + 15
            if b - a > nmax:  # at most 2 s, centred on the part nearest the edit
                c = min(max((f0 + f1) // 2, a + nmax // 2), b - nmax // 2)
                a, b = c - nmax // 2, c + nmax // 2
            mean = float(seg[a - lo:b - lo].mean())
            cands.append((0 if same_pause else 1, round(mean, 0), min(abs(a - f1), abs(b - f0)), a, b))
        if cands:
            same, _, _, a, b = min(cands)
            return a * hop, b * hop, "same pause" if same == 0 else "nearby"
    m = np.convolve(np.where(ok, seg, 0.0), np.ones(nmin) / nmin, mode="valid")
    m[np.convolve((~ok).astype(float), np.ones(nmin), mode="valid") > 0] = np.inf
    a = lo + int(np.argmin(m))
    return a * hop, (a + nmin) * hop, "quietest window"


def target_rms(x: np.ndarray, db: np.ndarray, hop: int, fps: float, s: int, e: int, blocked: np.ndarray) -> float | None:
    """RMS of the quieter half of the unblocked frames within 0.4 s of the edit."""
    w = int(0.4 * fps)
    f0, f1 = s // hop, -(-e // hop)
    idx = [i for i in list(range(max(0, f0 - w), f0)) + list(range(f1, min(len(db), f1 + w))) if not blocked[i]]
    if not idx:
        return None
    v = db[idx]
    sel = np.array(idx)[v <= np.percentile(v, 50)]
    return float(np.sqrt(np.mean([np.mean(x[i * hop:(i + 1) * hop].astype(np.float64) ** 2) for i in sel])))


def fill_mask(n: int, xf: int) -> np.ndarray:
    """Weight of the fill over an n-sample edit: raised-cosine in and out, 1 in between."""
    ramp = raised(min(xf, n // 2))
    m = np.ones(n)
    m[: len(ramp)] = ramp
    m[n - len(ramp):] = np.minimum(m[n - len(ramp):], ramp[::-1])
    return m


def apply_fill(x: np.ndarray, sr: int, spans: list[tuple[float, float]], seed_key: str) -> tuple[np.ndarray, list[dict]]:
    """Replace each [start, end) (s) of x ([samples] or [samples, channels]) with matched room tone.

    The tone source and gain are chosen on the channel mean; every channel takes its
    tone from the same samples, so a stereo image stays put. Same seed key, same output.
    """
    import zlib

    x2 = x if x.ndim == 2 else x[:, None]
    mono = x2.mean(1, dtype=np.float32) if x2.shape[1] > 1 else x2[:, 0]
    y = np.array(x2, dtype=np.float32)
    hop = int(round(0.01 * sr))
    fps = sr / hop
    db = frame_db(mono, hop)
    blocked = np.zeros(len(db) + 1, dtype=bool)
    samp = []
    for a, b in spans:
        s, e = int(round(a * sr)), min(len(mono), int(round(b * sr)))
        samp.append((s, e))
        blocked[max(0, s // hop - 5): e // hop + 5] = True
    blocked = blocked[: len(db)]
    xf = int(round(XFADE * sr))
    info = []
    for k, (s, e) in enumerate(samp):
        n = e - s
        if n <= 0:
            continue
        ta, tb, src = find_tone(db, hop, fps, s, e, blocked)
        tr = target_rms(mono, db, hop, fps, s, e, blocked)
        g = 1.0 if tr is None else tr / rms(mono[ta:tb])
        g = float(np.clip(g, 10 ** (-GAIN_LIMIT_DB / 20), 10 ** (GAIN_LIMIT_DB / 20)))
        m = fill_mask(n, xf)
        for c in range(x2.shape[1]):
            rng = np.random.default_rng(zlib.crc32(f"{seed_key}:{k}".encode()))
            fill = loop_tone(x2[ta:tb, c], n, rng, xf) * g
            y[s:e, c] = (x2[s:e, c] * (1 - m) + fill * m).astype(np.float32)
        info.append({"start": round(s / sr, 3), "end": round(e / sr, 3), "tone": [round(ta / sr, 2), round(tb / sr, 2)],
                     "toneFrom": src, "gainDb": round(20 * np.log10(g), 1)})
    return (y if x.ndim == 2 else y[:, 0]), info


# --------------------------------------------------------------------------
# Verification


def best_lag(a: np.ndarray, b: np.ndarray, max_lag: int) -> int:
    """Shift (samples) of a against b with the highest cross-correlation, within +-max_lag."""
    n = len(a) + len(b)
    nfft = 1 << (n - 1).bit_length()
    c = np.fft.irfft(np.fft.rfft(a, nfft) * np.conj(np.fft.rfft(b, nfft)), nfft)
    c = np.concatenate([c[-max_lag:], c[: max_lag + 1]])
    return int(np.argmax(c)) - max_lag


def max_zero_run(x: np.ndarray) -> int:
    """Longest run of exactly-zero samples (digital silence)."""
    return max([b - a for a, b in runs(np.asarray(x) == 0)] or [0])


def lags(ref: np.ndarray, dec: np.ndarray, sr: int, points: int = 5, seconds: float = 10.0, max_lag: int = 2000) -> list[int]:
    """Alignment offsets of dec against ref at `points` places spread over the file (all 0 when aligned)."""
    out = []
    n = min(len(ref), len(dec))
    for c in np.linspace(0.1, 0.9, points):
        i = int(c * n)
        a, b = ref[i:i + int(seconds * sr)], dec[i:i + int(seconds * sr)]
        out.append(best_lag(b.astype(np.float64), a.astype(np.float64), max_lag))
    return out


def snr_outside(ref: np.ndarray, dec: np.ndarray, sr: int, spans: list[tuple[float, float]], guard: float = 0.1) -> float:
    """SNR (dB) of dec against ref over the samples at least `guard` s away from every span."""
    n = min(len(ref), len(dec))
    keep = np.ones(n, dtype=bool)
    for a, b in spans:
        keep[max(0, int((a - guard) * sr)):int((b + guard) * sr)] = False
    sig = err = 0.0
    step = 1 << 20
    for a in range(0, n, step):
        k = keep[a:a + step]
        r = ref[a:a + step][k].astype(np.float64)
        d = dec[a:a + step][k].astype(np.float64)
        sig += float(np.sum(r * r))
        err += float(np.sum((r - d) ** 2))
    return float(10 * np.log10(sig / (err + 1e-20) + 1e-20))
