#!/bin/bash
set -e

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
    echo "No services specified. Restarting all services in $MODE mode."
    docker compose "${FILES[@]}" down
    docker compose "${FILES[@]}" up -d
else
    echo "Restarting specified services: $* in $MODE mode."
    docker compose "${FILES[@]}" down "$@"
    docker compose "${FILES[@]}" up -d "$@"
fi
