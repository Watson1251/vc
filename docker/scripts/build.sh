#!/bin/bash
set -e

# Resolve absolute dirs
SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
DOCKER_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
COMPOSE_DIR="${DOCKER_DIR}/compose"

MODE="dev"
if [[ "$1" == "--prod" ]]; then
    MODE="prod"
    shift
fi

FILES=(-f "${COMPOSE_DIR}/docker-compose.yml" -f "${COMPOSE_DIR}/docker-compose.${MODE}.yml")

if [ "$#" -eq 0 ]; then
    echo "No services specified. Building all services in $MODE mode."
    docker compose "${FILES[@]}" build
else
    echo "Building specified services: $* in $MODE mode."
    docker compose "${FILES[@]}" build "$@"
fi
