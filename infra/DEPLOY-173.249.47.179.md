# Deploying to 173.249.47.179 (shared box)

This host is **not** a blank VPS. It already runs a production site — `api.umbra.uz`, a
Node service behind an nginx installed on the host — with a valid Let's Encrypt
certificate. That nginx owns ports 80 and 443.

So the standard runbook in [README.md](README.md) does **not** apply here:

| Standard runbook step | Why it is wrong for this box |
| --- | --- |
| `provision-vps.sh` | Hardens `sshd` and enables a `ufw` allow-list of 22/80/443. Both can cut off services already running here. **Do not run it.** |
| `docker-compose.prod.yml` | Includes its own nginx bound to 80/443, which collides with the host nginx. |
| `nginx/conf.d/app.conf` | A whole-server config. It would have to replace what already serves `api.umbra.uz`. |

Use `docker-compose.vps.yml` and `nginx/vhosts/*.conf` instead. Together they only ever
*add*: containers listening on 127.0.0.1, and two new server blocks.

## Hosts

| Host | Serves | Container |
| --- | --- | --- |
| `studio.haywan.uz` | the SPA | `web`, `127.0.0.1:8091` |
| `studio-api.haywan.uz` | the API, `/media`, `/mcp` | `api`, `127.0.0.1:8090` |

Both are subdomains of `haywan.uz`, so they are *same-site*: the `SameSite=Lax` session
cookies the API sets are sent on requests the SPA makes. They are not same-origin, which
is why `CORS_ORIGINS` must name the SPA origin exactly — a wildcard is invalid once
credentials are involved.

## Prerequisites (not automatable from here)

1. **DNS.** `A` records for `studio` and `studio-api` under `haywan.uz` → `173.249.47.179`.
   `haywan.uz` itself currently points at `76.76.21.21` (Vercel), so the records are
   managed wherever that zone lives — leave the apex alone.
2. **SSH key.** `ssh-copy-id -i ~/.ssh/video_studio_deploy.pub deploy@173.249.47.179`.
3. **Docker.** Verify before deploying: `docker --version && docker compose version`.
   If absent, install Docker Engine from Docker's apt repository — do not let it
   reconfigure the firewall.

## Steps

```bash
# 1. Survey first. Nothing below should surprise you.
ssh -i ~/.ssh/video_studio_deploy deploy@173.249.47.179
sudo ss -tlnp                 # confirm 8090/8091 are free
docker ps                     # what is already containerised
df -h /                        # generated video needs room

# 2. Layout, owned by deploy.
sudo install -d -o deploy -g deploy /opt/video-studio/{current,shared/env,shared/state}

# 3. Environment. 0600, never in git.
#    API_PUBLIC_URL must equal the Google redirect URI minus the path, exactly.
cat > /opt/video-studio/shared/env/api.env   # see infra/env/api.env.example
chmod 600 /opt/video-studio/shared/env/api.env

# 4. Images. GHCR is the normal path (see README §2); for a first manual deploy you can
#    build on the box instead — slower, and it competes with the live site for CPU.

# 5. Start. Publishes only to loopback, so nothing is exposed yet.
cd /opt/video-studio/current
docker compose -f docker-compose.vps.yml up -d
curl -fsS http://127.0.0.1:8090/api/health/ready    # must return 200 before step 6

# 6. Certificates. Copy ONLY the :80 server block from each vhost file first, reload,
#    then issue — certbot needs the ACME location reachable over plain http.
sudo cp nginx/vhosts/studio.haywan.uz.conf nginx/vhosts/studio-api.haywan.uz.conf /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d studio.haywan.uz
sudo certbot certonly --webroot -w /var/www/certbot -d studio-api.haywan.uz
sudo nginx -t && sudo systemctl reload nginx     # now with the ssl blocks in place
```

`nginx -t` before every reload. A syntax error takes `api.umbra.uz` down with it, and
this box has no staging.

## Rollback

Nothing here replaces an existing file, so backing out is:

```bash
sudo rm /etc/nginx/conf.d/studio.haywan.uz.conf /etc/nginx/conf.d/studio-api.haywan.uz.conf
sudo nginx -t && sudo systemctl reload nginx
docker compose -f /opt/video-studio/current/docker-compose.vps.yml down
```

The `mongo-data` and `media` volumes survive that; `down -v` would destroy them.

## Still outstanding

- **Vertex AI needs billing** on `video-studio-504320`. Until then keep `FAKE_VERTEX=true`
  in `api.env`: sign-in and the whole UI work, generation returns a placeholder clip.
- **`AUTH_DEV_LOGIN` must be absent or `false`.** The API refuses it when
  `NODE_ENV=production` regardless, but do not rely on a single guard.
- The password used to bootstrap SSH should be rotated, and once key auth works,
  `PasswordAuthentication no` is worth considering — **but** that edits `sshd_config` on
  a box running someone else's service, so agree it with whoever owns `api.umbra.uz`.
