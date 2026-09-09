#!/bin/bash
# ==============================================================================
# Paper Trade - One-Click Shutdown (Linux & macOS)
# Stops and cleans up Docker containers cleanly.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================"
echo " Stopping Paper Trade Management System..."
echo "======================================================"

if ! docker info > /dev/null 2>&1; then
  echo "[!] Docker is not running or already stopped."
  exit 0
fi

docker compose down

echo ""
echo "======================================================"
echo " Application stopped cleanly. All data is safely preserved."
echo "======================================================"
