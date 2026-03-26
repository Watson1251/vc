import hashlib
import os
from datetime import datetime
from fastapi import FastAPI
import uvicorn
from features.ref_voice import process_reff_voice
from features.sound_effect import process_sound_effect_voice
from util.addFiletoDb import move_file_to_db
from util.hash_file_name import generate_hashed_filename
import requests

REFF_VOICE_TIME = 20  # seconds

app = FastAPI()




import hashlib
import os
from datetime import datetime
import requests
from fastapi import FastAPI
import uvicorn
from features.ref_voice import process_reff_voice
from features.sound_effect import process_sound_effect_voice
from util.addFiletoDb import move_file_to_db

REFF_VOICE_TIME = 20  # Reference voice duration in seconds

app = FastAPI()

# ----------------------------------------------
# Utility Function: Generate Hashed Filename
# ----------------------------------------------
def generate_hashed_filename(file_path):
    """Generate a hashed filename with dashes based on timestamp."""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    hash_object = hashlib.sha256(timestamp.encode())
    hash_hex = hash_object.hexdigest()
    
    # Format hash with dashes
    hashed_with_dashes = "-".join(hash_hex[i:i+8] for i in range(0, len(hash_hex), 8))
    
    return hashed_with_dashes  # No file extension needed, used for directory naming

# ----------------------------------------------
# API: Process Reference Voice
# ----------------------------------------------
@app.post("/add_reff_voice")
def add_reff_voice(data: dict):
    """Add reference voice and move it to the database."""
    try:
        key = data.get("key")
        input_file_path = data.get("input_file_path")

        if not key or not input_file_path:
            return {"status": "error", "message": "Missing required parameters: key or input_file_path."}

        # Hash directory name instead of file name
        hashed_dir = generate_hashed_filename(input_file_path)
        output_dir = os.path.join("/data/db/files/STAGING/REFF_VOICE/HASHED", hashed_dir)
        os.makedirs(output_dir, exist_ok=True)  # Create directory instead of renaming file

        config = {"segment_duration": REFF_VOICE_TIME}
        output = process_reff_voice(key, input_file_path, config)

        if output == "500":
            return {"status": "error", "message": "File processing failed due to an internal error."}
        
        move_status = move_file_to_db(output, "REFF_VOICE", key, config)
        
        if move_status != 0:
            return {"status": "error", "message": "Failed to move the processed file to the database."}

        return {"status": "success", "message": "Reference voice processed successfully.", "output_directory": output_dir}
    
    except Exception as e:
        return {"status": "error", "message": "Unexpected error occurred while processing reference voice.", "details": str(e)}

# ----------------------------------------------
# API: Clone Voice
# ----------------------------------------------
@app.post("/clone_voice")
def clone_voice(data: dict):
    """Clone voice using the Seed-VC engine."""
    try:
        SEED_VC_URL = os.getenv("SEED_VC_URL", "http://seedvc-engine:6000/inference")

        response = requests.post(SEED_VC_URL, json=data)
        
        if response.status_code != 200:
            return {"status": "error", "message": "Voice cloning failed due to an API error.", "details": response.text}
        
        return response.json()

    except Exception as e:
        return {"status": "error", "message": "Unexpected error occurred while cloning voice.", "details": str(e)}

# ----------------------------------------------
# API: Secure File Processing
# ----------------------------------------------
@app.post("/secure_file")
def secure_file(data: dict):
    """Secure a file using the Seed-VC engine."""
    try:
        SEED_VC_URL = os.getenv("SEED_VC_URL", "http://seedvc-engine:6000/secure_interface")

        response = requests.post(SEED_VC_URL, json=data)

        if response.status_code != 200:
            return {"status": "error", "message": "File securing failed due to an API error.", "details": response.text}

        output_dir = os.path.join("/data/db/files/STAGING/CLONE/SECURED", generate_hashed_filename(data["input_file"]))
        os.makedirs(output_dir, exist_ok=True)

        return {"status": "success", "message": "File secured successfully.", "output_directory": output_dir}

    except Exception as e:
        return {"status": "error", "message": "Unexpected error occurred while securing file.", "details": str(e)}

# ----------------------------------------------
# API: Verify Speakers
# ----------------------------------------------
@app.post("/verify_speakers")
def verify_speakers(data: dict):
    """Verify speakers using the NEMO engine."""
    try:
        NEMO_URL = os.getenv("NEMO_URL", "http://nemo-engine:5000/verify_speaker")

        response = requests.post(NEMO_URL, json=data)

        if response.status_code != 200:
            return {"status": "error", "message": "Speaker verification failed due to an API error.", "details": response.text}

        return response.json()
    
    except Exception as e:
        return {"status": "error", "message": "Unexpected error occurred during speaker verification.", "details": str(e)}

# ----------------------------------------------
# API: Clean Audio
# ----------------------------------------------
@app.post("/clean_audio")
def clean_audio(data: dict):
    """Clean audio using the Seed-VC engine."""
    try:
        SEED_VC_URL = os.getenv("SEED_VC_URL", "http://seedvc-engine:6000/clean_audio")

        response = requests.post(SEED_VC_URL, json=data)

        if response.status_code != 200:
            return {"status": "error", "message": "Audio cleaning failed due to an API error.", "details": response.text}

        output_dir = os.path.join("/data/db/files/STAGING/PROCESS/CLEAN", generate_hashed_filename(data["input_file"]))
        os.makedirs(output_dir, exist_ok=True)

        return {"status": "success", "message": "Audio cleaned successfully.", "output_directory": output_dir}

    except Exception as e:
        return {"status": "error", "message": "Unexpected error occurred while cleaning audio.", "details": str(e)}

# ----------------------------------------------
# Root Endpoint
# ----------------------------------------------


if __name__ == "__main__":
    # Test `add_reff_voice`
    raw_input_file = "/data/db/files/STAGING/REFF_VOICE/ROW/faisal_alqasim_sub.wav"
    hashed_filename = generate_hashed_filename(raw_input_file)
    hashed_file_path = os.path.join("/data/db/files/STAGING/REFF_VOICE/HASHED", hashed_filename)
    
    os.rename(raw_input_file, hashed_file_path)  # Move file with new name
    
    reff_data = {
        "key": "1234",
        "input_file_path": hashed_file_path
    }
    
    reff_result = add_reff_voice(reff_data)
    reff_voice_path = reff_result.get("file_path", None)
    print(f"Reference voice file path: {reff_voice_path}")

    # Clone voice processing
    clone_data = {
        "source": "/data/db/files/STAGING/CLONE/ROW/target/Yaser_Alhuzaimi.mp3",
        "target": reff_voice_path,
        "output": "/data/db/files/STAGING/CLONE/CLONED",
        "checkpoint": "/data/db/files/DATA/MODELS/my_target/ft_model.pth",
        "config": "/data/db/files/DATA/MODELS/my_target/config_dit_mel_seed_uvit_whisper_small_wavenet.yml",
        "diffusion_steps": 25,
        "length_adjust": 1.0,
        "inference_cfg_rate": 0.7,
        "key": reff_data["key"]
    }
    
    cloned_file_result = clone_voice(clone_data)
    clone_file_path = cloned_file_result.get("output_path", None)

    # Secure file processing
    secured_folder = "/data/db/files/STAGING/CLONE/SECURED"
    secure_response = secure_file(clone_file_path, secured_folder, config={"debug": False})
    secured_output_file = secure_response.get("file_path", None)
    
    if secure_response.get("status") == "error":
        print(f"Error securing file: {secure_response.get('message')}")
    else:
        print(f"File secured successfully: {secure_response}")

    # Speaker verification
    verification_data = {
        "audio_file_1": secured_output_file,
        "audio_file_2": reff_voice_path
    }
    
    is_real_voice = verify_speakers(verification_data)
    print(f"Is the voice real? {is_real_voice}")

    clone_accuracy = get_cloned_accuracy(verification_data)
    print(f"Cloned accuracy: {clone_accuracy}")

    # Add sound effect
    sound_effect_data = {
        "voice_file": secured_output_file,
        "background_file": "/data/db/files/DATA/SOUND_EFFECT/music.mp3",
        "output_dir": "/data/db/files/STAGING/CLONE/DONE",
        "background_volume_reduction": -15
    }

    sound_effect_result = add_sound_effect_from_seed_vc(sound_effect_data)
    
    if sound_effect_result.get("status") == "failure":
        print(f"Error adding sound effect: {sound_effect_result.get('error')}")
    else:
        print(f"Sound effect added successfully: {sound_effect_result.get('output_path')}")

    # Clean processed audio
    cleaned_audio_filename = os.path.basename(secured_output_file).replace(".wav", "_cleaned.wav")
    cleaned_audio_path = os.path.join("/data/db/files/STAGING/PROCESS/CLEAN", cleaned_audio_filename)
    
    clean_audio_data = {"input_file": secured_output_file}
    clean_audio_result = clean_audio(clean_audio_data)
    
    if clean_audio_result.get("status") == "error":
        print(f"Error cleaning audio: {clean_audio_result.get('message')}")
    else:
        os.rename(secured_output_file, cleaned_audio_path)  # Move file to CLEAN folder
        print(f"Audio cleaned successfully: {cleaned_audio_path}")