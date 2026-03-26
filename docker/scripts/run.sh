#!/bin/bash
set -e

# This one doesn't need compose paths; it execs into a running container by name.

DEFAULT_SERVICE="frontend-stt"
SERVICE="${1:-$DEFAULT_SERVICE}"

echo "Running bash inside the service: $SERVICE"
docker exec -it "$SERVICE" bash
