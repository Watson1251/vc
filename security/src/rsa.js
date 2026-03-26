const fs = require("fs");
const forge = require("node-forge");

// Adjust path if needed
const privateKeyPem = fs.readFileSync("/certs/rsa-login.key", "utf8");
const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

function decryptPassword(encryptedBase64) {
    const encryptedBytes = forge.util.decode64(encryptedBase64);
    const decrypted = privateKey.decrypt(encryptedBytes, "RSA-OAEP", {
        md: forge.md.sha256.create(),
        mgf1: {
            md: forge.md.sha1.create(),
        }
    });
    return decrypted;
}

module.exports = {
    decryptPassword,
};
