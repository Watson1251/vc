const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const logger = require("/logger/logger");

class HybridFileSecurity {
    constructor(publicKeyPath = "/certs/rsa-login.pub", privateKeyPath = "/certs/rsa-login.key") {
        this.MAGIC_HEADER = Buffer.from("ENC1");
        this.publicKey = fs.readFileSync(publicKeyPath, "utf-8");
        this.privateKey = fs.readFileSync(privateKeyPath, "utf-8");
    }

    encryptFile(inputPath, outputPath = null) {
        logger.info(`🔐 Encrypting file: ${inputPath}`);
        const aesKey = crypto.randomBytes(32); // AES-256
        const iv = crypto.randomBytes(16);

        const cipher = crypto.createCipheriv("aes-256-cfb", aesKey, iv);
        const inputData = fs.readFileSync(inputPath);
        const encryptedData = Buffer.concat([cipher.update(inputData), cipher.final()]);

        const encryptedKey = crypto.publicEncrypt(
            {
                key: this.publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
            },
            aesKey
        );

        const expectedLen = 256; // For 2048-bit RSA
        if (encryptedKey.length !== expectedLen) {
            throw new Error(`❌ Encrypted key length mismatch: got ${encryptedKey.length}, expected ${expectedLen}`);
        }

        const keyLenBuf = Buffer.alloc(2);
        keyLenBuf.writeUInt16BE(encryptedKey.length);

        const outPath = outputPath || `${inputPath}.enc`;
        const outStream = fs.createWriteStream(outPath);

        outStream.write(this.MAGIC_HEADER);
        outStream.write(keyLenBuf);
        outStream.write(encryptedKey);
        outStream.write(iv);
        outStream.write(encryptedData);
        outStream.end();

        logger.info(`✅ File encrypted and saved to: ${outPath}`);
        return outPath;
    }

    decryptFile(encryptedPath, outputPath = null) {
        logger.info(`🔓 Decrypting file: ${encryptedPath}`);
        const {
            encryptedKey,
            iv,
            encryptedData,
        } = this._parseEncryptedFile(encryptedPath);

        const aesKey = crypto.privateDecrypt(
            {
                key: this.privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
            },
            encryptedKey
        );

        const decipher = crypto.createDecipheriv("aes-256-cfb", aesKey, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

        const outPath = outputPath || encryptedPath.replace(/\.enc$/, "");
        fs.writeFileSync(outPath, decrypted);
        logger.info(`✅ File decrypted and saved to: ${outPath}`);
        return outPath;
    }

    decryptToTemp(encryptedPath, deleteAfterMs = null) {
        const tempFileName = path.basename(encryptedPath).replace(".enc", "");
        const tempPath = path.join(os.tmpdir(), uuidv4() + "_" + tempFileName);
        logger.info(`🔓 Decrypting to temp path: ${tempPath}`);

        const decryptedPath = this.decryptFile(encryptedPath, tempPath);

        if (deleteAfterMs) {
            setTimeout(() => {
                fs.unlink(decryptedPath, (err) => {
                    if (err) {
                        logger.warn(`⚠️ Could not delete temp file: ${decryptedPath}: ${err.message}`);
                    } else {
                        logger.info(`🗑️ Temp file deleted after ${deleteAfterMs}ms: ${decryptedPath}`);
                    }
                });
            }, deleteAfterMs);
        }

        return decryptedPath;
    }

    _parseEncryptedFile(filePath) {
        const buffer = fs.readFileSync(filePath);
        let offset = 0;

        const magic = buffer.slice(offset, offset + 4);
        offset += 4;
        if (!magic.equals(this.MAGIC_HEADER)) {
            throw new Error(`❌ Invalid file format. Missing magic header in: ${filePath}`);
        }

        const keyLen = buffer.readUInt16BE(offset);
        offset += 2;

        const encryptedKey = buffer.slice(offset, offset + keyLen);
        offset += keyLen;

        const expectedLen = 256;
        if (encryptedKey.length !== expectedLen) {
            throw new Error(`❌ Ciphertext length must be equal to key size: got ${encryptedKey.length}, expected ${expectedLen}`);
        }

        const iv = buffer.slice(offset, offset + 16);
        offset += 16;

        const encryptedData = buffer.slice(offset);
        if (!encryptedData || encryptedData.length === 0) {
            throw new Error("❌ Missing encrypted payload.");
        }

        return { encryptedKey, iv, encryptedData };
    }
}

module.exports = HybridFileSecurity;
