import os
import time
import logging
from util.toWav import convert_to_wav
# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
def process_sound_effect_voice(key, file_path):
    try:
        # Check if the file is already in .wav format
        if not file_path.lower().endswith('.wav'):
            
            file_path = convert_to_wav(file_path)
            logging.info(f"File converted successfully: {file_path}")
            
            return file_path
        else:
            logging.info(f"File is already in .wav format: {file_path}")
    except Exception as e:
        logging.error(f"Error processing sound effect voice: {e}")
        return 500
