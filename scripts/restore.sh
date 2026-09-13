#!/bin/bash
# ==============================================================================
# Paper Trade - Database Restore Script (Linux & macOS)
# Restores a specified .dump file (custom format -F c) using pg_restore.
# Usage: ./scripts/restore.sh [path_to_backup.dump]
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <path-to-dump-file>"
  echo "Example: $0 backups/local/papertrade_2026-09-13_1405.dump"
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
if command -v docker >/dev/null 2>&1 && docker compose ps 2>/dev/null | grep -q "db.*running"; then
  echo "Restoring via Docker PostgreSQL container..."
  docker compose exec -T db pg_restore -U "${PGUSER:-papertrade}" -d "${PGDATABASE:-papertrade}" --clean --if-exists -v -F c < "$BACKUP_FILE"
else
  echo "Restoring via native pg_restore..."
  pg_restore -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-papertrade}" -d "${PGDATABASE:-papertrade}" --clean --if-exists -v -F c "$BACKUP_FILE"
fi

echo "✔ Database restored successfully!"

