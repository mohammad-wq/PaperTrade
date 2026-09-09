#!/bin/bash
# ==============================================================================
# Paper Trade - One-Click Launcher (Linux & macOS)
# Starts Docker containers and automatically opens your web browser.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================"
echo " Starting Paper Trade Management System..."
echo "======================================================"
echo ""

# 1. Check if Docker is running
echo "[1/3] Checking Docker daemon status..."
if ! docker info > /dev/null 2>&1; then
  echo "[!] Docker is not running. Please start Docker service first."
  exit 1
fi

# 2. Start Docker containers in detached mode
echo "[2/3] Starting database and application containers..."
docker compose up -d

# 3. Poll until application responds on http://localhost:3000
echo ""
echo "[3/3] Waiting for application to initialize..."
ATTEMPTS=0
MAX_ATTEMPTS=30
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  if curl -s -f -L -o /dev/null http://localhost:3000; then
    break
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  printf "."
  sleep 2
done
echo ""

if [ $ATTEMPTS -ge $MAX_ATTEMPTS ]; then
  echo "[!] Warning: Application took longer than expected to respond on http://localhost:3000."
  echo "Check container status with: docker compose logs app"
fi

# Open default browser depending on OS
echo "Opening browser to http://localhost:3000..."
if which xdg-open > /dev/null 2>&1; then
  xdg-open "http://localhost:3000"
elif which open > /dev/null 2>&1; then
  open "http://localhost:3000"
else
  echo "Please open your browser to: http://localhost:3000"
fi

echo ""
echo "======================================================"
echo " Paper Trade is running at: http://localhost:3000"
echo " To connect from a 2nd PC on the LAN, open:"
echo " http://<YOUR-SERVER-LOCAL-IP>:3000"
echo " To stop the application cleanly, run ./stop.sh"
echo "======================================================"
