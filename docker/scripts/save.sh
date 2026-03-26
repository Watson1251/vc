#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
DOCKER_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
COMPOSE_DIR="${DOCKER_DIR}/compose"
IMAGES_DIR="${DOCKER_DIR}/images"

MODE="dev"
if [[ "$1" == "--prod" ]]; then
    MODE="prod"
    shift
fi

FILES=(-f "${COMPOSE_DIR}/docker-compose.yml" -f "${COMPOSE_DIR}/docker-compose.${MODE}.yml")

mkdir -p "$IMAGES_DIR"

echo "Saving images for services in $MODE mode..."

# Skip header; fields: SERVICE REPOSITORY TAG IMAGE_ID SIZE
docker compose "${FILES[@]}" images "$@" | tail -n +2 | \
while read -r SERVICE REPOSITORY TAG IMAGE_ID SIZE; do
    if [[ -z "$SERVICE" || -z "$REPOSITORY" || -z "$TAG" ]]; then
        continue
    fi
    if [[ "$REPOSITORY" == "<none>" || "$TAG" == "<none>" ]]; then
        echo "Skipping unnamed image for service $SERVICE"
        continue
    fi

    IMAGE_NAME="${REPOSITORY}:${TAG}"
    SAFE_REPO="${REPOSITORY//\//_}"
    FILE_NAME="${IMAGES_DIR}/${SAFE_REPO}_${TAG}.tar"

    echo "[+] Saving $IMAGE_NAME to $FILE_NAME"
    docker save -o "$FILE_NAME" "$IMAGE_NAME"
done
