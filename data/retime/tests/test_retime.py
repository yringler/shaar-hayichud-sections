import json

import numpy as np

from retime import align as A
from retime import files
from retime.romanize import romanize

# Shared with data/tools/src/retimed.test.ts: both implementations must give this hash.
SHA_WORDS = [
    {"word": "Hello", "start": 0.0, "end": 0.4995},
    {"word": "אור", "start": 1.0005, "end": 1.25},
    {"word": "world.", "start": 12.3456, "end": 12.9},
]
SHA_EXPECTED = "80b8b21a5188e02272b99de4f58c64b30530c21053497be4a2b410b85ede886d"


def test_sha_canonical_string():
    import hashlib

    text = "Hello\t0\t500\nאור\t1001\t1250\nworld.\t12346\t12900\n"
    assert files.transcript_sha(SHA_WORDS) == hashlib.sha256(text.encode()).hexdigest() == SHA_EXPECTED


def test_romanize():
    assert romanize("Twelve,") == ("twelve", False)
    assert romanize("12") == ("twelve", False)
    assert romanize("אין") == ("ain", True)
    assert romanize("תורה") == ("tora", True)
    assert romanize("—") == ("", False)


def test_pile_and_affected():
    pile = [{"word": "a", "start": 5.0, "end": 5.0}] * 20
    assert A.pile_words(pile) == 20
    assert A.affected(pile)
    spaced = [{"word": "a", "start": 0.417 * i, "end": 0.417 * i} for i in range(25)]
    assert A.pile_words(spaced) == 0 and A.affected(spaced)
    natural = [{"word": "a", "start": 0.3 * i + (0.05 if i % 2 else 0), "end": 0} for i in range(50)]
    assert not A.affected(natural)


def test_format_one_word_per_line():
    doc = {"schemaVersion": 1, "lectureId": "x", "words": [[0.0, 0.1, None, 0], [0.2, 0.3, 0.9, 2]]}
    text = files.format_retimed(doc)
    assert "\n    [0.0,0.1,null,0],\n    [0.2,0.3,0.9,2]\n" in text
    assert json.loads(text) == doc


def test_retime_interpolation_is_monotone():
    """Fake emissions that spell out the words one after another; times must not reorder."""
    import torchaudio

    d = torchaudio.pipelines.MMS_FA.get_dict(star="*")
    words = ["hello", "there", "and", "welcome", "everyone"]
    frames = []
    for w in words:
        frames += [0] * 10  # blank / silence
        for ch in w:
            frames += [d[ch]] * 3
    frames += [0] * 10
    em = np.full((len(frames), 29), -20.0, dtype=np.float32)
    em[np.arange(len(frames)), frames] = 0.0
    em[:, 28] = -5.0  # star unlikely: speech is transcribed
    ts = [{"word": w, "start": 0.0, "end": 0.0} for w in words]
    out, st = A.retime(ts, em)
    starts = [w[0] for w in out]
    assert starts == sorted(starts)
    assert all(w[1] >= w[0] for w in out)
    assert st["words"] == 5 and st["aligned"] == 5
    # "hello" starts after the first 10 blank frames (0.2 s).
    assert abs(out[0][0] - 0.2) < 0.03
