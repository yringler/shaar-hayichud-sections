# retime: forced-alignment re-timing of Sofer transcripts

Sofer.ai's word timestamps are broken on many tapes: runs of 20 or more words
share one start time ("piles"), or are spread at a synthetic 0.417 s
spacing, and the times after a pile can drift by minutes. `yarn align` takes
its line times from the word times, so a line read at 12:06 can come out at
6:26. This tool re-times every Sofer word against the audio itself and
writes `data/retimed/<encoded lecture id>.json`; `yarn align` and the
published transcripts use those times instead of Sofer's when a current file
exists.

It is Python (torch / torchaudio) and lives apart from `data/tools/`, so the
TypeScript build and the Cloudflare deploy never need Python. They only read
the committed `data/retimed/` files.

## Setup

Needs [uv](https://docs.astral.sh/uv/), `curl` and `ffmpeg`.

```bash
cd data/retime
uv sync                  # .venv with CPU torch/torchaudio 2.8 (pinned in uv.lock)
uv sync --extra verify   # also faster-whisper, for retime-verify
uv run pytest            # unit tests
```

torchaudio is pinned to 2.8: 2.9 removes `torchaudio.functional.forced_align`.

## Running

```bash
cd data/retime
uv run retime --lecture "216 Tape47-Side1Ch42&43-.mp3"   # one tape (repeatable)
uv run retime --affected --max-minutes 100               # every tape with broken Sofer times
uv run retime --all --dry-run                            # what --all would do
```

then re-align and check:

```bash
cd ../tools
yarn align --lecture "216 Tape47-Side1Ch42&43-.mp3"
yarn build-data
```

| Option | |
|--------|---|
| `--lecture ID` | a catalog lecture id with a stored transcript (repeatable) |
| `--affected` | every transcript with a pile of 20+ words at one start time, or 20+ words at the synthetic 0.417 s spacing |
| `--all` | every transcript |
| `--max-minutes N` | stop cleanly after the tape in progress once N minutes have passed (exit status 3: more to do). A tape is never cut off, so leave room for one (an hour of audio is about 15-25 min) |
| `--cache DIR` | audio, emissions and model cache (default `$RETIME_CACHE`, else `~/.cache/shaar-hayichud-retime`). If you put it inside the repo, use `data/retime/.cache/` (git-ignored) |
| `--threads N` | torch CPU threads (default 4) |
| `--force` | re-align even when the output is current (cached emissions are reused) |
| `--dry-run` | list what would be done |

**Per tape:** download the mp3 to `<cache>/audio/` (skipped when present),
compute MMS_FA emissions to `<cache>/emissions/<encoded id>.em.npy` (skipped
when present), align, and write the output atomically (temp file plus
rename, so a killed run leaves no half file). The model (about 1.2 GB) is
downloaded once to `<cache>/torch/`.

**Resuming.** A tape whose output already holds the current transcript's
`transcriptSha` and the current method version is skipped before anything
is downloaded, so rerunning the same command carries on where the last run
stopped. A tape killed during its emissions starts that tape again (the
emissions are written only when complete).

**Cost.** Emissions are the expensive part: about 15 min of wall time per
audio hour on 4 threads (a 30 min tape takes 8-12 min). Alignment itself
takes about 10 s per tape. Each tape prints its anchor coverage and spacing:

```
  4300 words: anchors 1316 (30.6%), placed 71.2%; anchor gap median 0.6 s, p90 2.94 s, max 37.04 s; ...
```

## Method

`src/retime/align.py`, from a prototype checked against Whisper:

1. **Emissions** (`emissions.py`): torchaudio's `MMS_FA` (wav2vec2, multilingual,
   characters a-z and apostrophe) with the `<star>` wildcard, on 30 s chunks with
   2 s of context per side. The bundle already applies `log_softmax`; an early
   prototype applied it twice, which `fix_double_log_softmax` undoes on load.
2. **Romanization** (`romanize.py`): English lowercased, digits spelled out;
   Hebrew words (Sofer writes them in Hebrew letters) get an Ashkenazi-style
   transliteration (`ashkenazi-v1`).
3. **Windowed CTC alignment**: blocks of 600 words, each in an audio window
   starting where the last committed word ended, with `<star>` between words to
   absorb untranscribed speech and noise. The first 70% of a block (up to its
   last confident long word) is committed, and the next block starts there.
4. **Anchors**: 4+ romanized characters, mean character posterior at least 0.5,
   a duration between 0.12 s and 0.12 s per character + 0.6 s, and under 7
   words/s against the neighbouring candidates. **Soft anchors**: any other word
   scoring at least 0.25 keeps its own aligned time.
5. **Interpolation**: every other word by character count between the placed
   words. The aligner is monotone, so words are never reordered.

Prototype results (October 2026): tape 216's chapter 43 moved from 6:26 to
12:06, and Whisper heard 133 of 150 sampled anchors at their new time against
24 of 150 at Sofer's times; on a clean tape the anchors agree with Sofer to
about 0.3 s.

`retime-verify --lecture ID` (needs `--extra verify`) repeats that Whisper
check on a retimed file.

## Output: `data/retimed/<encoded lecture id>.json`

Schema: `data/schema/sources/retimed.schema.json`. Named like the transcript.

```json
{
  "schemaVersion": 1,
  "lectureId": "216 Tape47-Side1Ch42&43-.mp3",
  "transcript": "transcripts/216%20Tape47-Side1Ch42%2643-.mp3.json",
  "transcriptSha": "3f0c…",
  "method": { "name": "mms-fa-ctc-windowed", "version": 1, "transliteration": "ashkenazi-v1", "…": "…" },
  "stats": { "words": 4300, "anchors": 1316, "anchorPct": 30.6, "…": "…" },
  "words": [
    [12.34,12.71,0.83,2],
    [12.71,13.02,null,0]
  ]
}
```

`words` has one entry per entry of the transcript's `result.timestamps`, in
order: `[start, end, score, kind]`. Times are seconds; `score` is the mean
frame posterior of the word's characters (`null` when it had nothing to
align, such as punctuation); `kind` is 2 for an anchor, 1 for a soft anchor
and 0 for an interpolated word. Starts never decrease and `end >= start`.

`transcriptSha` is the lowercase hex SHA-256 of the UTF-8 bytes of, for each
entry `w` of `result.timestamps` in order,

```
w.word + "\t" + ms(w.start) + "\t" + ms(w.end) + "\n"
```

where `ms(x) = floor(x * 1000 + 0.5)` written as a base-10 integer.
`files.py` (`transcript_sha`) and `data/tools/src/retimed.ts`
(`transcriptSha`) compute it and share a test vector.

The data build checks every file: the schema, the file name, that the
transcript exists, that `words` has one entry per transcript word, that
times are monotone, and that `transcriptSha` matches the transcript. A
stale file (the transcript changed, for example after
`yarn transcribe --resubmit`) fails the build: rerun `retime --lecture ID`
or delete the file. `yarn align` also refuses a stale file rather than
falling back to Sofer's times.

**Range overrides.** `fromSeconds` in `data/alignment-chapters.json` is
compared with the word times `yarn align` uses, so once a tape is retimed its
range boundaries must be in retimed time. Check the overrides of any tape you
retime.
