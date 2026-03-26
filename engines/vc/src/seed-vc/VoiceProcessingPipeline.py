import os
from pprint import pprint
import subprocess
import numpy as np
import shutil
import nemo.collections.asr as nemo_asr
import multiprocessing
import requests
import argparse
import logging
import torch



logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

class VoiceProcessingPipeline:
    """
    A class to encapsulate a complete audio processing pipeline, including:
      1. Extraction and saving of a target speaker embedding.
      2. Resampling raw audio files to a consistent format.
      3. Splitting audio files into smaller chunks.
      4. Removing silence from the audio chunks.
      5. Filtering chunks based on speaker similarity using cosine similarity.
    """

    def __init__(self, 
                 data: dict):
        
        self.raw_audio_folder=data['raw_audio_folder']
        self.target_voice_path=data['target_voice_path']
        self.target_embedding_path=data['target_embedding_path']
        self.dataset_folder=data['dataset_folder']
        self.resampled_folder = os.path.join(self.dataset_folder , "resampled")
        self.chunk_folder = os.path.join(self.dataset_folder, "chunks")
        self.cleaned = os.path.join(self.dataset_folder, "cleaned")
        self.chunk_size=data.get('chunk_size', 5)
        self.similarity_threshold=data.get('similarity_threshold', 0.60)

        self.nemo_url = os.getenv("NEMO_URL", "http://nemo-engine:5000")
        self.extract_embedding_url = f"{self.nemo_url}/extract_embedding"
        
        print(f"resampled_folder: {self.resampled_folder}")
        print(f"chunk_folder: {self.chunk_folder}")
        print(f"dataset_folder: {self.dataset_folder}")

    def extract_target_embedding(self) -> np.ndarray:
        """
        Extract and save the embedding for the target speaker.
        """
        # Read the NeMo URL from the environment variable or use the default
        
        # Use NeMo's "extract_embedding" endpoint to extract the embedding
        print(f"Extracting embedding from target voice file: {self.target_voice_path}")
        #files = {'file': open(self.target_voice_path, 'rb')}
        data = {'input_file': self.target_voice_path}
        
        response = requests.post(self.extract_embedding_url, json=data)
       
        if response.status_code != 200:
            raise Exception(f"Failed to extract embedding: {response.text}")

        embedding = np.array(response.json()['embedding'])
        np.save(self.target_embedding_path, embedding)
        print(f"Target voice embedding saved at: {self.target_embedding_path}")
        
        
        return response.json()
    
    def resample_audio_file(self, input_path: str, output_path: str) -> None:
        """
        Resample an audio file to 16kHz mono using ffmpeg.
        """

        print(f"Resampling '{input_path}' to 16kHz...")
        subprocess.run([
            "ffmpeg", "-y","-i", input_path,
            "-ar", "16000", "-ac", "1", output_path
        ], check=True)
        print(f"Resampled audio saved at: {output_path}")

    def batch_resample(self) -> None:
        """
        Resample all WAV files in the raw audio folder.
        """
        print("Starting batch resampling of audio files...")
        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger(__name__)
        logger.info(f"Resampling audio files from '{self.raw_audio_folder}' to '{self.resampled_folder}'")
        os.makedirs(self.resampled_folder, exist_ok=True)

        for file in os.listdir(self.raw_audio_folder):
           
            input_file = os.path.join(self.raw_audio_folder, file)
            output_file = os.path.join(self.resampled_folder, file)
            self.resample_audio_file(input_file, output_file)

    def split_audio_file(self, input_audio: str, output_folder: str) -> None:
        """
        Split an audio file into chunks of specified duration.
        """
        os.makedirs(output_folder, exist_ok=True)
        base_name = os.path.splitext(os.path.basename(input_audio))[0]
        chunk_pattern = os.path.join(output_folder, f"{base_name}_chunk_%03d.wav")
        subprocess.run([
            "ffmpeg", "-y", "-i", input_audio,
            "-f", "segment", "-segment_time", str(self.chunk_size),
            "-c", "copy", "-reset_timestamps", "1", chunk_pattern
        ], check=True)
        print(f"Audio splitting complete for '{input_audio}'. Chunks saved in: {output_folder}")

    def batch_split_audio(self) -> None:
        """
        Split all resampled audio files into chunks.
        """
        os.makedirs(self.chunk_folder, exist_ok=True)
        for file in os.listdir(self.cleaned):
            if file.lower().endswith(".wav"):
                input_path = os.path.join(self.cleaned, file)
                self.split_audio_file(input_path, self.chunk_folder)

    def remove_silence(self) -> None:
        """
        Remove silence from each audio chunk using ffmpeg.
        """
        for file in os.listdir(self.chunk_folder):
            if file.lower().endswith(".wav"):
                input_path = os.path.join(self.chunk_folder, file)
                temp_output = os.path.join(self.chunk_folder, "cleaned_" + file)
                subprocess.run([
                    "ffmpeg","-y", "-i", input_path,
                    "-af", "silenceremove=stop_periods=-1:stop_duration=4:start_threshold=-30dB",
                    temp_output
                ], check=True)
                os.remove(input_path)
                os.rename(temp_output, input_path)
        print(f"Silence removal complete for folder: {self.chunk_folder}")

    def load_target_embedding(self) -> np.ndarray:
        """
        Load the target speaker's embedding from storage.
        """
        if not os.path.exists(self.target_embedding_path):
            raise FileNotFoundError(f"Target embedding file not found: {self.target_embedding_path}")
        embedding = np.load(self.target_embedding_path)
        return embedding.flatten()
    
    def batch_clean_audio_(self) -> None:
        """
        Clean all resampled audio files using the clean_audio method and save them in self.cleaned.
        """
        
        os.makedirs(self.cleaned, exist_ok=True)
        for file in os.listdir(self.chunk_folder):
            if file.lower().endswith(".wav"):
                input_path = os.path.join(self.chunk_folder, file)
                # Prepare output directory for each file
                data = {"input_file": input_path}
                try:
                    self.clean_audio(data)
                   
                except subprocess.CalledProcessError as e:
                    print(f"Error processing file '{input_path}': {e}")
                    print(f"Command output: {e.output}")
                except Exception as err:
                    print(f"Error cleaning file '{input_path}': {err}")
        self.convert_to_wav_and_cleanup(self.cleaned)
    def clean_audio_(self, data):
        try:
            input_file = data.get("input_file")
            print(f"Cleaning audio file: {input_file}")

            if not input_file:
                return {"error": "Missing required parameter: input_file", "status": "failure"}, 400
            
            # Extract chunk name (without extension)
            chunk_name = os.path.splitext(os.path.basename(input_file))[0]
            
            # Define the output directory structure
            temp_output_dir = os.path.join(self.cleaned, chunk_name)  # Temporary demucs output folder
            final_output_path = os.path.join(self.cleaned, f"{chunk_name}.mp3")  # Final vocals destination
            #print(f"temp_output_dirt path: {temp_output_dir}")
            # Create necessary folders
            os.makedirs(temp_output_dir, exist_ok=True)

            # Run Demucs to extract vocals
            command = f"python3 -m demucs.separate --mp3 -o {temp_output_dir} {input_file}"
            result = subprocess.run(command, shell=True, check=True, text=True, capture_output=True)

            # Locate the `vocals.mp3` file inside the Demucs output folder
            demucs_dir = os.path.join(temp_output_dir, "htdemucs", chunk_name)
            #print(f"demucs_dir path: {demucs_dir}")
            vocals_file = os.path.join(demucs_dir, "vocals.mp3")

            if not os.path.exists(vocals_file):
                return {"error": "Vocals file not found", "status": "failure"}, 500

            # Move and rename `vocals.mp3` to the final cleaned folder
            shutil.move(vocals_file, final_output_path)
            print(f"Saved cleaned vocals: {final_output_path}")

            # Remove unnecessary files and temporary directories
            shutil.rmtree(temp_output_dir)

            return {
                "output_path": final_output_path,
                "status": "success",
                "raw_output": result.stdout  # Optional debugging info
            }

        except Exception as err:
            return {"error": str(err), "status": "failure"}, 500
    def clean_audio(self,input_file, cleaned_dir, use_gpu=False):
        """
        Worker function to clean audio files using either GPU or CPU (limited to 4 cores).
        """
        try:
            print(f"Cleaning audio file: {input_file} | {'GPU' if use_gpu else 'CPU (4 cores)'}")

            chunk_name = os.path.splitext(os.path.basename(input_file))[0]
            temp_output_dir = os.path.join(cleaned_dir, chunk_name)
            final_output_path = os.path.join(cleaned_dir, f"{chunk_name}.mp3")

            os.makedirs(temp_output_dir, exist_ok=True)

            # Use GPU or restrict CPU
            if use_gpu:
                command = f"python3 -m demucs.separate --mp3 -o {temp_output_dir} --device cuda  --two-stems=vocals {input_file}"
            else:
                command = f"python3 -m demucs.separate --mp3 -o {temp_output_dir} --jobs 4  --two-stems=vocals {input_file}"

            process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            process.wait()

            demucs_dir = os.path.join(temp_output_dir, "htdemucs", chunk_name)
            vocals_file = os.path.join(demucs_dir, "vocals.mp3")

            if os.path.exists(vocals_file):
                shutil.move(vocals_file, final_output_path)
                print(f"Saved cleaned vocals: {final_output_path}")
               
            else:
                print(f"[ERROR] vocals.mp3 not found for {chunk_name}")
                return {"output_path": None, "status": 500}

            shutil.rmtree(temp_output_dir)
            return {"output_path": final_output_path, "status": 200}

        except Exception as err:
            print(f"Error cleaning file '{input_file}': {err}")
            return {"error": str(err), "status": 500},500

    def batch_clean_audio(self):
        """
        Parallelized batch audio cleaning with comparison between GPU and CPU (4-core).
        """
        os.makedirs(self.cleaned, exist_ok=True)

        # Get list of .wav files
        #files = [os.path.join(self.chunk_folder, f) for f in os.listdir(self.chunk_folder) if f.lower().endswith(".wav")]
        files = [os.path.join(self.resampled_folder, f) for f in os.listdir(self.resampled_folder) if f.lower().endswith(".wav")]

        # Each process uses 4 cores, so total processes = (available_cores * 0.95) // 4
        total_cores = os.cpu_count() or 4
        usable_cores = int(total_cores * 0.95)
        pool_size = max(1, usable_cores // 4)

        # Run GPU processing
        # Check if GPU is available and requested
        if torch.cuda.is_available():
            use_gpu = True
        else:
            use_gpu = False

        if use_gpu:
            # Run sequentially on GPU
            #with multiprocessing.Pool(processes=pool_size) as pool:
            gpu_results = [self.clean_audio(file, self.cleaned, True) for file in files]
            cpu_results = "Not tested"
        else:
            # Run in parallel on CPU (4-core)
            with multiprocessing.Pool(processes=pool_size) as pool:
                cpu_results = pool.starmap(self.clean_audio, [(file, self.cleaned, False) for file in files])
            gpu_results = "Not available"

        print("Batch cleaning completed!")
        self.convert_to_wav_and_cleanup(self.cleaned)
        return {"status": "200", "message": "Audio cleaning complete."}, 200

    def clean_audio_v1(self, data):
        try:
            input_file = data.get("input_file")
            print(f"Cleaning audio file: {input_file}")
            
            if not input_file:
                return {"error": "Missing required parameter: input_file", "status": "failure"}, 400
            
            # Extract filename (without extension) to create output folder
            file_name = os.path.splitext(os.path.basename(input_file))[0]
            output_dir = os.path.join(self.cleaned, file_name)
            os.makedirs(output_dir, exist_ok=True)

            # Run Demucs with specified parameters
            command = f"python3 -m demucs.separate --mp3 -o {output_dir} {input_file}"

            result = subprocess.run(command, shell=True, check=True, text=True, capture_output=True)

            return {
            "output_path": output_dir,
            "status": "success",
            "raw_output": result.stdout  # Optional debugging info
            }
        except Exception as err:
            return {"error": str(err), "status": "failure"}, 500

    def convert_to_wav_and_cleanup(self, folder: str) -> None:
        """
        Convert all audio files in the given folder to WAV format (16kHz mono),
        save them in the same directory, and delete the original files.
        """
        for file in os.listdir(folder):
            file_path = os.path.join(folder, file)
            base, ext = os.path.splitext(file)
            if ext.lower() not in [".wav"]:
                wav_path = os.path.join(folder, f"{base}.wav")
                try:
                    subprocess.run([
                        "ffmpeg", "-y", "-i", file_path,
                        "-ar", "16000", "-ac", "1", wav_path
                    ], check=True)
                    os.remove(file_path)
                    print(f"Converted and removed: {file_path}")
                except Exception as e:
                    print(f"Error converting {file_path}: {e}")
    def filter_target_voice_chunks(self) -> None:
        """
        Filter audio chunks by comparing their embeddings against the target's embedding.
        """
        target_embedding = self.load_target_embedding()
        os.makedirs(self.dataset_folder, exist_ok=True)

        for file in os.listdir(self.chunk_folder):
            
            if file.lower().endswith(".wav"):
                input_path = os.path.join(self.chunk_folder, file)
                ready_folder = os.path.join(self.dataset_folder, 'ready')
                os.makedirs(ready_folder, exist_ok=True)
                output_path = os.path.join(ready_folder, file)
                try:
                    data = {'input_file': input_path}

                    response = requests.post(self.extract_embedding_url, json=data)
                    #logging.info(f"Response from NeMo: {response.status_code} - {response.text}")
                    #print(f"Response from NeMo: {response.status_code} - {response.text}")
                    if response.status_code != 200:
                        raise Exception(f"Failed to extract embedding: {response.text}")

                    chunk_embedding = np.array(response.json()['embedding'])
                    #chunk_embedding = self.speaker_model.get_embedding(input_path).detach().cpu().numpy().flatten()
                    cosine_similarity = np.dot(chunk_embedding, target_embedding) / (
                        np.linalg.norm(chunk_embedding) * np.linalg.norm(target_embedding)
                    )
                    if cosine_similarity >= self.similarity_threshold:
                        print(f"Saving target voice chunk: {file} (similarity: {cosine_similarity:.2f})")
                        shutil.copy(input_path, output_path)
                    else:
                        print(f"Skipping non-target voice chunk: {file} (similarity: {cosine_similarity:.2f})")
                except Exception as e:
                    print(f"Error processing file '{input_path}': {e}")

    def run_pipeline(self, debug=False) -> dict:
        """
        Run the full audio processing pipeline.
        """
        print("Starting the audio processing pipeline...")
        try:
            print("Extracting target embedding...")
            self.extract_target_embedding()
            print("Batch resampling audio files...")
            self.batch_resample()
            print("Batch cleaning audio files...")
            if debug:
               
                # Copy resampled files into the cleaning directory and create it if it doesn't exist
                os.makedirs(self.cleaned, exist_ok=True)
                for file in os.listdir(self.resampled_folder):
                    src = os.path.join(self.resampled_folder, file)
                    dst = os.path.join(self.cleaned, file)
                    if os.path.isfile(src):
                        shutil.copy(src, dst)
            else:
                self.batch_clean_audio()
            
            print("Batch splitting audio files...")
            self.batch_split_audio()
            print("Removing silence from audio chunks...")
            self.remove_silence()
            print("Filtering target voice chunks...")
            self.filter_target_voice_chunks()
            #return {"status": "200", "message": "Audio processing pipeline complete."}
            print("Audio processing pipeline complete.")
            return {"status": "200", "message": "Audio processing pipeline complete.", "output_folder": self.dataset_folder}
        except Exception as e:
            print(f"Error in audio processing pipeline: {e}")
            return {"status": "500", "message": f"Error: {e}"}


def train(data: dict) -> None:
    """
    Initialize and run the audio processing pipeline using the configurations
    passed in a dictionary.
    
    Expected keys in data:
      - raw_audio_folder
      - target_voice_path
      - target_embedding_path
      - (optional) resampled_folder (default: 'resampled')
      - (optional) chunk_folder (default: 'chunks')
      - (optional) dataset_folder (default: 'dataset')
      - (optional) chunk_size (default: 10)
      - (optional) similarity_threshold (default: 0.6)
    """
    print("starting the pipeline")
    try:
        # Check if the required keys are present in the data dictionary
        required_keys = ['raw_audio_folder', 'target_voice_path', 'target_embedding_path', 'dataset_folder']
        for key in required_keys:
            if key not in data:
                raise ValueError(f"Missing required key: {key}")

        # Initialize the pipeline with the provided data
        print("Data received:")
        pprint(data)
        pipeline = VoiceProcessingPipeline(data=data)


        result = pipeline.run_pipeline()
        return result
    except Exception as err:
        print(f"Error in train: {err}")
        return {"status": "500", "message": f"Error in train: {err}"}, 500



if __name__ == "__main__":

    predefined_args = {
        "raw_audio_folder":  "/data/db/files/STAGING/TRAIN/ROW/66c521bcf4e4eb89b4a2dd4377ad10f9",
        "target_voice_path": "/data/db/files/DATA/REFF_VOICE/75a9f2d94b5c6bb1893624c9422cc1c9.wav",
        "target_embedding_path": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/66c521bcf4e4eb89b4a2dd4377ad10f9/embedding_file.npy",
        "dataset_folder": "/data/db/files/STAGING/TRAIN/TRAINING_DIR/66c521bcf4e4eb89b4a2dd4377ad10f9",
        "chunk_size": 10,
        "similarity_threshold": 0.6,
    }

    train(predefined_args)

