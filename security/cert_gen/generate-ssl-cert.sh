#!/bin/bash

# File: generate-ssl-cert.sh

CERT_DIR="../certs"
mkdir -p "$CERT_DIR"

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "❌ mkcert is not installed. Please install it first:"
    echo "  - macOS: brew install mkcert"
    echo "  - Ubuntu: sudo apt install mkcert"
    echo "  - Windows: choco install mkcert"
    exit 1
fi

# Install the local CA (only needed once)
echo "📎 Ensuring mkcert local CA is installed..."
mkcert -install

# Generate TLS certificate and key
echo "🔐 Generating TLS certificate for vc.com ..."
mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" vc.com

# Confirm result
if [[ -f "$CERT_DIR/cert.pem" && -f "$CERT_DIR/key.pem" ]]; then
    echo "✅ TLS cert & key generated:"
    echo "   🔐 $CERT_DIR/cert.pem"
    echo "   🔑 $CERT_DIR/key.pem"
else
    echo "❌ Failed to generate TLS cert."
    exit 1
fi
