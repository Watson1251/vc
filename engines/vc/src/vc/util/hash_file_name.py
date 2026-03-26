import hashlib
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