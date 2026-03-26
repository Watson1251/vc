#!/bin/bash

# Define training parameters
CONFIG_FILE="configs/presets/config_dit_mel_seed_uvit_whisper_small_wavenet.yml"
DATASET_DIR="/data/db/files/STAGING/TRAIN/TRAINING_DIR/66c521bcf4e4eb89b4a2dd4377ad10f9/ready"
RUN_NAME="66c521bcf4e4eb89b4a2dd4377ad10f9"
BATCH_SIZE=4
MAX_STEPS=200
MAX_EPOCHS=1000
SAVE_EVERY=100
NUM_WORKERS=2

# Run training command
python3 train.py --config "$CONFIG_FILE" \
                 --dataset-dir "$DATASET_DIR" \
                 --run-name "$RUN_NAME" \
                 --batch-size "$BATCH_SIZE" \
                 --max-steps "$MAX_STEPS" \
                 --max-epochs "$MAX_EPOCHS" \
                 --save-every "$SAVE_EVERY" \
                 --num-workers "$NUM_WORKERS"
