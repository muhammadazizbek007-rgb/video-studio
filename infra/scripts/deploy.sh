#!/usr/bin/env bash
#
# deploy.sh — roll the production stack onto an image tag. Runs ON the VPS as the
# unprivileged deploy user. Nothing is built here; images come from GHCR.
#
# Usage:
#   ./deploy.sh <image-tag>
#
# Arguments:
#   <image-tag>       tag of ghcr.io/$GHCR_OWNER/video-studio-{api,web}, e.g. a git sha
#
# Environment:
#   GHCR_TOKEN        PAT with read:packages. Passed in by CI over ssh, never stored.
#                     When unset, the login and pull are skipped and the tag must
#                     already be present locally (this is what rollback.sh relies on).
#   APP_ROOT          deployment root                     (default: /opt/video-studio)
#   HEALTH_RETRIES    readiness attempts                  (default: 40)
#   HEALTH_INTERVAL   seconds between attempts            (default: 3)
#
# Reads GHCR_OWNER / GHCR_USER from $APP_ROOT/shared/env/deploy.env.
# On a failed readiness check the previous tag is restored and the script exits 1.
set -euo pipefail

TAG="${1:-}"
APP_ROOT="${APP_ROOT:-/opt/video-studio}"
DEPLOY_DIR="$APP_ROOT/current"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"
ENV_FILE="$DEPLOY_DIR/.env"
STATE_DIR="$APP_ROOT/shared/state"
HEALTH_RETRIES="${HEALTH_RETRIES:-40}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: deploy.sh <image-tag>

  <image-tag>  tag of ghcr.io/$GHCR_OWNER/video-studio-{api,web}, e.g. a git sha

Environment:
  GHCR_TOKEN       PAT with read:packages; unset skips login and pull
  APP_ROOT         deployment root (default: /opt/video-studio)
  HEALTH_RETRIES   readiness attempts (default: 40)
  HEALTH_INTERVAL  seconds between attempts (default: 3)
USAGE
}

if [ -z "$TAG" ] || [ "$TAG" = '-h' ] || [ "$TAG" = '--help' ]; then
  usage
  [ -n "$TAG" ] && exit 0
  exit 2
fi

[ -f "$COMPOSE_FILE" ] || die "no compose file at ${COMPOSE_FILE} — rsync infra/ into ${DEPLOY_DIR} first"
[ -f "$APP_ROOT/shared/env/api.env" ] || die "missing ${APP_ROOT}/shared/env/api.env"

if [ -f "$APP_ROOT/shared/env/deploy.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_ROOT/shared/env/deploy.env"
  set +a
fi
: "${GHCR_OWNER:?GHCR_OWNER is not set (see \$APP_ROOT/shared/env/deploy.env)}"
GHCR_USER="${GHCR_USER:-$GHCR_OWNER}"

mkdir -p "$STATE_DIR"
PREVIOUS_TAG="$(cat "$STATE_DIR/current_tag" 2>/dev/null || true)"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

write_tag() {
  # Written with a restrictive umask even though it holds no secret; compose reads
  # this file to interpolate the image references.
  ( umask 077
    printf 'GHCR_OWNER=%s\nIMAGE_TAG=%s\n' "$GHCR_OWNER" "$1" > "$ENV_FILE" )
}

wait_ready() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if compose exec -T api wget -q -O /dev/null http://127.0.0.1:8080/api/health/ready 2>/dev/null; then
      log "api reported ready after ${attempt} attempt(s)"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

LOGGED_IN=0
cleanup() {
  # The credential store would otherwise keep the token in ~/.docker/config.json.
  [ "$LOGGED_IN" -eq 1 ] && docker logout ghcr.io >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ -n "${GHCR_TOKEN:-}" ]; then
  log 'Logging in to ghcr.io'
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  LOGGED_IN=1
else
  warn 'GHCR_TOKEN is not set — skipping login and pull, the tag must already be local'
fi

log "Deploying tag ${TAG} (previous: ${PREVIOUS_TAG:-none})"
write_tag "$TAG"

if [ "$LOGGED_IN" -eq 1 ]; then
  compose pull --quiet api web
fi

compose up -d --remove-orphans

if wait_ready; then
  if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$TAG" ]; then
    printf '%s\n' "$PREVIOUS_TAG" > "$STATE_DIR/previous_tag"
  fi
  printf '%s\n' "$TAG" > "$STATE_DIR/current_tag"
  # Keep a week of superseded images so a rollback never has to hit the network.
  docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
  log "Deployed ${TAG}"
  compose ps
  exit 0
fi

warn "tag ${TAG} never became ready after $((HEALTH_RETRIES * HEALTH_INTERVAL))s"
compose logs --tail 80 api >&2 || true

if [ -z "$PREVIOUS_TAG" ]; then
  die 'no previous tag recorded — the stack is left running on the failed tag for inspection'
fi

warn "Restoring ${PREVIOUS_TAG}"
write_tag "$PREVIOUS_TAG"
compose up -d --remove-orphans
if wait_ready; then
  warn "rolled back to ${PREVIOUS_TAG}"
else
  warn "rollback to ${PREVIOUS_TAG} did NOT become ready either — manual intervention required"
fi
exit 1
