# @pingtop/video-studio-server

Node backend for PingTop Video Studio. Replaces the Cloudflare Worker in
`workers/` and the Firebase Cloud Functions in `functions/` as the single
source of truth for video and image generation.

Node 22, TypeScript (strict), ESM, Express 4.

## Install

```sh
npm install
```

## Configure

```sh
cp .env.example .env
```

`FIREBASE_SERVICE_ACCOUNT_JSON` is the only strictly required variable;
`GOOGLE_CLOUD_PROJECT` is required too unless the service account JSON supplies
the same `project_id`. Every other variable has a documented default in
`.env.example`. Startup fails with a single error listing all invalid or
missing variables.

The server does not load `.env` itself. Export the variables first, e.g.
`node --env-file=.env dist/index.js`, or supply them from your deployment
platform.

## Run

```sh
npm run dev        # tsx watch, reloads on change
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm test           # node:test via tsx
npm run typecheck  # tsc --noEmit
```

## Wire protocol

Clients POST to `/<name>` with `{ "data": { ... } }` and an
`Authorization: Bearer <firebase id token>` header. Success responses are
`{ "result": ... }`; failures are `{ "error": { "status": <code>, "message": ... } }`,
where `<code>` is one of the `ErrorCode` values in `src/errors.ts`. This matches
`src/lib/callWorker.ts` in the frontend and must not change.
