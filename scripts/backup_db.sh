#!/usr/bin/env bash
# Backup PostgreSQL database to a timestamped file.
# Usage: ./scripts/backup_db.sh

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
BACKUP_FILE="${BACKUP_DIR}/sahayak_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "Starting backup: $BACKUP_FILE"
pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_FILE"
echo "Backup complete: $BACKUP_FILE"
