#!/bin/bash
# Check if the folder path is passed as an argument
if [[ -z "$1" ]]; then
    echo "No folder path provided. Exiting."
    exit 1
fi

folder_path="$1"

# Validate the folder path
if [[ "$folder_path" == "." || "$folder_path" == "$(pwd)" ]]; then
    echo "Operation not allowed on the current directory. Exiting."
    exit 1
fi

if [[ "$folder_path" != /data/db/files/STAGING* ]]; then
    echo "Operation only allowed on paths under /data/db/files/STAGING. Exiting."
    exit 1
    
fi

# Confirm with the user before proceeding
read -p "Are you sure you want to delete all files in '$folder_path'? (yes/no): " confirmation

if [[ "$confirmation" == "yes" ]]; then
    # Execute the find command to delete files
    find "$folder_path" -type f -exec rm -f {} +
    echo "Files deleted successfully."
else
    echo "Operation canceled."
fi

# Copy the specified files to their respective destinations
cp /app/engines/vc/TEMP/requests/faisal_alqasim_sub.wav /data/db/files/STAGING/CLONE/ROW/source/faisal_alqasim_sub.wav
cp /app/engines/vc/TEMP/requests/Muataz_Mishal_sub.wav /data/db/files/STAGING/CLONE/ROW/target/Yaser_Alhuzaimi.mp3
cp /app/engines/vc/TEMP/requests/faisal_alqasim_sub.wav /data/db/files/STAGING/REFF_VOICE/ROW/faisal_alqasim_sub.wav


echo "Files copied successfully."