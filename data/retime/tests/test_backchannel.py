"""Pure parts of retime.backchannel: no models, no network (scipy is in the `edit` extra)."""
import json

import numpy as np
import pytest

pytest.importorskip("scipy")

from retime.backchannel import catalog, dsp, editlist, media  # noqa: E402
from retime.backchannel import detect as D  # noqa: E402
from retime.backchannel.words import Words, transcript_rights  # noqa: E402

SR = dsp.SR


def hiss(n, level=0.003, seed=0):
    return (np.random.default_rng(seed).standard_normal(n) * level).astype(np.float32)


def tone(t0, dur, f=220.0, amp=0.2):
    t = np.arange(int(dur * SR)) / SR
    env = np.minimum(1, np.minimum(t, dur - t) / 0.01)
    return (amp * env * (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t))).astype(np.float32), int(t0 * SR)


def place(w, *parts):
    for x, i in parts:
        w[i:i + len(x)] += x
    return w


# ---------------------------------------------------------------- burst detection


def test_burst_in_pause_is_found_with_its_edges():
    w = place(hiss(12 * SR), tone(5.0, 0.3))
    e, fl = dsp.energy_floor(w)
    bs = dsp.bursts_from_energy(e, fl)
    assert len(bs) == 1
    b = bs[0]
    assert abs(b["start"] - 5.0) <= 0.04 and abs(b["end"] - 5.3) <= 0.04
    assert b["pre"] > 1 and b["post"] > 1 and b["peak"] > dsp.BURST_HI_DB


def test_long_speech_and_no_pause_are_not_bursts():
    # 1.5 s of "speech" is too long; two 0.2 s bursts 50 ms apart merge, 0.3 s + 0.05 s gap lacks a pause
    w = place(hiss(14 * SR), tone(2.0, 1.5), tone(7.0, 0.2), tone(7.25, 0.2))
    e, fl = dsp.energy_floor(w)
    bs = dsp.bursts_from_energy(e, fl)
    assert all(not (1.9 < b["start"] < 3.6) for b in bs)
    assert len([b for b in bs if 6.9 < b["start"] < 7.5]) == 1  # merged into one 0.45 s burst
    assert dsp.bursts_from_energy(e, fl, min_pause=5.0) == []


def test_runs():
    assert dsp.runs(np.array([0, 1, 1, 0, 1])) == [(1, 3), (4, 5)]
    assert dsp.runs(np.zeros(3)) == []


# ---------------------------------------------------------------- fill / crossfade math


def test_raised_cosine_is_complementary():
    r = dsp.raised(240)
    assert r[0] > 0 and r[-1] < 1 and np.all(np.diff(r) > 0)
    np.testing.assert_allclose(r + r[::-1], 1.0, atol=1e-12)


def test_fill_mask_edges():
    m = dsp.fill_mask(1000, 240)
    assert m[0] < 0.01 and m[-1] < 0.01 and np.all(m[240:760] == 1)
    short = dsp.fill_mask(100, 240)  # shorter than two crossfades: ramps meet in the middle
    assert short.max() <= 1 and short[0] < 0.05 and short[-1] < 0.05


def test_loop_tone_length_and_level():
    t = hiss(int(0.3 * SR), level=0.01)
    out = dsp.loop_tone(t, int(1.7 * SR), np.random.default_rng(1), 240)
    assert len(out) == int(1.7 * SR)
    assert abs(20 * np.log10(dsp.rms(out) / dsp.rms(t))) < 1.5


def test_apply_fill_replaces_only_the_span_with_room_tone():
    x = place(hiss(10 * SR), tone(5.0, 0.3, amp=0.3))
    y, info = dsp.apply_fill(x, SR, [(4.98, 5.32)], "k")
    assert len(y) == len(x)
    s, e = int(4.98 * SR), int(5.32 * SR)
    np.testing.assert_array_equal(y[:s], x[:s])
    np.testing.assert_array_equal(y[e:], x[e:])
    seg = y[s + 240:e - 240]
    assert abs(20 * np.log10(dsp.rms(seg) / 0.003)) < 3  # hiss level, not the tone, not silence
    assert dsp.max_zero_run(y[s:e]) == 0
    assert info[0]["toneFrom"] in ("same pause", "nearby")
    y2, _ = dsp.apply_fill(x, SR, [(4.98, 5.32)], "k")
    np.testing.assert_array_equal(y, y2)  # deterministic per seed key


def test_apply_fill_stereo_keeps_channels_and_shape():
    m = place(hiss(6 * SR), tone(3.0, 0.2))
    x = np.stack([m, m * 0.5], 1)
    y, _ = dsp.apply_fill(x, SR, [(2.99, 3.21)], "k")
    assert y.shape == x.shape
    s, e = int(3.0 * SR), int(3.2 * SR)
    np.testing.assert_allclose(y[s:e, 1], y[s:e, 0] * 0.5, atol=1e-6)  # same tone source in both channels


# ---------------------------------------------------------------- time / length verification


def test_best_lag_and_lags():
    a = hiss(SR * 4, level=0.1, seed=3).astype(np.float64)
    b = np.concatenate([np.zeros(37), a])[: len(a)]
    assert dsp.best_lag(b, a, 200) == 37
    assert dsp.lags(a, a, SR, seconds=1.0) == [0] * 5


def test_snr_outside_ignores_edit_spans():
    x = hiss(SR * 4, level=0.1)
    y = x.copy()
    y[SR:SR + 1600] = 0.5
    assert dsp.snr_outside(x, y, SR, [(1.0, 1.1)]) > 100
    assert dsp.snr_outside(x, y, SR, []) < 20


def test_max_zero_run():
    assert dsp.max_zero_run(np.array([1, 0, 0, 0, 2, 0], dtype=float)) == 3
    assert dsp.max_zero_run(np.ones(4)) == 0


def test_mp3_bitrate_at_least_source_with_headroom():
    assert media.mp3_bitrate(24000, 16000) == 32
    assert media.mp3_bitrate(96000, 32000) == 128
    assert media.mp3_bitrate(32000, 16000) == 40
    assert media.mp3_bitrate(None, 44100) == 32
    assert media.mp3_bitrate(10 ** 6, 16000) == 160


# ---------------------------------------------------------------- edit list I/O


def doc_example():
    return {
        "schemaVersion": 1, "lectureId": "001 Intro.mp3", "mode": "fill",
        "source": {"durationSeconds": 10.0},
        "edits": [{"start": 1.0, "end": 1.4, "class": "isolated", "action": "fill", "src": "audio", "scores": {"spk": 0.3}},
                  {"start": 5.1, "end": 5.3, "class": "overlap", "action": "partial-fill", "src": "tx", "scores": {}}],
        "kept": [{"start": 7.0, "end": 7.2, "reason": "audio:low-P:?"}],
        "output": None,
    }


def test_format_one_edit_per_line_and_roundtrip(tmp_path):
    d = doc_example()
    text = editlist.format_doc(d)
    assert json.loads(text) == d
    lines = text.split("\n")
    assert any(ln.startswith('    {"start": 1.0, "end": 1.4') for ln in lines)
    assert any(ln.startswith('    {"start": 7.0') for ln in lines)
    p = tmp_path / "edits" / "x.json"
    editlist.write(p, d)
    assert editlist.read(p) == d and not list(p.parent.glob(".*tmp*"))
    assert editlist.read(tmp_path / "missing.json") is None


def test_check_and_edits_sha():
    d = doc_example()
    assert editlist.check(d) == []
    bad = doc_example()
    bad["edits"][1]["start"] = 1.2
    bad["edits"].append({"start": 11.0, "end": 11.5, "class": "isolated", "action": "fill"})
    errs = editlist.check(bad)
    assert any("out of order" in e for e in errs) and any("past the end" in e for e in errs)
    s = editlist.edits_sha(d["edits"])
    d2 = doc_example()
    d2["edits"][0]["scores"] = {"spk": 0.9}
    assert editlist.edits_sha(d2["edits"]) == s  # scores do not change the render
    d2["edits"][0]["end"] = 1.41
    assert editlist.edits_sha(d2["edits"]) != s


# ---------------------------------------------------------------- frame rules, transcript, catalog


def frames(ps, rabbi=(), db=None):
    ps = np.asarray(ps, dtype=float)
    e = np.full(len(ps), -25.0) if db is None else np.asarray(db, dtype=float) - 50.0
    fl = np.full(len(ps), -50.0)
    for i in rabbi:
        e[i] = -20.0
    return D.Frames(ps, e, fl)


def test_cap_cuts_overlong_edit_to_loud_core_plus_tail():
    ps = np.full(200, 0.1)
    ps[40:70] = 0.95  # the listener, 0.3 s, loud
    ps[70:130] = 0.9  # posterior spill into quieter frames after it
    db = np.full(200, 25.0)
    db[70:130] = 12.0
    fr = frames(ps, db=db)
    x, y = fr.cap(40, 130, 60)
    assert x == 40 - D.PAD or x == 40
    assert y == 70 + D.TAIL  # the decay is kept for at most TAIL frames
    assert fr.cap(40, 80, 60) == (40, 80)  # short spans are untouched
    quiet = frames(ps, db=np.full(200, 12.0))
    assert quiet.cap(40, 130, 60) == (40, 40)  # no loud core: dropped
    assert int(fr.core(30, 140).sum()) == 30


def test_partial_never_cuts_into_preceding_teacher_tail():
    ps = np.full(100, 0.1)
    ps[30:60] = 0.9
    fr = frames(ps, rabbi=range(20, 30))
    a, b = fr.partial(20, 70)
    assert a == 30 and b == 70


def test_transcript_rights_standalone_and_bracket():
    ts = [{"word": w, "start": i, "end": i + 0.5} for i, w in enumerate(["end.", "Right.", "Next", "is", "right", "here."])]
    w = Words(ts, [[x["start"], x["end"], None, 0] for x in ts], "sofer", "")
    rs = transcript_rights(w)
    assert [r["standalone"] for r in rs] == [True, False]
    assert rs[0]["lo"] == 0.5 and rs[0]["hi"] == 2


def test_catalog_lectures_and_edited_name(tmp_path):
    p = tmp_path / "classes.txt"
    p.write_text("# S:37\n## P:38\n> A/B  c\n- Intro\n001 Intro.mp3:722.9\n@ 002 old.mp3\n002 new (x).mp3\n# T:0\n> Z\n9.mp3\n", "utf-8")
    ls = catalog.lectures(p)
    assert [(x.id, x.filename, x.folder, x.series, x.seconds) for x in ls] == [
        ("001 Intro.mp3", "001 Intro.mp3", "A/B  c", "37", 722.9),
        ("002 old.mp3", "002 new (x).mp3", "A/B  c", "37", None),
        ("9.mp3", "9.mp3", "Z", "0", None),
    ]
    assert catalog.edited_filename("214 Tape46-Side1 Ch41&42.mp3") == "214 Tape46-Side1 Ch41&42 (edited).mp3"


# Shared with data/tools/src/audio-edits.test.ts: both implementations must give this hash.
EDITS_SHA_EDITS = [{"start": 1.0, "end": 1.4, "action": "fill"}, {"start": 5.1, "end": 5.3, "action": "partial-fill"},
                   {"start": 1234.56, "end": 1235.07, "action": "fill"}]
EDITS_SHA_EXPECTED = "f79145335ab6a50e1c4480a51073a161d944188705ce1eceabe14bc8fecfe1d6"


def test_edits_sha_shared_vector():
    assert editlist.edits_sha(EDITS_SHA_EDITS) == EDITS_SHA_EXPECTED


def test_classes_patch_adds_old_id_and_keeps_duration(tmp_path):
    from retime.backchannel import upload

    (tmp_path / "classes.txt").write_text("# S:37\n> F/G\n- Intro\n001 Intro.mp3:722.9\n@ 002 old.mp3\n002 new.mp3:5\n", "utf-8")
    items = [
        {"line": 4, "lectureId": "001 Intro.mp3", "filename": "001 Intro.mp3", "editedFilename": "001 Intro (edited).mp3"},
        {"line": 6, "lectureId": "002 old.mp3", "filename": "002 new.mp3", "editedFilename": "002 new (edited).mp3"},
    ]
    patch = upload.classes_patch(tmp_path, items)
    assert "-001 Intro.mp3:722.9\n+@ 001 Intro.mp3\n+001 Intro (edited).mp3:722.9\n" in patch
    assert "-002 new.mp3:5\n+002 new (edited).mp3:5\n" in patch and "+@ 002" not in patch


def test_upload_credentials_file_wins_over_stray_shell_vars(tmp_path, monkeypatch):
    from retime.backchannel import upload

    f = tmp_path / "r2.env"
    f.write_text("R2_ENDPOINT=https://e\nR2_BUCKET=b\nAWS_ACCESS_KEY_ID='k'\nAWS_SECRET_ACCESS_KEY=s\n", "utf-8")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "other")
    env = upload.read_env(str(f))
    assert env["AWS_ACCESS_KEY_ID"] == "k" and env["R2_BUCKET"] == "b"
    monkeypatch.delenv("R2_ENV_FILE", raising=False)
    with pytest.raises(SystemExit):
        upload.read_env(None)  # environment lacks R2_ENDPOINT / R2_BUCKET
