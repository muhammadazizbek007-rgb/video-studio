# Video Studio

AI video generation on Google Veo and Imagen, running entirely on a single VPS.

A pnpm + Turborepo monorepo: a React frontend, a Fastify API, and a shared contract package
that both import so a wire-format change breaks the build rather than production.

## Layout

| Path              | Package                | What it is                                                  |
| ----------------- | ---------------------- | ----------------------------------------------------------- |
| `apps/web`        | `@video-studio/web`    | React 19 + Vite 6 + Tailwind v4, neumorphic design system     |
| `apps/api`        | `@video-studio/api`    | Fastify 5 + Mongoose 8, Google OAuth, Vertex AI, MCP server   |
| `packages/shared` | `@video-studio/shared` | Zod schemas, DTO types, the Veo/Imagen model registry         |
| `e2e`             | `@video-studio/e2e`    | Playwright suite driving the real API and the real frontend   |
| `infra`           | —                      | Dockerfiles, Compose stack, nginx, VPS provisioning scripts   |

`packages/shared` is the contract. Model ids, supported durations, aspect ratios and every
request/response shape are defined once there; the API validates against them and the web
client parses responses through them.

## Stack

- **Auth** — Google OAuth 2.0 (OIDC). The API mints its own HS256 access token (15 min) plus an
  opaque, rotating refresh token, both in httpOnly cookies. Only token *hashes* are stored.
- **Data** — MongoDB 7 via Mongoose, with a TTL index reaping dead sessions.
- **Storage** — generated video and uploads on local disk behind a `StorageDriver` interface,
  served from `/media`. Swapping in S3 means one new implementation of that interface.
- **Live status** — Server-Sent Events on `/api/generations/:id/events`, with polling fallback
  in the client for proxies that break streaming.
- **Generation** — Vertex AI Veo (video) and Imagen (images), authenticated with a service account.
- **MCP** — the Model Context Protocol server is mounted at `/mcp`, bearer-token authenticated,
  and calls the same service layer the REST API does.

## Getting started

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d   # local MongoDB
cp apps/api/.env.example apps/api/.env             # then fill it in
pnpm dev                                           # api on :8080, web on :5173
```

Without Google or Vertex credentials you can still run the whole app:

```bash
FAKE_VERTEX=true AUTH_DEV_LOGIN=true pnpm --filter @video-studio/api dev
```

`FAKE_VERTEX` returns a deterministic completed generation with a real playable MP4 and makes
no network calls. `AUTH_DEV_LOGIN` exposes `POST /api/auth/dev-login`, which issues real session
cookies for any email. Both are refused when `NODE_ENV=production`.

## Verifying

```bash
pnpm lint        # biome, whole workspace
pnpm typecheck   # tsc across every package
pnpm test        # vitest: shared, api (in-memory Mongo), web (jsdom)
pnpm build       # shared -> api -> web
pnpm e2e         # Playwright against the real stack
pnpm verify      # lint + typecheck + test + build
```

The E2E suite starts its own MongoDB and both servers; it needs no credentials and no Docker.
Set `VS_E2E_MONGODB_URI` to point it at an existing database instead.

## Deployment

A single VPS running Docker Compose behind nginx. Images are built in GitHub Actions and
pushed to GHCR; the box only pulls and restarts, so nothing is ever compiled on the server.

See [`infra/README.md`](infra/README.md) for the runbook — provisioning the `deploy` user,
issuing certificates, deploying, rolling back, and restoring a backup.
