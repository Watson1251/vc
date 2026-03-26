#!/bin/bash

# File: generate-login-keys.sh

CERT_DIR="../certs"
mkdir -p "$CERT_DIR"

PRIVATE_KEY="$CERT_DIR/rsa-login.key"
PUBLIC_KEY="$CERT_DIR/rsa-login.pub"

# Generate 2048-bit RSA key pair
echo "🔐 Generating RSA key pair for login encryption..."
openssl genrsa -out "$PRIVATE_KEY" 2048
openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"

# Confirm result
if [[ -f "$PRIVATE_KEY" && -f "$PUBLIC_KEY" ]]; then
    echo "✅ RSA key pair generated:"
    echo "   🔐 Private key: $PRIVATE_KEY"
    echo "   🔓 Public key:  $PUBLIC_KEY"
else
    echo "❌ Failed to generate login key pair."
    exit 1
fi

# Print environment.ts-ready public key string
echo ""
echo "📤 Paste the following into your Angular environment.ts:"
echo "rsaPublicKey: \`$(awk '{printf "%s\\n", $0}' "$PUBLIC_KEY")\`"
