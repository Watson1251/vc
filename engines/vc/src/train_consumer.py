# vc/src/train_consumer.py

import os
import sys
import uuid
import shutil
from typing import List, Optional, Dict
import json, time, threading, concurrent.futures as cf
import glob

# ---- imports from your repo layout ----
if "/logger" not in sys.path:
    sys.path.insert(0, "/logger")
from logger import AppLogger

if "/rabbitmq" not in sys.path:
    sys.path.insert(0, "/rabbitmq")
from rabbitmq import RabbitMQManager

# Ensure security module is available to this process (even if we don't decrypt here)
if "/security" not in sys.path:
    sys.path.insert(0, "/security")
from secure import HybridFileSecurity  # noqa: F401

from seed_vc_trainer import SeedVCTrainer
from task_registry import list_tasks, cancel as cancel_running

logger = AppLogger()

MEDIA_ROOT = os.getenv("MEDIA_ROOT", "/db/media").rstrip("/")

TARGET_TRAIN_QUEUE = os.getenv("TARGET_TRAIN_QUEUE", "target_train_queue")
TARGET_CANCEL_QUEUE = os.getenv("TARGET_CANCEL_QUEUE", "target_cancel_queue")
VC_MAX_CONCURRENCY = int(os.getenv("VC_MAX_CONCURRENCY", "4"))
TARGET_STATUS_QUEUE = os.getenv("TARGET_STATUS_QUEUE", "target_status_queue")
STATUS_PATH = os.getenv("VC_STATUS_FILE", f"{MEDIA_ROOT}/train_consumer_status.json")

trainer = SeedVCTrainer()

mq_train = RabbitMQManager(queue_name=TARGET_TRAIN_QUEUE, durable=True, auto_ack=False)
mq_cancel = RabbitMQManager(queue_name=TARGET_CANCEL_QUEUE, durable=True, auto_ack=True)
mq_status = RabbitMQManager(queue_name=TARGET_STATUS_QUEUE, durable=True, auto_ack=True)

# Add near other globals:
TERMINAL_STATES = {"SUCCESS", "FAILED", "CANCELLED"}

try:
    if hasattr(mq_train, "set_qos"):
        mq_train.set_qos(prefetch_count=VC_MAX_CONCURRENCY)
    elif hasattr(mq_train, "_channel"):
        mq_train._channel.basic_qos(prefetch_count=VC_MAX_CONCURRENCY)
    else:
        logger.warn("⚠️ Could not set prefetch on RabbitMQ channel; relying on acks to pace load.")
except Exception as e:
    logger.warn(f"⚠️ Failed to set prefetch: {e}")

_executor = cf.ThreadPoolExecutor(max_workers=VC_MAX_CONCURRENCY)
_active_futures = set()
_active_lock = threading.RLock()
_stop = threading.Event()

def _emit_status(target_id: str, status: str, phase: str, message: str = "", **extra):
    payload = {
        "type": "vc.training.status",
        "targetId": target_id,
        "status": status,  # STARTED|PROGRESS|SUCCESS|FAILED|CANCELLED
        "phase": phase,    # RECEIVED|PREPROCESS|LAUNCH|TRAIN|FINALIZE
        "message": message,
        "ts": time.time(),
    }
    payload.update(extra or {})
    try:
        mq_status.publish(payload)
    except Exception as e:
        logger.warn(f"⚠️ status publish failed: {e}")

# ---------------- media path + owner helpers ---------------- #

def _repair_media_path(p: str) -> Optional[str]:
    """
    Return a fixed absolute path under MEDIA_ROOT when possible.
    Strategy:
      1) If absolute and starts with MEDIA_ROOT -> accept.
      2) If absolute but not under MEDIA_ROOT -> try glob by basename under MEDIA_ROOT/**.
      3) If relative or truncated (e.g., 'dia/admin/....enc') -> glob under MEDIA_ROOT/** by basename.
    If multiple matches, prefer ones whose immediate parent looks like an owner directory.
    """
    try:
        if not isinstance(p, str) or not p.strip():
            return None
        p = p.strip()

        # Case 1: absolute and already under media root
        if p.startswith(MEDIA_ROOT + "/"):
            return os.path.abspath(p)

        # Case 2: absolute but outside media root -> try glob by basename
        if p.startswith("/"):
            base = os.path.basename(p)
            matches = glob.glob(os.path.join(MEDIA_ROOT, "*", "**", base), recursive=True)
            return _pick_best_media_match(matches)

        # Case 3: relative or truncated -> try glob by basename
        base = os.path.basename(p)
        matches = glob.glob(os.path.join(MEDIA_ROOT, "*", "**", base), recursive=True)
        return _pick_best_media_match(matches)
    except Exception:
        return None

def _pick_best_media_match(matches: List[str]) -> Optional[str]:
    if not matches:
        return None
    # Prefer a path that is directly MEDIA_ROOT/<owner>/... (i.e., has an owner segment right after MEDIA_ROOT)
    def score(path: str) -> int:
        try:
            rel = path[len(MEDIA_ROOT)+1:]  # drop "/"
            first = rel.split("/", 1)[0]
            return 0 if first and first not in ("", ".", "..") else 1
        except Exception:
            return 2
    matches.sort(key=score)
    return os.path.abspath(matches[0])

def _normalize_media_list(paths: List[str]) -> List[str]:
    """
    Repair each path; drop Nones; keep order; ensure uniqueness.
    """
    seen = set()
    out = []
    for p in paths or []:
        fixed = _repair_media_path(p)
        if fixed and fixed not in seen:
            seen.add(fixed)
            out.append(fixed)
    return out

def _extract_owner_from_media_path(p: str) -> Optional[str]:
    """
    From /db/media/<owner>/... return <owner>.
    """
    try:
        if not p or not p.startswith(MEDIA_ROOT + "/"):
            return None
        rel = p[len(MEDIA_ROOT)+1:]
        first = rel.split("/", 1)[0].strip()
        return first or None
    except Exception:
        return None

def _choose_owner(reference_audio: List[str], training_audio: List[str]) -> Optional[str]:
    """
    Prefer owner from referenceAudio[0], otherwise scan all repaired paths.
    """
    candidates = []
    if reference_audio:
        candidates.append(reference_audio[0])
    candidates.extend(training_audio or [])
    for p in candidates:
        o = _extract_owner_from_media_path(p)
        if o:
            return o
    return None

# ---------------- workspace helpers ---------------- #

def _deterministic_workspace(owner: str, target_id: str) -> str:
    """
    Deterministic per-target workspace WITHOUT a random seed:
      /db/media/<owner>/<target_id>
    Inside we create subfolders:
      - embed/
      - enc_out/
      (model/ is created by the trainer when persisting)
    """
    root = os.path.join(MEDIA_ROOT, owner, str(target_id))
    os.makedirs(root, exist_ok=True)
    os.makedirs(os.path.join(root, "embed"), exist_ok=True)
    enc_out = os.path.join(root, "enc_out")
    os.makedirs(enc_out, exist_ok=True)

    # marker
    try:
        with open(os.path.join(root, ".seedvc.ws"), "w") as f:
            f.write(f"id={target_id}\nowner={owner}\n")
    except Exception:
        pass

    # Tell VC pipeline / NeMo where to emit encrypted chunks on shared storage
    os.environ["SEED_VC_ENC_OUTDIR"] = enc_out

    logger.info(f"📁 Per-target workspace: {root}")
    logger.info(f"🔒 Encrypted chunk outdir: {enc_out}")
    return root

def _safe_cleanup_workspace(root: Optional[str]):
    """
    Do NOT remove the deterministic workspace root (it may contain model/).
    Only clear volatile subdirs like enc_out/.
    Respect KEEP_SHARED_WORKSPACE=1 to keep everything.
    """
    if not root or not os.path.isdir(root):
        return
    keep = os.getenv("KEEP_SHARED_WORKSPACE", "0").lower() in ("1", "true", "yes")
    if keep:
        logger.info(f"📌 Keeping shared workspace (KEEP_SHARED_WORKSPACE=1): {root}")
        return
    # Remove enc_out/ only
    enc_out = os.path.join(root, "enc_out")
    try:
        if os.path.isdir(enc_out):
            shutil.rmtree(enc_out, ignore_errors=True)
            logger.info(f"🧹 Cleared enc_out: {enc_out}")
    except Exception:
        pass

# ---------------- consumer core ---------------- #

def _handle_train_message(msg: dict, ch, delivery_tag):
    acked = False
    shared_ws_root: Optional[str] = None
    final_published = False
    final_state: Optional[str] = None

    try:
        target_id = str(msg.get("id") or "").strip()
        reference_audio = list(msg.get("referenceAudio", []) or [])
        training_audio  = list(msg.get("trainingAudio", []) or [])

        if not target_id:
            _emit_status("?", "FAILED", "RECEIVED", "missing id")
            try: ch.basic_ack(delivery_tag=delivery_tag); acked = True
            except Exception: pass
            return

        _emit_status(target_id, "STARTED", "RECEIVED", "message received by consumer", orig=msg)

        # Normalize/repair paths first (fixes truncated like 'dia/admin/...')
        ref_fixed   = _normalize_media_list(reference_audio)
        train_fixed = _normalize_media_list(training_audio)

        if not ref_fixed:
            _emit_status(target_id, "FAILED", "RECEIVED", "missing or unresolved referenceAudio")
            try: ch.basic_ack(delivery_tag=delivery_tag); acked = True
            except Exception: pass
            return

        if not train_fixed:
            _emit_status(target_id, "FAILED", "PREPROCESS", "No training_audio provided.")
            try: ch.basic_ack(delivery_tag=delivery_tag); acked = True
            except Exception: pass
            return

        logger.info(f"🎯 Start training target {target_id}")
        _emit_status(target_id, "PROGRESS", "PREPROCESS", "staging workspace")

        # Derive owner deterministically from repaired paths
        owner = _choose_owner(ref_fixed, train_fixed)
        if not owner:
            raise RuntimeError(
                "[seed-vc] Could not determine owner from payload/workspace. "
                f"Expected absolute media paths like {MEDIA_ROOT}/<owner>/.../*.enc"
            )

        # Deterministic per-target workspace at /db/media/<owner>/<target_id>
        shared_ws_root = _deterministic_workspace(owner, target_id)

        enc_ref_path = ref_fixed[0]
        data: Dict = {
            "target_voice_path": enc_ref_path,
            "target_embedding_path": os.path.join(shared_ws_root, "embed", "embedding_file.npy"),
            "chunk_size": int(os.getenv("SEED_VC_CHUNK_SIZE", "10")),
            "similarity_threshold": float(os.getenv("SEED_VC_SIM_THRESH", "0.6")),

            # Provide all expected key shapes (snake/camel) using repaired lists
            "trainingAudio": train_fixed,
            "training_paths": train_fixed,
            "referenceAudio": ref_fixed,
            "reference_paths": ref_fixed,
            "training_audio": train_fixed,
            "reference_audio": ref_fixed,
        }

        # Status callback from trainer → forward to status queue
        def _cb(ev: Dict):
            try:
                ev.setdefault("targetId", target_id)
                ev.setdefault("type", "vc.training.status")
                ev.setdefault("ts", time.time())
                mq_status.publish(ev)
            except Exception as e:
                logger.warn(f"⚠️ status cb publish failed: {e}")

        _emit_status(target_id, "PROGRESS", "LAUNCH", "launching trainer")
        result = trainer.run_with_pipeline(target_id=target_id, data=data, status_cb=_cb)

        code = int(result.get("status", 500))
        model_path  = result.get("modelPath") or ""
        config_path = result.get("configPath") or ""
        run_name    = result.get("runName") or target_id

        if code == 200:
            logger.info(f"✅ Completed target {target_id}")
            logger.info(f"   • modelPath:  {model_path}")
            logger.info(f"   • configPath: {config_path}")
            logger.info(f"   • runName:    {run_name}")
            try:
                _emit_status(
                    target_id, "SUCCESS", "FINALIZE", "training succeeded",
                    modelPath=model_path, configPath=config_path, runName=run_name
                )
                final_published = True
                final_state = "SUCCESS"
            except Exception as e:
                logger.warn(f"⚠️ status publish failed after success: {e}")
                final_published = True
                final_state = "SUCCESS"

            try:
                ch.basic_ack(delivery_tag=delivery_tag); acked = True
            except Exception as e:
                logger.warn(f"⚠️ ack failed after success (ignored): {e}")
            return

        if code == 499:
            try:
                _emit_status(
                    target_id, "CANCELLED", "FINALIZE", "training cancelled",
                    modelPath=model_path, configPath=config_path, runName=run_name
                )
                final_published = True
                final_state = "CANCELLED"
            except Exception as e:
                logger.warn(f"⚠️ status publish failed after cancel: {e}")
                final_published = True
                final_state = "CANCELLED"
            try:
                ch.basic_ack(delivery_tag=delivery_tag); acked = True
            except Exception as e:
                logger.warn(f"⚠️ ack failed after cancel (ignored): {e}")
            return

        # Non-zero, non-cancel → FAILED
        msg_err = result.get("message") or "unknown error"
        logger.error(f"❌ Training failed for {target_id}: {msg_err}")
        try:
            _emit_status(
                target_id, "FAILED", "FINALIZE", msg_err,
                modelPath=model_path, configPath=config_path, runName=run_name, error=msg_err
            )
            final_published = True
            final_state = "FAILED"
        except Exception as e:
            logger.warn(f"⚠️ status publish failed after failure: {e}")

        try:
            ch.basic_ack(delivery_tag=delivery_tag); acked = True
        except Exception as e:
            logger.warn(f"⚠️ ack failed after failure (ignored): {e}")
        return

    except Exception as e:
        if final_published and final_state in TERMINAL_STATES:
            logger.warn(f"⚠️ Late exception after terminal state ({final_state}): {e}")
        else:
            logger.error(f"❌ Worker error: {e}")
            try:
                _emit_status(
                    (target_id if 'target_id' in locals() else "?"),
                    "FAILED", "FINALIZE", f"worker exception: {e}", error=str(e)
                )
                final_published = True
                final_state = "FAILED"
            except Exception as e2:
                logger.warn(f"⚠️ status publish failed in except: {e2}")

        if not acked:
            try:
                ch.basic_ack(delivery_tag=delivery_tag); acked = True
            except Exception:
                pass

    finally:
        # Only clear volatile subdir; keep deterministic workspace (model/ lives there)
        try:
            _safe_cleanup_workspace(shared_ws_root)
        except Exception:
            pass

def _start_train_consumer():
    def on_msg(message, ch, delivery_tag):
        # submit to pool, ack when done
        fut = _executor.submit(_handle_train_message, message, ch, delivery_tag)
        with _active_lock:
            _active_futures.add(fut)
        def _done(_f):
            with _active_lock:
                _active_futures.discard(_f)
        fut.add_done_callback(_done)

    logger.info(f"🐰 Train consumer starting on '{TARGET_TRAIN_QUEUE}' with max={VC_MAX_CONCURRENCY} ...")
    mq_train.consume_with_manual_ack_queue(on_message_callback=on_msg)

def _start_cancel_consumer():
    # Create a dedicated connection in this thread
    from rabbitmq import RabbitMQManager
    local_cancel = RabbitMQManager(queue_name=TARGET_CANCEL_QUEUE, durable=True, auto_ack=True)

    def on_cancel(message: dict, ch, delivery_tag):
        target_id = str(message.get("id") or "").strip()
        if not target_id:
            logger.warn("⚠️ Cancel without 'id' ignored.")
            return

        # breadcrumb: see what we think is running
        try:
            running = list_tasks()
            logger.info(f"🧭 Cancel received for {target_id}. Running={list(running.keys())}")
        except Exception:
            pass

        # 1) try to cancel running (task_registry → pgid SIGTERM/SIGKILL)
        if cancel_running(target_id):
            logger.info(f"🛑 Cancelled running training for {target_id}")
            return

        # 2) not running → drop pending message from the train queue
        try:
            mq_train.drain_and_drop_first(lambda m: str(m.get('id') or '') == target_id, max_wait=2)
            logger.info(f"🧹 Dropped pending message for {target_id}")
        except Exception as e:
            logger.warn(f"⚠️ Cancel drop pending failed for {target_id}: {e}")

    logger.info(f"🛎️ Cancel consumer starting on '{TARGET_CANCEL_QUEUE}' ...")
    local_cancel.consume_queue(on_message_callback=on_cancel)  # <-- now exists

def _status_writer():
    while not _stop.is_set():
        try:
            data = {
                "time": time.time(),
                "concurrency": VC_MAX_CONCURRENCY,
                "running": list_tasks(),
                "active_futures": len([f for f in list(_active_futures) if not f.done()]),
                "queue": TARGET_TRAIN_QUEUE,
                "cancel_queue": TARGET_CANCEL_QUEUE,
            }
            os.makedirs(os.path.dirname(STATUS_PATH), exist_ok=True)
            with open(STATUS_PATH, "w") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass
        _stop.wait(2.0)

def start_consumers():
    logger.info("🚦 Starting VC Engine train consumer...")
    t1 = threading.Thread(target=_start_train_consumer, daemon=True)
    t2 = threading.Thread(target=_start_cancel_consumer, daemon=True)
    t3 = threading.Thread(target=_status_writer, daemon=True)
    t1.start(); t2.start(); t3.start()
    logger.info("✅ Consumers launched.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        _stop.set()
        _executor.shutdown(wait=False, cancel_futures=True)

if __name__ == "__main__":
    start_consumers()
