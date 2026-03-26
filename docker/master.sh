#!/bin/bash

# Make paths robust no matter the caller's CWD
DOCKER_DIR="$( cd "$( dirname "$0" )" && pwd )"
SCRIPTS_DIR="${DOCKER_DIR}/scripts"

SCRIPT_NAME="$1"
shift

# If no argument passed, print usage and list available commands
if [[ -z "$SCRIPT_NAME" ]]; then
    echo "Usage: ./master.sh <command> [args...]"
    echo "Available commands:"
    for f in "${SCRIPTS_DIR}"/*.sh; do
        [[ -e "$f" ]] || continue
        echo "  $(basename "$f" .sh)"
    done
    exit 0
fi

SCRIPT_PATH="${SCRIPTS_DIR}/${SCRIPT_NAME}.sh"

if [[ -x "$SCRIPT_PATH" ]]; then
    exec "$SCRIPT_PATH" "$@"
else
    echo "Unknown command: $SCRIPT_NAME"
    echo "Available commands:"
    for f in "${SCRIPTS_DIR}"/*.sh; do
        [[ -e "$f" ]] || continue
        echo "  $(basename "$f" .sh)"
    done
    exit 1
fi
