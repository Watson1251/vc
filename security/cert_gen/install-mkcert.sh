#!/bin/bash

# Path to mkcert binary
MKCERT="./mkcert-linux"

# Check if mkcert exists
if [[ ! -f "$MKCERT" ]]; then
  echo "❌ mkcert-linux not found in $(pwd)."
  exit 1
fi

# Make sure it's executable
chmod +x "$MKCERT"

# Install the local CA
echo "📎 Installing local CA for mkcert..."
$MKCERT -install

echo "✅ Local CA installed for mkcert."
