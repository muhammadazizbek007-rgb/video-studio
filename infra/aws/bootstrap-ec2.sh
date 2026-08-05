#!/usr/bin/env bash
#
# bootstrap-ec2.sh — turn a freshly launched EC2 instance into a deploy target.
#
# Connects as `ubuntu` with the admin key, copies infra/ up, and runs
# provision-vps.sh there: docker, the unprivileged `deploy` user authorised with the
# deploy key, sshd hardening, ufw, fail2ban, /opt/video-studio and the nightly backup.
#
# Usage:
#   ./infra/aws/bootstrap-ec2.sh <public-ip>
#   NAME=video-studio KEY_DIR=~/.ssh ./infra/aws/bootstrap-ec2.sh 13.51.x.x
#
# Environment:
#   NAME         resource prefix used by provision-ec2.sh   (default: video-studio)
#   KEY_DIR      where that script wrote the keys           (default: ~/.ssh)
#   ADMIN_USER   cloud image default account                (default: ubuntu)
#   DEPLOY_USER  unprivileged deploy account to create      (default: deploy)
#   APP_ROOT     deployment root on the box                 (default: /opt/video-studio)
#
# Safe to re-run: provision-vps.sh is itself idempotent and never overwrites an
# env file, a certificate or a database that already exists.
set -euo pipefail

NAME="${NAME:-video-studio}"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
ADMIN_USER="${ADMIN_USER:-ubuntu}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_ROOT="${APP_ROOT:-/opt/video-studio}"
HOST="${1:-}"

ADMIN_KEY_FILE="${KEY_DIR}/${NAME}-admin"
DEPLOY_KEY_FILE="${KEY_DIR}/${NAME}-deploy"
KNOWN_HOSTS_FILE="${KEY_DIR}/${NAME}-known_hosts"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$HOST" ] || die 'usage: bootstrap-ec2.sh <public-ip>'
[ -f "$ADMIN_KEY_FILE" ] || die "admin key not found at ${ADMIN_KEY_FILE} — run provision-ec2.sh first"
[ -f "${DEPLOY_KEY_FILE}.pub" ] || die "deploy public key not found at ${DEPLOY_KEY_FILE}.pub"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "${REPO_ROOT}/infra/scripts/provision-vps.sh" ] || die "cannot locate infra/ from ${REPO_ROOT}"

# The host key was captured at launch. Verify against it rather than disabling the
# check — an unverified first connection is exactly when a substitution would work.
if [ ! -s "$KNOWN_HOSTS_FILE" ]; then
  warn "no known_hosts at ${KNOWN_HOSTS_FILE} — scanning now"
  ssh-keyscan -T 10 -t ed25519,rsa "$HOST" > "$KNOWN_HOSTS_FILE" 2>/dev/null || true
  [ -s "$KNOWN_HOSTS_FILE" ] || die 'the host is not answering on port 22'
fi

SSH_OPTS=(-i "$ADMIN_KEY_FILE"
          -o "UserKnownHostsFile=${KNOWN_HOSTS_FILE}"
          -o StrictHostKeyChecking=yes
          -o BatchMode=yes
          -o ConnectTimeout=15)

log "Connecting to ${ADMIN_USER}@${HOST}"
ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" 'true' \
  || die "cannot ssh in — check the security group allows 22 from this address"

# cloud-init still holds the apt lock for a minute or two after the status checks
# pass; apt-get would fail with "could not get lock" if provisioning started now.
log 'Waiting for cloud-init to finish'
ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" 'cloud-init status --wait >/dev/null 2>&1 || true'

log 'Uploading infra/'
# ubuntu cannot write /opt yet, so stage in the home directory and move with sudo.
ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" "rm -rf ~/infra && mkdir -p ~/infra"
if command -v rsync >/dev/null 2>&1; then
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "${REPO_ROOT}/infra/" "${ADMIN_USER}@${HOST}:~/infra/"
else
  # Git Bash on Windows ships no rsync. tar over ssh needs nothing on either end.
  tar -C "${REPO_ROOT}" -czf - infra | ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" 'tar -xzf - -C ~ --strip-components=0'
fi

log 'Running provision-vps.sh (docker, deploy user, ufw, fail2ban, layout)'
DEPLOY_PUBLIC_KEY="$(cat "${DEPLOY_KEY_FILE}.pub")"
ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" \
  "chmod +x ~/infra/scripts/*.sh && sudo DEPLOY_USER='${DEPLOY_USER}' APP_ROOT='${APP_ROOT}' ~/infra/scripts/provision-vps.sh '${DEPLOY_PUBLIC_KEY}'"

log "Seeding ${APP_ROOT}/current from the uploaded tree"
ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" \
  "sudo cp -a ~/infra/. '${APP_ROOT}/current/' && sudo chown -R '${DEPLOY_USER}:${DEPLOY_USER}' '${APP_ROOT}/current' && sudo chmod +x '${APP_ROOT}/current/scripts/'*.sh"

# The per-domain vhosts name certificate files that do not exist on a fresh box, and
# nginx refuses to start when an ssl_certificate path is missing — which would take
# down the ACME webroot needed to fix it. Self-signed placeholders break that loop.
log 'Creating placeholder certificates so nginx can boot'
ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${HOST}" \
  "sudo APP_ROOT='${APP_ROOT}' '${APP_ROOT}/current/scripts/issue-certs.sh' --placeholders-only"

log 'Verifying the deploy user can log in and reach docker'
ssh -i "$DEPLOY_KEY_FILE" -o "UserKnownHostsFile=${KNOWN_HOSTS_FILE}" \
    -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15 \
    "${DEPLOY_USER}@${HOST}" 'docker version --format "{{.Server.Version}}"' \
  || die "the ${DEPLOY_USER} account cannot use docker — re-run provisioning"

cat <<SUMMARY

------------------------------------------------------------------------------
 ${HOST} is provisioned
------------------------------------------------------------------------------

 SET THESE ON THE REPOSITORY  (Settings -> Secrets and variables -> Actions)

 Secrets:
   VPS_HOST              ${HOST}
   VPS_SSH_KEY           <contents of ${DEPLOY_KEY_FILE}>
   VPS_SSH_KNOWN_HOSTS   <contents of ${KNOWN_HOSTS_FILE}>

 Variables:
   VPS_USER              ${DEPLOY_USER}
   DEPLOY_PATH           ${APP_ROOT}
   VITE_API_URL          https://studio-api.haywan.uz

 With the gh CLI, from the repo root:

   gh secret set VPS_HOST --body '${HOST}'
   gh secret set VPS_SSH_KEY < '${DEPLOY_KEY_FILE}'
   gh secret set VPS_SSH_KNOWN_HOSTS < '${KNOWN_HOSTS_FILE}'
   gh variable set VPS_USER --body '${DEPLOY_USER}'
   gh variable set DEPLOY_PATH --body '${APP_ROOT}'
   gh variable set VITE_API_URL --body 'https://studio-api.haywan.uz'

 STILL TO DO ON THE BOX (as ${DEPLOY_USER}@${HOST})

   1. Deploy settings:
        vim ${APP_ROOT}/shared/env/deploy.env     # GHCR_OWNER, GHCR_USER

   2. Application secrets — every field is documented in the example file:
        cp ${APP_ROOT}/current/env/api.env.example ${APP_ROOT}/shared/env/api.env
        chmod 600 ${APP_ROOT}/shared/env/api.env
        vim ${APP_ROOT}/shared/env/api.env

      For the split-domain setup:
        WEB_APP_URL=https://studio.haywan.uz
        API_PUBLIC_URL=https://studio-api.haywan.uz
        CORS_ORIGINS=https://studio.haywan.uz

   3. Point DNS at ${HOST}, then issue both certificates:
        sudo ${APP_ROOT}/current/scripts/issue-certs.sh you@example.com

 The api container refuses to start until api.env is filled in — that is the
 readiness gate doing its job, not a broken deploy.
------------------------------------------------------------------------------

SUMMARY
