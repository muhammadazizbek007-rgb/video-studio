#!/usr/bin/env bash
#
# provision-vps.sh — one-time setup of a fresh Ubuntu 24.04 VPS for video-studio.
#
# Usage:
#   sudo ./provision-vps.sh "ssh-ed25519 AAAA... deploy@ci"
#   sudo DEPLOY_PUBLIC_KEY="ssh-ed25519 AAAA..." ./provision-vps.sh
#
# Arguments:
#   $1                  public key to authorise for the deploy user (or DEPLOY_PUBLIC_KEY)
#
# Environment:
#   DEPLOY_PUBLIC_KEY   same as $1
#   DEPLOY_USER         unprivileged deploy account          (default: deploy)
#   APP_ROOT            deployment root                      (default: /opt/video-studio)
#   SSH_PORT            port to open in ufw for sshd         (default: 22)
#   BACKUP_HOUR         hour (UTC) of the nightly mongo dump (default: 3)
#
# Run as root, once. It is idempotent: re-running it repairs drift and never
# destroys data, certificates or env files that already exist.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_ROOT="${APP_ROOT:-/opt/video-studio}"
SSH_PORT="${SSH_PORT:-22}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"
DEPLOY_PUBLIC_KEY="${1:-${DEPLOY_PUBLIC_KEY:-}}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: sudo provision-vps.sh "<ssh public key>"
       sudo DEPLOY_PUBLIC_KEY="<ssh public key>" provision-vps.sh

Environment:
  DEPLOY_USER  unprivileged deploy account (default: deploy)
  APP_ROOT     deployment root (default: /opt/video-studio)
  SSH_PORT     port opened in ufw for sshd (default: 22)
  BACKUP_HOUR  UTC hour of the nightly mongo dump (default: 3)

Run once, as root, on a fresh Ubuntu 24.04 host. Safe to re-run.
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

[ "$(id -u)" -eq 0 ] || die 'must be run as root'
if [ -z "$DEPLOY_PUBLIC_KEY" ]; then
  usage
  die 'a deploy public key is required (argument or DEPLOY_PUBLIC_KEY)'
fi
case "$DEPLOY_PUBLIC_KEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *|sk-ssh-*\ *) ;;
  *) die 'DEPLOY_PUBLIC_KEY does not look like an OpenSSH public key' ;;
esac

export DEBIAN_FRONTEND=noninteractive

log 'Installing base packages'
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg openssl rsync jq \
  ufw fail2ban cron logrotate unattended-upgrades certbot

log 'Installing Docker Engine from the official apt repository'
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
# shellcheck disable=SC1091
. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "${UBUNTU_CODENAME:-${VERSION_CODENAME}}" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if [ ! -f /etc/docker/daemon.json ]; then
  log 'Capping docker daemon log files'
  install -d -m 0755 /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  },
  "live-restore": true
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

log "Creating the ${DEPLOY_USER} user"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
[ -n "$DEPLOY_HOME" ] || die "cannot resolve the home directory of ${DEPLOY_USER}"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
AUTHORIZED_KEYS="$DEPLOY_HOME/.ssh/authorized_keys"
touch "$AUTHORIZED_KEYS"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"
if grep -qxF "$DEPLOY_PUBLIC_KEY" "$AUTHORIZED_KEYS"; then
  log 'Deploy key already authorised'
else
  printf '%s\n' "$DEPLOY_PUBLIC_KEY" >> "$AUTHORIZED_KEYS"
  log 'Deploy key added'
fi

log 'Hardening sshd'
cat > /etc/ssh/sshd_config.d/99-video-studio.conf <<'SSHD'
# Managed by infra/scripts/provision-vps.sh
PubkeyAuthentication yes
PasswordAuthentication no
PermitRootLogin prohibit-password
KbdInteractiveAuthentication no
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
SSHD
# A bad drop-in locks everyone out of the box, so validate before reloading.
sshd -t || die 'sshd configuration is invalid; the hardening drop-in was NOT applied'
systemctl reload ssh 2>/dev/null || systemctl restart ssh

log 'Configuring ufw'
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

log 'Configuring fail2ban'
cat > /etc/fail2ban/jail.d/video-studio.local <<SSHJAIL
[sshd]
enabled  = true
backend  = systemd
port     = ${SSH_PORT}
maxretry = 4
findtime = 10m
bantime  = 1h
SSHJAIL
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

log "Creating the deployment layout under ${APP_ROOT}"
for dir in \
  "$APP_ROOT" \
  "$APP_ROOT/releases" \
  "$APP_ROOT/current" \
  "$APP_ROOT/shared" \
  "$APP_ROOT/shared/state" \
  "$APP_ROOT/shared/backups" \
  "$APP_ROOT/shared/logs" \
  "$APP_ROOT/shared/certs" \
  "$APP_ROOT/shared/certbot" \
  "$APP_ROOT/shared/certbot/www"
do
  install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$dir"
done
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_ROOT/shared/env"

API_ENV="$APP_ROOT/shared/env/api.env"
if [ ! -f "$API_ENV" ]; then
  cat > "$API_ENV" <<'ENVSTUB'
# Fill this in from infra/env/api.env.example before the first deploy.
# Every value is a secret or an environment-specific URL: it is never in git.
ENVSTUB
  chown "$DEPLOY_USER:$DEPLOY_USER" "$API_ENV"
  chmod 600 "$API_ENV"
  warn "created an EMPTY ${API_ENV} — the api will refuse to start until it is filled in"
fi

DEPLOY_ENV="$APP_ROOT/shared/env/deploy.env"
if [ ! -f "$DEPLOY_ENV" ]; then
  cat > "$DEPLOY_ENV" <<'ENVSTUB'
# Non-secret deploy settings, sourced by deploy.sh and rollback.sh.
# The GHCR token is NEVER stored here: CI passes it in the ssh environment.
GHCR_OWNER=your-github-org-or-user
GHCR_USER=your-github-username
ENVSTUB
  chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_ENV"
  chmod 600 "$DEPLOY_ENV"
  warn "created a placeholder ${DEPLOY_ENV} — set GHCR_OWNER and GHCR_USER"
fi

if [ ! -f "$APP_ROOT/shared/certs/fullchain.pem" ]; then
  log 'Generating a self-signed placeholder certificate so nginx can start'
  # Without this, the TLS server block refers to files that do not exist yet and
  # nginx refuses to boot — which would also take down the ACME webroot that
  # certbot needs to issue the real certificate.
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=$(hostname -f 2>/dev/null || hostname)" \
    -keyout "$APP_ROOT/shared/certs/privkey.pem" \
    -out "$APP_ROOT/shared/certs/fullchain.pem" >/dev/null 2>&1
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_ROOT/shared/certs/"*.pem
  chmod 644 "$APP_ROOT/shared/certs/fullchain.pem"
  chmod 640 "$APP_ROOT/shared/certs/privkey.pem"
fi

log 'Scheduling the nightly mongo backup'
cat > /etc/cron.d/video-studio-backup <<CRON
# Managed by infra/scripts/provision-vps.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 ${BACKUP_HOUR} * * * ${DEPLOY_USER} APP_ROOT=${APP_ROOT} ${APP_ROOT}/current/scripts/backup-mongo.sh >> ${APP_ROOT}/shared/logs/backup.log 2>&1
CRON
chmod 0644 /etc/cron.d/video-studio-backup
systemctl enable --now cron >/dev/null

cat > /etc/logrotate.d/video-studio <<ROTATE
${APP_ROOT}/shared/logs/*.log {
  weekly
  rotate 8
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
  su ${DEPLOY_USER} ${DEPLOY_USER}
}
ROTATE

log 'Enabling unattended security upgrades'
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

cat <<SUMMARY

------------------------------------------------------------------------------
 Provisioning complete.
------------------------------------------------------------------------------

 deploy user : ${DEPLOY_USER} (docker group, key-only ssh)
 app root    : ${APP_ROOT}
 firewall    : ufw, inbound ${SSH_PORT}/80/443 only
 backups     : nightly at ${BACKUP_HOUR}:15 UTC -> ${APP_ROOT}/shared/backups

 NEXT STEPS

 1. Copy the deployment tree onto the box (as ${DEPLOY_USER}, from your machine):

      rsync -az --delete --exclude '.env' ./infra/ ${DEPLOY_USER}@<host>:${APP_ROOT}/current/

 2. Fill in the environment files (as ${DEPLOY_USER}, on the box):

      vim ${APP_ROOT}/shared/env/api.env     # from infra/env/api.env.example
      vim ${APP_ROOT}/shared/env/deploy.env  # GHCR_OWNER, GHCR_USER

 3. Point the DNS A/AAAA record of your domain at this host, then bring the
    stack up once so the ACME webroot is served:

      ${APP_ROOT}/current/scripts/deploy.sh latest

 4. Issue the certificate and switch nginx onto it:

      sudo certbot certonly --webroot -w ${APP_ROOT}/shared/certbot/www \\
        -d <domain> -m <email> --agree-tos --no-eff-email
      ln -sfn /etc/letsencrypt/live/<domain>/fullchain.pem ${APP_ROOT}/shared/certs/fullchain.pem
      ln -sfn /etc/letsencrypt/live/<domain>/privkey.pem  ${APP_ROOT}/shared/certs/privkey.pem
      docker compose -f ${APP_ROOT}/current/docker-compose.prod.yml exec nginx nginx -s reload

    Renewal is already handled by the certbot systemd timer; add the reload hook:

      echo 'docker compose -f ${APP_ROOT}/current/docker-compose.prod.yml exec -T nginx nginx -s reload' \\
        | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
      sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

 5. GitHub repository secrets required by the deploy workflow:

      VPS_HOST              this server's hostname or IP
      VPS_USER              ${DEPLOY_USER}
      VPS_SSH_KEY           the PRIVATE key matching the authorised deploy key
      GHCR_TOKEN            a PAT with write:packages / read:packages
      VITE_API_URL          empty string (same-origin deployment)

 CAVEAT: docker publishes ports by writing its own iptables rules, which bypass
 ufw. Only nginx publishes ports here (80/443, both already open), so the two
 agree — but do not add a `ports:` mapping to another service and expect ufw to
 keep it private. Use the internal networks instead.
------------------------------------------------------------------------------

SUMMARY
