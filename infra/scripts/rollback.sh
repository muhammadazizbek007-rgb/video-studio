#!/usr/bin/env bash
#
# rollback.sh — redeploy the tag that was live before the current one.
#
# Usage:
#   ./rollback.sh            # roll back to $APP_ROOT/shared/state/previous_tag
#   ./rollback.sh <tag>      # roll back to an explicit tag
#
# Environment:
#   APP_ROOT     deployment root (default: /opt/video-studio)
#   GHCR_TOKEN   optional; without it the image must already be present locally,
#                which is the normal case since deploy.sh only prunes after 7 days.
#
# Delegates to deploy.sh, so the rolled-back tag goes through the same readiness
# gate and the tag bookkeeping stays consistent (rolling back twice toggles).
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/video-studio}"
STATE_DIR="$APP_ROOT/shared/state"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: rollback.sh [<image-tag>]

  no argument  roll back to the recorded previous tag
  <image-tag>  roll back to this tag instead

Environment:
  APP_ROOT     deployment root (default: /opt/video-studio)
  GHCR_TOKEN   optional; omit to reuse the locally cached image
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  [ -f "$STATE_DIR/previous_tag" ] || die "no previous tag recorded in ${STATE_DIR}/previous_tag"
  TARGET="$(cat "$STATE_DIR/previous_tag")"
fi
[ -n "$TARGET" ] || die 'the recorded previous tag is empty'

CURRENT="$(cat "$STATE_DIR/current_tag" 2>/dev/null || true)"
[ "$TARGET" != "$CURRENT" ] || die "tag ${TARGET} is already the running tag"

log "Rolling back from ${CURRENT:-unknown} to ${TARGET}"
exec "$SCRIPT_DIR/deploy.sh" "$TARGET"
