#!/usr/bin/env bash
#
# restore-mongo.sh — restore a mongodump archive over the production database.
#
# Usage:
#   ./restore-mongo.sh <archive> --confirm
#   ./restore-mongo.sh /opt/video-studio/shared/backups/video-studio-20260802T031500Z.archive.gz --confirm
#
# Arguments:
#   <archive>    path to a .archive.gz produced by backup-mongo.sh
#   --confirm    required. Without it the script refuses to run.
#
# Environment:
#   APP_ROOT     deployment root (default: /opt/video-studio)
#   MONGO_DB     database name   (default: video-studio)
#
# THIS IS DESTRUCTIVE: every collection in the archive is dropped and rewritten.
# The api is stopped for the duration so nothing writes into a half-restored
# database, and restarted afterwards even if the restore fails.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/video-studio}"
MONGO_DB="${MONGO_DB:-video-studio}"
COMPOSE_FILE="$APP_ROOT/current/docker-compose.prod.yml"
ENV_FILE="$APP_ROOT/current/.env"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: restore-mongo.sh <archive> --confirm

  <archive>  path to a .archive.gz written by backup-mongo.sh
  --confirm  mandatory acknowledgement that the current database is dropped

Environment:
  APP_ROOT   deployment root (default: /opt/video-studio)
  MONGO_DB   database name (default: video-studio)
USAGE
}

ARCHIVE="${1:-}"
CONFIRM="${2:-}"

case "$ARCHIVE" in
  ''|-h|--help) usage; [ -n "$ARCHIVE" ] && exit 0; exit 2 ;;
esac

[ "$CONFIRM" = '--confirm' ] || {
  usage
  die 'refusing to restore without --confirm'
}

[ -f "$ARCHIVE" ] || die "no such archive: ${ARCHIVE}"
[ -s "$ARCHIVE" ] || die "archive is empty: ${ARCHIVE}"
[ -f "$COMPOSE_FILE" ] || die "no compose file at ${COMPOSE_FILE}"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

restart_api() {
  log 'Starting the api again'
  compose up -d api || warn 'could not restart the api — do it by hand'
}

log "Restoring ${MONGO_DB} from ${ARCHIVE}"
log 'Stopping the api'
compose stop api
trap restart_api EXIT

if compose exec -T mongo mongorestore --quiet --archive --gzip --drop < "$ARCHIVE"; then
  log 'Restore complete'
else
  die 'mongorestore failed — the database may be in a partial state'
fi
