from pydub import AudioSegment


# Load voice and background sound
voice = AudioSegment.from_file("/data/db/files/DATA/REFF_VOICE/1234.wav")
background = AudioSegment.from_file("/app/engines/vc/TEMP/requests/music.mp3")


# Adjust background length to match voice length
if len(background) < len(voice):
    background = background * (len(voice) // len(background) + 1)
background = background[:len(voice)]

# Reduce background volume (-15 dB)
background = background - 15


# Overlay background onto voice
merged_audio = voice.overlay(background)

# Export the final mixed audio
merged_audio.export("output.wav", format="wav")
