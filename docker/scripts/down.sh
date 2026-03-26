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

DOWN_ARGS=()
while [[ "$1" == "-v" || "$1" == "--volumes" ]]; do
    DOWN_ARGS+=(--volumes)
    shift
done

FILES=(-f "${COMPOSE_DIR}/docker-compose.yml" -f "${COMPOSE_DIR}/docker-compose.${MODE}.yml")

if [ "$#" -eq 0 ]; then
    if [ "${#DOWN_ARGS[@]}" -gt 0 ]; then
        echo "Bringing down all services in $MODE mode and removing compose-named volumes."
    else
        echo "No services specified. Bringing down all services in $MODE mode."
    fi
    docker compose "${FILES[@]}" down "${DOWN_ARGS[@]}"
else
    echo "Bringing down specified services: $* in $MODE mode."
    docker compose "${FILES[@]}" rm -s -f "$@"
fi
