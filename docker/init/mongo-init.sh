#!/bin/bash

# Wait until MongoDB is reachable
until mongosh--host mongo--eval "print('MongoDB is up')" &> /dev/null; do
  echo "[~] Waiting for MongoDB to be ready..."
  sleep 2
done

# Check if replica set already initiated
IS_INITIATED = $(mongosh--host mongo--quiet--eval 'rs.status().ok' || echo "0")
if [["$IS_INITIATED" != "1"]]; then
  echo "[+] Initializing MongoDB replica set..."
mongosh--host mongo--eval 'rs.initiate({_id: "rs0", members: [{ _id: 0, host: "mongo:27017" }]})'
else
  echo "[✓] Replica set already initialized."
fi
