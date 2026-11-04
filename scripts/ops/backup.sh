#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${BACKUP_PASSWORD:?Set BACKUP_PASSWORD}"
exec node "$(dirname "$0")/backup.mjs" "${1:-./private/backups}"
