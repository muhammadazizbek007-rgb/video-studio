# @video-studio/e2e

Playwright end-to-end tests that drive the **real** stack: the Fastify API, a real MongoDB,
the real local storage driver and the Vite-served SPA. Nothing is mocked at the HTTP layer.

No Google account, no Vertex AI credentials and no Docker are required.

## Running it

```bash
pnpm install
pnpm build               # packages/shared must exist on disk: both dev servers import its dist
pnpm --filter @video-studio/e2e exec playwright install --with-deps chromium
pnpm e2e                 # or: pnpm --filter @video-studio/e2e test
pnpm --filter @video-studio/e2e test:ui
```

`playwright test` boots everything it needs:

| Piece   | How it starts                                             | Where it listens        |
| ------- | --------------------------------------------------------- | ----------------------- |
| MongoDB | `mongodb-memory-server`, owned by `start-api.ts`            | `127.0.0.1:27077`       |
| API     | `pnpm --filter @video-studio/api dev`, spawned by that file | `http://127.0.0.1:8080` |
| Web     | `pnpm --filter @video-studio/web dev`                       | `http://127.0.0.1:5173` |

Media files land in a throwaway directory under the OS temp dir
(`<tmp>/video-studio-e2e/media`) and are removed by the global teardown.

### Why `start-api.ts` owns the database

Playwright brings every `webServer` entry up **and waits for its URL** before it runs
`globalSetup`. Provisioning Mongo in `globalSetup` therefore cannot work: the API would be
asked to boot against a database that does not exist yet, and gating the API's command on a
file `globalSetup` writes simply deadlocks the two against each other. Owning Mongo in the
same process that owns the API removes the ordering question entirely — the database is up
before the server is spawned and dies with it.

`global-setup.ts` runs after all of that and publishes the run's shape (origins, Mongo URI,
temp paths) to `<tmp>/video-studio-e2e/state.json`. Module state does not cross Playwright's
process boundaries, so the path travels in `$VS_E2E_STATE_FILE`, exported by
`playwright.config.ts` during config evaluation — before any worker is forked.

Useful overrides:

- `VS_E2E_MONGODB_URI` — point the API at an already-running MongoDB (a CI service
  container). When it is set, `mongodb-memory-server` is never started. Otherwise the first
  local run downloads a `mongod` binary once, which needs network access.
- `VS_E2E_MONGO_PORT` — move the in-memory mongod if `27077` is taken. The port is fixed
  rather than ephemeral because `playwright.config.ts` has to spell `MONGODB_URI` out for the
  API's `webServer` entry before anything has started.
- `CI=1` — enables retries, `forbidOnly`, the GitHub reporter, and stops reusing servers.

## The two escape hatches

Both are read from the environment by `apps/api/src/env.ts` and are set only in
`playwright.config.ts`.

**`AUTH_DEV_LOGIN=true`** registers `POST /api/auth/dev-login`, which takes
`{ email, name }` and issues the same `vs_access` / `vs_refresh` cookies a completed Google
OAuth round trip would. It cannot fire in production: `apps/api/src/auth/routes.ts` only
registers the route when `env.nodeEnv !== 'production' && env.authDevLogin`, and re-checks
both conditions *per request* before doing any work, throwing `not-found` if either fails.
Registration alone is deliberately not the only barrier.

**`FAKE_VERTEX=true`** swaps Vertex AI for `apps/api/src/vertex/fake.ts`. It never touches
the network and needs no service account. It writes a genuine 973-byte H.264 MP4 through the
same storage driver production uses, so `<video>` playback and the `/media/*` static route
are exercised for real. It cannot fire in production because a production deployment sets
`FAKE_VERTEX=false` (or omits it — the default is `false`), and with it off
`apps/api/src/env.ts` refuses to boot without `GOOGLE_SERVICE_ACCOUNT_JSON` and a project id.

Neither hatch is reachable from a built image unless an operator deliberately sets the
variable *and* leaves `NODE_ENV` off `production`.

## How a test gets a session

`fixtures.ts` extends Playwright's `test`:

- `session` — mints a **unique account per test** (`e2e-<uuid>@example.test`) and POSTs
  `/api/auth/dev-login` through `context.request`, whose cookie jar is the browser context's.
  A unique account per test is what keeps `fullyParallel: true` honest: every list endpoint
  is scoped to the caller, so no worker can observe another's rows. On teardown the fixture
  deletes everything the account owns.
- `signedInPage` — the same `page`, with the session already installed.
- `api` — the signed-in `APIRequestContext`, for seeding.
- `account` — the credentials the session was created with.

Seeding helpers: `seedGeneration`, `seedElement`, `listGenerations`, `listElements`,
`clearAccount`. `openApp(page, path)` navigates with `?lang=en` pinned, because
`detectLanguage()` prefers the query string over storage and the browser locale — that is
what lets the specs assert on real English copy instead of markup.

## What the specs hang on

Only one `data-testid` exists in `apps/web/src` today:

| Testid           | Used by          | Renders                                                  |
| ---------------- | ---------------- | -------------------------------------------------------- |
| `studio-summary` | `studio.spec.ts` | `<model> · <ratio> · <duration>s · <mode>` on the studio |

Everything else is a role, label or copy locator:

- `getByRole('button', { name: 'Continue with Google' })` — `login.continueWithGoogle`
- `getByRole('button', { name: 'Generate' })` — `studio.generate`
- `getByRole('button', { name: 'Sign out' })` — `nav.signOut`
- `getByLabel('Prompt')` — the composer textarea's `aria-label`
- `getByRole('radiogroup', { name: 'Model' | 'Mode' | 'Aspect ratio' | 'Duration' })`
- `getByRole('listbox', { name: 'Mentioned elements' })` and its `option`s — the @mention
  autocomplete
- `getByRole('dialog')` — `Modal`, for both confirmation flows
- `getByRole('listitem')` — one `<li>` per element in the library
- `getByLabel('Interface language')` — the language `Select` on Settings
- `getByRole('button', { name: 'Тёмная тема' / 'Светлая тема' })` — the theme toggle
- `getByRole('button', { name: 'Play' })` — the video player transport

### Testids that would make this suite less brittle

None of these exist yet, and none were added — the components are owned elsewhere.

| Suggested testid                                                  | Where                          | Why                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dashboard-stat-total` / `-completed` / `-processing` / `-failed` | `DashboardPage.tsx` `StatTile` | The tiles are located by label text and disambiguated with `.first()`, because "Ready" is both `dashboard.completed` and `status.completed`.       |
| `generation-card`                                                 | `GenerationCard.tsx`           | The card is reached with `getByText(prompt).locator('xpath=..')`; a testid would drop the DOM-shape assumption.                                    |
| `generation-status`                                               | `StatusPill.tsx`               | Status is asserted through translated copy, so the flagship spec breaks if the wording changes.                                                    |
| `video-player`                                                    | `VideoPlayer.tsx`              | `aria-label={t('studio.result')}` resolves to `undefined` (no such key), leaving the player with no accessible name.                               |
| `element-card`                                                    | `ElementLibrary.tsx`           | `getByRole('listitem')` works but ties the spec to the `<ul>`.                                                                                     |

## Known discrepancies between the code on disk and the intended contract

Found while writing the specs. None of it is fixed here — every file involved is owned by
another part of the workspace.

1. **`AppShell` / `NavBar` are never mounted.** `apps/web/src/App.tsx` renders each page
   inside `RequireAuth` directly, so there is no application shell, no primary navigation and
   no header identity. The brief's "after dev-login the shell shows the user's email" is
   asserted on `/settings` instead, the only place `user.email` renders.
2. **`DashboardPage` and `StudioPage` read `data` off `useGenerations()`**, which returns
   `{ generations, isLoading, isError, error, hasMore, isLoadingMore, loadMore, refetch }`
   and has no `data` field. Both pages therefore see `undefined` and render an empty list
   forever. `dashboard.spec.ts` asserts the intended behaviour and will fail until the
   destructuring is corrected to `generations`.
3. **`IconButton` requires an `icon` prop and omits `children`**, but `GenerationCard`,
   `ElementLibrary` and `NavBar` pass their glyph as children. The buttons still expose the
   right accessible name (`label` → `aria-label`), so the locators hold, but no icon paints.
4. **`VideoPlayer` calls `t('studio.result')`**, which is not a key in
   `i18n/translations.ts`; the player container ends up with no accessible name.
5. **`ThemeToggle` and `Modal` hard-code Russian copy** (`'Тёмная тема'`, `'Светлая тема'`,
   `closeLabel = 'Закрыть'`) regardless of the selected language. `settings.spec.ts` uses
   those literals deliberately.
6. **`Badge` exposes `tone`, but `ModelPicker` and `SettingsPage` pass `variant`.** The
   badges still render their text, so the copy locators hold.

## Operational notes

- The API applies a **global 300 requests/minute rate limit keyed on the client IP**
  (`apps/api/src/app.ts`). Every worker shares `127.0.0.1`, so the suite is kept small and
  deliberately avoids chatty polling. Many more page loads would need that ceiling raised for
  the test environment.
- Generation creation is limited to **10/minute per user**; each test has its own user, so
  seeding stays well inside it.
- `ALLOWED_EMAILS` is blanked explicitly for the API process so an ambient allow-list can
  never reject the generated test accounts.
- `global-teardown.ts` removes the media tree but leaves the mongod data directory alone: the
  API is still running at teardown time, and `start-api.ts` recycles that directory on its
  next boot anyway.
