#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, sys, time, shutil, subprocess, signal, re
from typing import Optional, Callable, Dict, Tuple
from pathlib import Path

if "/logger" not in sys.path: sys.path.insert(0, "/logger")
from logger import AppLogger
logger = AppLogger()

# cancel registry
if "/vc/src" not in sys.path: sys.path.insert(0, "/vc/src")
from task_registry import register as task_register, unregister as task_unregister

# encryption
if "/security" not in sys.path: sys.path.insert(0, "/security")
from secure import HybridFileSecurity

# audio utils you already have
if "/vc/src" not in sys.path: sys.path.insert(0, "/vc/src")
from audio_preprocessor import AudioPreprocessor

# at the top of voice_cloner.py
try:
    from pydub import AudioSegment
    _PYDUB_OK = True
except Exception:
    _PYDUB_OK = False


class VoiceCloner:
    """
    Decrypts inputs, runs Seed-VC inference via subprocess, re-encrypts output,
    supports cancellation via task_registry (SIGTERM/SIGKILL on pgid).
    """
    def __init__(self, action_id: str, workspace: str, status_cb: Optional[Callable[[Dict], None]] = None):
        self.action_id   = str(action_id)
        self.workspace   = workspace
        self.tmp_dir     = os.path.join(workspace, "tmp")
        self.out_dir     = os.path.join(workspace, "out")
        os.makedirs(self.tmp_dir, exist_ok=True)
        os.makedirs(self.out_dir, exist_ok=True)
        self.status_cb   = status_cb or (lambda ev: None)
        self.security    = HybridFileSecurity()
        self.pre         = AudioPreprocessor(sample_rate=16000, channels=1, sample_fmt="s16")
        self._gen_candidate: Optional[str] = None  # last *.wav seen in stdout

    def _status(self, **ev):
        try:
            self.status_cb(ev)
        except Exception:
            pass

    # pydub mixer (kept)
    def _mix_with_sfx(
        self,
        voice_wav: str,
        sfx_wav: str,
        gain_db: int,
        loop_sfx: bool = True,
        trim_start: Optional[float] = None,
        trim_end: Optional[float] = None
    ) -> str:
        if not _PYDUB_OK:
            logger.warn("⚠️ pydub not available; skipping SFX mixing.")
            return voice_wav
        if not (os.path.exists(voice_wav) and os.path.exists(sfx_wav)):
            logger.warn("⚠️ voice/sfx wav not found; skipping SFX mixing.")
            return voice_wav

        self._status(status="PROGRESS", phase="FINALIZE",
                     message=f"pydub mixing (gain={gain_db} dB)")
        try:
            voice = AudioSegment.from_file(voice_wav)
            bg    = AudioSegment.from_file(sfx_wav)

            # Apply trim at mix-time (ms)
            if trim_start is not None or trim_end is not None:
                s_ms = int(max(0.0, float(trim_start or 0.0)) * 1000.0)
                if trim_end is not None:
                    e_ms = int(max(0.0, float(trim_end)) * 1000.0)
                else:
                    e_ms = len(bg)
                if e_ms > s_ms:
                    bg = bg[s_ms:e_ms]

            if loop_sfx:
                if len(bg) < len(voice):
                    bg = bg * ((len(voice) // len(bg)) + 1)
                bg = bg[:len(voice)]
            else:
                # play SFX once, pad with silence to match voice length
                bg = bg[:len(voice)]
                if len(bg) < len(voice):
                    bg = AudioSegment.silent(duration=len(voice)).overlay(bg)
            if isinstance(gain_db, (int, float)) and gain_db != 0:
                bg = bg + gain_db

            merged = voice.overlay(bg)
            out_path = os.path.splitext(voice_wav)[0] + ".with_sfx.wav"
            merged.export(out_path, format="wav")
            return out_path if os.path.exists(out_path) else voice_wav
        except Exception as e:
            logger.warn(f"⚠️ SFX mix failed: {type(e).__name__}: {e}")
            return voice_wav


    # ffmpeg fallback mixer (kept)
    def _mix_with_sfx_ffmpeg(
        self,
        voice_wav: str,
        sfx_wav: str,
        gain_db: int,
        loop_sfx: bool = True,
        trim_start: Optional[float] = None,
        trim_end: Optional[float] = None
    ) -> str:
        try:
            if not (os.path.exists(voice_wav) and os.path.exists(sfx_wav)):
                logger.warn("⚠️ ffmpeg mix: missing input(s)")
                return voice_wav

            out_path = os.path.splitext(voice_wav)[0] + ".with_sfx.wav"
            import subprocess, json
            probe = subprocess.check_output(
                ["ffprobe","-v","error","-show_entries","format=duration","-of","json", voice_wav],
                text=True
            )
            dur = float(json.loads(probe)["format"]["duration"])
            dur = max(0.01, dur)

            cmd = [
                "ffmpeg", "-y",
                "-v", "error",
                "-i", voice_wav,
            ]
            if loop_sfx:
                cmd += ["-stream_loop", "-1", "-t", f"{dur:.3f}"]
            if trim_start is not None:
                cmd += ["-ss", f"{float(trim_start):.3f}"]
            if trim_end is not None and trim_start is not None:
                span = max(0.0, float(trim_end) - float(trim_start))
                cmd += ["-t", f"{span:.3f}"]
            elif trim_end is not None:
                cmd += ["-to", f"{float(trim_end):.3f}"]
            cmd += ["-i", sfx_wav,
                    "-filter_complex",
                    f"[1:a]volume={gain_db}dB[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=0",
                    "-c:a", "pcm_s16le",
                    out_path]

            self._status(status="PROGRESS", phase="FINALIZE",
                         message=f"ffmpeg mixing (gain={gain_db} dB)")

            cp = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if cp.returncode != 0:
                logger.warn(f"⚠️ ffmpeg mix failed: {cp.stderr.strip()[:200]}")
                return voice_wav

            return out_path if os.path.exists(out_path) else voice_wav
        except Exception as e:
            logger.warn(f"⚠️ ffmpeg mix exception: {type(e).__name__}: {e}")
            return voice_wav

    def _decrypt(self, enc_path: str) -> str:
        self._status(status="PROGRESS", phase="PREP", message=f"decrypt {os.path.basename(enc_path)}")
        return self.security.decrypt_to_temp(enc_path, delete_on_exit=False)

    def _to_wav(self, inp: str) -> str:
        self._status(status="PROGRESS", phase="PREP", message=f"to wav {os.path.basename(inp)}")
        wav = self.pre.convert_to_wav(inp, output_path=None, overwrite=True)
        if not wav or not os.path.exists(wav):
            raise RuntimeError("WAV conversion failed")
        return wav

    from typing import Optional

    def _maybe_crop_wav(self, wav_path: str, start: Optional[float], end: Optional[float]) -> str:
        """If start/end given, crops wav_path to [start, end); otherwise returns wav_path."""
        try:
            if start is None and end is None:
                return wav_path

            dur = self.pre.get_duration(wav_path)
            if not dur or dur <= 0:
                return wav_path

            s = max(0.0, float(start or 0.0))
            e = float(end) if end is not None else dur
            e = max(s, min(e, dur))  # clamp

            if e <= s:
                return wav_path

            base, _ = os.path.splitext(wav_path)
            out_cropped = f"{base}.trim_{int(round(s*1000))}_{int(round(e*1000))}.wav"
            self._status(status="PROGRESS", phase="PREP",
                        message=f"cropping sfx to [{s:.3f},{e:.3f}) sec")
            cropped = self.pre.segment_audio(wav_path, s, e, out_path=out_cropped, overwrite=True)
            if cropped and os.path.exists(cropped):
                return cropped
            return wav_path
        except Exception as e:
            self._status(status="PROGRESS", phase="PREP",
                        message=f"sfx trim failed, using full sfx ({type(e).__name__})")
            return wav_path

    def _encrypt_out(self, wav_path: str, dest_dir: Optional[str] = None) -> str:
        target_dir = Path(dest_dir) if dest_dir else Path(self.out_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        base = target_dir / f"{self.action_id}.wav.enc"
        self._status(status="PROGRESS", phase="FINALIZE", message="encrypting output")
        self.security.encrypt_file(wav_path, output_path=str(base))
        return str(base)

    def _run_subproc(self, cmd: str, cwd: Optional[str] = None) -> Tuple[bool, Optional[str], bool]:
        """
        Run external inference. Returns (ok, err, cancelled).
        Captures stdout line-by-line, forwarding to status, and tracks *.wav hints.
        """
        # reset any previous candidate
        self._gen_candidate = None

        wav_re = re.compile(r'(?P<p>(?:\/|\.{1,2}\/)?[^\s"\'\]]+\.wav)\b', re.IGNORECASE)

        proc = subprocess.Popen(
            cmd, cwd=cwd, shell=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, universal_newlines=True,
            preexec_fn=os.setsid
        )
        # register for cancel
        task_register(self.action_id, proc.pid, cmd)
        err_msg = None
        try:
            # stream stdout
            while True:
                line = proc.stdout.readline()
                if not line and proc.poll() is not None:
                    break
                if line:
                    line = line.rstrip("\n")
                    logger.info(line)
                    self._status(status="PROGRESS", phase="INFER", message=line[:300])
                    # try to detect generated wav filepath
                    m = wav_re.search(line)
                    if m:
                        self._gen_candidate = m.group("p")

            # drain stderr
            stderr_text = proc.stderr.read() or ""
            if stderr_text:
                for l in stderr_text.splitlines():
                    logger.info(l)
                    self._status(status="PROGRESS", phase="INFER", message=l[:300])

            rc = proc.wait()
        finally:
            try:
                task_unregister(self.action_id)
            except Exception:
                pass

        cancelled = (rc < 0 and abs(rc) in (signal.SIGTERM, signal.SIGKILL))
        if rc != 0 and not cancelled:
            err_msg = f"Non-zero exit: {rc}"
        return (err_msg is None and not cancelled), err_msg, cancelled

    def run(
        self,
        content_enc: str,
        reference_enc: str,
        model_path: str,
        config_path: str,
        diffusion: float = 25.0,
        length: float = 1.0,
        inference_rate: float = 0.7,
        sound_effect_enc: Optional[str] = None,
        sfx_gain_db: int = 6,
        sfx_trim: Optional[dict] = None,            # ✅ NEW: {start, end}
        output_dir: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str], bool]:
        """
        Returns: (ok, out_enc_path, err, cancelled)
        """
        self._status(status="STARTED", phase="INFER", message="cloner.run()")

        dec_content = dec_ref = None
        wav_content = wav_ref = None
        dec_sfx = None
        wav_sfx = None
        sfx_for_mix = None
        loop_sfx = True
        sfx_paths = []
        out_wav_fixed = None
        out_enc = None

        try:
            # 1) decrypt
            dec_content = self._decrypt(content_enc)
            dec_ref     = self._decrypt(reference_enc)
            if sound_effect_enc:
                logger.info(f"🎛️ SFX provided: {sound_effect_enc}")
            else:
                logger.info("🎛️ SFX provided: false")

            # 2) normalize to wav
            wav_content = self._to_wav(dec_content)
            wav_ref     = self._to_wav(dec_ref)

            # 3) build output dir and command
            #    NOTE: we point Seed-VC to a *plaintext* output folder; we will encrypt the final wav afterward.
            out_dir = Path(output_dir or self.out_dir)
            out_dir.mkdir(parents=True, exist_ok=True)

            # a fixed fallback filename we control (in case the script doesn't print the name)
            out_wav_fixed = str(out_dir / f"{self.action_id}.wav")

            # Seed-VC CLI (from your reference)
            # python3 inference.py --source <wav_content> --target <wav_ref> --output <out_dir>
            #   --diffusion-steps <diffusion> --length-adjust <length>
            #   --inference-cfg-rate <inference_rate> --f0-condition False --auto-f0-adjust False
            #   --semi-tone-shift 0 --checkpoint <model_path> --config <config_path> --fp16 True --key <action_id>
            seedvc_dir = "/vc/src/seed-vc"
            inf_py = f"{seedvc_dir}/inference.py"

            # Ensure output directory exists (use caller-provided or our own)
            out_dir = Path(output_dir or self.out_dir)
            out_dir.mkdir(parents=True, exist_ok=True)

            # Seed-VC will write: {key}_cloned.wav in --output
            expected_name = f"{self.action_id}_cloned.wav"
            out_wav = str(out_dir / expected_name)

            # Coerce types as Seed-VC expects
            diffusion_i = int(round(diffusion))              # <-- MUST be int
            length_f    = float(length)
            cfg_rate_f  = float(inference_rate)

            # Seed-VC bools (str2bool) — pass lowercase strings for safety
            f0_condition_str   = "false"
            auto_f0_adjust_str = "false"
            fp16_str           = "true"

            cmd = (
                f"python3 '{inf_py}' "
                f"--source '{wav_content}' "
                f"--target '{wav_ref}' "
                f"--output '{str(out_dir)}' "
                f"--diffusion-steps {diffusion_i} "
                f"--length-adjust {length_f} "
                f"--inference-cfg-rate {cfg_rate_f} "
                f"--f0-condition {f0_condition_str} "
                f"--auto-f0-adjust {auto_f0_adjust_str} "
                f"--semi-tone-shift 0 "
                f"--checkpoint '{model_path}' "
                f"--config '{config_path}' "
                f"--fp16 {fp16_str} "
                f"--key '{self.action_id}'"
            )

            self._status(status="PROGRESS", phase="INFER", message=f"launching: {cmd}")
            ok, err, cancelled = self._run_subproc(cmd, cwd=seedvc_dir)   # <-- run in Seed-VC dir
            if cancelled:
                return False, None, None, True
            if not ok:
                return False, None, (err or "inference failed"), False

            # Seed-VC prints the filename to stdout, but we trust the contract and check the expected path
            if not os.path.exists(out_wav):
                return False, None, "inference produced no output", False

            # 4) Mix (if sfx available)
            final_wav = out_wav
            self._status(status="PROGRESS", phase="FINALIZE",
                         message="checking sfx for mixing",
                         sfx_present=bool(wav_sfx), pydub_ok=_PYDUB_OK)
            if sound_effect_enc:
                # Load SFX only at mix time, then apply trim if provided
                dec_sfx = self._decrypt(sound_effect_enc)
                sfx_paths.append(dec_sfx)
                wav_sfx = self._to_wav(dec_sfx)
                sfx_paths.append(wav_sfx)

                start = end = None
                if isinstance(sfx_trim, dict):
                    start = sfx_trim.get("start", None)
                    end   = sfx_trim.get("end", None)

                if wav_sfx and (start is not None or end is not None):
                    cropped_sfx = self._maybe_crop_wav(wav_sfx, start, end)
                    if cropped_sfx and os.path.exists(cropped_sfx):
                        wav_sfx = cropped_sfx
                        sfx_paths.append(cropped_sfx)

                sfx_for_mix = wav_sfx

                # Adjust looping based on trimmed length vs voice length
                try:
                    voice_dur = self.pre.get_duration(out_wav) or 0
                    if start is not None or end is not None:
                        s = float(start or 0.0)
                        e = float(end) if end is not None else (self.pre.get_duration(wav_sfx) or 0)
                        seg_len = max(0.0, e - s)
                        loop_sfx = seg_len > 0 and seg_len < voice_dur
                    else:
                        loop_sfx = True
                except Exception:
                    loop_sfx = True

            if sfx_for_mix:
                logger.info(
                    f"🎛️ Mixing SFX background | path={sfx_for_mix} | "
                    f"trim=({start},{end}) | loop={loop_sfx} | gain_db={sfx_gain_db}"
                )
                mixed = self._mix_with_sfx(
                    out_wav,
                    sfx_for_mix,
                    gain_db=int(sfx_gain_db),
                    loop_sfx=loop_sfx,
                    trim_start=start,
                    trim_end=end
                ) if _PYDUB_OK else out_wav
                if (not _PYDUB_OK) or mixed == out_wav:
                    mixed = self._mix_with_sfx_ffmpeg(
                        out_wav,
                        sfx_for_mix,
                        gain_db=int(sfx_gain_db),
                        loop_sfx=loop_sfx,
                        trim_start=start,
                        trim_end=end
                    )
                if mixed and os.path.exists(mixed):
                    final_wav = mixed

            # 4) encrypt result (use final_wav which may be mixed)
            out_enc = self._encrypt_out(final_wav, dest_dir=output_dir)
            return True, out_enc, None, False

        except Exception as e:
            if out_enc and os.path.exists(out_enc):
                logger.warn(f"⚠️ post-success exception ignored (output preserved): {type(e).__name__}: {e}")
                return True, out_enc, None, False
            logger.exception("❌ cloner exception")
            return False, None, str(e), False

        finally:
            # cleanup temps (keep encrypted result & workspace)
            for p in (wav_content, wav_ref, out_wav_fixed, dec_content, dec_ref, dec_sfx, wav_sfx, *sfx_paths):
                try:
                    if p and os.path.exists(p): os.remove(p)
                except Exception:
                    pass
            # If we created a mixed temp (…with_sfx.wav), it sits next to out_wav; safe to remove.
            try:
                if 'final_wav' in locals() and final_wav and final_wav != out_wav and os.path.exists(final_wav):
                    os.remove(final_wav)
            except Exception:
                pass
