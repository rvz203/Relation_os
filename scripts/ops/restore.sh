#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set the isolated restore target DATABASE_URL}"
: "${BACKUP_PASSWORD:?Set BACKUP_PASSWORD}"
: "${RESTORE_ACK:?Set RESTORE_ACK=I_HAVE_STOPPED_SMS after stopping the worker}"
if [[ "$RESTORE_ACK" != "I_HAVE_STOPPED_SMS" ]]; then exit 1; fi
exec node "$(dirname "$0")/restore.mjs" "${1:?Pass the encrypted backup file}"
