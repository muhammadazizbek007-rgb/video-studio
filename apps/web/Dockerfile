# syntax=docker/dockerfile:1.9
#
# Build context is the REPO ROOT, not apps/web.
#
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL= \
#     -t ghcr.io/<owner>/video-studio-web:<tag> .
#
# VITE_API_URL is baked into the bundle at build time. Leave it empty for the
# production deployment: nginx serves the SPA and the API from the same origin.

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine
ARG PNPM_VERSION=10.15.0

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# See apps/api/Dockerfile: Node 22's bundled corepack fails signature verification
# against npm's rotated keys, so it is upgraded before it is used.
RUN npm install --global corepack@latest \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS fetched
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM fetched AS build
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
COPY . .
RUN pnpm install --frozen-lockfile --offline --filter '@video-studio/web...'
RUN pnpm --filter @video-studio/shared build && pnpm --filter @video-studio/web build

FROM ${NGINX_IMAGE} AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

COPY <<'CONF' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  listen [::]:80;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  access_log /var/log/nginx/access.log main;
  server_tokens off;

  location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
  }

  # Vite emits content-hashed filenames under /assets, so they can never go stale.
  # `expires` is deliberately not used here: it would emit a second, competing
  # Cache-Control header alongside this one.
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    try_files $uri =404;
  }

  # The entry document must be revalidated or clients keep booting a dead bundle
  # whose hashed assets no longer exist.
  location = /index.html {
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
CONF

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
