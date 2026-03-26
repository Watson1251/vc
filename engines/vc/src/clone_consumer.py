#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, sys, time, json, shutil, glob, threading, concurrent.futures as cf
from typing import Optional, List, Dict

# logging
if "/logger" not in sys.path: sys.path.insert(0, "/logger")
from logger import AppLogger
logger = AppLogger()

# rabbit
if "/rabbitmq" not in sys.path: sys.path.insert(0, "/rabbitmq")
from rabbitmq import RabbitMQManager

# cancel registry
if "/vc/src" not in sys.path: sys.path.insert(0, "/vc/src")
from task_registry import list_tasks, register as task_register, unregister as task_unregister, cancel as cancel_running
from voice_cloner import VoiceCloner

# security is used inside VoiceCloner, but we import to force early failure if missing
if "/security" not in sys.path: sys.path.insert(0, "/security")
from secure import HybridFileSecurity  # noqa

MEDIA_ROOT              = os.getenv("MEDIA_ROOT", "/db/media").rstrip("/")
CLONE_QUEUE             = os.getenv("CLONE_QUEUE", "clone_queue")
CLONE_CANCEL_QUEUE      = os.getenv("CLONE_CANCEL_QUEUE", "clone_cancel_queue")
CLONE_STATUS_QUEUE      = os.getenv("CLONE_STATUS_QUEUE", "clone_status_queue")
VC_MAX_CONCURRENCY      = int(os.getenv("VC_MAX_CONCURRENCY", "4"))
STATUS_FILE             = os.getenv("CLONE_STATUS_FILE", f"{MEDIA_ROOT}/clone_consumer_status.json")

mq_clone   = RabbitMQManager(queue_name=CLONE_QUEUE, durable=True, auto_ack=False)
mq_cancel  = RabbitMQManager(queue_name=CLONE_CANCEL_QUEUE, durable=True, auto_ack=True)
mq_status  = RabbitMQManager(queue_name=CLONE_STATUS_QUEUE, durable=True, auto_ack=True)

_executor     = cf.ThreadPoolExecutor(max_workers=VC_MAX_CONCURRENCY)
_active       = set()
_active_lock  = threading.RLock()
_stop         = threading.Event()

def _emit_status(action_id: str, status: str, phase: str, message: str = "", **extra):
    payload = {
        "type": "vc.clone.status",
        "actionId": str(action_id or "?"),
        "status": status,       # STARTED|PROGRESS|SUCCESS|FAILED|CANCELLED
        "phase": phase,         # RECEIVED|PREP|INFER|FINALIZE
        "message": message,
        "ts": time.time(),
    }
    payload.update(extra or {})
    try:
        mq_status.publish(payload)
    except Exception as e:
        logger.warn(f"⚠️ status publish failed: {e}")

def _owner_from_path(p: str) -> Optional[str]:
    try:
        if not p or not p.startswith(MEDIA_ROOT + "/"): return None
        return p[len(MEDIA_ROOT)+1:].split("/", 1)[0].strip() or None
    except Exception:
        return None

def _deterministic_workspace(owner: str, action_id: str) -> str:
    root = os.path.join(MEDIA_ROOT, owner, "clone", str(action_id))
    os.makedirs(os.path.join(root, "tmp"), exist_ok=True)
    os.makedirs(os.path.join(root, "out"), exist_ok=True)
    try:
        with open(os.path.join(root, ".voiceclone.ws"), "w") as f:
            f.write(f"id={action_id}\nowner={owner}\n")
    except Exception:
        pass
    return root

# --- in clone_consumer.py ---

def _handle_clone_message(msg: dict, ch, delivery_tag):
    acked = False
    action_id = str(msg.get("id") or "").strip()

    # NEW: track whether we already sent a terminal state
    terminal_sent = False
    terminal_state = None  # 'SUCCESS' | 'CANCELLED' | 'FAILED' | None

    try:
        if not action_id:
            _emit_status("?", "FAILED", "RECEIVED", "missing id")
            ch.basic_ack(delivery_tag=delivery_tag); return

        _emit_status(action_id, "STARTED", "RECEIVED", "message received", orig=msg)

        content_enc   = str(msg.get("contentPath") or "").strip()
        reference_enc = str(msg.get("referencePath") or "").strip()
        model_path    = str(msg.get("modelPath") or "").strip()
        config_path   = str(msg.get("configPath") or "").strip()
        owner         = (msg.get("owner") or _owner_from_path(content_enc) or _owner_from_path(reference_enc) or "").strip()

        if not owner:
            raise RuntimeError("owner could not be resolved from payload or media paths")
        if not (content_enc and reference_enc and model_path and config_path):
            raise RuntimeError("missing one of required fields: contentPath, referencePath, modelPath, configPath")

        ws_root = _deterministic_workspace(owner, action_id)
        cloner  = VoiceCloner(
            action_id=action_id,
            workspace=ws_root,
            status_cb=lambda ev: _emit_status(
                action_id,
                ev.get("status","PROGRESS"),
                ev.get("phase","INFER"),
                ev.get("message",""),
                **{k:v for k,v in ev.items() if k not in ("status","phase","message")}
            )
        )

        opts = {
            "diffusion": float(msg.get("diffusion", 25.0)),
            "length": float(msg.get("length", 1.0)),
            "inference_rate": float(msg.get("inference_rate", 0.7)),
        }
        out_dir = msg.get("outputDir")
        if isinstance(out_dir, str) and out_dir.strip():
            opts["output_dir"] = out_dir.strip()

        # Optional SFX (encrypted path)
        sfx_path = msg.get("soundEffectPath") or msg.get("sound_effect_path") or msg.get("sound_effect_enc")
        if sfx_path:
            opts["sound_effect_enc"] = str(sfx_path).strip()

        # Optional SFX gain (dB)
        opts["sfx_gain_db"] = int(msg.get("backgroundVolumeReduction",
                                msg.get("background_volume_reduction", 6)))


        # ✅ NEW: optional trim {start, end} in seconds
        trim = msg.get("soundEffectTrim") or msg.get("sound_effect_trim")
        if isinstance(trim, dict):
            s_raw = trim.get("start", None)
            e_raw = trim.get("end", None)
            try:
                s = None if s_raw in (None, "") else float(s_raw)
            except Exception:
                s = None
            try:
                e = None if e_raw in (None, "") else float(e_raw)
            except Exception:
                e = None
            if s is not None or e is not None:
                opts["sfx_trim"] = {"start": s, "end": e}

        _emit_status(
            action_id, "PROGRESS", "PREP", "sfx options",
            sfx_present=bool(sfx_path),
            sfx_gain_db=opts["sfx_gain_db"],
            sfx_trim=opts.get("sfx_trim", None),
        )

        ok, out_enc, err, cancelled = cloner.run(
            content_enc=content_enc,
            reference_enc=reference_enc,
            model_path=model_path,
            config_path=config_path,
            **opts
        )

        if cancelled:
            _emit_status(action_id, "CANCELLED", "FINALIZE", "cloning cancelled", outputPath=out_enc)
            terminal_sent = True; terminal_state = "CANCELLED"
        elif ok:
            _emit_status(action_id, "SUCCESS", "FINALIZE", "cloning succeeded", outputPath=out_enc)
            terminal_sent = True; terminal_state = "SUCCESS"
        else:
            _emit_status(action_id, "FAILED", "FINALIZE", err or "unknown error")
            terminal_sent = True; terminal_state = "FAILED"

        ch.basic_ack(delivery_tag=delivery_tag); acked = True

    except Exception as e:
        # Use full traceback for debugging
        logger.exception("❌ clone worker error")

        # ⬇️ NEW: If we already said SUCCESS/CANCELLED, do NOT send FAILED afterward.
        if terminal_sent and terminal_state in ("SUCCESS", "CANCELLED"):
            # Best-effort: keep logs quiet to not confuse the UI
            logger.warn(f"⚠️ post-terminal exception ignored for {action_id}: {e}")
        else:
            try:
                _emit_status(action_id or "?", "FAILED", "FINALIZE", f"worker exception: {type(e).__name__}: {e}")
            except Exception:
                pass

        if not acked:
            try: ch.basic_ack(delivery_tag=delivery_tag)
            except Exception: pass


def _start_clone_consumer():
    def on_msg(message, ch, delivery_tag):
        fut = _executor.submit(_handle_clone_message, message, ch, delivery_tag)
        with _active_lock:
            _active.add(fut)
        fut.add_done_callback(lambda f: _active.discard(f))

    try:
        if hasattr(mq_clone, "set_qos"):
            mq_clone.set_qos(prefetch_count=VC_MAX_CONCURRENCY)
    except Exception as e:
        logger.warn(f"⚠️ Could not set prefetch: {e}")

    logger.info(f"🎭 Clone consumer starting on '{CLONE_QUEUE}' with max={VC_MAX_CONCURRENCY} ...")
    mq_clone.consume_with_manual_ack_queue(on_message_callback=on_msg)

def _start_cancel_consumer():
    local_cancel = RabbitMQManager(queue_name=CLONE_CANCEL_QUEUE, durable=True, auto_ack=True)
    def on_cancel(message: dict, ch, delivery_tag):
        action_id = str(message.get("id") or "").strip()
        if not action_id:
            logger.warn("⚠️ Clone cancel without 'id' ignored."); return
        try:
            running = list_tasks()
            logger.info(f"🧭 Clone cancel for {action_id}. Running={list(running.keys())}")
        except Exception:
            pass
        if cancel_running(action_id):
            logger.info(f"🛑 Cancelled running clone for {action_id}")
            return
        try:
            mq_clone.drain_and_drop_first(lambda m: str(m.get('id') or '') == action_id, max_wait=2)
            logger.info(f"🧹 Dropped pending clone message for {action_id}")
        except Exception as e:
            logger.warn(f"⚠️ Clone cancel drop pending failed: {e}")

    logger.info(f"🛎️ Clone cancel consumer starting on '{CLONE_CANCEL_QUEUE}' ...")
    local_cancel.consume_queue(on_message_callback=on_cancel)

def _status_writer():
    while not _stop.is_set():
        try:
            data = {
                "time": time.time(),
                "running": list_tasks(),
                "active_futures": len([f for f in list(_active) if not f.done()]),
                "queue": CLONE_QUEUE,
                "cancel_queue": CLONE_CANCEL_QUEUE,
            }
            os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
            with open(STATUS_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass
        _stop.wait(2.0)

def start_consumers():
    logger.info("🚦 Starting VC Engine clone consumer...")
    t1 = threading.Thread(target=_start_clone_consumer,  daemon=True)
    t2 = threading.Thread(target=_start_cancel_consumer, daemon=True)
    t3 = threading.Thread(target=_status_writer,        daemon=True)
    t1.start(); t2.start(); t3.start()
    logger.info("✅ Clone consumers launched.")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt: pass
    finally:
        _stop.set()
        _executor.shutdown(wait=False, cancel_futures=True)

if __name__ == "__main__":
    start_consumers()
