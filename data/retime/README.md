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

## Back-channel removal (`backchannel`)

In the Rabbi Markel series (`:37`) a listener says a standalone "Right." about
100-135 times an hour, often in the teacher's pauses. `backchannel` finds them
and writes an edited copy of each tape in which they are replaced by room
tone. It shares this package and its cache but has its own extra; like
`retime`, nothing in the data build or the deploy needs it.

```bash
cd data/retime
uv sync --extra edit                                   # + speechbrain, faster-whisper, scipy
uv run backchannel detect --lecture "063 Ch5 part4.mp3" --render
uv run backchannel detect --all-markel --render        # whole series; resumable
uv run backchannel contact --all-markel --reel         # review clips
uv run pytest                                          # unit tests (the DSP ones need the extra)
```

**Fill, never cut.** Every edit keeps its length: the span is replaced by
room tone from the nearest quiet stretch (same pause first, else within
10 s, never another edit), RMS-matched to the quiet frames around the edit
(within +-6 dB), looped from random offsets with 15 ms raised-cosine joins and
borders. The edited file has the same duration as the original, so every
timestamp in `data/` (transcripts, retimed words, alignments, outlines) is
valid for both. Ducking and source separation were tried and dropped.

**Precision over recall.** A missed "right" stays audible; a cut into the
teacher's words damages the class. The rules below keep the teacher-damage
count at 0 on the hand-labelled evaluation windows.

### Subcommands

| | |
|---|---|
| `detect` | writes `data/edits/<encoded lecture id>.json` (atomically). `--render` renders each lecture right after; `--features-only` only fills the stage-1 cache; `--no-overlap` makes no partial-fill edits (every overlap candidate goes to `kept`) |
| `render` | fills, encodes and verifies the edited mp3 into `<cache>/edited/<CDN folder>/<stem> (edited).mp3`, and records it in the edit list's `output` |
| `contact` | review clips per lecture into `<cache>/contact/<encoded id>/` (3 s of the original, a beep, the same 3 s edited) with `index.json`: every overlap edit, every capped edit, the 3 weakest speaker scores and an even sample of the rest (`--per-lecture`, default 8). `--reel` joins all of them into `<cache>/contact/review-reel.mp3` + `.json` |
| `backchannel-upload` | the upload plan and upload (below) |

Selection: `--lecture ID` (repeatable), `--series N`, `--all-markel` (=
`--series 37`); `--shard K/N` takes every N-th selected lecture (run N
processes with `--threads 1` to use N CPUs); `--max-minutes`, `--force`,
`--dry-run`, `--cache`, `--threads` as for `retime`.

**Resuming.** `detect` skips a lecture whose edit list already has the
transcript's current `transcriptSha`, the same word-time source and the
current method version, before anything is downloaded. The slow stage-1
features are cached per tape in `<cache>/backchannel/features/`, so a
re-detect after a threshold change takes seconds. `render` skips a lecture
whose recorded output is verified, was made from the current edits
(`output.editsSha`) and still has its sha256 in the cache. A killed run
leaves no half file (temp file plus rename everywhere).

**Cost.** About 5 min of wall time per audio hour on 4 threads, almost all
of it stage 1 (the per-burst CTC keyword check dominates); the 47 h series
took about 2 h with 4 one-thread shards. Detection after that is about 20 s per tape and a render 20-45 s.

**Inputs.** The audio is the transcript's `audioUrl`, downloaded to
`<cache>/audio/` like `retime`. Models run on a 16 kHz mono decode; the
render works at the tape's native rate and channels (some tapes are 32 kHz
stereo). Transcript brackets use the retimed word times when a current
`data/retimed/` file exists, else Sofer's (the edit list's `wordTimes`); the
audio-led detection does not need either. Models: speechbrain
`spkrec-ecapa-voxceleb` and faster-whisper `base` (pinned revisions,
downloaded once to `<cache>/models/`), and MMS_FA (shared with `retime`).

### Method (`src/retime/backchannel/`, version 2)

1. **Bursts** (`dsp.py`): speech-band (300-3400 Hz) energy per 10 ms over a
   rolling 3 s 10th-percentile floor; runs above floor + 7 dB that reach
   floor + 14 dB, 80-700 ms long, with at least 100 ms of quiet on both sides.
2. **Speaker** (`features.py`, `listener.py`): an ECAPA embedding per burst;
   the teacher's centroid from 200 slices of 0.4 s of long speech; the
   listener's from the bursts that sit alone in the bracket of a transcript
   "Right." (seeds). Score = cos(listener) - cos(teacher), leave-one-out. A
   tape with fewer than 30 seeds adds the pooled listener of the three
   reference tapes (063, 002, 214; built once into
   `<cache>/backchannel/pool-v1.npz`).
3. **Keyword**: MMS_FA CTC forced-alignment score of "right" against
   yeah/okay/yes/so/and on each burst padded with room tone, and faster-whisper
   base on one reel of all burst clips per tape. A burst scoring over 0.10
   is the listener's; with either keyword check it is a "right".
4. **Frame posterior**: a small per-tape MLP on +-5 frames of 40 log-mel
   bands, trained on the tape's own confident "right" bursts against the
   teacher (borrowing the reference tapes' listener frames when it has fewer
   than 1000), gives a 10 ms listener posterior. It trims each audio-led edit
   to its listener core and finds the "right"s inside transcript brackets that
   no burst explained (residuals; confirmed by an ECAPA score over 0.05).
5. **Edits** (`detect.py`): isolated "right"s are filled whole; residuals
   that touch the teacher's speech become `partial-fill` (never into a
   preceding teacher tail, never into a following onset). A residual
   needs a loud listener core (5+ frames with posterior > 0.8 and energy 20 dB
   over the floor): the posterior also runs high on quiet frames and on the
   decaying tail of the teacher's words. Any edit over 0.6 s is cut to its
   loud core plus at most 150 ms of decay (one candidate ran 0.5 s into the
   teacher's next words).

**Evaluation.** Three hand-labelled 10 min windows (063 0-600 s, 002
600-1200 s, 214 1200-1800 s; 93 listener events): precision 0.987, recall
0.828, teacher damage 0 (October 2026). Recall on "right"s that overlap the
teacher is low (4 of 10); they are left in rather than risk the teacher.

**Whole series (October 2026).** 107 tapes, 47.2 h: 5,043 edits (4,406
isolated, 637 partial-fill overlaps), 29.3 min of audio filled, against
5,299 standalone "Right."s in the transcripts. An automatic screen
transcribed 4 s around 1,643 edits (every overlap and capped edit, plus 8
random per tape) before and after with faster-whisper: a back-channel word
was heard near 1,292 of them before and 34 after. A teacher word near the
edit went missing in 6.6% of audio-led isolated edits (the screen's own
noise: on these tapes whisper's wording changes from run to run) but in 15%
of overlap and transcript-found isolated edits, so some of those may clip
the teacher. Listen to the overlap clips (`contact`) before going live; if
they do, rerun `detect --no-overlap --render`.

### Render and verification (`render.py`)

CBR libmp3lame at the smallest standard rate that is at least 1.25x the
source's (24 kb/s sources -> 32 kb/s, 96 -> 128), at the native sample rate
and channels, with the original's tags copied. The render then decodes its
own output and requires: exactly the original's sample count; a
cross-correlation lag of 0 against the edited PCM at five places; no zero
run of 10 ms or more inside any edit; and at least 10 dB SNR against the
original outside the edits (100 ms guard). The sha256, size, duration,
bitrate, encoder, `editsSha` and these results go into `output`.

### Output: `data/edits/<encoded lecture id>.json`

Schema: `data/schema/sources/audio-edits.schema.json`; named like the
transcript; one edit per line.

```json
{
  "schemaVersion": 1, "lectureId": "063 Ch5 part4.mp3", "mode": "fill",
  "transcript": "transcripts/063%20Ch5%20part4.mp3.json", "transcriptSha": "…", "wordTimes": "retimed",
  "method": { "name": "audio-led-listener", "version": 1, "thresholds": {…}, "models": {…}, "pool": […] },
  "source": { "url": "https://media…", "sha256": "…", "sampleRate": 16000, "channels": 1, "durationSeconds": 1645.2, "bitrate": 24000 },
  "stats": { "bursts": 320, "seeds": 48, "edits": 108, "removedSeconds": 37.9, … },
  "edits": [
    {"start": 21.14, "end": 21.38, "class": "overlap", "action": "partial-fill", "src": "tx", "scores": {"spk": 0.278, "P": 0.943}},
    …
  ],
  "kept": [ {"start": 350.85, "end": 351.25, "reason": "audio:listener-other:isolated"}, … ],
  "output": { "filename": "063 Ch5 part4 (edited).mp3", "sha256": "…", "durationSeconds": …, "bitrate": 32000,
              "sampleRate": 16000, "channels": 1, "encoder": "…", "editsSha": "…", "verify": {"ok": true, …} }
}
```

Times are seconds in the original (and, since nothing moves, the edited)
audio. `class` is `isolated` (in a pause) or `overlap` (touches the
teacher); `action` `fill` or `partial-fill`; `src` `audio`, `audio+tx` or
`tx`. `kept` lists candidates left alone with the reason, for review.
`editsSha` = sha256 of `start.toFixed(2) TAB end.toFixed(2) TAB action LF`
per edit (`editlist.py` and `data/tools/src/audio-edits.ts` share a test
vector).

The data build checks the schema, the file name, that the lecture and its
transcript exist, that `transcriptSha` matches the transcript (a stale
file fails the build, as for `retimed/`: rerun `backchannel detect` or
delete the file), that edits are ordered, disjoint and inside the audio,
and that a recorded `output` was rendered from the current edits.

### Upload (`backchannel-upload`)

The edited file goes to the same CDN folder as the original: bucket key =
the catalog `>` folder + "/" + `<stem> (edited).mp3`, unencoded (the CDN
URL is that key percent-encoded). The original stays.

```bash
export R2_ENV_FILE=~/.r2-shaar.env   # or R2_ENDPOINT / R2_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
uv run --extra edit --with boto3 backchannel-upload --all-markel --plan-json plan.json     # read-only plan
uv run --extra edit --with boto3 backchannel-upload --all-markel --execute                 # upload
uv run --extra edit backchannel-upload --all-markel --classes-patch classes.patch         # then the catalog change
```

Credentials are read only from the environment or that file, never from
arguments, and never printed. The plan HEADs every original key (must
exist, same size as the cached original) and edited key (must not exist).
`--execute` uploads only lectures that pass, with `Content-Type: audio/mpeg`
and `If-None-Match: *` (never overwrites), then HEADs each new object and
checks its size and ETag (MD5). After the upload, apply the classes.txt
patch: it renames each file line to the edited file with an `@ <old id>`
line before it, so lecture IDs (favorites, downloads) do not change and the
durations stay as they are. Then `cd ../tools && yarn build-data`, and
`NODE_USE_ENV_PROXY=1 yarn check-urls` to see the new URLs resolve.
