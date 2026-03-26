# vc/src/seed_vc_trainer.py
import os
import re
import sys
import shutil
import subprocess
from typing import Optional, Tuple, Dict, Callable, List
import signal
import time
import glob

# ---- logging ----
if "/logger" not in sys.path:
    sys.path.insert(0, "/logger")
from logger import AppLogger
logger = AppLogger()

# ---- pipeline ----
if "/vc/src" not in sys.path:
    sys.path.insert(0, "/vc/src")
from voice_processing_pipeline import VoiceProcessingPipeline
from task_registry import register as task_register, unregister as task_unregister


class SeedVCTrainer:
    def __init__(self, repo_root: Optional[str] = None):
        self.repo_root = repo_root or os.path.dirname(os.path.abspath(__file__))
        self.seed_vc_dir = os.path.join(self.repo_root, "seed-vc")

        # ===== DEFAULT TRAINING CONFIG (OPTIMAL VALUES) =====
        self.default_config      = os.getenv("SEED_VC_CONFIG", "configs/presets/config_dit_mel_seed_uvit_whisper_small_wavenet.yml")
        self.default_batch       = int(os.getenv("SEED_VC_BATCH_SIZE", "4"))
        self.default_steps       = int(os.getenv("SEED_VC_MAX_STEPS", "1500"))
        self.default_epochs      = int(os.getenv("SEED_VC_MAX_EPOCHS", "1000"))
        self.default_save_every  = int(os.getenv("SEED_VC_SAVE_EVERY", "200"))
        self.default_workers     = int(os.getenv("SEED_VC_NUM_WORKERS", "2"))

        # NEW optional defaults for LR schedule
        self.default_base_lr     = os.getenv("SEED_VC_BASE_LR", "3e-5")
        self.default_warmup      = os.getenv("SEED_VC_WARMUP_STEPS", "50")

        # Persist under original media root
        self.media_root          = os.getenv("MEDIA_ROOT", "/db/media")
        # Optional: keep workspace for debugging (1/true to keep)
        self.keep_workspace      = (os.getenv("VC_KEEP_WORKSPACE", "0").lower() in ("1", "true", "yes"))

    # ---------------- helpers ---------------- #
    def _ensure_dir(self, d: str):
        os.makedirs(d, exist_ok=True)

    def _move_file(self, src: str, dst_dir: str, dst_name: Optional[str] = None) -> str:
        self._ensure_dir(dst_dir)
        if not os.path.isfile(src):
            raise FileNotFoundError(f"Source file not found: {src}")
        basename = dst_name or os.path.basename(src)
        dst = os.path.join(dst_dir, basename)
        if os.path.abspath(src) != os.path.abspath(dst):
            try:
                shutil.move(src, dst)
            except Exception:
                shutil.copy2(src, dst)
                try:
                    os.remove(src)
                except Exception:
                    pass
        return os.path.abspath(dst)

    def _paths_from_data(self, data: Dict) -> List[str]:
        out = []
        for key in (
            "trainingAudio", "referenceAudio",     # camelCase
            "training_paths", "reference_paths",
            "training_audio", "reference_audio",   # snake_case
        ):
            v = data.get(key)
            if not isinstance(v, list):
                continue
            for item in v:
                if isinstance(item, str):
                    out.append(os.path.abspath(item))
                elif isinstance(item, dict):
                    for k in ("filepath", "filePath", "path", "fullpath"):
                        p = item.get(k)
                        if isinstance(p, str):
                            out.append(os.path.abspath(p))
                            break
        return out

    def _derive_owner_from_payload_or_glob(self, media_root: str, payload_paths: List[str]) -> Optional[str]:
        prefix = f"{media_root.rstrip('/')}/"
        # Direct parse from absolute media paths
        for p in payload_paths:
            if p.startswith(prefix):
                rest = p[len(prefix):]
                cand = rest.split("/", 1)[0].strip()
                if cand:
                    return cand
        # Fallback: glob by filename
        for p in payload_paths:
            base = os.path.basename(p)
            matches = glob.glob(os.path.join(media_root, "*", "**", base), recursive=True)
            if matches:
                rest = matches[0][len(prefix):]
                cand = rest.split("/", 1)[0].strip()
                if cand:
                    return cand
        return None

    def _derive_owner_from_workspace(self, media_root: str, ws_root: Optional[str]) -> Optional[str]:
        """
        Parse owner from workspace path like: /db/media/<owner>/<target>_<seed>
        """
        if not ws_root:
            return None
        ws_root = os.path.abspath(ws_root)
        prefix = f"{media_root.rstrip('/')}/"
        if not ws_root.startswith(prefix):
            return None
        rest = ws_root[len(prefix):]  # "<owner>/<target>_<seed>..."
        parts = rest.split("/", 1)
        return parts[0].strip() if parts and parts[0].strip() else None

    def _results_dir(self, media_root: str, owner: str, target_id: str) -> str:
        return os.path.join(media_root.rstrip("/"), owner, str(target_id), "model")

    # ---------------- main ---------------- #
    def run_with_pipeline(self, target_id: str, data: Dict, status_cb: Optional[Callable[[Dict], None]] = None) -> Dict:
        """
        1) Run VoiceProcessingPipeline to produce /tmp ready dataset.
        2) Train.
        3) On success, move ft_model.pth + config into /db/media/<owner>/<target_id>/model/ and return those paths.
        """
        media_root = (self.media_root or "/db/media").rstrip("/")

        pipeline = VoiceProcessingPipeline(data)
        ws_root = pipeline.ws_root
        dataset_root = getattr(pipeline, "dataset_folder", None)

        try:
            if status_cb:
                status_cb({"status": "PROGRESS", "phase": "PREPROCESS", "message": "pipeline.run() start"})

            prep = pipeline.run()
            if int(prep.get("status", 500)) != 200:
                if status_cb:
                    status_cb({"status": "FAILED", "phase": "PREPROCESS", "message": f"preprocess failed: {prep.get('message','')}"})
                return {"status": 500, "message": f"Preprocess failed: {prep.get('message')}"}

            ready_dir = prep["dataset_ready_dir"]

            # ===== Determine owner (payload -> glob -> workspace) =====
            payload_paths = self._paths_from_data(data)
            owner = self._derive_owner_from_payload_or_glob(media_root, payload_paths)
            if not owner:
                owner = self._derive_owner_from_workspace(media_root, ws_root)

            if not owner:
                raise RuntimeError(
                    "[seed-vc] Could not determine owner from payload/workspace. "
                    "Expected absolute media paths like /db/media/<owner>/.../*.enc"
                )

            target_results_dir = self._results_dir(media_root, owner, target_id)
            self._ensure_dir(target_results_dir)
            logger.info(f"[seed-vc] Results directory → {target_results_dir} (owner={owner})")

            # ----- Overrides from data.seed_vc -----
            o = (data.get("seed_vc") or {})
            cfg        = o.get("config",      self.default_config)
            batch      = int(o.get("batch",   self.default_batch))
            steps      = int(o.get("steps",   self.default_steps))
            epochs     = int(o.get("epochs",  self.default_epochs))
            save_every = int(o.get("saveEvery", self.default_save_every))
            workers    = int(o.get("workers", self.default_workers))
            base_lr    = o.get("baseLR", self.default_base_lr)
            warmup     = o.get("warmupSteps", self.default_warmup)

            run_name = target_id

            cmd = (
                f"python3 train.py "
                f"--config {cfg} "
                f"--dataset-dir {ready_dir} "
                f"--run-name {run_name} "
                f"--batch-size {batch} "
                f"--max-steps {steps} "
                f"--max-epochs {epochs} "
                f"--save-every {save_every} "
                f"--num-workers {workers} "
                f"--base-lr {base_lr} "
                f"--warmup-steps {warmup}"
            )

            logger.info(f"[seed-vc] Launching training: {cmd}")
            if status_cb:
                status_cb({"status": "PROGRESS", "phase": "LAUNCH", "message": "trainer subprocess start"})
            ok, err, cancelled = self._run_subprocess(
                cmd, cwd=self.seed_vc_dir, target_id=target_id, status_cb=status_cb, run_name=run_name
            )

            if cancelled:
                if status_cb:
                    status_cb({"status": "CANCELLED", "phase": "FINALIZE", "message": "training cancelled"})
                return {"status": 499, "message": "Training cancelled"}

            if not ok:
                if status_cb:
                    status_cb({"status": "FAILED", "phase": "FINALIZE", "message": f"training failed: {err or 'Unknown error'}"})
                return {"status": 500, "message": f"Training failed: {err or 'Unknown error'}"}

            # ===== Locate outputs =====
            candidate_model = os.path.join(ready_dir, "ft_model.pth")
            alt_candidate   = os.path.join(ready_dir, str(run_name), "ft_model.pth")
            if (not os.path.exists(candidate_model)) and os.path.exists(alt_candidate):
                candidate_model = alt_candidate

            if not os.path.exists(candidate_model):
                runs_dir = os.path.join(self.seed_vc_dir, "runs", run_name)
                guess = self._pick_best_checkpoint(runs_dir)
                candidate_model = guess or ""

            config_path = cfg if os.path.isabs(cfg) else os.path.join(self.seed_vc_dir, cfg)

            if not candidate_model or not os.path.exists(candidate_model):
                if status_cb:
                    status_cb({"status": "FAILED", "phase": "FINALIZE", "message": "no model produced", "configPath": config_path})
                return {"status": 500, "message": "Training ended without producing a model"}

            # ===== Persist into /db/media/<owner>/<target_id>/model =====
            try:
                model_dst = self._move_file(candidate_model, target_results_dir, "ft_model.pth")

                cfg_basename = os.path.basename(config_path) if os.path.isfile(config_path) else "config.yml"
                config_dst = os.path.join(target_results_dir, cfg_basename)
                try:
                    if os.path.abspath(config_path) != os.path.abspath(config_dst) and os.path.isfile(config_path):
                        shutil.copy2(config_path, config_dst)
                except Exception as e:
                    logger.warn(f"[seed-vc] Could not copy config to results dir: {e}")
                    config_dst = os.path.abspath(config_path)

                logger.info(f"[seed-vc] Result artifacts stored → {target_results_dir}")
                logger.info(f"[seed-vc]  - modelPath:  {model_dst}")
                logger.info(f"[seed-vc]  - configPath: {config_dst}")

            except Exception as e:
                if status_cb:
                    status_cb({"status": "FAILED", "phase": "FINALIZE", "message": f"persist results failed: {str(e)}"})
                return {"status": 500, "message": f"Persist results failed: {str(e)}"}

            # ===== SUCCESS =====
            if status_cb:
                status_cb({
                    "status": "SUCCESS",
                    "phase": "FINALIZE",
                    "message": "training completed",
                    "modelPath": model_dst,
                    "configPath": config_dst,
                    "runName": run_name
                })

            return {
                "status": 200,
                "message": "Training completed (seed-vc + pipeline)",
                "modelPath": model_dst,
                "configPath": config_dst,
                "runName": run_name,
            }

        finally:
            # Optional cleanup of plaintext workspace & dataset
            if not self.keep_workspace:
                for p in filter(None, [dataset_root, ws_root]):
                    try:
                        if os.path.isdir(p):
                            shutil.rmtree(p, ignore_errors=True)
                            logger.info(f"🧹 Removed temp dir: {p}")
                    except Exception:
                        pass

    # ---------------- subprocess + checkpoint helpers ---------------- #
    def _run_subprocess(
        self, cmd: str, cwd: Optional[str] = None, target_id: Optional[str] = None,
        status_cb: Optional[Callable[[Dict], None]] = None, run_name: Optional[str] = None
    ) -> Tuple[bool, Optional[str], bool]:
        proc = subprocess.Popen(
            cmd, cwd=cwd, shell=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, universal_newlines=True,
            preexec_fn=os.setsid
        )
        try:
            if target_id:
                task_register(target_id, proc.pid, cmd)
        except Exception:
            pass

        err_msg = None
        while True:
            line = proc.stdout.readline()
            if not line and proc.poll() is not None:
                break
            if line:
                print(line, end="", flush=True)
                logger.info(line.strip())

                if status_cb:
                    m_prog = re.search(r"epoch\s+(\d+).*?step\s+(\d+).*?loss:\s*([\d\.Ee+-]+)", line, flags=re.IGNORECASE)
                    if m_prog:
                        try:
                            status_cb({
                                "status": "PROGRESS",
                                "phase": "TRAIN",
                                "message": "step update",
                                "epoch": int(m_prog.group(1)),
                                "step": int(m_prog.group(2)),
                                "loss": float(m_prog.group(3)),
                                "runName": run_name,
                            })
                        except Exception:
                            pass

                m = re.search(r'(\b\w*Error\b):?\s*(.*)', line, flags=re.IGNORECASE)
                if m:
                    err_msg = f"{m.group(1)}: {m.group(2).strip()}"

        stderr_text = proc.stderr.read() or ""
        if stderr_text:
            for l in stderr_text.splitlines():
                logger.info(l)
                if status_cb:
                    status_cb({"status": "PROGRESS", "phase": "TRAIN", "message": l[:300]})
            m2 = re.search(r'(\b\w*Error\b):?\s*(.*)', stderr_text)
            if m2:
                err_msg = f"{m2.group(1)}: {m2.group(2).strip()}"

        proc.stdout.close(); proc.stderr.close()
        rc = proc.wait()

        if target_id:
            try:
                task_unregister(target_id)
            except Exception:
                pass

        cancelled = False
        if rc < 0:
            cancelled = (abs(rc) in (signal.SIGTERM, signal.SIGKILL))

        if rc != 0 and not err_msg and not cancelled:
            err_msg = f"Non-zero exit: {rc}"

        return (err_msg is None and not cancelled), err_msg, cancelled

    def _pick_best_checkpoint(self, runs_dir: str):
        if not os.path.isdir(runs_dir):
            return None
        best_path, best_mtime = None, 0
        for root, _, files in os.walk(runs_dir):
            for fn in files:
                if fn.endswith((".ckpt", ".pth")):
                    p = os.path.join(root, fn)
                    try:
                        mt = os.path.getmtime(p)
                        if mt > best_mtime:
                            best_mtime, best_path = mt, p
                    except Exception:
                        pass
        return best_path
