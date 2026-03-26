# nemo_engine.py
from typing import Optional
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

    @torch.no_grad()
    def get_embedding(self, audio_path: str) -> np.ndarray:
        emb = self.speakernet_model.get_embedding(audio_path)
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
        decision = self.titanet_model.verify_speakers(audio_path_1, audio_path_2)
        return bool(decision)

    def device_info(self) -> str:
        if self.device.type == "cuda":
            idx = torch.cuda.current_device()
            return f"cuda:{idx} - {torch.cuda.get_device_name(idx)}"
        return "cpu"
