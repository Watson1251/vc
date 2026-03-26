from fastapi import FastAPI
import uvicorn
from features.ref_voice import process_ref_voice
from features.sound_effect import process_sound_effect_voice
from util.addFiletoDb import move_file_to_db
import requests
import os
import logging
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from datetime import datetime
from util.toWav import convert_to_wav
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
import shutil
REFF_VOICE_TIME = 30  # seconds

app = FastAPI()
def train_model(data: dict):
    """Call the seed-vc server to train a model and return the response.
    Args:
        data (dict): Dictionary containing input parameters for training.
    Returns:
        dict: Response from the seed-vc server.
    """
    SEED_VC_URL = os.getenv("SEED_VC_URL")
    if not SEED_VC_URL:
        SEED_VC_URL = "http://seedvc-engine:6000"

    TRAIN_URL = SEED_VC_URL + "/train"


    response = requests.post(TRAIN_URL, json=data)
    if response.status_code != 200:
        print(f"Error {response.status_code}: {response.text}")  # Debugging
        raise HTTPException(status_code=500, detail=f"Error {response.status_code}: {response.text}")

    #logging.info(f"Train response: {response.status_code} - {response.json()}")

    file_type = "TRAIN"
    file_key = data["train_config"]["run_name"]
    model_path = os.path.join(data["train_config"]["training_set_dir"], file_key, "ft_model.pth")
    config_path = os.path.join(data["train_config"]["training_set_dir"], "runs",file_key, "config_dit_mel_seed_uvit_whisper_small_wavenet.yml")
    if not os.path.exists(model_path) or not os.path.exists(config_path):
        logging.error(f"Output file {model_path} or/and {config_path} does not exist.")
        raise HTTPException(status_code=500, detail=f"Output file {model_path} or/and {config_path} does not exist.") 
    config_key = data["train_config"]["run_name"] + "_config"
    move_model = move_file_to_db(model_path, file_type, file_key, config={ "debug_mode": False})
    move_config = move_file_to_db(config_path, file_type, config_key, config={ "debug_mode": False})
    # delete the training directory to save space
    training_dir = data["train_config"]["training_directory"]
    if os.path.exists(training_dir):
        try:
            
            shutil.rmtree(training_dir)
            logging.info(f"Training directory {training_dir} deleted successfully.")
        except Exception as e:
            logging.error(f"Error deleting training directory {training_dir}: {e}")
    else:
        logging.warning(f"Training directory {training_dir} does not exist, nothing to delete.")    
    
    
    response_data = {
        "status": "success",
        "message": "Model trained successfully.",
        "model_path": move_model.get("file_path"),
        "config_path": move_config.get("file_path"),
        "model_key": file_key,
        "config_key": config_key
    }
    return response_data
def clean_audio(data: dict):
    """Call the seed-vc server to clean audio and return the response.
    Args:
        data (dict): Dictionary containing input parameters for cleaning the audio.
    Returns:
        dict: Response from the seed-vc server.
    """
    SEED_VC_URL = os.getenv("SEED_VC_URL")
    if not SEED_VC_URL:
        SEED_VC_URL = "http://seedvc-engine:6000"

    CLEAN_AUDIO_URL = SEED_VC_URL + "/clean_audio"

    response = requests.post(CLEAN_AUDIO_URL, json=data)

    if response.status_code == 200:
        return response.json()
    else:
        return {"status": "error", "message": f"Error {response.status_code}: {response.text}"}

def add_sound_effect_from_seed_vc(data: dict):
    """Call the seed-vc server to add sound effect and return the response.
    Args:
        data (dict): Dictionary containing input parameters for the sound effect.
    Returns:
        dict: Response from the seed-vc server.
    """
    SEED_VC_URL = os.getenv("SEED_VC_URL")
    if not SEED_VC_URL:
        SEED_VC_URL = "http://seedvc-engine/:6000"

    SOUND_EFFECT_URL = SEED_VC_URL + "/add_sound_effect"

    response = requests.post(SOUND_EFFECT_URL, json=data)

    if response.status_code == 200:
        return response.json()
    else:
        return {"status": "error", "message": f"Error {response.status_code}: {response.text}"}

def get_cloned_accuracy(data: dict):
    """Get cloned accuracy using the NEMO engine's get_similarity interface.
    Args:
        data (dict): Dictionary containing audio_file_1 and audio_file_2.
    Returns:
        dict: Response from the NEMO engine containing similarity results.
    """
    NEMO_URL = os.getenv("NEMO_URL")
    if not NEMO_URL:
        NEMO_URL = "http://nemo-engine:5000"

    NEMO_URL_SIMILARITY = NEMO_URL + "/get_similarity"

    response = requests.post(NEMO_URL_SIMILARITY, json=data)


    
    if response.status_code != 200:
        print(f"Error {response.status_code}: {response.text}")  # Debugging
        raise HTTPException(status_code=500, detail=f"Error {response.status_code}: {response.text}")

    try:
        return response.json()
    except requests.exceptions.JSONDecodeError:
        print("Invalid JSON response received")  # Debugging
        return {"status": "error", "message": "Invalid JSON response"}
  
def verify_speakers(data: dict):
    """Verify sounds using the NEMO engine.
    Args:
        data (dict): Dictionary containing audio_file_1, audio_file_2, key, and debug flag.
    Returns:
        dict: Response from the NEMO engine.
    """
    NEMO_URL = os.getenv("NEMO_URL")
    if not NEMO_URL:
        NEMO_URL = "http://nemo-engine:5000"

    NEMO_URL_VERIFY_SPEAKER = NEMO_URL + "/verify_speaker"

    nemo_response = requests.post(NEMO_URL_VERIFY_SPEAKER, json=data)

    if nemo_response.status_code == 200:
        return nemo_response.json()
    else:
        return {"status": "error", "message": f"Error {nemo_response.status_code}: {nemo_response.json()}"}

def add_sound_effect(data: dict):
    """Add sound effect to the input file.
    Args:
        data (dict): Dictionary containing key, input_file_path, and optional config.
    """
    key = data.get("key")
    input_file_path = data.get("input_file_path")
    config = data.get("config", {})

    if not key or not input_file_path:
        return {"status": "500", "message": "Missing required parameters: key or input_file_path."}

    output = process_sound_effect_voice(key, input_file_path)
    if output == "500":
        return {"status": "500", "message": "File processing failed."}
    else:
        # Move the processed file to the DB
        file_type = "SOUND_EFFECT"
        file_key = key
        move_status = move_file_to_db(output, file_type, file_key, config)
    logging.info(f"Move status: {move_status}")
    return move_status 

def add_ref_voice(data: dict):
    """Add reference voice to the input file.
    Args:
        data (dict): Dictionary containing key, input_file_path, and optional config.
    """
    key = data.get("key",)
    input_file_path = data.get("input_file_path")
    config = data.get("config", {})

    if not key or not input_file_path:
        return {"status": "500", "message": "Missing required parameters: key or input_file_path."}

    config["segment_duration"] = REFF_VOICE_TIME
    output = process_ref_voice(key, input_file_path, config)

    if output == "500":
        return {"status": "500", "message": "File processing failed."}
    else:
        # Move the processed file to the DB
        file_type = "REFF_VOICE"
        file_key = key
        move_status = move_file_to_db(output, file_type, file_key, config)
    return move_status

def add_reff_voice_(key, input_file_path, config=None):
    """Add reference voice to the input file.
    Args:
        key (str): Key to identify the input file.
        input_file_path (str): Path to the input audio file.
        config (dict): Configuration dictionary containing segment_duration for processing.
    """

    config = config or {}
    config["segment_duration"] = REFF_VOICE_TIME
    output = process_ref_voice(key, input_file_path, config)
    print(config)
    if output == "500":
        return {"status": "error", "message": "File processing failed."}
    else:
        # Move the processed file to the DB
        # Assuming move_file_to_db is a function that moves the file to the DB
         file_type = "REFF_VOICE"
         file_key = key
         move_status = move_file_to_db(output, file_type, file_key, config)
         if move_status != 0:
             return {"status": "error", "message": "."}
         else:
             return {"status": "success", "message": "File moved successfully with file path: {output}."}

def clone_voice(data: dict, config=None):
    """Clone voice using the provided files and configuration.
    Args:
        voice_files (list): List of voice files to be cloned.
        clone_config (dict): Configuration dictionary for cloning.
    """
    #url = SEED_VC_URL
    SEED_VC_URL = os.getenv("SEED_VC_URL")
    if not SEED_VC_URL:
        SEED_VC_URL = "http://seedvc-engine:6000"

    SEED_VC_URL = SEED_VC_URL + "/clone"

    response = requests.post(SEED_VC_URL, json=data)

    if response.status_code == 200:
        print("Response:", response.json())
    else:
        print(response.text)
        print("Error:", response.status_code, response.json())
    return response.json()
def secure_file(data: dict, config=None):
    """Secure interface to process files using the seed-vc engine.
    Args:
        input_file (str): Path to the input file.
        output_file (str): Path to the output file.
    Returns:
        dict: Response from the seed-vc engine.
    """
    SEED_VC_URL = os.getenv("SEED_VC_URL")
    if not SEED_VC_URL:
        SEED_VC_URL = "http://seedvc-engine:6000"

    SECURE_INTERFACE_URL = SEED_VC_URL + "/secure_interface"

    
    response = requests.post(SECURE_INTERFACE_URL, json=data)

    # Ensure the secured file is a .wav file
    secured_file_path = response.json().get("secured_file_path")
    if secured_file_path and not secured_file_path.lower().endswith(".wav"):
        wav_file_path = convert_to_wav(secured_file_path)
        if wav_file_path:
            response_json = response.json()
            response_json["secured_file_path"] = wav_file_path
            return response_json
        else:
            return {"status": "error", "message": "Failed to convert secured file to WAV format."}

    if response.status_code == 200:
        return response.json()
    else:
        return {"status": "error", "message": f"Error {response.status_code}: {response.json()}"}

def clone_engine(data: dict):
    """
    Clone voice, verify speakers, add sound effect, then secure file.
    Args:
        args (dict): {
            "ref_voice_path": str,
            "content_voice_path": str,
            "output_path": str,
            "model_path": str,
            "config_path": str,
            "sound_effect_file": str,
            "sound_effect_output_dir": str,
            "sound_effect_volume_reduction": int,
            "secure_debug": bool,
            "key": str
        }
    Returns:
        dict: Results from each step.
    """
    ref_voice_path = data.get("ref_voice_path")
    clone_result = clone_voice(data)
    file_path = clone_result.get("cloned_file_path", data.get("output_path"))

    # 2. Verify speakers
    verify_data = {
        "audio_file_1": file_path,
        "audio_file_2": ref_voice_path,
        "debug": False
    }
    verify_result = verify_speakers(verify_data)
    # If verify_result is a tuple (response, status_code), extract the JSON
    if isinstance(verify_result, tuple):
        verify_result_json = verify_result[0].json if hasattr(verify_result[0], "json") else verify_result[0]
    else:
        verify_result_json = verify_result

    # 3. Add sound effect
    if data.get("add_sound_effect", False) and data.get("sound_effect_path"):
        sound_effect_data = {
            "voice_file" : file_path,
            "sound_effect_path": data.get("sound_effect_path"),
            "output_dir": data.get("output_path"),
            "background_volume_reduction": data.get("background_volume_reduction", -15),
            "targetId": data.get("targetId", "default_key"),
            }
        sound_effect_result = add_sound_effect_from_seed_vc(sound_effect_data)
        file_path = sound_effect_result.get("voice_merged_with_sound_effect", file_path)
    
    # 4. Secure file
    secure_data = {
        "input_file": file_path,
        "output_path": data.get("output_path"),
        "targetId": data.get("targetId", "default_key"),
        "debug": data.get("secure_debug", False)
    }

    secure_result = secure_file(secure_data)
    file_path = secure_result.get("secured_file_path", file_path)
    
    if secure_result.get("status") == "error":
        logging.error(f"Error securing file: {secure_result.get('message')}")
        raise HTTPException(status_code=500, detail=f"Error securing file: {secure_result.get('message')}")     

    # 5. move the cloned file to the database , rename file withe targetId_timestamp
    file_type = "CLONED_VOICE"
    file_key = data.get("targetId", "default_key")
    timestamp = int(datetime.now().timestamp())
    cloned_file_path = move_file_to_db(file_path, file_type, f"{file_key}_{timestamp}", config={"debug_mode": True}).get("file_path", file_path)      

    return {
        "cloned_file_path": cloned_file_path,
        "isClonedSameRef": verify_result_json.get("isClonedSameRef"),
        "similarity_percentage": verify_result_json.get("similarity_percentage"),
        #"sound_effect_file_path": sound_effect_file_path,
        #"secured_file_path": secure_result.get("secured_file_path", sound_effect_file_path),
        "status": clone_result.get("status", "success"),
    }

@app.post("/clone_voice")
def clone_voice_endpoint(data: dict):
    """Endpoint to clone voice."""
    return clone_engine(data)

@app.post("/add_ref_voice")
def add_ref_voice_endpoint(data: dict):
    """Endpoint to add reference voice."""
    return add_ref_voice(data)

@app.post("/add_sound_effect")
def add_sound_effect_endpoint(data: dict):
    """Endpoint to add sound effect."""
    return add_sound_effect(data)

@app.post("/verify_speakers")
def verify_speakers_endpoint(data: dict):
    """Endpoint to verify speakers."""
    return verify_speakers(data)

@app.post("/train")
def train_model_endpoint(data: dict):
    """Endpoint to train a model."""
    return train_model(data)

@app.get("/")
def read_root():
    return {"message": "Hello, FastAPI!"}


def test_main():
    #uvicorn.run(app, host="0.0.0.0", port=8080)

    # test train
    test_config = {
        "pipeline_config": {
            "raw_audio_folder": "/data/db/files/STAGING/TRAIN/ROW/412a1022b5a21dc73a28cd2b6b20387f",
            "target_voice_path": "/data/db/files/DATA/REFF_VOICE/75a9f2d94b5c6bb1893624c9422cc1c9.wav",
            "target_embedding_path": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f/embedding_file.npy",
            "dataset_folder": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f"
            # Optionally include: resampled_folder, chunk_folder, dataset_folder, etc.
        },
        "train_config": {
            "config_file": "configs/presets/config_dit_mel_seed_uvit_whisper_small_wavenet.yml",
            "run_name": "412a1022b5a21dc73a28cd2b6b20387f",
            "batch_size": 4,
            "max_steps": 200,
            "max_epochs": 1000,
            "save_every": 100,
            "num_workers": 2,
            "training_directory": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f",
            "training_set_dir" : "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f/chunks",
        }

    }
    result = train_model(test_config)
    print(result)

    # Test the add_reff_voice function directly
    # reff_data = {"key" : "1234",
    #         "input_file_path" : "/data/db/files/STAGING/REFF_VOICE/ROW/faisal_alqasim_sub.wav",
    # }
    # reff_result = add_reff_voice(reff_data)
    # reff_voice_path = reff_result.get("file_path", None)
    # print(f"Reference voice file path: {reff_voice_path}")

    # clone_data = {
    #         "source": "/data/db/files/STAGING/CLONE/ROW/target/Yaser_Alhuzaimi.mp3",
    #         "target": reff_voice_path,
    #         "output": "/data/db/files/STAGING/CLONE/CLONED",
    #         "checkpoint": "/data/db/files/DATA/MODELS/my_target/ft_model.pth",
    #         "config": "/data/db/files/DATA/MODELS/my_target/config_dit_mel_seed_uvit_whisper_small_wavenet.yml",
    #         "diffusion_steps": 25,
    #         "length_adjust": 1.0,
    #         "inference_cfg_rate": 0.7,
    #         "key": reff_data["key"],
    #     }
    
    # cloned_file_result = clone_voice(clone_data)
    # clone_file_path = cloned_file_result.get("output_path", None)

    
    # # exit() 
    # secured_file = "/data/db/files/STAGING/CLONE/SECURED"
    # secure_response = secure_file(clone_file_path, secured_file, config={"debug": False})
    # secured_output_file = secure_response.get("file_path", None)
    # if secure_response.get("status") == "error":
    #     print(f"Error securing file: {secure_response.get('message')}")
    # else:
    #     print(f"File secured successfully: {secure_response}")

    # fake_data = { "audio_file_1": secured_output_file,
    #              "audio_file_2": reff_voice_path}
    # isFake = verify_speakers(fake_data)
    # print(f"Is the voice look Real? {isFake}")

    # accuracy = get_cloned_accuracy(fake_data)
    # print(f"Cloned accuracy: {accuracy}")
    

    # sound_effect_data = {
    #     "voice_file": secured_output_file,
    #     "background_file": "/data/db/files/DATA/SOUND_EFFECT/music.mp3",
    #     "output_dir": "/data/db/files/STAGING/CLONE/DONE",
    #     "background_volume_reduction": -15
    # }

    # sound_effect_result = add_sound_effect_from_seed_vc(sound_effect_data)
    # if sound_effect_result.get("status") == "failure":
    #     print(f"Error adding sound effect: {sound_effect_result.get('error')}")
    # else:
    #     print(f"Sound effect added successfully: {sound_effect_result.get('output_path')}")
    

    # input_file = "/data/db/files/STAGING/PROCESS/CLEAN/vc_1234_Yaser_Alhuzaimi_1234_1.0_25_0.7_secured_with_sound_effect.wav"

    # clean_audio_data = {"input_file": input_file}
    # clean_audio_result = clean_audio(clean_audio_data)
    # if clean_audio_result.get("status") == "error":
    #     print(f"Error cleaning audio: {clean_audio_result.get('message')}")
    # else:
    #     print(f"Audio cleaned successfully: {clean_audio_result}")
if __name__ == "__main__":
    # test_main()
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=True)
    #test_main()
    #uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=True)