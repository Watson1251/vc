# nemo_engine.py
from typing import Optional
import os
import tempfile
import subprocess
import torch
import numpy as np
from scipy.spatial.distance import cosine
import nemo.collections.asr as nemo_asr

class NemoEngine:
    """
    Wrapper around NeMo speaker models (SpeakerNet + TitaNet) with simple APIs:
      - get_embedding(audio_path) -> np.ndarray (1D)
      - similarity(audio_path_1, audio_path_2) -> float [0..1]
      - verify(audio_path_1, audio_path_2) -> bool
    """

    def __init__(
        self,
        speakernet_name: str = "speakerverification_speakernet",
        titanet_name: str = "titanet_large",
        device: Optional[str] = None,
        use_half: bool = False,
    ) -> None:
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(device)

        self.speakernet_model = nemo_asr.models.EncDecSpeakerLabelModel.from_pretrained(
            model_name=speakernet_name
        )
        self.titanet_model = nemo_asr.models.EncDecSpeakerLabelModel.from_pretrained(
            model_name=titanet_name
        )

        self.speakernet_model.eval().to(self.device)
        self.titanet_model.eval().to(self.device)

        if use_half and self.device.type == "cuda":
            self.speakernet_model = self.speakernet_model.half()
            self.titanet_model = self.titanet_model.half()

    def _normalize_audio(self, audio_path: str) -> str:
        """Convert arbitrary input audio to mono 16 kHz WAV for NeMo speaker models."""
        fd, out_path = tempfile.mkstemp(prefix="nemo_audio_", suffix=".wav", dir="/tmp")
        os.close(fd)
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-v", "error",
                    "-i", audio_path,
                    "-ac", "1",
                    "-ar", "16000",
                    "-sample_fmt", "s16",
                    out_path,
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            return out_path
        except Exception:
            try:
                if os.path.exists(out_path):
                    os.remove(out_path)
            except Exception:
                pass
            raise

    @torch.no_grad()
    def get_embedding(self, audio_path: str) -> np.ndarray:
        wav_path = self._normalize_audio(audio_path)
        try:
            emb = self.speakernet_model.get_embedding(wav_path)
        finally:
            try:
                if os.path.exists(wav_path):
                    os.remove(wav_path)
            except Exception:
                pass
        if isinstance(emb, torch.Tensor):
            emb = emb.detach().float().cpu().numpy()
        emb = np.asarray(emb).squeeze()
        if emb.ndim != 1:
            raise ValueError("Embedding must be 1-D")
        return emb

    @torch.no_grad()
    def similarity(self, audio_path_1: str, audio_path_2: str) -> float:
        emb1 = self.get_embedding(audio_path_1)
        emb2 = self.get_embedding(audio_path_2)
        sim = 1.0 - cosine(emb1, emb2)
        return float(max(0.0, min(1.0, sim)))

    @torch.no_grad()
    def verify(self, audio_path_1: str, audio_path_2: str) -> bool:
        wav1 = self._normalize_audio(audio_path_1)
        wav2 = self._normalize_audio(audio_path_2)
        try:
            decision = self.titanet_model.verify_speakers(wav1, wav2)
            return bool(decision)
        finally:
            for p in (wav1, wav2):
                try:
                    if os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass

    def device_info(self) -> str:
        if self.device.type == "cuda":
            idx = torch.cuda.current_device()
            return f"cuda:{idx} - {torch.cuda.get_device_name(idx)}"
        return "cpu"
