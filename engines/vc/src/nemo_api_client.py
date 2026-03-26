# vc/src/nemo_api_client.py
import os
import sys
import time
from typing import List, Optional, Dict

import numpy as np
import requests
from requests.adapters import HTTPAdapter, Retry

# ---- logging ----
if "/logger" not in sys.path:
    sys.path.insert(0, "/logger")
from logger import AppLogger
logger = AppLogger()


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


class NemoAPIClient:
    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.base_url = (base_url or os.getenv("NEMO_API_URL") or "http://nemo:8000").rstrip("/")
        # POST/JSON API (embedding, chunk, etc.) — allow long runs on shared GPU
        self.timeout = (
            float(timeout)
            if timeout is not None
            else _env_float("NEMO_API_TIMEOUT", 180.0)
        )
        self.health_timeout = _env_float("NEMO_API_HEALTH_TIMEOUT", 15.0)
        self._health_retries = _env_int("NEMO_API_HEALTH_RETRIES", 8)
        self._health_retry_delay = _env_float("NEMO_API_HEALTH_RETRY_DELAY", 5.0)

        s = requests.Session()
        retries = Retry(
            total=3,
            backoff_factor=0.3,
            status_forcelist=(500, 502, 503, 504),
            allowed_methods=["POST", "GET"],
        )
        s.mount("http://", HTTPAdapter(max_retries=retries))
        s.mount("https://", HTTPAdapter(max_retries=retries))
        self._session = s

        self._verify_health()

    def _verify_health(self) -> None:
        url = f"{self.base_url}/"
        last_err: Optional[BaseException] = None
        for attempt in range(self._health_retries):
            try:
                r = self._session.get(url, timeout=self.health_timeout)
                r.raise_for_status()
                body = r.json()
                if body.get("status") != "ok":
                    raise RuntimeError(f"unexpected health payload: {body!r}")
                device = body.get("device", "?")
                logger.info(
                    f"🌐 NeMo API healthy: {self.base_url} device={device} "
                    f"(attempt {attempt + 1}/{self._health_retries})"
                )
                return
            except Exception as e:
                last_err = e
                logger.warn(
                    f"⚠️ NeMo health check failed "
                    f"{attempt + 1}/{self._health_retries}: {e}"
                )
                if attempt + 1 < self._health_retries:
                    time.sleep(self._health_retry_delay)
        raise ConnectionError(
            f"NeMo API unreachable at {self.base_url} after "
            f"{self._health_retries} attempts (last error: {last_err})"
        )

    def _post_json(self, path: str, payload: Dict) -> Dict:
        url = f"{self.base_url}{path}"
        r = self._session.post(url, json=payload, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, dict) or data.get("status") != "success":
            raise RuntimeError(f"NeMo API error at {path}: {data}")
        return data

    def extract_embedding(self, wav_path: str, encrypted: bool = False) -> np.ndarray:
        payload = {"input_file": wav_path}
        if encrypted:
            payload["encrypted"] = True
        resp = self._post_json("/extract_embedding", payload)
        emb = np.asarray(resp.get("embedding"), dtype=np.float32).squeeze()
        if emb.ndim != 1:
            raise ValueError("NeMo API returned a non 1-D embedding")
        return emb

    def chunk_and_score(
        self,
        input_file: str,
        encrypted: bool,
        target_file: Optional[str],
        target_encrypted: Optional[bool],
        chunk_size: int,
        silence_cfg: Optional[Dict] = None,
    ) -> Dict:
        payload = {
            "input_file": input_file,
            "encrypted": bool(encrypted),
            "chunk_size": int(chunk_size),
        }
        if target_file:
            payload["target_file"] = target_file
            payload["target_encrypted"] = bool(target_encrypted)
        if silence_cfg:
            payload["silence_filter"] = silence_cfg
        return self._post_json("/chunk_and_score", payload)

    def emit_filtered_chunks(
        self,
        input_file: str,
        encrypted: bool,
        output_dir: str,
        chunk_size: int,
        indices: Optional[List[int]] = None,
        threshold: Optional[float] = None,
        silence_cfg: Optional[Dict] = None,
    ) -> Dict:
        payload = {
            "input_file": input_file,
            "encrypted": bool(encrypted),
            "output_dir": output_dir,
            "chunk_size": int(chunk_size),
        }
        if indices is not None:
            payload["indices"] = [int(i) for i in indices]
        if threshold is not None:
            payload["threshold"] = float(threshold)
        if silence_cfg:
            payload["silence_filter"] = silence_cfg
        return self._post_json("/emit_filtered_chunks", payload)
