#!/bin/bash
# ==============================================================================
# Paper Trade - Database Restore Script (Linux & macOS)
# Restores a specified .sql file into the Docker PostgreSQL container.
# Usage: ./scripts/restore.sh [path_to_backup.sql]
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <path-to-sql-file>"
  echo "Example: $0 backups/papertrade_backup_20260908_120000.sql"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: File '$BACKUP_FILE' does not exist."
  exit 1
fi

echo "=========================================================="
echo " WARNING: Restoring will overwrite existing database data."
echo " Selected file: $BACKUP_FILE"
echo "=========================================================="
read -p "Are you sure you want to proceed? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

echo "Restoring database..."
cat "$BACKUP_FILE" | docker compose exec -T db psql -U postgres papertrade

echo "✔ Database restored successfully!"

