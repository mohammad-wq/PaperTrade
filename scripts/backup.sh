#!/bin/bash
# ==============================================================================
# Paper Trade - Automatic / Manual Database Backup Script (Linux & macOS)
# Runs pg_dump inside the docker db container and saves a timestamped .sql file.
# ==============================================================================

set -e

# Change to project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Create backups directory if it doesn't exist
mkdir -p backups

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backups/papertrade_backup_${TIMESTAMP}.sql"

echo "=========================================="
echo " Starting Paper Trade Database Backup..."
echo " Target file: $BACKUP_FILE"
echo "=========================================="

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
  echo "Error: Docker is not running. Please start Docker first."
  exit 1
fi

# Run pg_dump against the db container
docker compose exec -T db pg_dump -U postgres papertrade --no-owner --no-acl --clean --if-exists > "$BACKUP_FILE"

# Verify file size
if [ -s "$BACKUP_FILE" ]; then
  FILE_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
  echo "✔ Backup successful! ($FILE_SIZE)"
  echo "Saved to: $BACKUP_FILE"
else
  echo "❌ Error: Backup file is empty."
  rm -f "$BACKUP_FILE"
  exit 1
fi

