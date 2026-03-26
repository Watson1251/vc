import re
import json
import torch
import os
import sys
from flask import Flask, request, jsonify
import time
import shutil
from pathlib import Path
import threading

if "/vc/src" not in sys.path:
    sys.path.insert(0, "/vc/src")
from audio_preprocessor import AudioPreprocessor

if "/security" not in sys.path:
    sys.path.insert(0, "/security")
from secure import HybridFileSecurity

# Make sure Python can see /logger
if "/logger" not in sys.path:
    sys.path.insert(0, "/logger")
from logger import AppLogger

# RabbitMQ manager
if "/rabbitmq" not in sys.path:
    sys.path.insert(0, "/rabbitmq")
from rabbitmq import RabbitMQManager  # /rabbitmq/rabbitmq.py

TARGET_CANCEL_QUEUE = os.getenv("TARGET_CANCEL_QUEUE", "target_cancel_queue")
mq_cancel_admin = RabbitMQManager(queue_name=TARGET_CANCEL_QUEUE, durable=True, auto_ack=True)
STATUS_PATH = os.getenv("VC_STATUS_FILE", "/db/media/train_consumer_status.json")

def _json_error(msg: str, code: int = 400):
    logger.error(msg)
    return jsonify({"message": msg, "code": code}), code

# ============= LOGGER
logger = AppLogger()
app = Flask(__name__)

# ============= RABBITMQ SETUP
TARGET_TRAIN_QUEUE = os.getenv("TARGET_TRAIN_QUEUE", "target_train_queue")
mq_train_admin = RabbitMQManager(queue_name=TARGET_TRAIN_QUEUE, durable=True, auto_ack=False)

# near top with other queues
CLONE_CANCEL_QUEUE = os.getenv("CLONE_CANCEL_QUEUE", "clone_cancel_queue")
mq_clone_cancel = RabbitMQManager(queue_name=CLONE_CANCEL_QUEUE, durable=True, auto_ack=True)

# ============ CLASSES
preprocessor = AudioPreprocessor(sample_rate=16000, channels=1, sample_fmt="s16")
security = HybridFileSecurity()

def _derive_encrypted_wav_path(src_encrypted_path: str) -> str:
    p = Path(src_encrypted_path)
    p_noenc = p.with_suffix("") if p.suffix == ".enc" else p
    wav_noenc = p_noenc.with_suffix(".wav")
    return str(Path(str(wav_noenc) + ".enc"))

@app.route("/status", methods=["GET"])
def status():
    try:
        if os.path.exists(STATUS_PATH):
            with open(STATUS_PATH, "r") as f:
                js = json.load(f)
        else:
            js = {"message": "status file not found", "path": STATUS_PATH}
        return jsonify(js), 200
    except Exception as e:
        return _json_error(f"Status read failed: {e}", 500)


@app.route("/preprocess-audio", methods=["POST"])
def preprocess_audio():
    body = request.get_json(force=True, silent=False)
    if not body or "path" not in body:
        return jsonify({"message": "Missing 'path' in body"}), 400

    enc_input_path = body["path"]
    overwrite = bool(body.get("overwrite", True))

    logger.info(f"🎧 Preprocessing request for: {enc_input_path}")

    security = HybridFileSecurity()
    pre = AudioPreprocessor()

    dec_temp = None
    temp_wav = None
    final_wav_enc = _derive_encrypted_wav_path(enc_input_path)

    try:
        # 1) Decrypt -> temp
        dec_temp = security.decrypt_to_temp(enc_input_path, delete_on_exit=False)
        logger.info(f"🔓 Decrypted temp path: {dec_temp}")

        # 2) Integrity
        if not pre.check_integrity(dec_temp):
            raise RuntimeError("Integrity check failed (ffmpeg validation).")

        # 3) Convert to WAV (note: correct kwarg is output_path)
        #    Let the preprocessor pick a temp WAV path next to dec_temp.
        temp_wav = pre.convert_to_wav(dec_temp, output_path=None, overwrite=True)
        if not temp_wav or not os.path.exists(temp_wav):
            raise RuntimeError("WAV conversion did not produce an output file.")

        # 4) Duration
        duration = pre.get_duration(temp_wav)
        if duration is None:
            raise RuntimeError("Failed to probe WAV duration.")

        # 5) Encrypt WAV next to original upload (…/file.wav.enc)
        if os.path.exists(final_wav_enc):
            if overwrite:
                try:
                    os.remove(final_wav_enc)
                except Exception as e:
                    raise RuntimeError(f"Failed to overwrite existing {final_wav_enc}: {e}")
            else:
                raise RuntimeError(f"Target already exists: {final_wav_enc}")

        security.encrypt_file(temp_wav, output_path=final_wav_enc)
        logger.info(f"🔐 Wrote encrypted WAV: {final_wav_enc}")

        return jsonify({
            "message": "Preprocessing OK",
            "wav_path": final_wav_enc,
            "duration_seconds": float(duration),
        }), 200

    except Exception as e:
        # Remove partially-created encrypted WAV, if any
        try:
            if final_wav_enc and os.path.exists(final_wav_enc):
                os.remove(final_wav_enc)
                logger.info(f"🗑️ Removed partial encrypted WAV: {final_wav_enc}")
        except Exception as e2:
            logger.warn(f"⚠️ Could not delete partial encrypted WAV {final_wav_enc}: {e2}")

        logger.error(f"❌ Preprocessing failed for {enc_input_path}: {e}")
        return jsonify({"message": f"{e}"}), 500

    finally:
        # Cleanup temps
        try:
            if temp_wav and os.path.exists(temp_wav):
                os.remove(temp_wav)
                logger.info(f"🧹 Deleted temp wav: {temp_wav}")
        except Exception as e:
            logger.warn(f"⚠️ Failed to delete temp wav {temp_wav}: {e}")

        try:
            if dec_temp and os.path.exists(dec_temp):
                os.remove(dec_temp)
                logger.info(f"🧹 Deleted decrypted temp file: {dec_temp}")
        except Exception as e:
            logger.warn(f"⚠️ Failed to delete decrypted temp {dec_temp}: {e}")


@app.route("/cancel-clone/<clone_action_id>", methods=["POST"])
def api_cancel_clone(clone_action_id: str):
    clone_action_id = str(clone_action_id).strip()
    try:
        mq_clone_cancel.publish({"id": clone_action_id})
        logger.info(f"🛑 clone-cancel token published for {clone_action_id}")
        return jsonify({"message": "Cancel requested", "cloneActionId": clone_action_id}), 200
    except Exception as e:
        return _json_error(f"cancel clone failed: {e}", 500)


@app.route("/cancel/<target_id>", methods=["POST"])
def api_cancel(target_id: str):
    """
    Remove a pending job from the TARGET_TRAIN_QUEUE by target_id.
    - Drains a short burst of messages from the training queue
    - Drops the first message with id == target_id
    - Re-publishes the others (order may change)
    NOTE: This does NOT cancel a job already running in the engine.
    """
    target_id = str(target_id)
    logger.info(f"🎯 Cancel request received for target ID: {target_id}")
    
    # try to cancel a running one (consumer will act on this)
    try:
        mq_cancel_admin.publish({"id": target_id})
        logger.info(f"📨 Sent cancel signal for running task: {target_id}")
    except Exception as e:
        logger.warn(f"⚠️ Failed to send cancel signal: {e}")

    try:
        # Drain a small window from the queue (non-blocking loop with small wait)
        drained = mq_train_admin.drain_messages(max_wait=2)  # returns [(msg_dict, delivery_tag), ...]
        if not drained:
            logger.warn(f"🟨 Cancel requested for {target_id}, but queue appears empty.")
            return jsonify({"message": "Queue empty", "targetId": target_id, "removed": False}), 200

        removed = False
        kept_count = 0
        dropped_count = 0

        # Re-publish all except the first matching target_id
        for message, delivery_tag in drained:
            try:
                msg_id = str(message.get("id") or "")
            except Exception:
                msg_id = ""

            if not removed and msg_id == target_id:
                # Drop this one (ACK without re-publish)
                mq_train_admin.ack(delivery_tag)
                removed = True
                dropped_count += 1
                logger.info(f"🧹 Removed pending job for target {target_id} from '{TARGET_TRAIN_QUEUE}'")
            else:
                # Re-publish and ACK original
                try:
                    mq_train_admin.publish({k: v for k, v in message.items() if k != "_delivery_tag"})
                finally:
                    mq_train_admin.ack(delivery_tag)
                kept_count += 1

        if removed:
            return jsonify({
                "message": "Removed pending job from queue",
                "targetId": target_id,
                "removed": True,
                "kept": kept_count,
                "dropped": dropped_count,
                "queue": TARGET_TRAIN_QUEUE
            }), 200
        else:
            logger.warn(f"🟨 No pending job found for target {target_id} in drained window.")
            return jsonify({
                "message": "No matching pending job found (may be already running or outside window)",
                "targetId": target_id,
                "removed": False,
                "kept": kept_count,
                "dropped": dropped_count,
                "queue": TARGET_TRAIN_QUEUE
            }), 200

    except Exception as e:
        logger.error(f"❌ /cancel error for {target_id}: {e}")
        return jsonify({"message": str(e), "targetId": target_id, "removed": False}), 500


if __name__ == "__main__":
    logger.info("🚀 Starting Flask app...")
    app.run()
