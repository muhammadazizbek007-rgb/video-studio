# syntax=docker/dockerfile:1.9
#
# Build context is the REPO ROOT, not apps/api — the api resolves @video-studio/shared
# through the pnpm workspace, so the whole workspace has to be visible to the build.
#
#   docker build -f apps/api/Dockerfile -t ghcr.io/<owner>/video-studio-api:<tag> .

ARG NODE_IMAGE=node:22-alpine
ARG PNPM_VERSION=10.15.0

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Dependency tarballs are fetched from the lockfile alone, so editing source code
# never invalidates the (slow) download layer.
FROM base AS fetched
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM fetched AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline --filter '@video-studio/api...'
RUN pnpm --filter @video-studio/shared build && pnpm --filter @video-studio/api build

# A second, independent install produces the runtime node_modules with no dev deps.
FROM fetched AS prod-deps
COPY . .
RUN pnpm install --frozen-lockfile --offline --prod --filter '@video-studio/api...'

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini
RUN addgroup -g 1001 -S app && adduser -u 1001 -S -G app app

ENV NODE_ENV=production
ENV PORT=8080
ENV MEDIA_ROOT=/app/var/media
ENV MEDIA_PUBLIC_BASE_URL=/media

WORKDIR /app

# The pnpm layout is a web of relative symlinks between these three node_modules
# trees; the directory shape has to be reproduced exactly for resolution to work.
COPY --from=prod-deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=prod-deps --chown=1001:1001 /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps --chown=1001:1001 /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=1001:1001 /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=1001:1001 /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=1001:1001 /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=1001:1001 /app/apps/api/dist ./apps/api/dist

RUN mkdir -p "$MEDIA_ROOT" && chown -R 1001:1001 /app/var

USER app
WORKDIR /app/apps/api
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health/live" || exit 1

# tini reaps zombies and forwards SIGTERM, so `docker compose down` is a clean shutdown
# rather than a 10-second kill.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
