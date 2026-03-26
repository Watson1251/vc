#!/bin/bash
# Optional: confirm you're in /vc
cd /vc

# Install Python dependencies
pip install --upgrade pip setuptools wheel
pip install -r /vc/env/requirements.txt