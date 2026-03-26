echo "Running gunicorn"
# Sync workers are "silent" for the whole request; --timeout must exceed worst-case
# infer/resample/GPU time or gunicorn kills the worker mid-request (SystemExit in librosa/soxr).
: "${GUNICORN_TIMEOUT:=600}"
exec gunicorn --timeout "${GUNICORN_TIMEOUT}" -b 0.0.0.0:8000 main:app --reload