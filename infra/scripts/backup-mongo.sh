#!/usr/bin/env bash
#
# backup-mongo.sh — dump the production database from the running mongo container
# into a timestamped, gzipped archive. Invoked nightly by /etc/cron.d/video-studio-backup.
#
# Usage:
#   ./backup-mongo.sh
#
# Environment:
#   APP_ROOT         deployment root                  (default: /opt/video-studio)
#   MONGO_DB         database name                    (default: video-studio)
#   RETENTION_DAYS   archives older than this are removed (default: 14)
#
# Archives land in $APP_ROOT/shared/backups/video-studio-<utc-timestamp>.archive.gz.
# They are NOT off-site: copy them elsewhere if the VPS itself is a single point of
# failure you care about.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/video-studio}"
MONGO_DB="${MONGO_DB:-video-studio}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="$APP_ROOT/current/docker-compose.prod.yml"
ENV_FILE="$APP_ROOT/current/.env"
BACKUP_DIR="$APP_ROOT/shared/backups"

log() { printf '%s ==> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { printf '%s [x] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

case "${1:-}" in
  -h|--help)
    cat <<'USAGE'
Usage: backup-mongo.sh

Environment:
  APP_ROOT        deployment root (default: /opt/video-studio)
  MONGO_DB        database name (default: video-studio)
  RETENTION_DAYS  age at which archives are deleted (default: 14)
USAGE
    exit 0
    ;;
esac

[ -f "$COMPOSE_FILE" ] || die "no compose file at ${COMPOSE_FILE}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$BACKUP_DIR/video-studio-${STAMP}.archive.gz"

log "Dumping ${MONGO_DB} to ${ARCHIVE}"
# Write to .part first: a cron job killed mid-dump must not leave a truncated file
# that looks like a valid restore point.
if ! docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mongo \
  mongodump --quiet --archive --gzip --db "$MONGO_DB" > "${ARCHIVE}.part"; then
  rm -f "${ARCHIVE}.part"
  die 'mongodump failed'
fi

[ -s "${ARCHIVE}.part" ] || { rm -f "${ARCHIVE}.part"; die 'mongodump produced an empty archive'; }
mv "${ARCHIVE}.part" "$ARCHIVE"
chmod 600 "$ARCHIVE"
log "Wrote $(du -h "$ARCHIVE" | cut -f1)"

log "Pruning archives older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'video-studio-*.archive.gz' \
  -mtime "+${RETENTION_DAYS}" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.part' -mtime +1 -delete

log 'Backup complete'
