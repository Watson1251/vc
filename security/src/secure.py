import os
import tempfile
import threading
import time
import atexit
import uuid
from pathlib import Path
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

import sys
sys.path.append('/logger')
from logger import AppLogger
logger = AppLogger()


class HybridFileSecurity:
    MAGIC_HEADER = b'ENC1'  # 4-byte identifier to verify encrypted files

    def __init__(self, public_key_path='/certs/rsa-login.pub', private_key_path='/certs/rsa-login.key'):
        self.public_key = self._load_public_key(public_key_path)
        self.private_key = self._load_private_key(private_key_path)

    def _load_public_key(self, path):
        logger.info(f"🔐 Loading public key from {path}")
        with open(path, 'rb') as f:
            return serialization.load_pem_public_key(f.read(), backend=default_backend())

    def _load_private_key(self, path):
        logger.info(f"🔐 Loading private key from {path}")
        with open(path, 'rb') as f:
            return serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())

    def encrypt_file(self, file_path, output_path=None):
        file_path = Path(file_path)
        output_path = Path(output_path or f"{file_path}.enc")
        logger.info(f"🔐 Encrypting file: {file_path}")

        aes_key = os.urandom(32)
        iv = os.urandom(16)

        cipher = Cipher(algorithms.AES(aes_key), modes.CFB(iv), backend=default_backend())
        encryptor = cipher.encryptor()

        encrypted_data = bytearray()
        with open(file_path, 'rb') as f:
            while chunk := f.read(1024 * 1024):
                encrypted_data.extend(encryptor.update(chunk))
        encrypted_data.extend(encryptor.finalize())

        encrypted_key = self.public_key.encrypt(
            aes_key,
            asym_padding.OAEP(
                mgf=asym_padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )

        expected_len = self.public_key.key_size // 8
        if len(encrypted_key) != expected_len:
            raise ValueError(f"❌ Encrypted key length mismatch: got {len(encrypted_key)}, expected {expected_len}")

        with open(output_path, 'wb') as f:
            f.write(self.MAGIC_HEADER)
            f.write(len(encrypted_key).to_bytes(2, byteorder='big'))
            f.write(encrypted_key)
            f.write(iv)
            f.write(encrypted_data)

        logger.info(f"✅ File encrypted and saved to: {output_path}")
        return str(output_path)

    def decrypt_file(self, encrypted_path, output_path=None):
        output_path = Path(output_path or Path(encrypted_path).with_suffix('').as_posix())
        logger.info(f"🔓 Decrypting file: {encrypted_path}")

        key_len, encrypted_key, iv, encrypted_data = self._parse_encrypted_file(encrypted_path)

        aes_key = self.private_key.decrypt(
            encrypted_key,
            asym_padding.OAEP(
                mgf=asym_padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )

        cipher = Cipher(algorithms.AES(aes_key), modes.CFB(iv), backend=default_backend())
        decryptor = cipher.decryptor()

        with open(output_path, 'wb') as f:
            f.write(decryptor.update(encrypted_data) + decryptor.finalize())

        logger.info(f"✅ File decrypted and saved to: {output_path}")
        return str(output_path)

    def decrypt_to_temp(self, encrypted_path, delete_on_exit=True, delete_after_seconds=None):
        encrypted_path = Path(encrypted_path)
        original_name = encrypted_path.name.replace('.enc', '')
        
        # Use UUID to generate unique temp path
        unique_temp_name = f"{uuid.uuid4().hex}_{original_name}"
        temp_path = Path(tempfile.gettempdir()) / unique_temp_name
        logger.info(f"🔓 Decrypting to temp path: {temp_path}")

        key_len, encrypted_key, iv, encrypted_data = self._parse_encrypted_file(encrypted_path)

        aes_key = self.private_key.decrypt(
            encrypted_key,
            asym_padding.OAEP(
                mgf=asym_padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )

        cipher = Cipher(algorithms.AES(aes_key), modes.CFB(iv), backend=default_backend())
        decryptor = cipher.decryptor()

        with open(temp_path, 'wb') as f:
            f.write(decryptor.update(encrypted_data) + decryptor.finalize())

        if delete_after_seconds:
            def delayed_delete():
                time.sleep(delete_after_seconds)
                if temp_path.exists():
                    try:
                        temp_path.unlink()
                        logger.info(f"🗑️ Temp file deleted after {delete_after_seconds}s: {temp_path}")
                    except Exception as e:
                        logger.warn(f"⚠️ Could not delete temp file: {e}")
            threading.Thread(target=delayed_delete, daemon=True).start()
        elif delete_on_exit:
            atexit.register(lambda: temp_path.exists() and temp_path.unlink())

        logger.info(f"✅ Temp decrypted file ready: {temp_path}")
        return str(temp_path)

    def _parse_encrypted_file(self, encrypted_path):
        with open(encrypted_path, 'rb') as f:
            magic = f.read(4)
            if magic != self.MAGIC_HEADER:
                raise ValueError(f"❌ Invalid file format. Missing magic header in: {encrypted_path}")

            key_len_bytes = f.read(2)
            if len(key_len_bytes) != 2:
                raise ValueError("❌ Invalid encrypted file. Could not read key length.")

            key_len = int.from_bytes(key_len_bytes, byteorder='big')

            encrypted_key = f.read(key_len)
            if len(encrypted_key) != key_len:
                raise ValueError(f"❌ Failed to read full encrypted key: expected {key_len}, got {len(encrypted_key)}")

            expected_len = self.private_key.key_size // 8
            if len(encrypted_key) != expected_len:
                raise ValueError(f"❌ Ciphertext length must be equal to key size: got {len(encrypted_key)}, expected {expected_len}")

            iv = f.read(16)
            if len(iv) != 16:
                raise ValueError("❌ Failed to read IV.")

            encrypted_data = f.read()
            if not encrypted_data:
                raise ValueError("❌ Missing encrypted payload.")

            return key_len, encrypted_key, iv, encrypted_data
