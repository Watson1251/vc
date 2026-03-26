const crypto = require('crypto');
const fs = require('fs');

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32 bytes hex string
const ivLength = 12;

// String encryption/decryption (AES-256-GCM with hex string output)
function encrypt(text) {
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Combine into a single string: iv.authTag.encryptedData
    const payload = [
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex')
    ].join('.');

    return payload;
}

function decrypt(payload) {
    const parts = payload.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted payload format');
    }

    const [ivHex, authTagHex, encryptedDataHex] = parts;

    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedDataHex, 'hex')),
        decipher.final()
    ]);

    return decrypted.toString('utf8');
}

function safeEncrypt(value) {
    if (!value) return "";
    return encrypt(value);
}

function safeDecrypt(value) {
    if (!value) return "";
    try {
        return decrypt(value);
    } catch (err) {
        return value;
    }
}

/**
 * Generalized encryption function for different types
 * @param {any} value - value to encrypt
 * @param {"string"|"number"|"json"} type - type of the value
 * @returns {string} encrypted string
 */
function encryptField(value, type) {
    if (value === undefined || value === null) return "";

    if (type === "number") {
        return safeEncrypt(value.toString());
    } else if (type === "string") {
        return safeEncrypt(value);
    } else {
        // For any other type, stringify as JSON before encrypting
        return safeEncrypt(JSON.stringify(value));
    }
}

/**
 * Generalized decryption function for different types
 * @param {string} value - encrypted string
 * @param {"string"|"number"|"json"} type - expected return type
 * @returns {any} decrypted value in expected type
 */
function decryptField(value, type) {
    if (!value) return null;

    const decrypted = safeDecrypt(value);

    if (type === "number") {
        const num = Number(decrypted);
        return isNaN(num) ? null : num;
    } else if (type === "string") {
        return decrypted;
    } else {
        try {
            return JSON.parse(decrypted);
        } catch {
            return decrypted;
        }
    }
}

// ===== New file encryption/decryption functions =====

// Encrypt a buffer (e.g., file contents) returning a Buffer (iv + authTag + encrypted)
function encryptBuffer(buffer) {
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]);
}

// Decrypt a buffer encrypted with encryptBuffer, returns a Buffer with original content
function decryptBuffer(encryptedBuffer) {
    const iv = encryptedBuffer.slice(0, ivLength);
    const authTag = encryptedBuffer.slice(ivLength, ivLength + 16);
    const encrypted = encryptedBuffer.slice(ivLength + 16);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted;
}

// Helper: encrypt file contents from input path and save encrypted to output path
function encryptFile(inputPath, outputPath) {
    const fileBuffer = fs.readFileSync(inputPath);
    const encryptedBuffer = encryptBuffer(fileBuffer);
    fs.writeFileSync(outputPath, encryptedBuffer);
}

// Helper: decrypt encrypted file at input path and save decrypted contents to output path
function decryptFile(inputPath, outputPath) {
    const encryptedBuffer = fs.readFileSync(inputPath);
    const decryptedBuffer = decryptBuffer(encryptedBuffer);
    fs.writeFileSync(outputPath, decryptedBuffer);
}

module.exports = {
    safeEncrypt,
    safeDecrypt,
    encryptField,
    decryptField,
    encryptBuffer,
    decryptBuffer,
    encryptFile,
    decryptFile,
};
