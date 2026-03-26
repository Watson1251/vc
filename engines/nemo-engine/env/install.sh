#!/bin/bash
set -e
cd /nemo-engine

# We are already inside the venv due to PATH env from Dockerfile
python -m pip install --upgrade pip setuptools wheel

# Unpinned torch/torchaudio on default PyPI often pull CUDA 12.8+ builds that need a
# *newer* driver than many hosts (PyTorch then errors: "driver too old (found 12070)").
# Install from the cu124 wheel index first, then re-apply after NeMo so deps can't
# replace them with an incompatible default wheel.
PYTORCH_INDEX_URL="${PYTORCH_INDEX_URL:-https://download.pytorch.org/whl/cu124}"
python -m pip install --index-url "${PYTORCH_INDEX_URL}" torch torchvision torchaudio

python -m pip install -r /nemo-engine/env/requirements.txt

python -m pip install --no-cache-dir "nemo_toolkit[asr]"

python -m pip install --index-url "${PYTORCH_INDEX_URL}" torch torchvision torchaudio --force-reinstall