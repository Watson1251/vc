echo "Running gunicorn"
gunicorn -b vc-engine:8000 main:app --reload
