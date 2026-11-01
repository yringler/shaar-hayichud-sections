"""backchannel: find and remove a listener's standalone "Right." from class audio.

Fill mode only: each edit's span is replaced by room tone matched to the local
hiss, so the edited file has the same duration and every timestamp in
data/ (transcripts, retimed words, alignments) stays valid.

    backchannel detect --lecture ID | --series 37 | --all-markel
    backchannel render  (same selection)
    backchannel contact (same selection)

Edit lists go to data/edits/<encoded lecture id>.json; rendered mp3s and
review clips stay in the cache. See data/retime/README.md.
"""
