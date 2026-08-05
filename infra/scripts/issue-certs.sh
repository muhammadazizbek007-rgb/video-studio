#!/usr/bin/env bash
#
# issue-certs.sh — placeholder certificates, then real ones from Let's Encrypt.
#
# The split-domain deployment serves two hostnames from the containerised nginx, and
# each needs its own certificate under shared/certs/<domain>/. nginx refuses to start
# when an ssl_certificate path does not exist, so this runs in two phases:
#
#   phase 1  self-sign a placeholder for every domain that has none. Cheap, offline,
#            and it is what lets nginx boot on a box that has never seen certbot —
#            including the boot that serves the ACME webroot phase 2 needs.
#   phase 2  certbot webroot for each domain, then repoint shared/certs/<domain>/ at
#            /etc/letsencrypt/live/<domain>/ and reload nginx.
#
# Usage:
#   sudo ./issue-certs.sh --placeholders-only          # phase 1 only (provisioning)
#   sudo ./issue-certs.sh you@example.com              # both phases
#   sudo DOMAINS='a.example.com b.example.com' ./issue-certs.sh you@example.com
#
# Environment:
#   DOMAINS    space-separated hostnames  (default: studio.haywan.uz studio-api.haywan.uz)
#   APP_ROOT   deployment root            (default: /opt/video-studio)
#   STAGING    1 to use the Let's Encrypt staging CA (untrusted certs, no rate limit)
#
# Idempotent. An existing real certificate is never replaced by a placeholder, and
# certbot is skipped for a domain whose certificate is already live.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/video-studio}"
DOMAINS="${DOMAINS:-studio.haywan.uz studio-api.haywan.uz}"
CERT_ROOT="${APP_ROOT}/shared/certs"
WEBROOT="${APP_ROOT}/shared/certbot/www"
COMPOSE_FILE="${APP_ROOT}/current/docker-compose.prod.yml"
PLACEHOLDERS_ONLY=0
EMAIL=''

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  --placeholders-only) PLACEHOLDERS_ONLY=1 ;;
  -h|--help)
    sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  '') die 'usage: issue-certs.sh <email> | issue-certs.sh --placeholders-only' ;;
  *)  EMAIL="$1" ;;
esac

[ "$(id -u)" -eq 0 ] || die 'must be run as root (certbot writes /etc/letsencrypt)'

DEPLOY_USER="$(stat -c '%U' "$APP_ROOT" 2>/dev/null || echo root)"

# ---------------------------------------------------------------------------
# Phase 1 — placeholders.
# ---------------------------------------------------------------------------
for domain in $DOMAINS; do
  dir="${CERT_ROOT}/${domain}"
  install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$dir"

  if [ -e "${dir}/fullchain.pem" ]; then
    log "${domain}: certificate already present"
    continue
  fi

  log "${domain}: generating a self-signed placeholder"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=${domain}" \
    -keyout "${dir}/privkey.pem" \
    -out    "${dir}/fullchain.pem" >/dev/null 2>&1
  chown "$DEPLOY_USER:$DEPLOY_USER" "${dir}/fullchain.pem" "${dir}/privkey.pem"
  chmod 644 "${dir}/fullchain.pem"
  chmod 640 "${dir}/privkey.pem"
done

if [ "$PLACEHOLDERS_ONLY" -eq 1 ]; then
  log 'Placeholders in place — nginx can now start. Re-run with an email once DNS resolves.'
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase 2 — real certificates.
# ---------------------------------------------------------------------------
command -v certbot >/dev/null 2>&1 || die 'certbot is not installed — run provision-vps.sh'
[ -f "$COMPOSE_FILE" ] || die "no compose file at ${COMPOSE_FILE} — deploy once before issuing certificates"

install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$WEBROOT"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

reload_nginx() {
  # `nginx -t` first: a reload with a broken config leaves the old workers serving,
  # which looks like the change silently did nothing.
  if compose exec -T nginx nginx -t >/dev/null 2>&1; then
    compose exec -T nginx nginx -s reload >/dev/null 2>&1 && return 0
  fi
  warn 'nginx did not reload — check: docker compose -f '"$COMPOSE_FILE"' logs nginx'
  return 1
}

if ! compose ps --status running --services 2>/dev/null | grep -qx nginx; then
  die "the nginx container is not running — start the stack first: ${APP_ROOT}/current/scripts/deploy.sh <tag>"
fi

PUBLIC_IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"

STAGING_FLAG=''
if [ "${STAGING:-0}" = '1' ]; then
  STAGING_FLAG='--staging'
  warn 'using the staging CA — the resulting certificates are NOT trusted by browsers'
fi

issued_any=0
for domain in $DOMAINS; do
  if [ -d "/etc/letsencrypt/live/${domain}" ]; then
    log "${domain}: Let's Encrypt certificate already issued"
  else
    # A domain whose A record has not propagated fails http-01 and burns one of the
    # five-per-week duplicate-certificate attempts. Checking first is free.
    resolved="$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR==1{print $1}')"
    if [ -z "$resolved" ]; then
      warn "${domain}: does not resolve yet — skipping. Add the A record and re-run."
      continue
    fi
    if [ -n "$PUBLIC_IP" ] && [ "$resolved" != "$PUBLIC_IP" ]; then
      warn "${domain}: resolves to ${resolved}, this host is ${PUBLIC_IP} — skipping."
      warn "  (behind a proxy or a CDN? issue the certificate there instead)"
      continue
    fi

    log "${domain}: requesting a certificate"
    certbot certonly --webroot -w "$WEBROOT" \
      -d "$domain" -m "$EMAIL" \
      --agree-tos --no-eff-email --non-interactive $STAGING_FLAG \
      || { warn "${domain}: certbot failed — see /var/log/letsencrypt/letsencrypt.log"; continue; }
    issued_any=1
  fi

  # Symlinks, not copies: certbot rewrites live/<domain>/ in place on renewal, and a
  # copy would quietly go stale ninety days later. Both paths exist inside the nginx
  # container because /etc/letsencrypt is mounted read-only alongside shared/certs.
  ln -sfn "/etc/letsencrypt/live/${domain}/fullchain.pem" "${CERT_ROOT}/${domain}/fullchain.pem"
  ln -sfn "/etc/letsencrypt/live/${domain}/privkey.pem"   "${CERT_ROOT}/${domain}/privkey.pem"
  log "${domain}: shared/certs/${domain}/ now points at Let's Encrypt"
done

# The renewal timer is installed by the certbot package; it only needs to know how to
# make nginx pick a renewed certificate up.
HOOK='/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh'
if [ ! -f "$HOOK" ]; then
  log 'Installing the renewal reload hook'
  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  cat > "$HOOK" <<HOOKEOF
#!/bin/sh
# Managed by infra/scripts/issue-certs.sh
docker compose -f ${COMPOSE_FILE} exec -T nginx nginx -s reload
HOOKEOF
  chmod +x "$HOOK"
fi

reload_nginx && log 'nginx reloaded'

cat <<SUMMARY

------------------------------------------------------------------------------
 Certificates
------------------------------------------------------------------------------
$(for d in $DOMAINS; do
    if [ -d "/etc/letsencrypt/live/${d}" ]; then
      printf ' %-28s Let'"'"'s Encrypt, expires %s\n' "$d" \
        "$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/${d}/fullchain.pem" 2>/dev/null | cut -d= -f2)"
    else
      printf ' %-28s SELF-SIGNED placeholder — browsers will warn\n' "$d"
    fi
  done)

 Renewal runs from certbot's systemd timer; verify it end to end with:
   sudo certbot renew --dry-run

 $( [ "$issued_any" -eq 1 ] && echo 'Check the live headers:' || echo 'Nothing new was issued this run.' )
   curl -sI https://$(set -- $DOMAINS; echo "$1")/
------------------------------------------------------------------------------

SUMMARY
