#!/usr/bin/env bash
set -Eeuo pipefail

# ---------------- env (tunable without editing) ----------------
: "${API_HOST:=0.0.0.0}"      # accept connections from outside the container
: "${API_PORT:=8000}"
: "${API_WORKERS:=2}"         # bump if you have CPU headroom
: "${API_THREADS:=4}"         # gthread threads per worker
: "${API_TIMEOUT:=300}"
: "${API_GRACEFUL_TIMEOUT:=30}"
: "${API_KEEPALIVE:=75}"
: "${API_LOGLEVEL:=info}"
: "${API_RELOAD:=0}"          # keep 0 in training; set 1 only during light dev

: "${VC_NICE:=7}"             # lower CPU priority (higher value = lower priority)
: "${VC_IONICE_CLASS:=2}"     # 2=best-effort, 1=real-time, 3=idle
: "${VC_IONICE_PRIO:=7}"      # lowest IO priority within class
# ----------------------------------------------------------------

echo "✅ Starting VC Engine services..."

GUNICORN_PID=""
TRAIN_CONSUMER_PID=""
CLONE_CONSUMER_PID=""

cleanup() {
  echo "⛔ Shutting down services..."

  # kill whole process groups so children (ffmpeg, python, etc.) die too
  if [[ -n "${CLONE_CONSUMER_PID}" ]] && ps -p "${CLONE_CONSUMER_PID}" >/dev/null 2>&1; then
    echo "🛑 Stopping clone_consumer (PID=${CLONE_CONSUMER_PID})"
    kill -TERM -"$CLONE_CONSUMER_PID" || true
  fi
  if [[ -n "${TRAIN_CONSUMER_PID}" ]] && ps -p "${TRAIN_CONSUMER_PID}" >/dev/null 2>&1; then
    echo "🛑 Stopping train_consumer (PID=${TRAIN_CONSUMER_PID})"
    kill -TERM -"$TRAIN_CONSUMER_PID" || true
  fi
  if [[ -n "${GUNICORN_PID}" ]] && ps -p "${GUNICORN_PID}" >/dev/null 2>&1; then
    echo "🛑 Stopping gunicorn (PID=${GUNICORN_PID})"
    kill -TERM -"$GUNICORN_PID" || true
  fi

  # give them a moment to exit
  sleep 1

  # reap without blocking shutdown
  [[ -n "${CLONE_CONSUMER_PID}" ]] && wait "${CLONE_CONSUMER_PID}" 2>/dev/null || true
  [[ -n "${TRAIN_CONSUMER_PID}" ]] && wait "${TRAIN_CONSUMER_PID}" 2>/dev/null || true
  [[ -n "${GUNICORN_PID}" ]] && wait "${GUNICORN_PID}" 2>/dev/null || true

  echo "👋 Bye."
}

trap cleanup SIGINT SIGTERM

start_gunicorn() {
  echo "🚀 Starting Gunicorn API ..."
  local reload_flags=()
  if [[ "${API_RELOAD}" == "1" ]]; then
    reload_flags+=(--reload --reload-engine auto)
  fi

  # gthread keeps Flask simple but responsive; each worker has threads
  # setsid => own process group for clean kill
  setsid gunicorn \
    --bind "${API_HOST}:${API_PORT}" \
    --workers "${API_WORKERS}" \
    --threads "${API_THREADS}" \
    --worker-class gthread \
    --timeout "${API_TIMEOUT}" \
    --graceful-timeout "${API_GRACEFUL_TIMEOUT}" \
    --keep-alive "${API_KEEPALIVE}" \
    --log-level "${API_LOGLEVEL}" \
    --worker-tmp-dir /dev/shm \
    "${reload_flags[@]}" \
    main:app &

  GUNICORN_PID=$!
  echo "🦄 Gunicorn PID: ${GUNICORN_PID} (listening on ${API_HOST}:${API_PORT})"
}

start_train_consumer() {
  echo "📥 Starting RabbitMQ training consumer ..."
  if command -v ionice >/dev/null 2>&1; then
    setsid ionice -c "${VC_IONICE_CLASS}" -n "${VC_IONICE_PRIO}" nice -n "${VC_NICE}" \
      python3 -u ./src/train_consumer.py &
  else
    setsid nice -n "${VC_NICE}" python3 -u ./src/train_consumer.py &
  fi
  TRAIN_CONSUMER_PID=$!
  echo "🐰 Train Consumer PID: ${TRAIN_CONSUMER_PID}"
}

start_clone_consumer() {
  echo "🎭 Starting RabbitMQ clone consumer ..."
  if command -v ionice >/dev/null 2>&1; then
    setsid ionice -c "${VC_IONICE_CLASS}" -n "${VC_IONICE_PRIO}" nice -n "${VC_NICE}" \
      python3 -u ./src/clone_consumer.py &
  else
    setsid nice -n "${VC_NICE}" python3 -u ./src/clone_consumer.py &
  fi
  CLONE_CONSUMER_PID=$!
  echo "🎯 Clone Consumer PID: ${CLONE_CONSUMER_PID}"
}

# 1) Start API first so it’s immediately reachable
start_gunicorn

# 2) Start the workers (reduced priority so API stays responsive)
start_train_consumer
start_clone_consumer

# 3) Lightweight supervisor loop that does NOT hog the main thread
#    Avoid `wait -n` portability issues; just poll PIDs.
while true; do
  api_alive=0; train_alive=0; clone_alive=0
  ps -p "${GUNICORN_PID}" >/dev/null 2>&1 && api_alive=1
  ps -p "${TRAIN_CONSUMER_PID}" >/dev/null 2>&1 && train_alive=1
  ps -p "${CLONE_CONSUMER_PID}" >/dev/null 2>&1 && clone_alive=1

  if [[ "${api_alive}" -eq 0 || "${train_alive}" -eq 0 || "${clone_alive}" -eq 0 ]]; then
    [[ "${api_alive}" -eq 0 ]] && echo "❌ Gunicorn exited."
    [[ "${train_alive}" -eq 0 ]] && echo "❌ Train consumer exited."
    [[ "${clone_alive}" -eq 0 ]] && echo "❌ Clone consumer exited."
    break
  fi
  sleep 1
done

cleanup
