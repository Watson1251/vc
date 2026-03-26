# vc/src/audio_preprocessor.py
import os
import sys
import math
import subprocess
from typing import List, Tuple, Optional

# Logger
if "/logger" not in sys.path:
    sys.path.insert(0, "/logger")
from logger import AppLogger

logger = AppLogger()


class AudioPreprocessor:
    """
    Utilities for validating media, converting to standardized WAV, splitting, and segmenting.

    - check_integrity(path) -> bool
    - get_duration(path) -> float | None
    - convert_to_wav(in_path, output_path=None, overwrite=True) -> str
    - ensure_wav_inplace(path) -> str
    - split_audio_file(in_path, output_folder, chunk_size) -> None
    - segment_audio(in_path, start_sec, end_sec, out_path=None, overwrite=True) -> str
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        channels: int = 1,
        sample_fmt: str = "s16",
        ffmpeg_loglevel: str = "error",
    ):
        self.sample_rate = int(sample_rate)
        self.channels = int(channels)
        self.sample_fmt = str(sample_fmt)
        self.ffmpeg_loglevel = ffmpeg_loglevel

    # ---------------------------
    # Validation / Probing
    # ---------------------------

    def check_integrity(self, file_path: str) -> bool:
        logger.info(f"🧪 Checking file integrity: {file_path}")
        if not file_path or not os.path.exists(file_path):
            logger.error(f"❌ Path missing or not found: {file_path}")
            return False

        try:
            subprocess.run(
                ["ffmpeg", "-v", "error", "-i", file_path, "-f", "null", "-"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
            logger.info("✅ File integrity check passed.")
            return True
        except subprocess.CalledProcessError:
            logger.error(f"❌ Invalid/unsupported media. FFmpeg failed on: {file_path}")
            return False

    def get_duration(self, file_path: str) -> Optional[float]:
        if not file_path or not os.path.exists(file_path):
            logger.error(f"❌ get_duration: path not found: {file_path}")
            return None

        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1",
            file_path,
        ]
        try:
            out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True).strip()
            dur = float(out)
            if math.isfinite(dur) and dur > 0:
                return dur
            return None
        except Exception as e:
            logger.error(f"❌ ffprobe failed for {file_path}: {e}")
            return None

    def _probe_audio_stream(self, file_path: str) -> Optional[Tuple[str, int, int]]:
        """Returns (sample_fmt, sample_rate, channels) for the FIRST audio stream, or None."""
        try:
            out = subprocess.check_output(
                [
                    "ffprobe", "-v", "error",
                    "-select_streams", "a:0",
                    "-show_entries", "stream=sample_fmt,sample_rate,channels",
                    "-of", "default=nw=1:nk=1",
                    file_path,
                ],
                stderr=subprocess.STDOUT,
                text=True,
            ).strip().splitlines()
            if len(out) >= 3:
                fmt = out[0].strip()
                sr = int(out[1].strip())
                ch = int(out[2].strip())
                return (fmt, sr, ch)
        except Exception:
            pass
        return None

    def _is_standard_wav(self, file_path: str) -> bool:
        """True if already mono, 16k, s16."""
        info = self._probe_audio_stream(file_path)
        if not info:
            return False
        fmt, sr, ch = info
        return (fmt == self.sample_fmt and sr == self.sample_rate and ch == self.channels)

    def ensure_wav_inplace(self, path: str) -> str:
        """
        Ensures 'path' is mono/16k/s16 WAV. If already correct and *.wav, returns as-is.
        Otherwise, writes <base>.wav next to it and returns that path.
        """
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        if self._is_standard_wav(path) and path.lower().endswith(".wav"):
            return path
        base, _ = os.path.splitext(path)
        out = f"{base}.wav"
        return self.convert_to_wav(path, output_path=out, overwrite=True)

    def split_audio_file(self, input_audio: str, output_folder: str, chunk_size: int) -> None:
        """Split an audio file into chunks of 'chunk_size' seconds."""
        os.makedirs(output_folder, exist_ok=True)
        base_name = os.path.splitext(os.path.basename(input_audio))[0]
        chunk_pattern = os.path.join(output_folder, f"{base_name}_chunk_%03d.wav")
        subprocess.run([
            "ffmpeg", "-y", "-v", self.ffmpeg_loglevel, "-i", input_audio,
            "-f", "segment", "-segment_time", str(chunk_size),
            "-ac", str(self.channels), "-ar", str(self.sample_rate), "-sample_fmt", self.sample_fmt,
            "-reset_timestamps", "1", chunk_pattern
        ], check=True)

    # ---------------------------
    # Core transforms
    # ---------------------------

    def convert_to_wav(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        overwrite: bool = True,
    ) -> str:
        """
        Converts any supported media (audio/video) to mono 16k WAV (s16).
        - If input already matches target format: returns input_path (no re-encode).
        - If output resolves to same as input: write to a safe sibling '<name>.conv.wav'.
        """
        if not input_path or not os.path.exists(input_path):
            raise FileNotFoundError(f"convert_to_wav: input not found: {input_path}")

        if input_path.lower().endswith(".enc"):
            raise ValueError(f"Encrypted input given to FFmpeg: {input_path}")

        if not self.check_integrity(input_path):
            raise ValueError(f"convert_to_wav: integrity check failed: {input_path}")

        if self._is_standard_wav(input_path):
            logger.info("🎧 Input already mono/16k/s16 — skipping re-encode.")
            return input_path

        # Derive output path
        if output_path is None:
            base, _ = os.path.splitext(input_path)
            output_path = f"{base}.wav"

        # Ensure output != input
        if os.path.abspath(output_path) == os.path.abspath(input_path):
            base, _ = os.path.splitext(input_path)
            output_path = f"{base}.conv.wav"

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        if os.path.exists(output_path) and not overwrite:
            logger.info(f"ℹ️ convert_to_wav: output exists and overwrite=False -> {output_path}")
            return output_path

        cmd = [
            "ffmpeg",
            "-y" if overwrite else "-n",
            "-v", self.ffmpeg_loglevel,
            "-i", input_path,
            "-ac", str(self.channels),
            "-ar", str(self.sample_rate),
            "-sample_fmt", self.sample_fmt,
            output_path,
        ]

        logger.info(f"🎧 Converting to WAV: {input_path} -> {output_path}")
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or e.stdout or str(e)).strip()
            logger.error(f"❌ convert_to_wav failed: {msg}")
            raise

        if not os.path.exists(output_path):
            raise RuntimeError(f"convert_to_wav: ffmpeg reported success but file missing: {output_path}")

        logger.info(f"✅ WAV ready: {output_path}")
        return output_path

    def segment_audio(
        self,
        input_path: str,
        start_sec: float,
        end_sec: float,
        output_path: Optional[str] = None,
        overwrite: bool = True,
    ) -> str:
        if not input_path or not os.path.exists(input_path):
            raise FileNotFoundError(f"segment_audio: input not found: {input_path}")

        if not isinstance(start_sec, (int, float)) or not isinstance(end_sec, (int, float)):
            raise ValueError("segment_audio: start_sec and end_sec must be numbers")

        if start_sec < 0:
            raise ValueError("segment_audio: start_sec must be >= 0")
        if end_sec <= start_sec:
            raise ValueError("segment_audio: end_sec must be > start_sec")

        if not self.check_integrity(input_path):
            raise ValueError(f"segment_audio: integrity check failed: {input_path}")

        duration = self.get_duration(input_path)
        if duration is None:
            raise ValueError("segment_audio: unable to probe duration")
        if start_sec >= duration:
            raise ValueError(f"segment_audio: start_sec ({start_sec}) >= duration ({duration:.3f})")

        end_sec = min(end_sec, duration)
        seg_len = max(0.0, end_sec - start_sec)
        if seg_len <= 0:
            raise ValueError("segment_audio: computed segment length <= 0 after clamping")

        if output_path is None:
            base, _ = os.path.splitext(input_path)
            output_path = f"{base}_{int(start_sec)}_{int(end_sec)}.wav"

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        cmd = [
            "ffmpeg",
            "-y" if overwrite else "-n",
            "-v", self.ffmpeg_loglevel,
            "-ss", f"{start_sec:.3f}",
            "-t", f"{seg_len:.3f}",
            "-i", input_path,
            "-ac", str(self.channels),
            "-ar", str(self.sample_rate),
            "-sample_fmt", self.sample_fmt,
            output_path,
        ]

        logger.info(f"✂️ Segmenting {input_path} [{start_sec:.3f}, {end_sec:.3f}) -> {output_path}")
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or e.stdout or str(e)).strip()
            logger.error(f"❌ segment_audio failed: {msg}")
            raise

        if not os.path.exists(output_path):
            raise RuntimeError(f"segment_audio: ffmpeg reported success but file missing: {output_path}")

        logger.info(f"✅ Segment ready: {output_path}")
        return output_path
