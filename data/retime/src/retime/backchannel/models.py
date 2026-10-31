"""Model loading (all CPU). Downloaded once into <cache>/models/ (MMS_FA into <cache>/torch/, shared with retime).

Pinned Hugging Face revisions, so a rerun scores with the same weights.
"""
from __future__ import annotations

from pathlib import Path

ECAPA_REPO = "speechbrain/spkrec-ecapa-voxceleb"
ECAPA_REVISION = "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286"
WHISPER_REPO = "Systran/faster-whisper-base"
WHISPER_REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"


def describe() -> dict:
    return {
        "speaker": f"{ECAPA_REPO}@{ECAPA_REVISION[:12]}",
        "keywordCtc": "torchaudio MMS_FA (with <star>)",
        "keywordAsr": f"{WHISPER_REPO}@{WHISPER_REVISION[:12]}",
    }


def _snapshot(repo: str, revision: str, dest: Path, marker: str) -> Path:
    if not (dest / marker).exists():
        from huggingface_hub import snapshot_download

        snapshot_download(repo, revision=revision, local_dir=str(dest))
    return dest


class Models:
    """Lazy holder; each model loads on first use."""

    def __init__(self, cache: Path, threads: int):
        import torch

        torch.set_num_threads(threads)
        self.cache = cache
        self.threads = threads
        self._ecapa = self._ctc = self._whisper = None

    def ecapa(self):
        if self._ecapa is None:
            from speechbrain.inference.speaker import EncoderClassifier

            d = _snapshot(ECAPA_REPO, ECAPA_REVISION, self.cache / "models" / "spkrec-ecapa-voxceleb", "embedding_model.ckpt")
            self._ecapa = EncoderClassifier.from_hparams(source=str(d), savedir=str(d), run_opts={"device": "cpu"})
        return self._ecapa

    def ctc(self):
        """(MMS_FA model with <star>, its dictionary)."""
        if self._ctc is None:
            import torch
            import torchaudio

            torch.hub.set_dir(str(self.cache / "torch"))
            bundle = torchaudio.pipelines.MMS_FA
            self._ctc = (bundle.get_model(with_star=True).eval(), bundle.get_dict(star="*"))
        return self._ctc

    def whisper(self):
        if self._whisper is None:
            from faster_whisper import WhisperModel

            d = _snapshot(WHISPER_REPO, WHISPER_REVISION, self.cache / "models" / "faster-whisper-base", "model.bin")
            self._whisper = WhisperModel(str(d), device="cpu", compute_type="int8", cpu_threads=self.threads)
        return self._whisper
