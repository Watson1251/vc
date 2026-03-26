import os
from pydub import AudioSegment

def convert_to_wav(file_path, config=None):
    """Convert any audio format to WAV."""
    audio = AudioSegment.from_file(file_path)
    wav_path = file_path.replace(file_path.split(".")[-1], "wav")
    if config and config.get("debug", False):
        return file_path
    else:
        audio.export(wav_path, format="wav")
    audio.export(wav_path, format="wav")
    return wav_path