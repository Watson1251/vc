import os
from util.toWav import convert_to_wav
from pydub import AudioSegment
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def process_ref_voice(key,input_file_path, config: None):
    """Process the input audio file and save the first 20 seconds as a WAV file.
    Args:
        key (str): Key to identify the input file.
        input_file_path (str): Path to the input audio file.
        config (dict): Configuration dictionary containing segment_duration for processing.
    """
    
    segment_duration  = config.get("segment_duration", 20)  # Default to 20 seconds
   
    # Check if the input file exists        
    if os.path.isfile(input_file_path):
        try:
            # Convert to WAV if not already
            if not input_file_path.endswith(".wav"):
                input_file = convert_to_wav(input_file_path,config)
            # Process the audio file
            audio = AudioSegment.from_file(input_file_path)
            segment = audio[:segment_duration * 1000]  # Convert seconds to milliseconds
            
            parent_dir = os.path.dirname(input_file_path)
            output_dir = os.path.abspath(os.path.join(parent_dir, "..", "READY"))
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, os.path.splitext(os.path.basename(input_file_path))[0] + ".wav")
           
            segment.export(output_path, format="wav")
         
            logging.info("Successfully processed %s", input_file_path)

            # Clean up the original file after processing
            if config.get("debug_mode", False):
                logging.info("Debug mode is ON. Skipping file removal.")
                return output_path
            if os.path.isfile(input_file_path):
                os.remove(input_file_path)
            
            return output_path
        except Exception as e:
             logging.error(f"Error: {str(e)}")
             return "500"
    
    else:
        logging.error(f"Error: Input file {input_file_path} does not exist.")
        return "500"
    