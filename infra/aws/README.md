# AWS deployment — eu-north-1

One EC2 instance running the same Docker stack as `infra/docker-compose.prod.yml`.
The application deploy is unchanged from the VPS setup: GitHub Actions builds the
images, pushes them to GHCR, and the box pulls and restarts. **Nothing is ever built
on the server.** Only the provisioning is AWS-specific, and it lives in this
directory.

```
             eu-north-1 default VPC
   ┌──────────────────────────────────────────────┐
   │  sg: video-studio-sg                          │
   │    22/tcp  <- your address only               │
   │    80,443  <- 0.0.0.0/0                       │
   │                                               │
   │  ┌────────────────────────────────────────┐   │
   │  │ t3.medium, Ubuntu 24.04                │   │
   │  │ 50 GiB gp3, encrypted, IMDSv2 required │   │
   │  │                                        │   │
   │  │  nginx ── gadgetpro.uz                 │   │
   │  │             /       -> web             │   │
   │  │             /api    -> api ──> mongo   │   │
   │  │             /media  -> api             │   │
   │  └────────────────────────────────────────┘   │
   └──────────────────────────────────────────────┘
                      ▲
                 Elastic IP  (survives stop/start)
```

| File | Purpose |
| --- | --- |
| `provision-ec2.sh` | creates the key pairs, security group, instance and Elastic IP |
| `bootstrap-ec2.sh` | installs everything on the instance and prints the GitHub secrets |

Both are idempotent — re-run either to repair a half-finished run.

## Cost

Roughly, on-demand in eu-north-1:

| Item | Monthly |
| --- | --- |
| t3.medium, 730 h | ~$30 |
| 50 GiB gp3 | ~$4 |
| Elastic IP (associated) | ~$3.6 |
| Egress, first 100 GB free | $0 for typical use |

An Elastic IP is billed whether or not it is attached. Releasing it is part of
tearing the stack down, not optional housekeeping.

## 1. Credentials

```bash
aws configure               # access key, secret, region eu-north-1, output json
aws sts get-caller-identity # must print your account and ARN
```

The IAM principal needs EC2 (`RunInstances`, `*SecurityGroup*`, `*Address*`,
`ImportKeyPair`, `Describe*`) and `ssm:GetParameter` — the last one is how the
current Ubuntu 24.04 AMI id is resolved instead of hard-coding one that goes stale.
`AmazonEC2FullAccess` covers all of it.

## 2. Build the AWS resources

```bash
./infra/aws/provision-ec2.sh
```

Writes three files into `~/.ssh` and prints the Elastic IP:

| File | What it is |
| --- | --- |
| `video-studio-admin` | admin key — `ssh ubuntu@<ip>`; the public half is the EC2 key pair |
| `video-studio-deploy` | CI's key — becomes the `VPS_SSH_KEY` secret |
| `video-studio-known_hosts` | the scanned host key — becomes `VPS_SSH_KNOWN_HOSTS` |

Both key pairs are generated locally. AWS only ever receives the admin **public**
key, and the deploy key never touches AWS at all.

### Why port 22 is open to the world

Two rules are created for SSH: your address, and `0.0.0.0/0`. The second one is not
an oversight. The deploy workflow connects from a GitHub-hosted runner whose address
cannot be predicted — Actions publishes hundreds of CIDRs that rotate, and a security
group holds 60 rules — so CI can only deploy if 22 is reachable from anywhere.
`provision-vps.sh` has always assumed this; it opens 22 in ufw unconditionally.

The port is protected by sshd rather than by the security group:

| | |
| --- | --- |
| `PasswordAuthentication no` | keys only, no password to guess |
| `MaxAuthTries 3` | three attempts per connection |
| fail2ban | 4 failures → 1 hour ban |
| `PermitRootLogin prohibit-password` | no root password login |

If you would rather keep 22 closed, run `CI_SSH=0 ./infra/aws/provision-ec2.sh`.
Deploys must then run from an allowed address, or from a self-hosted runner on the
instance — which is the strictly safer design, since the runner dials out and needs
no inbound access at all.

To add another admin address later:

```bash
aws ec2 authorize-security-group-ingress --region eu-north-1 \
  --group-id <sg-id> --protocol tcp --port 22 --cidr <new-ip>/32
```

Overrides:

```bash
INSTANCE_TYPE=t3.large VOLUME_SIZE=100 ./infra/aws/provision-ec2.sh
ADMIN_CIDR=0.0.0.0/0 ./infra/aws/provision-ec2.sh        # SSH open to the world
```

## 3. Provision the box

```bash
./infra/aws/bootstrap-ec2.sh <elastic-ip>
```

Waits for cloud-init, uploads `infra/`, and runs `scripts/provision-vps.sh`: Docker
Engine, the unprivileged `deploy` user (key-only SSH, docker group), sshd hardening,
ufw, fail2ban, `/opt/video-studio`, the nightly mongo backup, and placeholder
certificates so nginx can boot before ACME has run. It finishes by printing every
GitHub secret and variable with its value filled in.

The security group, not ufw, is what actually protects the instance — ufw is defence
in depth. **Docker publishes ports by writing iptables rules that bypass ufw**, so a
`ports:` mapping added to a compose service is reachable from the internet unless the
security group also blocks it. Only nginx publishes ports here (80/443).

## 4. DNS

Two A records, both at the Elastic IP:

```
gadgetpro.uz.       A   <elastic-ip>
www.gadgetpro.uz.   A   <elastic-ip>
```

Wait for propagation before issuing certificates — a failed http-01 burns one of the
five duplicate-certificate attempts Let's Encrypt allows per week.

```bash
dig +short gadgetpro.uz www.gadgetpro.uz
```

## 5. Environment

As `deploy` on the box:

```bash
vim /opt/video-studio/shared/env/deploy.env     # GHCR_OWNER, GHCR_USER

cp /opt/video-studio/current/env/api.env.example /opt/video-studio/shared/env/api.env
chmod 600 /opt/video-studio/shared/env/api.env
vim /opt/video-studio/shared/env/api.env
```

The values specific to the single-origin layout:

```ini
WEB_APP_URL=https://gadgetpro.uz
API_PUBLIC_URL=https://gadgetpro.uz
CORS_ORIGINS=
```

`CORS_ORIGINS` is deliberately **empty**. The SPA and the API share one origin, so no
request is ever cross-origin and there is nothing for CORS to allow. The `SameSite=Lax`
session cookies need no special handling either.

If you later split the API onto its own hostname, all three change: `API_PUBLIC_URL`
points at the API host, `CORS_ORIGINS` must name the SPA origin explicitly (a wildcard
is invalid on a credentialed request), and `VITE_API_URL` must be rebuilt.

The Google OAuth client's authorised redirect URI must be exactly:

```
https://gadgetpro.uz/api/auth/google/callback
```

Everything else is documented inline in `infra/env/api.env.example`. Non-obvious:

- `AUTH_JWT_SECRET` — `openssl rand -base64 48`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the key file on one line: `jq -c . key.json`
- `MONGODB_URI` — `mongodb://mongo:27017/video-studio`. Mongo sits on an
  `internal: true` docker network and is never published, which is why it runs
  without authentication.

## 6. GitHub

`bootstrap-ec2.sh` prints these with the values already filled in:

| | Name | Value |
| --- | --- | --- |
| secret | `VPS_HOST` | the Elastic IP |
| secret | `VPS_SSH_KEY` | `~/.ssh/video-studio-deploy` |
| secret | `VPS_SSH_KNOWN_HOSTS` | `~/.ssh/video-studio-known_hosts` |
| variable | `VPS_USER` | `deploy` |
| variable | `DEPLOY_PATH` | `/opt/video-studio` |
| variable | `VITE_API_URL` | empty — same origin |

`VITE_API_URL` is compiled into the SPA bundle at image build time. Changing it
requires a **new build** — redeploying an existing tag will not pick it up.

GHCR access from Actions uses the built-in `GITHUB_TOKEN`; it is handed to the box
over the SSH stdin, so it never appears in a command line, a log, or on disk.

## 7. First deploy

`Deploy` runs automatically when `CI` succeeds on `main`. To go first time, or from
a branch, dispatch it with an empty `image_tag`:

```bash
gh workflow run deploy.yml
gh run watch
```

Then issue the real certificates — nginx must already be serving the ACME webroot,
which is why this comes after the first deploy and not before:

```bash
ssh ubuntu@<elastic-ip>
sudo /opt/video-studio/current/scripts/issue-certs.sh you@example.com
```

It requests a certificate per domain, repoints `shared/certs/<domain>/` at
`/etc/letsencrypt/live/<domain>/` with symlinks (so renewals are picked up rather
than going stale in ninety days), installs the reload hook, and reloads nginx.
Domains that do not yet resolve to this host are skipped with a warning instead of
being attempted and failed.

Rehearse against the staging CA if you are unsure — untrusted certs, no rate limit:

```bash
sudo STAGING=1 /opt/video-studio/current/scripts/issue-certs.sh you@example.com
```

## 8. Verifying

```bash
curl -sI https://gadgetpro.uz/                       # 200 + security headers
curl -s  https://gadgetpro.uz/api/health/ready       # ok
curl -N  https://gadgetpro.uz/api/generations/<id>/events   # must stream

cd /opt/video-studio/current
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

If the SPA loads but every request 401s or is blocked in the console, check
`VITE_API_URL` first: on this single-origin setup it must be **empty**, and a stale
non-empty value baked into the bundle sends the browser cross-origin for no reason.

## 9. Operations

Deploy, rollback, backup and restore are unchanged — see the runbook in
[`infra/README.md`](../README.md). The AWS-specific ones:

```bash
# stop overnight; the Elastic IP is kept, the instance store is not used
aws ec2 stop-instances  --region eu-north-1 --instance-ids <id>
aws ec2 start-instances --region eu-north-1 --instance-ids <id>

# resize (must be stopped first)
aws ec2 modify-instance-attribute --region eu-north-1 \
  --instance-id <id> --instance-type Value=t3.large

# grow the root volume, then extend the filesystem ON the box
aws ec2 modify-volume --region eu-north-1 --volume-id <vol> --size 100
ssh ubuntu@<ip> 'sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1'
```

Snapshots are worth having even with the nightly mongodump, because the media volume
is not in those archives:

```bash
aws ec2 create-snapshot --region eu-north-1 --volume-id <vol> \
  --description "video-studio $(date -u +%F)"
```

### Tearing it down

```bash
aws ec2 terminate-instances --region eu-north-1 --instance-ids <id>
aws ec2 release-address     --region eu-north-1 --allocation-id <alloc>
aws ec2 delete-security-group --region eu-north-1 --group-id <sg>
```

Terminating destroys the root volume, and with it the database and every generated
video. Pull the backups off the box first:

```bash
rsync -az deploy@<ip>:/opt/video-studio/shared/backups/ ./backups/
```
