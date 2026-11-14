#!/usr/bin/env bash
# Restore a dump made by backup_db.sh into a database, for the restore drill.
# Usage: RESTORE_DATABASE_URL=postgresql://... ./scripts/restore_db.sh backups/sahayak_YYYYMMDD_HHMMSS.dump
#
# The target comes from RESTORE_DATABASE_URL, never DATABASE_URL, so the drill
# cannot overwrite the live database by leaving an environment variable set.

set -euo pipefail

DUMP="${1:?usage: restore_db.sh <dump file>}"
TARGET="${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL to the scratch database}"

if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET" = "$DATABASE_URL" ]; then
  echo "Refusing: RESTORE_DATABASE_URL is the same as DATABASE_URL (the live database)." >&2
  exit 1
fi

echo "Restoring $DUMP"
pg_restore --no-owner --no-privileges --clean --if-exists -d "$TARGET" "$DUMP"

echo "Row counts in the restored database:"
psql "$TARGET" -At -c "SELECT 'users', count(*) FROM users UNION ALL SELECT 'partners', count(*) FROM partners UNION ALL SELECT 'jobs', count(*) FROM jobs UNION ALL SELECT 'job_status_history', count(*) FROM job_status_history UNION ALL SELECT 'payments', count(*) FROM payments;"
echo "Compare these with the live database before calling the drill passed."
