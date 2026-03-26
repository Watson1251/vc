# nemo/main.py
import os, sys, json, tempfile, shutil, subprocess, contextlib, hashlib
from typing import Optional, Tuple, Dict, List
import numpy as np
from flask import Flask, request, jsonify

# logger
if "/logger" not in sys.path:
    sys.path.insert(0, "/logger")
from logger import AppLogger
logger = AppLogger()

# Hide GPUs before torch/NeMo import so CUDA init is skipped (slow; for broken GPU stacks).
if os.getenv("NEMO_FORCE_CPU", "").lower() in ("1", "true", "yes"):
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    logger.warn("NEMO_FORCE_CPU enabled — CUDA disabled; NeMo runs on CPU (slow).")

# security
if "/security" not in sys.path:
    sys.path.insert(0, "/security")
try:
    from secure import HybridFileSecurity
    HAS_SECURITY = True
    logger.info("🔐 HybridFileSecurity available.")
except Exception as e:
    HAS_SECURITY = False
    logger.error(f"🔐 HybridFileSecurity import failed: {e}")

# engine
if "/nemo" not in sys.path and "/nemo-engine" not in sys.path:
    sys.path.insert(0, "/nemo-engine")
from nemo_engine import NemoEngine

# caches
os.environ.setdefault("XDG_CACHE_HOME", "/nemo-engine/models")
os.environ.setdefault("TORCH_HOME", "/nemo-engine/models/torch")
os.environ.setdefault("HF_HOME", "/nemo-engine/models/huggingface")
os.environ.setdefault("TRANSFORMERS_CACHE", "/nemo-engine/models/huggingface/transformers")

app = Flask(__name__)
# init engine
try:
    SPEAKERNET_NAME = os.getenv("NEMO_SPEAKERNET", "speakerverification_speakernet")
    TITANET_NAME = os.getenv("NEMO_TITANET", "titanet_large")
    NEMO_DEVICE = os.getenv("NEMO_DEVICE")
    NEMO_FP16 = os.getenv("NEMO_FP16", "false").lower() in ("1", "true", "yes")

    engine = NemoEngine(
        speakernet_name=SPEAKERNET_NAME,
        titanet_name=TITANET_NAME,
        device=NEMO_DEVICE,
        use_half=NEMO_FP16,
    )
    logger.info(f"✅ NeMo engine initialized on {engine.device_info()}")
except Exception as e:
    logger.error(f"❌ Failed to initialize NeMo engine: {e}")
    raise

@app.route("/", methods=["GET"])
def root():
    return jsonify({
        "status": "ok",
        "message": "NeMo Speaker Service",
        "device": engine.device_info(),
        "models": {"speakernet": SPEAKERNET_NAME, "titanet": TITANET_NAME}
    }), 200


# -------- utils --------
@contextlib.contextmanager
def _maybe_decrypt_input(input_path: str, encrypted: Optional[bool] = None):
    def _exists(p: str) -> bool:
        try:
            return bool(p) and os.path.exists(p)
        except Exception:
            return False

    enc_variant   = input_path if input_path.lower().endswith(".enc") else f"{input_path}.enc"
    plain_variant = input_path[:-4] if input_path.lower().endswith(".enc") else input_path

    src_path = None
    must_decrypt = False

    if encrypted is True:
        if _exists(input_path):
            src_path = input_path
        elif _exists(enc_variant):
            src_path = enc_variant
        else:
            raise FileNotFoundError(f"Encrypted file not found (tried): {input_path} and {enc_variant}")
        must_decrypt = True
    else:
        if input_path.lower().endswith(".enc"):
            if not _exists(input_path):
                if _exists(plain_variant):
                    src_path = plain_variant
                    must_decrypt = False
                else:
                    raise FileNotFoundError(f"File not found: {input_path}")
            else:
                src_path = input_path
                must_decrypt = True
        else:
            if _exists(plain_variant):
                src_path = plain_variant
                must_decrypt = False
            elif _exists(enc_variant):
                src_path = enc_variant
                must_decrypt = True
            else:
                raise FileNotFoundError(f"File not found (tried): {plain_variant} and {enc_variant}")

    if must_decrypt:
        if not HAS_SECURITY:
            raise RuntimeError("HybridFileSecurity unavailable in NeMo container.")
        sec = HybridFileSecurity()
        dec_path = sec.decrypt_to_temp(src_path, delete_on_exit=True)
        try:
            yield dec_path
        finally:
            try:
                if os.path.exists(dec_path):
                    os.remove(dec_path)
            except Exception:
                pass
    else:
        yield src_path

def _ffmpeg_split(src: str, out_dir: str, chunk_sec: int, silence: Optional[Dict]) -> List[str]:
    """Resample mono/16k/s16, optional silence removal, then segment to fixed-size chunks."""
    os.makedirs(out_dir, exist_ok=True)
    resampled = os.path.join(out_dir, "_resampled.wav")
    # Convert / normalize
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-i", src,
        "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
        resampled
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    # Optional silence removal
    if silence and silence.get("enable", True):
        ref_clean = os.path.join(out_dir, "_clean.wav")
        thr = f"{int(silence.get('start_threshold_db', -35))}dB"
        dur = str(silence.get("stop_duration", 0.5))
        subprocess.run([
            "ffmpeg","-y","-v","error",
            "-i", resampled,
            "-af", f"silenceremove=stop_periods=-1:stop_duration={dur}:start_threshold={thr}",
            "-ac","1","-ar","16000","-sample_fmt","s16",
            ref_clean
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        os.replace(ref_clean, resampled)

    # Segment
    pattern = os.path.join(out_dir, "chunk_%03d.wav")
    subprocess.run([
        "ffmpeg","-y","-v","error",
        "-i", resampled,
        "-f","segment","-segment_time", str(int(chunk_sec)),
        "-ac","1","-ar","16000","-sample_fmt","s16",
        "-reset_timestamps","1",
        pattern
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    chunks = [os.path.join(out_dir, f) for f in sorted(os.listdir(out_dir)) if f.startswith("chunk_") and f.endswith(".wav")]
    return chunks


def _deterministic_signature(chunk_sec: int, silence: Optional[Dict]) -> str:
    payload = {
        "chunk_sec": int(chunk_sec),
        "silence": {
            "enable": bool(silence.get("enable", True)) if silence else False,
            "stop_duration": float(silence.get("stop_duration", 0.5)) if silence else None,
            "start_threshold_db": float(silence.get("start_threshold_db", -35)) if silence else None,
        }
    }
    h = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return h


# -------- basic endpoints --------
@app.route("/extract_embedding", methods=["POST"])
def extract_embedding():
    try:
        data = request.get_json(silent=True) or {}
        input_file = data.get("input_file")
        encrypted = data.get("encrypted", None)
        if not input_file:
            return jsonify({"status": "error", "message": "input_file is required"}), 400
        with _maybe_decrypt_input(input_file, encrypted=encrypted) as resolved:
            embedding = engine.get_embedding(resolved)
        return jsonify({"status": "success", "embedding": embedding.tolist()}), 200
    except Exception as e:
        logger.error(f"❌ /extract_embedding failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/get_similarity", methods=["POST"])
def get_similarity():
    try:
        data = request.get_json(silent=True) or {}
        a1 = data.get("audio_file_1")
        a2 = data.get("audio_file_2")
        enc1 = data.get("encrypted_1", data.get("encrypted", None))
        enc2 = data.get("encrypted_2", data.get("encrypted", None))
        if not a1 or not a2:
            return jsonify({"status": "error", "message": "Both audio_file_1 and audio_file_2 are required"}), 400
        with _maybe_decrypt_input(a1, encrypted=enc1) as p1, _maybe_decrypt_input(a2, encrypted=enc2) as p2:
            sim = engine.similarity(p1, p2)
        return jsonify({"status": "success", "similarity": sim, "similarity_percentage": sim * 100.0}), 200
    except Exception as e:
        logger.error(f"❌ /get_similarity failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/verify_speaker", methods=["POST"])
def verify_speaker():
    try:
        data = request.get_json(silent=True) or {}
        a1 = data.get("audio_file_1")
        a2 = data.get("audio_file_2")
        enc1 = data.get("encrypted_1", data.get("encrypted", None))
        enc2 = data.get("encrypted_2", data.get("encrypted", None))
        if not a1 or not a2:
            return jsonify({"status": "error", "message": "Both audio_file_1 and audio_file_2 are required"}), 400
        with _maybe_decrypt_input(a1, encrypted=enc1) as p1, _maybe_decrypt_input(a2, encrypted=enc2) as p2:
            decision = engine.verify(p1, p2)
            sim = engine.similarity(p1, p2)
        return jsonify({"status": "success", "isClonedSameRef": bool(decision), "similarity": sim, "similarity_percentage": sim * 100.0}), 200
    except Exception as e:
        logger.error(f"❌ /verify_speaker failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


# -------- new endpoints: preprocess inside NeMo --------
@app.route("/chunk_and_score", methods=["POST"])
def chunk_and_score():
    """
    Input:
      {
        "input_file": "/shared/.../x.wav.enc",
        "encrypted": true,
        "target_file": "/shared/.../ref.wav.enc",    # optional
        "target_encrypted": true,                    # optional
        "chunk_size": 10,
        "silence_filter": {"enable": true, "stop_duration": 0.5, "start_threshold_db": -35}
      }
    Output:
      {
        "status": "success",
        "chunks": [{"index": 0, "start": 0.0, "end": 10.0, "similarity": 0.83}, ...],
        "deterministic_signature": "...",
        "ref_embedding": [...]   # returned only if target_file provided
      }
    """
    try:
        data = request.get_json(silent=True) or {}
        input_file = data.get("input_file")
        encrypted = data.get("encrypted", None)
        chunk_size = int(data.get("chunk_size", 10))
        silence = data.get("silence_filter", None)
        target_file = data.get("target_file")
        target_encrypted = data.get("target_encrypted", None)

        if not input_file:
            return jsonify({"status": "error", "message": "input_file is required"}), 400

        with _maybe_decrypt_input(input_file, encrypted=encrypted) as src:
            work = tempfile.mkdtemp(prefix="nemo_pre_", dir="/tmp")
            try:
                chunks = _ffmpeg_split(src, os.path.join(work, "chunks"), chunk_size, silence)
                # compute per-chunk embeddings
                scores = []
                ref_emb = None
                if target_file:
                    with _maybe_decrypt_input(target_file, encrypted=target_encrypted) as refp:
                        ref_emb = engine.get_embedding(refp)
                        ref_norm = np.linalg.norm(ref_emb) + 1e-8
                        ref_emb = (ref_emb / ref_norm).astype(np.float32)

                for i, ch in enumerate(chunks):
                    emb = engine.get_embedding(ch)
                    # cosine w.r.t ref if available else 0.0
                    sim = 0.0
                    if ref_emb is not None:
                        v = emb.astype(np.float32)
                        v /= (np.linalg.norm(v) + 1e-8)
                        sim = float(np.dot(v, ref_emb))
                        sim = max(0.0, min(1.0, sim))
                    scores.append({"index": i, "start": i * chunk_size * 1.0, "end": (i + 1) * chunk_size * 1.0, "similarity": sim})

                out = {
                    "status": "success",
                    "chunks": scores,
                    "deterministic_signature": _deterministic_signature(chunk_size, silence),
                }
                if ref_emb is not None:
                    out["ref_embedding"] = ref_emb.astype(float).tolist()
                return jsonify(out), 200
            finally:
                try:
                    shutil.rmtree(work, ignore_errors=True)
                except Exception:
                    pass
    except Exception as e:
        logger.error(f"❌ /chunk_and_score failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/emit_filtered_chunks", methods=["POST"])
def emit_filtered_chunks():
    """
    Input:
      {
        "input_file": "/shared/.../x.wav.enc",
        "encrypted": true,
        "output_dir": "/shared/enc_out/seedvc_run_abcd",
        "chunk_size": 10,
        "indices": [0,2,5],           # optional (either provide indices OR threshold)
        "threshold": 0.6,             # optional
        "silence_filter": {...}       # optional (MUST match scoring call)
      }
    Output:
      {"status": "success", "written": [{"index": 0, "enc_path": "/shared/enc_out/.../chunk_000.enc"}, ...]}
    """
    try:
        data = request.get_json(silent=True) or {}
        input_file = data.get("input_file")
        encrypted = data.get("encrypted", None)
        output_dir = data.get("output_dir")
        chunk_size = int(data.get("chunk_size", 10))
        silence = data.get("silence_filter", None)
        indices = data.get("indices")
        threshold = data.get("threshold")

        if not input_file or not output_dir:
            return jsonify({"status": "error", "message": "input_file and output_dir are required"}), 400
        if not HAS_SECURITY:
            return jsonify({"status": "error", "message": "HybridFileSecurity unavailable to emit encrypted chunks."}), 500

        os.makedirs(output_dir, exist_ok=True)

        with _maybe_decrypt_input(input_file, encrypted=encrypted) as src:
            work = tempfile.mkdtemp(prefix="nemo_emit_", dir="/tmp")
            try:
                chunks_dir = os.path.join(work, "chunks")
                chunks = _ffmpeg_split(src, chunks_dir, chunk_size, silence)

                keep_set = set()
                if indices is not None:
                    keep_set = set(int(i) for i in indices if 0 <= int(i) < len(chunks))
                elif threshold is not None:
                    # score locally against itself (no ref) - typical caller passes indices; this branch
                    # is provided as a convenience to threshold on energy/duration in future
                    keep_set = set(range(len(chunks)))  # default keep all if threshold logic not provided
                else:
                    keep_set = set(range(len(chunks)))  # default keep all

                # Encrypt each kept chunk into output_dir
                sec = HybridFileSecurity()
                written = []
                for i in sorted(list(keep_set)):
                    src_chunk = chunks[i]
                    enc_out = os.path.join(output_dir, f"chunk_{i:03d}.wav.enc")
                    # encrypt_file reads plaintext and writes .enc
                    sec.encrypt_file(src_chunk, enc_out)
                    written.append({"index": i, "enc_path": enc_out})

                return jsonify({"status": "success", "written": written}), 200
            finally:
                try:
                    shutil.rmtree(work, ignore_errors=True)
                except Exception:
                    pass
    except Exception as e:
        logger.error(f"❌ /emit_filtered_chunks failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == "__main__":
    logger.info("🚀 Starting NeMo Flask service...")
    app.run(host="0.0.0.0", port=8000)
