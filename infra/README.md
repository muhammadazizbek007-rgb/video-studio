# Infrastructure & deployment runbook

One VPS. Root provisions it once; every deploy after that runs as the unprivileged
`deploy` user over SSH. Images are built in GitHub Actions and pushed to GHCR — the
server only pulls and restarts. **Nothing is ever built on the server.**

```
GitHub Actions ──build──▶ ghcr.io/<owner>/video-studio-api:<tag>
                          ghcr.io/<owner>/video-studio-web:<tag>
                                    │
                                    ▼  ssh deploy@vps  scripts/deploy.sh <tag>
                    ┌───────────────────────────────────────────┐
   :80 :443 ───────▶│ nginx  ──/──────▶ web   (static SPA)       │
                    │        ──/api───▶ api   ──▶ mongo (internal)│
                    │        ──/mcp───▶ api                       │
                    │        ──/media─▶ api   ──▶ media volume    │
                    └───────────────────────────────────────────┘
```

## Contents

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | local dev stack — mongo only, on `127.0.0.1:27017` |
| `docker-compose.prod.yml` | production stack — mongo, api, web, nginx |
| `nginx/nginx.conf` | main nginx config (gzip, timeouts, body size, TLS defaults) |
| `nginx/conf.d/app.conf` | the edge server blocks: ACME, HTTPS redirect, routing, security headers |
| `env/api.env.example` | template for the API's production environment |
| `env/web.env.example` | template for the web image's **build-time** args |
| `scripts/provision-vps.sh` | one-time root provisioning of a fresh Ubuntu 24.04 box |
| `scripts/deploy.sh` | deploy an image tag, health-gated, auto-reverting |
| `scripts/rollback.sh` | redeploy the previously recorded tag |
| `scripts/backup-mongo.sh` | nightly `mongodump` into `shared/backups`, 14-day retention |
| `scripts/restore-mongo.sh` | restore a named archive (requires `--confirm`) |

The Dockerfiles live with their apps: `apps/api/Dockerfile`, `apps/web/Dockerfile`.
Both take the **repo root** as build context because the workspace's
`@video-studio/shared` package has to be visible to the build.

## Local development

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm dev
```

Mongo is bound to loopback only. The api and web run from pnpm so hot reload stays
instant; there are no application containers in the dev stack.

## 1. First-time provisioning

On your machine, generate a deploy key pair (the private half becomes a GitHub
secret, the public half is authorised on the box):

```bash
ssh-keygen -t ed25519 -C 'video-studio deploy' -f ~/.ssh/video-studio-deploy -N ''
```

On the fresh Ubuntu 24.04 box, as root:

```bash
git clone https://github.com/<owner>/video-studio.git /tmp/video-studio
sudo /tmp/video-studio/infra/scripts/provision-vps.sh "$(cat ~/.ssh/video-studio-deploy.pub)"
```

That creates the `deploy` user (key-only SSH, docker group), installs Docker Engine
and the compose plugin from Docker's apt repo, hardens sshd, enables ufw (22/80/443
only) and fail2ban, installs certbot, lays out `/opt/video-studio`, drops a
self-signed placeholder certificate so nginx can boot, and schedules the nightly
backup. It is idempotent — re-run it whenever the box drifts.

### On-disk layout

```
/opt/video-studio/
├── current/                     # a copy of this infra/ directory — the active deploy tree
│   ├── docker-compose.prod.yml
│   ├── .env                     # GHCR_OWNER + IMAGE_TAG, written by deploy.sh
│   ├── nginx/
│   └── scripts/
├── releases/<timestamp>/        # snapshots of previous current/ trees
└── shared/                      # survives every deploy
    ├── env/api.env              # API secrets, 0600
    ├── env/deploy.env           # GHCR_OWNER, GHCR_USER — no secrets
    ├── state/current_tag        # what is live
    ├── state/previous_tag       # what rollback.sh goes back to
    ├── certs/{fullchain,privkey}.pem
    ├── certbot/www/             # ACME http-01 webroot
    ├── backups/                 # mongodump archives
    └── logs/backup.log
```

### Push the deploy tree and fill in the environment

From your machine:

```bash
# snapshot the tree that is about to be replaced, then sync
ssh deploy@<host> 'cp -a /opt/video-studio/current /opt/video-studio/releases/$(date -u +%Y%m%dT%H%M%SZ) 2>/dev/null || true'
rsync -az --delete --exclude '.env' ./infra/ deploy@<host>:/opt/video-studio/current/
```

Then on the box, as `deploy`:

```bash
cp /opt/video-studio/current/env/api.env.example /opt/video-studio/shared/env/api.env
chmod 600 /opt/video-studio/shared/env/api.env
vim /opt/video-studio/shared/env/api.env      # every field is documented in the file
vim /opt/video-studio/shared/env/deploy.env   # GHCR_OWNER, GHCR_USER
```

Non-obvious values:

- `AUTH_JWT_SECRET` — `openssl rand -base64 48`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the key file on **one line**: `jq -c . key.json`
- `WEB_APP_URL` / `API_PUBLIC_URL` — both the same `https://<domain>`; the Google
  OAuth client's authorised redirect URI must be
  `https://<domain>/api/auth/google/callback`
- `MONGODB_URI` — `mongodb://mongo:27017/video-studio`. Mongo is on an `internal:
  true` docker network and is never published to the host, which is why it runs
  without authentication.

## 2. GitHub secrets

Set these on the repository (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `VPS_HOST` | hostname or IP of the VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | contents of `~/.ssh/video-studio-deploy` (the **private** key) |
| `GHCR_TOKEN` | PAT with `write:packages` (build) and `read:packages` (pull) |
| `VITE_API_URL` | empty string — the SPA and the API share one origin |

`GITHUB_TOKEN` is enough to push to GHCR from within Actions; `GHCR_TOKEN` exists so
the VPS can pull. It is passed into the SSH session as an environment variable and
is never written to the server's disk — `deploy.sh` logs out of GHCR on exit.

The images the workflow must produce:

```
ghcr.io/<owner>/video-studio-api:<tag>
ghcr.io/<owner>/video-studio-web:<tag>
```

built with the repo root as context:

```bash
docker build -f apps/api/Dockerfile -t ghcr.io/<owner>/video-studio-api:<tag> .
docker build -f apps/web/Dockerfile --build-arg VITE_API_URL= \
  -t ghcr.io/<owner>/video-studio-web:<tag> .
```

Use the commit SHA as `<tag>` — rollback needs a tag that identifies exactly one
build, which `latest` does not.

## 3. Issuing the TLS certificate

Point the domain's A/AAAA record at the VPS first, then bring the stack up once so
that nginx serves the ACME webroot (the placeholder certificate keeps port 443
alive in the meantime; browsers will warn until the real certificate is in place):

```bash
/opt/video-studio/current/scripts/deploy.sh <tag>

sudo certbot certonly --webroot -w /opt/video-studio/shared/certbot/www \
  -d <domain> -m <email> --agree-tos --no-eff-email

ln -sfn /etc/letsencrypt/live/<domain>/fullchain.pem /opt/video-studio/shared/certs/fullchain.pem
ln -sfn /etc/letsencrypt/live/<domain>/privkey.pem  /opt/video-studio/shared/certs/privkey.pem

docker compose -f /opt/video-studio/current/docker-compose.prod.yml exec nginx nginx -s reload
```

`nginx/conf.d/app.conf` points at `/etc/nginx/certs/{fullchain,privkey}.pem`, which
is `shared/certs/` mounted read-only. The symlinks resolve inside the container
because `/etc/letsencrypt` is mounted too. Nothing in the nginx config mentions the
domain, so this works unchanged for any hostname.

Renewal runs from certbot's systemd timer. Add the reload hook once:

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
docker compose -f /opt/video-studio/current/docker-compose.prod.yml exec -T nginx nginx -s reload
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

## 4. Deploying

From CI, or by hand:

```bash
ssh deploy@<host> "GHCR_TOKEN=<token> /opt/video-studio/current/scripts/deploy.sh <tag>"
```

`deploy.sh`:

1. reads `GHCR_OWNER`/`GHCR_USER` from `shared/env/deploy.env`;
2. logs in to GHCR from stdin (never a file), records the currently live tag;
3. writes `current/.env` with the new `IMAGE_TAG`, pulls, `docker compose up -d`;
4. polls `/api/health/ready` inside the api container — 40 attempts, 3s apart;
5. on success updates `state/current_tag` and `state/previous_tag` and prunes images
   older than a week; on failure prints the last 80 api log lines, restores the
   previous tag, and exits non-zero.

Tune the gate with `HEALTH_RETRIES` and `HEALTH_INTERVAL`.

Only the deploy tree changed (nginx config, compose file)? Re-`rsync` `infra/` into
`current/` and re-run `deploy.sh` with the tag that is already live.

## 5. Rolling back

```bash
ssh deploy@<host> /opt/video-studio/current/scripts/rollback.sh          # previous tag
ssh deploy@<host> /opt/video-studio/current/scripts/rollback.sh <tag>    # a specific tag
```

No `GHCR_TOKEN` is needed as long as the image is still in the local docker cache —
`deploy.sh` only prunes images older than 7 days. Pass `GHCR_TOKEN` to force a pull
of an older tag. Rollback goes through the same readiness gate as a deploy.

## 6. Backups

`mongodump` runs nightly at 03:15 UTC from `/etc/cron.d/video-studio-backup`, writing
`shared/backups/video-studio-<utc>.archive.gz` and deleting archives older than 14
days. Log: `shared/logs/backup.log` (rotated weekly, 8 kept).

```bash
/opt/video-studio/current/scripts/backup-mongo.sh          # on demand
ls -lh /opt/video-studio/shared/backups
```

These archives sit on the same disk as the database. Pull them somewhere else if you
care about losing the whole VPS:

```bash
rsync -az deploy@<host>:/opt/video-studio/shared/backups/ ./backups/
```

### Restoring

Destructive — every collection in the archive is dropped and rewritten. The api is
stopped for the duration and restarted afterwards:

```bash
/opt/video-studio/current/scripts/restore-mongo.sh \
  /opt/video-studio/shared/backups/video-studio-20260802T031500Z.archive.gz --confirm
```

The script refuses to do anything without the literal `--confirm`.

**Generated videos are not in these archives.** They live in the `media` docker
volume; a database restore that predates a video leaves the file orphaned rather than
broken. To back the media up as well:

```bash
docker run --rm -v video-studio_media:/media -v /opt/video-studio/shared/backups:/out \
  alpine tar czf /out/media-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /media .
```

## 7. Where things live

| What | Where |
| --- | --- |
| Generated videos & uploads | docker volume `video-studio_media` → `/app/var/media` in the api |
| Database | docker volume `video-studio_mongo-data` |
| Container logs | `docker compose -f /opt/video-studio/current/docker-compose.prod.yml logs -f api` |
| nginx access/error logs | inside the nginx container, `/var/log/nginx/` (also in `docker logs`) |
| Backup log | `/opt/video-studio/shared/logs/backup.log` |
| Live/previous tag | `/opt/video-studio/shared/state/{current_tag,previous_tag}` |

Every container logs through `json-file` capped at 10 MB × 5 files, and the docker
daemon carries the same default — an unbounded container log is the most common way
a small VPS runs out of disk.

Useful checks:

```bash
cd /opt/video-studio/current
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec api wget -qO- http://127.0.0.1:8080/api/health/ready
curl -sI https://<domain>/            # security headers
curl -N https://<domain>/api/generations/<id>/events   # SSE must stream, not buffer
df -h /var/lib/docker
```

## 8. Notes and caveats

- **Docker bypasses ufw.** Published ports are inserted into iptables ahead of ufw's
  chains. Only nginx publishes ports here (80/443, both already open), so the two
  agree. Do not add a `ports:` mapping to another service and assume ufw hides it —
  put the service on the internal `data` network instead.
- **SSE.** `/api/generations/*/events` is matched by a regex location with
  `proxy_buffering off` and a 3600s read timeout. A plain `location /api/` would
  buffer the stream and the UI would only see the final status.
- **CSP.** `style-src` keeps `'unsafe-inline'` because React and motion write animated
  values into the `style` attribute, which CSP counts as inline style. `img-src` and
  `media-src` allow `blob:` for local previews. There are no external font, CDN or
  analytics hosts — if you add one, the header in `nginx/conf.d/app.conf` must be
  updated or the asset is blocked.
- **Uploads** are capped at 12 MB by `client_max_body_size`; the API enforces its own
  smaller per-file limit.
- The api container runs as uid 1001 with `tini` as PID 1, so `docker compose down`
  is a graceful SIGTERM rather than a 10-second kill.
