from flask import Flask, request, jsonify

import subprocess
import requests
import uvicorn
import os
import re
from pydub import AudioSegment
from VoiceProcessingPipeline import train
from VoiceProcessingPipeline import VoiceProcessingPipeline
import logging
import json
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)


@app.route('/train', methods=['POST'])
def train_endpoint():
    try:
        # Get input data as JSON
        data = request.get_json()
        logging.info("Received training request: %s", data)

        if not data:
            return jsonify({"error": "No input data provided", "status": "failure"}), 400

        # Extract necessary configurations
        pipeline_config = data.get("pipeline_config")
        train_config = data.get("train_config", {})

        if not pipeline_config:
            return jsonify({"error": "Missing required parameter: pipeline_config", "status": "failure"}), 400
        if not train_config:
            return jsonify({"error": "Missing required parameter: train_config", "status": "failure"}), 400

        config_file = train_config.get("config_file", "configs/presets/config_dit_mel_seed_uvit_whisper_small_wavenet.yml")
        dataset_dir = train_config.get("training_directory")
        run_name = train_config.get("run_name", "my_target")
        batch_size = train_config.get("batch_size", 4)
        max_steps = train_config.get("max_steps", 200)
        max_epochs = train_config.get("max_epochs", 1000)
        save_every = train_config.get("save_every", 100)
        num_workers = train_config.get("num_workers", 2)
        training_directory = train_config.get("training_directory")
        training_set_dir = train_config.get("training_set_dir", os.path.join(dataset_dir, 'chunks'))
        status = train(pipeline_config)
        logging.info("Pipeline completed successfully: %s", status)
        
        if int(status['status']) != 200:
           return jsonify({"error": status['message'], "status": status['status']}), int(status['status'])
            
        #make sure there is files in training_set_dir
        if not os.path.exists(training_set_dir) or not os.listdir(training_set_dir):
            return jsonify({"error": f"No files found in training_set_dir: {training_set_dir}", "status": "failure"}), 400

        train_command = (
            f"python3 train.py --config {config_file} "
            f"--dataset-dir {training_set_dir} "
            f"--run-name {run_name} "
            f"--batch-size {batch_size} "
            f"--max-steps {max_steps} "
            f"--max-epochs {max_epochs} "
            f"--save-every {save_every} "
            f"--num-workers {num_workers}"
        )

        logging.info("[DEBUG] Running command: %s", train_command)

        process = subprocess.Popen(train_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=os.getcwd())

        error_message = None

        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break

            print(line, end="", flush=True)
            logging.info(line.strip())

            # Match any error line (RuntimeError, AssertionError, etc.)
            match = re.search(r'(\b\w*Error\b):?\s*(.*)', line, re.IGNORECASE)
            if match:
                error_type, error_details = match.groups()
                error_message = f"{error_type}: {error_details.strip()}"

        # Also check stderr for errors
        stderr_output = process.stderr.read()
        if stderr_output:
            match = re.search(r'(\b\w*Error\b):?\s*(.*)', stderr_output)
            if match:
                error_type, error_details = match.groups()
                error_message = f"{error_type}: {error_details.strip()}"

        process.stdout.close()
        process.stderr.close()
        process.wait()

        # Handle captured errors
        if error_message:
            logging.error("Training failed: %s", error_message)
            return jsonify({"error": error_message, "status": 500}), 500

        # Training successful
        save_path = os.path.join(training_set_dir, 'ft_model.pth')
        result = {
            "status": "200",
            "message": "Training completed successfully.",
            "file_path": save_path,
        }
        logging.info("Training completed successfully: %s", result["file_path"])
        return jsonify(result)

    except subprocess.CalledProcessError as e:
        logging.error("Subprocess error: %s", str(e))
        return jsonify({"message": str(e), "status": "501"})

    except Exception as e:
        logging.error("Unexpected error: %s", str(e))
        return jsonify({"message": str(e), "status": "502"})


@app.route('/train_v0', methods=['POST'])
def train_endpoint_v0():
    try:
        # Get input data as JSON
        data = request.get_json()
        print("train_endpoint data: ", data)
        if not data:
            return jsonify({"error": "No input data provided", "status": "failure"}), 400

        # The input data should contain a 'pipeline_config' dictionary.
        pipeline_config = data.get("pipeline_config")
        if not pipeline_config:
            return jsonify({"error": "Missing required parameter: pipeline_config", "status": "failure"}), 400
        train_config = data.get("train_config", {})
        if not train_config:
            return jsonify({"error": "Missing required parameter: train_config", "status": "failure"}), 400
        # Run the audio processing pipeline.
        logging.info("Received Starting preprocessing pipeline using: %s", pipeline_config)
        #status = train(pipeline_config)
        #logging.info("Pipeline completed successfully: %s", status)
        
        #if int(status['status']) != 200:
        #    return jsonify({"error": status['message'], "status": status['status']}), int(status['status'])

        # try:
        #     train_result = "Trained already" #train(pipeline_config)
        #     logging.info("Pipeline completed successfully: %s", train_result)
        #     # if isinstance(train_result, dict):
        #     #     return jsonify(train_result)
        #     # else:
        #     #     return jsonify({"result": train_result, "status": "success"})
        # except Exception as e:
        #     return jsonify({"error": str(e), "status": "failure"}), 500

        # Build and run the training command.
        # Optionally, the input may include a 'train_config' dictionary.
        
        config_file = train_config.get("config_file", "configs/presets/config_dit_mel_seed_uvit_whisper_small_wavenet.yml")
        dataset_dir = train_config.get("training_directory")
        run_name = train_config.get("run_name", "my_target")
        batch_size = train_config.get("batch_size", 4)
        max_steps = train_config.get("max_steps", 200)
        max_epochs = train_config.get("max_epochs", 1000)
        save_every = train_config.get("save_every", 100)
        num_workers = train_config.get("num_workers", 2)
        training_directory = train_config.get("training_directory", "../seed-vc")
        training_set_dir = train_config.get("training_set_dir", os.path.join(dataset_dir,'chunks')) 
       
        train_command = (
            f"python3 train.py --config {config_file} "
            f"--dataset-dir {training_set_dir} "
            f"--run-name {run_name} "
            f"--batch-size {batch_size} "
            f"--max-steps {max_steps} "
            f"--max-epochs {max_epochs} "
            f"--save-every {save_every} "
            f"--num-workers {num_workers}"
        )
        print("train_command: ", train_command)


        logging.info("[DEBUG] Running command: %s", train_command) 

        process = subprocess.Popen(train_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=os.getcwd())
        # Print output in real-time
        error_message = None
        while True:
            line = process.stdout.readline()
            if not line:
                break
            print(line, end="", flush=True)
            # Match any line containing something ending with 'Error' (e.g., RuntimeError, AssertionError, etc.)
            if re.search(r'\b\w*Error\b', line):
            # Extract the error message after the first occurrence of 'Error'
                error_message = line.split("Error", 1)[-1].strip()
        # Stream logs in real-time and check for RuntimeError
        if error_message:
            return jsonify({"error": error_message, "status": 500}), 500

        process.stdout.close()
        process.wait()
        
        
        save_path = os.path.join(training_set_dir, 'ft_model.pth')
        result = {
            "status": "200",
            "message": "Training completed successfully.",
            "file_path": save_path,
        }
        res = jsonify(result)
        print("Training completed successfully: ")
        logging.info("Training completed successfully: %s", result["file_path"])
        return res
    except subprocess.CalledProcessError as e:
        return jsonify({"message": e.stderr, "status": "501"})
    except Exception as e:
        return jsonify({"message": str(e), "status": "502"})


    
@app.route('/clean_audio', methods=['POST'])
def clean_audio_inference():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No input data provided", "status": "failure"}), 400
        vp_object = VoiceProcessingPipeline()
        if not vp_object:
            return jsonify({"error": "Failed to initialize VoiceProcessingPipeline", "status": "failure"}), 500
        input_file = data.get("input_file")
        cleaned_dir = data.get("cleaned_dir", ".")

        res = vp_object.clean_audio(input_file, cleaned_dir, use_gpu=True)
        if res is None:
            return jsonify({"error": "No output from clean_audio", "status": "failure"}), 500
        if isinstance(res, dict):
            return jsonify(res)
        else:
            return jsonify({"output_dir": res, "status": "200"})

    except subprocess.CalledProcessError as e:
        return jsonify({"error": e.stderr, "status": "failure"}), 500
    except Exception as e:
        return jsonify({"error": str(e), "status": "failure"}), 500


@app.route('/add_sound_effect', methods=['POST'])
def add_sound_effect():
    print("add_sound_effect ....................................")
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No input data provided", "status": "failure"}), 400
        
        voice_file = data.get("voice_file")
        background_file = data.get("sound_effect_path")
        key = data.get("targetId", "default")
        output_dir = data.get("output_dir", key)
        background_volume_reduction = data.get("background_volume_reduction", -15)

        if not voice_file or not background_file:
            return jsonify({"error": "Missing voice_file or background_file", "status": "failure"}), 400

        # Load voice and background sound
        voice = AudioSegment.from_file(voice_file)
        background = AudioSegment.from_file(background_file)

        # Adjust background length to match voice length
        if len(background_file) < len(voice_file):
            background = background * (len(voice) // len(background) + 1)
        background = background[:len(voice)]

        # Reduce background volume
        background = background + background_volume_reduction

        # Overlay background onto voice
        merged_audio = voice.overlay(background)

        # Generate output file name
        input_file_name = os.path.splitext(os.path.basename(voice_file))[0]
        output_file = os.path.join(output_dir, f"{key}_with_sound_effect.wav")

        # Export the final mixed audio
        merged_audio.export(output_file, format="wav")

        return jsonify({
            "status": "success",
            "message": "Audio files merged successfully",
            "voice_merged_with_sound_effect": output_file
        })

    except Exception as e:
        return jsonify({"error": str(e), "status": "failure"}), 500

@app.route('/secure_interface', methods=['POST'])
def secure_interface():
    try:
        data = request.json
        logging.info("Received secure interface request: %s", data)
        if not data:
            return jsonify({"error": "No input data provided", "status": "failure"}), 400
        
        input_file = data.get("input_file")
        output_file = data.get("output_path")
        key = data.get("targetId", "default")
        if not input_file or not output_file:
            logging.error("Missing input_file or output_file")
            return jsonify({"error": "Missing input_file or output_file", "status": "failure"}), 400
        input_file_name = os.path.basename(input_file)
        output_file= os.path.join(output_file, key)
        # First command
        command1 = (
            f"ffmpeg -i {input_file} -filter_complex "
            f"\"anoisesrc=color=white:duration=54.97:amplitude=0.005[a];[0:a][a]amix=inputs=2:weights=1 0.1:duration=first\" "
            f"{output_file}_noise.wav"
        )
        logging.info("Running command: %s", command1)
        subprocess.run(command1, shell=True, check=True)
        # Wait for the first command to complete and use its output as input for the second command
        
       

        # Second command
        command2 = f"ffmpeg -i {output_file}_noise.wav -c:a libmp3lame {output_file}_compressed.mp3"
        subprocess.run(command2, shell=True, check=True)

        # Rename the output file to include "_secured" in the name
        
        secured_output_file = os.path.join(
            os.path.dirname(output_file),
            f"{os.path.splitext(input_file_name)[0]}_secured.mp3"
        )
        os.rename(f"{output_file}_compressed.mp3", secured_output_file)
         # Delete the intermediate noise file if debug is False
        if not data.get("debug", False):
            os.remove(f"{output_file}_noise.wav")
        
        
        return jsonify({
            "status": "success",
            "message": "Commands executed successfully",
            "secured_file_path": secured_output_file
        })

       
    except Exception as e:
        logging.error("Error in secure_interface: %s", str(e))
        return jsonify({"error": str(e), "status": "failure"}), 500

@app.route('/clone', methods=['POST'])
def run_inference():
    try:
        data = request.json
        logging.info("Received inference request: %s", data)
        if not data:
            return jsonify({"error": "No input data provided", "status": "failure"}), 400
        
        
        diffusion_steps = data.get("diffusion_steps", 25)
        length_adjust = data.get("length_adjust", 1.0)
        inference_cfg_rate = data.get("inference_cfg_rate", 0.7)
        
        
        source_wav = data.get("content_voice_path")
        target_wav = data.get("ref_voice_path")
        output_dir = data.get("output_path", data.get("targetId", "default"))
        checkpoint = data.get("model_path")
        config = data.get("config_path")
        key = data.get("targetId")
        if not source_wav or not target_wav or not output_dir or not checkpoint or not config:
            return jsonify({"error": "Missing required parameters", "status": "failure"}), 400
        command = (
            f"python3 inference.py --source {source_wav} --target {target_wav} "
            f"--output {output_dir} --diffusion-steps {diffusion_steps} --length-adjust {length_adjust} "
            f"--inference-cfg-rate {inference_cfg_rate} --f0-condition False --auto-f0-adjust False "
            f"--semi-tone-shift 0 --checkpoint {checkpoint} --config {config} --fp16 True --key {key}" #  "
        )
        logging.info("Running command: %s", command)
        result = subprocess.run(command, shell=True, check=True, text=True, capture_output=True)
        output = result.stdout
        # Search for the line with the generated file name
        match = re.search(r'[^\s]+\.wav', output)
        if match:
            generated_file = match.group(0)
        else:
            
            generated_file = f"{key}.wav"

        return jsonify({
            "cloned_file_path": output_dir + "/" + generated_file,
            "status": "success",
            "raw_output":  output  # optional: to help debugging
        })

    except subprocess.CalledProcessError as e:
        return jsonify({"error": e.stderr, "status": "failure"}), 500
    except Exception as e:
        return jsonify({"error": str(e), "status": "failure"}), 500

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=6000, debug=True)

    # test train
    # with app.test_request_context(
    #     '/train',
    #     method='POST',
    #     json={
    #         "pipeline_config": {
    #             "raw_audio_folder": "/data/db/files/STAGING/TRAIN/ROW/412a1022b5a21dc73a28cd2b6b20387f",
    #             "target_voice_path": "/data/db/files/DATA/REFF_VOICE/75a9f2d94b5c6bb1893624c9422cc1c9.wav",
    #             "target_embedding_path": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f/embedding_file.npy",
    #             "dataset_folder": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f"
    #         },
    #         "train_config": {
    #             "config_file": "configs/presets/config_dit_mel_seed_uvit_whisper_small_wavenet.yml",
    #             "run_name": "412a1022b5a21dc73a28cd2b6b20387f",
    #             "batch_size": 4,
    #             "max_steps": 200,
    #             "max_epochs": 1000,
    #             "save_every": 100,
    #             "num_workers": 2,
    #             "training_directory": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f",
    #             "training_set_dir": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/412a1022b5a21dc73a28cd2b6b20387f/ready"
    #         }
    #     }
    # ):
    #     resp = train_endpoint()
    #     if isinstance(resp, tuple):
    #         response_obj = resp[0]
    #     else:
    #         response_obj = resp
    #     print("Test /train response:", response_obj.get_json())
    #app.run(host='0.0.0.0', port=6000, debug=True)
    # Example of how to send a request to this app using Python's requests library
    # Save this in a separate script or use it in a Python environment
    # Example request to the train endpoint
    # url = "http://127.0.0.1:6000/train"
    # headers = {"Content-Type": "application/json"}
    # payload = {
    #     "pipeline_config": {},  # Add your pipeline configuration here
    #     "train_config": {
    #         "config_file": "configs/presets/config_dit_mel_seed_uvit_whisper_small_wavenet.yml",
    #         "dataset_dir": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/1234",
    #         "run_name": "1234",
    #         "batch_size": 4,
    #         "max_steps": 200,
    #         "max_epochs": 1000,
    #         "save_every": 100,
    #         "num_workers": 2,
    #         "training_directory": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/1234"
    #     }
    # }

    # response = requests.post(url, headers=headers, data=json.dumps(payload))
    # print(response.json())

