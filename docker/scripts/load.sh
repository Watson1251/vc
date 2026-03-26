#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
DOCKER_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
IMAGES_DIR="${DOCKER_DIR}/images"

if [[ ! -d "$IMAGES_DIR" ]]; then
    echo "[-] No '$IMAGES_DIR' directory found. Exiting."
    exit 1
fi

echo "[~] Loading all Docker images from $IMAGES_DIR..."

shopt -s nullglob
for TAR_FILE in "$IMAGES_DIR"/*.tar; do
    echo "[+] Loading image: $TAR_FILE"
    docker load -i "$TAR_FILE"
done
shopt -u nullglob

echo "[✓] All images loaded."
