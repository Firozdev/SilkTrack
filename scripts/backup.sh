#!/usr/bin/env bash
# Daily backup on the VPS: database dump + uploaded files, keeping 14 days.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
DEST="${BACKUP_DIR:-/var/backups/silktrack}"
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DEST/db_$STAMP.dump"
$COMPOSE exec -T app tar -C /app -czf - uploads > "$DEST/uploads_$STAMP.tgz"
find "$DEST" -type f -mtime +14 -delete
echo "Backup written to $DEST ($STAMP)"
