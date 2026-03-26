# vc/src/voice_processing_pipeline.py
import os
import sys
import shutil
import tempfile
from typing import List, Optional, Dict

import numpy as np

# ---- logging ----
if "/logger" not in sys.path:
    sys.path.insert(0, "/logger")
from logger import AppLogger
logger = AppLogger()

# ---- local modules ----
if "/vc/src" not in sys.path:
    sys.path.insert(0, "/vc/src")
from audio_preprocessor import AudioPreprocessor
from nemo_api_client import NemoAPIClient  # sibling file

# ---- optional security (for decrypting emitted chunks into VC /tmp only) ----
try:
    if "/security" not in sys.path:
        sys.path.insert(0, "/security")
    from secure import HybridFileSecurity
    HAS_SECURITY = True
except Exception:
    HAS_SECURITY = False


class VoiceProcessingPipeline:
    """
    Plaintext NEVER touches shared storage.
    - All plaintext lives in /tmp inside the VC container.
    - NeMo performs split+score and emits ONLY encrypted chunks (.enc) to a shared enclave
      pointed to by SEED_VC_ENC_OUTDIR (created by the consumer).
    - VC decrypts those emitted chunks into /tmp/ready for training, then trainer cleans /tmp.
    """

    def __init__(self, data: Dict, nemo_client: Optional[NemoAPIClient] = None):
        self.data: Dict = dict(data)

        # /tmp workspace inside VC
        self.ws_root = tempfile.mkdtemp(prefix="seedvc_", dir="/tmp")
        self.dataset_folder = os.path.join(self.ws_root, "dataset")
        self.ready_folder = os.path.join(self.ws_root, "ready")
        os.makedirs(self.dataset_folder, exist_ok=True)
        os.makedirs(self.ready_folder, exist_ok=True)

        # Reference path (encrypted on shared) & where to store the embedding (vector is safe to persist)
        self.target_voice_path: str = self.data.get("target_voice_path", "")
        self.target_embedding_path: str = self.data.get(
            "target_embedding_path",
            os.path.join(self.dataset_folder, "embedding_file.npy"),
        )

        # Pipeline tuning
        self.chunk_size: int = int(self.data.get("chunk_size", 10))
        self.similarity_threshold: float = float(self.data.get("similarity_threshold", 0.6))

        # Optional silence filter config (applied in NeMo container)
        self.silence_cfg: Dict = {
            "enable": True,
            "stop_duration": float(self.data.get("silence_stop_duration", 0.5)),   # seconds
            "start_threshold_db": float(self.data.get("silence_start_threshold_db", -35)),
        }

        self.nemo: NemoAPIClient = nemo_client or NemoAPIClient()
        self.pre = AudioPreprocessor(sample_rate=16000, channels=1, sample_fmt="s16")

    # -----------------------
    # Target embedding (via NeMo)
    # -----------------------
    def extract_target_embedding(self) -> None:
        if not self.target_voice_path:
            raise FileNotFoundError("target_voice_path not provided")
        enc = self.target_voice_path.lower().endswith(".enc")
        v = self.nemo.extract_embedding(self.target_voice_path, encrypted=enc).astype(np.float32).flatten()
        np.save(self.target_embedding_path, v)
        logger.info(f"💾 Target embedding saved: {self.target_embedding_path}")

    # -----------------------
    # Training staging via NeMo
    # -----------------------
    def _remote_preprocess_and_fetch(self, src_enc_path: str) -> List[str]:
        """
        1) Ask NeMo to chunk+score the encrypted input against the (encrypted) target.
        2) Request NeMo to emit ONLY the selected chunks as encrypted files into a shared enclave
           (SEED_VC_ENC_OUTDIR/<run>).
        3) Decrypt those emitted .enc chunks locally into /tmp/ready as .wav for training.

        Returns list of local plaintext chunk paths in /tmp/ready.
        """
        th = float(os.getenv("SEED_VC_SIM_THRESH", str(self.similarity_threshold)))

        # 1) scoring (metadata only)
        meta = self.nemo.chunk_and_score(
            input_file=src_enc_path,
            encrypted=True,
            target_file=self.target_voice_path or None,
            target_encrypted=(self.target_voice_path.lower().endswith(".enc") if self.target_voice_path else None),
            chunk_size=self.chunk_size,
            silence_cfg=self.silence_cfg if self.silence_cfg.get("enable", True) else None,
        )
        chunks = meta.get("chunks", [])
        keep_idxs = [int(c["index"]) for c in chunks if float(c.get("similarity", 0.0)) >= th]
        # Deduplicate & keep ascending order
        keep_seen = set()
        keep_idxs = [i for i in keep_idxs if (i not in keep_seen and not keep_seen.add(i))]
        if not keep_idxs:
            raise RuntimeError("No chunks passed similarity filtering (remote).")

        # 2) enclave for encrypted emitted chunks (shared)
        enclave_root = os.getenv("SEED_VC_ENC_OUTDIR", "/db/media/tmp/seedvc_enc_out")
        os.makedirs(enclave_root, exist_ok=True)
        # Use a unique subdir named after this tmp workspace to avoid collisions
        run_enclave = os.path.join(enclave_root, os.path.basename(self.ws_root))
        os.makedirs(run_enclave, exist_ok=True)

        out = self.nemo.emit_filtered_chunks(
            input_file=src_enc_path,
            encrypted=True,
            output_dir=run_enclave,
            chunk_size=self.chunk_size,
            indices=keep_idxs,
            silence_cfg=self.silence_cfg if self.silence_cfg.get("enable", True) else None,
        )
        written = out.get("written", [])

        # 3) decrypt emitted .enc → /tmp/ready/*.wav
        if not HAS_SECURITY:
            raise RuntimeError("HAS_SECURITY=False in VC; cannot decrypt remote chunks.")
        sec = HybridFileSecurity()
        kept_paths: List[str] = []
        for item in written:
            enc_p = item.get("enc_path")
            idx = int(item.get("index", -1))
            if not enc_p or not os.path.exists(enc_p):
                logger.warn(f"[emit] missing emitted enc chunk: {enc_p}")
                continue
            try:
                plain_tmp = sec.decrypt_to_temp(enc_p, delete_on_exit=False)
                dst = os.path.join(self.ready_folder, f"chunk_{idx:03d}.wav" if idx >= 0 else os.path.basename(plain_tmp))
                shutil.move(plain_tmp, dst)
                kept_paths.append(dst)
            except Exception as e:
                logger.warn(f"[emit] failed to decrypt/move chunk '{enc_p}': {e}")

        if not kept_paths:
            raise RuntimeError("Remote emitted no chunks after filtering.")
        return kept_paths

    def ingest_training(self) -> List[str]:
        """
        Normalize training list to encrypted paths.
        - If <file>.enc exists → use it.
        - Else if <file> exists → encrypt it in place (writes <file>.enc) then use it.
        """
        sources = list(self.data.get("training_audio") or [])
        if not sources:
            raise RuntimeError("No training_audio provided.")

        enc_list: List[str] = []
        for s in sources:
            if not s:
                continue
            enc_variant = s if s.lower().endswith(".enc") else f"{s}.enc"
            plain_variant = s[:-4] if s.lower().endswith(".enc") else s
            if os.path.exists(enc_variant):
                enc_list.append(enc_variant)
            elif os.path.exists(plain_variant):
                if not HAS_SECURITY:
                    raise RuntimeError("HAS_SECURITY=False; cannot encrypt plain training source onto shared.")
                sec = HybridFileSecurity()
                enc_path = sec.encrypt_file(plain_variant)  # writes <plain>.enc next to it
                enc_list.append(enc_path)
            else:
                logger.warn(f"[ingest] source not found: {plain_variant} | {enc_variant}")

        if not enc_list:
            raise RuntimeError("No valid training sources found.")
        return enc_list

    # -----------------------
    # Orchestrate
    # -----------------------
    def run(self) -> Dict:
        try:
            # 1) Target embedding via NeMo (no plaintext on shared)
            if self.target_voice_path:
                logger.info("🔧 extract target embedding")
                self.extract_target_embedding()
            else:
                logger.warn("No target_voice_path provided; filtering may be ineffective.")

            # 2) For each training source: remote split/score → emit enc → decrypt to /tmp/ready
            logger.info("🔧 staging training sources")
            sources_enc = self.ingest_training()
            total = 0
            for src_enc in sources_enc:
                kept = self._remote_preprocess_and_fetch(src_enc)
                total += len(kept)
                logger.info(f"[remote] kept {len(kept)} chunks from {os.path.basename(src_enc)}")

            if total == 0:
                return {
                    "status": 500,
                    "message": "Pipeline produced no ready files.",
                    "dataset_ready_dir": self.ready_folder
                }

            return {"status": 200, "message": "ok", "dataset_ready_dir": self.ready_folder}
        except Exception as e:
            return {"status": 500, "message": str(e), "dataset_ready_dir": self.ready_folder}
        finally:
            # Trainer will clean ws_root after training completes.
            pass
