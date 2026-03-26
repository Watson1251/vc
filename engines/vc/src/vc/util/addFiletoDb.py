import os
import shutil
import logging

# Global variable for the DB directory path
DB_DIR = "/data/db/files/DATA"
# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# Configuration dictionary will be passed as an argument to the function
def move_file_to_db(current_file_path, file_type, file_key, config=None):
    """
    Moves a file from its current location to the DB directory, renames it with the given key,
    and stores it in a specific directory in the DB based on its type.

    :param current_file_path: Full path to the current file
    :param file_type: Type of the file (used to determine the subdirectory in the DB)
    :param file_key: Unique key to rename the file
    :param config: Dictionary containing configuration options (e.g., debugging mode)
    :return: 0 if successful, 500 if an error occurs
    """
    config = config or {}  # Default to an empty dictionary if no config is provided
    debug_mode = config.get("debug_mode", False)

    try:
        # Ensure the type-specific directory exists in the DB
        type_dir = os.path.join(DB_DIR, file_type)
        os.makedirs(type_dir, exist_ok=True)

        # Extract the original file name and construct the new file name
        original_file_name = os.path.basename(current_file_path)
        file_extension = os.path.splitext(original_file_name)[1]
        new_file_name = f"{file_key}{file_extension}"
        destination_path = os.path.join(type_dir, new_file_name)

        
        if debug_mode:
            # In debug mode, do not move the file, just log the action
            logging.info(f"[DEBUG] File is Coppied to {destination_path}")
            # Copy the file to the destination path without removing the original
            shutil.copy2(current_file_path, destination_path)
        else:
            # Move and rename the file
            shutil.move(current_file_path, destination_path)
            logging.info(f"File moved successfully to {destination_path}")

            # Remove the original file if it still exists (in case of copy in debug mode)
            if os.path.exists(current_file_path):
                os.remove(current_file_path)
            
            # Remove the file or folder in the current directory and in any directory one level up from the current dir
            current_dir = os.path.dirname(current_file_path)
            parent_dir = os.path.dirname(current_dir)
            target_name = os.path.basename(current_file_path)

            # Remove from current directory
            target_path_current = os.path.join(current_dir, target_name)
            if os.path.exists(target_path_current):
                if os.path.isfile(target_path_current):
                    os.remove(target_path_current)
                elif os.path.isdir(target_path_current):
                    shutil.rmtree(target_path_current)

            # Remove from parent directory (one level up)
            target_path_parent = os.path.join(parent_dir, target_name)
            if os.path.exists(target_path_parent):
                if os.path.isfile(target_path_parent):
                    os.remove(target_path_parent)
                elif os.path.isdir(target_path_parent):
                    shutil.rmtree(target_path_parent)
        
        # Return a dictionary with status and destination path
        resp = {
            "status": "200",
            "file_path": destination_path,
            "message": f"File moved successfully to {destination_path}"
        }
        if debug_mode:
            resp["debug"] = {
                "original_file_name": original_file_name,
                "new_file_name": new_file_name,
                "file_extension": file_extension
            }
        
        return resp

      
    except Exception as e:
        # Log the error
        logging.error(f"Error moving file: {e}")
        return {"status": "500", "file_path": None, "message": f"Error moving file: {e}"}
def move_file_to_db_(current_file_path, file_type, file_key):
    """
    Moves a file from its current location to the DB directory, renames it with the given key,
    and stores it in a specific directory in the DB based on its type.

    :param current_file_path: Full path to the current file
    :param file_type: Type of the file (used to determine the subdirectory in the DB)
    :param file_key: Unique key to rename the file
    :return: 0 if successful, 500 if an error occurs
    """
    try:
        # Ensure the type-specific directory exists in the DB
        type_dir = os.path.join(DB_DIR, file_type)
        os.makedirs(type_dir, exist_ok=True)

        # Extract the original file name and construct the new file name
        original_file_name = os.path.basename(current_file_path)
        file_extension = os.path.splitext(original_file_name)[1]
        new_file_name = f"{file_key}{file_extension}"
        destination_path = os.path.join(type_dir, new_file_name)

        # Move and rename the file
        shutil.move(current_file_path, destination_path)

        # Log success
        print(f"File moved successfully to {destination_path}")
        return 0
    except Exception as e:
        # Log the error
        print(f"Error moving file: {e}")
        return 500