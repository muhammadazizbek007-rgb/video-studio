# Video Studio — live end-to-end plan

Execute this **after** the new Firebase project, Blaze billing and Vertex AI
access exist. Nothing here has been run yet.

Everything below is derived from the code as it stands:

* Server routes — `server/src/routes/diagnostics.ts`, `server/src/routes/video.ts`
  (there are exactly four: `GET /health`, `POST /testVertexConnection`,
  `POST /startVideoGeneration`, `POST /checkVideoGeneration`; any other path
  returns `404 {"error":{"status":"not-found","message":"Unknown function: <path>"}}`
  from `server/src/app.ts`).
* Wire format — `server/README.md` and `src/lib/callWorker.ts`: request body is
  `{"data":{...}}`, success is `{"result":...}`, failure is
  `{"error":{"status":"<code>","message":"..."}}` with the codes and HTTP statuses
  in `server/src/errors.ts`.
* Config — `server/src/config.ts`, `server/.env.example`.
* Frontend — `src/pages/VideoStudio.tsx`, `src/components/video/VideoAccessGate.tsx`,
  `src/services/videoGenerationService.ts`, `src/firebaseApp.ts`.

---

## 1. Prerequisites checklist

Tick every line before running section 3.

| # | Item | How to satisfy / verify |
|---|---|---|
| 1.1 | **New Firebase project created**, project id recorded as `<PROJECT_ID>` | Firebase console → Add project. Record it; it is used verbatim in `GOOGLE_CLOUD_PROJECT` and `VITE_FIREBASE_PROJECT_ID`. |
| 1.2 | **Blaze (pay-as-you-go) billing enabled** on that project | Firebase console → Settings → Usage and billing. Vertex AI refuses to serve on Spark. |
| 1.3 | **Vertex AI API enabled** | `gcloud services enable aiplatform.googleapis.com --project <PROJECT_ID>`. Also enable `firestore.googleapis.com`, `storage.googleapis.com`, `identitytoolkit.googleapis.com` if they are not on already. |
| 1.4 | **Veo available in the chosen region** | The server builds `https://<location>-aiplatform.googleapis.com/v1/projects/<project>/locations/<location>/publishers/google/models/<model>` (`server/src/vertex/client.ts`). Default location is `us-central1` (`server/src/config.ts`). The Veo model ids actually called are in `server/src/vertex/models.ts`: `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.0-generate-001`, `veo-3.0-fast-generate-001`, `veo-2.0-generate-001`. Confirm the ones you intend to use are enabled for the project (preview models may need allow-listing). |
| 1.5 | **Firestore database created** (Native mode) | The frontend uses database id from `VITE_FIREBASE_DATABASE_ID`, default `(default)` (`src/firebaseApp.ts`). The server's Admin SDK always uses `(default)` (`server/src/firebase.ts`). **If these differ, the server will not see the documents the browser writes — keep `VITE_FIREBASE_DATABASE_ID=(default)`.** |
| 1.6 | **Cloud Storage bucket exists**, name recorded as `<BUCKET>` | Default assumed by the server is `<PROJECT_ID>.firebasestorage.app` (`server/src/config.ts`). Results are written to `video-generations/{uid}/{generationId}/result.mp4` (`server/src/vertex/veo.ts`). |
| 1.7 | **Service account created** and given `roles/aiplatform.user` | `gcloud projects add-iam-policy-binding <PROJECT_ID> --member serviceAccount:<SA_EMAIL> --role roles/aiplatform.user`. The same account also needs Firestore and Storage access — either reuse the auto-created `firebase-adminsdk-*@<PROJECT_ID>.iam.gserviceaccount.com` (which already has them) or additionally grant `roles/datastore.user`, `roles/storage.objectAdmin` and `roles/firebaseauth.admin` (token verification uses `getAuth().verifyIdToken`). |
| 1.8 | **Service account JSON key downloaded** | Must contain `project_id`, `client_email`, `private_key` — `parseServiceAccount()` in `server/src/config.ts` rejects the config listing every missing field. |
| 1.9 | **Firestore rules deployed** | `firebase deploy --only firestore:rules --project <PROJECT_ID>` from the repo root (`firebase.json` → `firestore.rules`). The rules let a signed-in user create/read/update/delete only documents whose `userId` equals their uid, and deny the client all access to `rateLimits` (Admin SDK only). |
| 1.10 | **Storage rules deployed** | `firebase deploy --only storage --project <PROJECT_ID>` (`firebase.json` → `storage.rules`). Uploads are limited to `video-generations/{uid}/**` and `video-elements/{uid}/**`, <25 MB, image/video/audio content types. |
| 1.11 | **Anonymous authentication enabled** | Firebase console → Authentication → Sign-in method → Anonymous → Enable. Both `VideoAccessGate` and `VideoStudio` sign in with `signInAnonymously` — without this, the guest button fails with `auth/operation-not-allowed`. |
| 1.12 | **`localhost` in Authorized domains** | Firebase console → Authentication → Settings → Authorized domains. `localhost` is present by default on a new project; confirm it was not removed. |
| 1.13 | **Web app registered**, SDK config copied | `firebase apps:sdkconfig WEB --project <PROJECT_ID>`. `src/firebaseApp.ts` hard-asserts that `VITE_FIREBASE_API_KEY` starts with `AIzaSy` and is ≥30 chars, and that project id and app id are non-empty — the app throws at import time otherwise. |
| 1.14 | **Email allow-lists left empty for the guest E2E** | Anonymous users have **no email claim**. If `VIDEO_STUDIO_ALLOWED_EMAILS` (server) is non-empty, `requireAllowedEmail()` in `server/src/middleware/auth.ts` returns `403 permission-denied` for every anonymous call. Same for `VITE_VIDEO_STUDIO_ALLOWED_EMAILS` on the client (`src/config/videoStudioAccess.ts`), which would show the "Access denied" screen. |
| 1.15 | **Node 22+** for the server | `server/package.json` → `engines.node >= 22`; the `--env-file` flag used below needs it. |

---

## 2. Environment variables

### 2.1 `server/.env` (this directory)

The server **does not load `.env` by itself** (`server/README.md`). Run it as
`node --env-file=.env dist/index.js`, or export the variables first.

| Variable | Required | Shape of the value | Notes |
|---|---|---|---|
| `PORT` | no | integer 1–65535, e.g. `8080` | Default `8080`. Invalid values fail startup. |
| `GOOGLE_CLOUD_PROJECT` | yes* | `my-video-studio-4f2a1` | *Optional only if identical to `project_id` inside the service-account JSON, which is the fallback. |
| `VERTEX_LOCATION` | no | `us-central1` | Default `us-central1`. Must be a region where the Veo model is served. |
| `FIREBASE_STORAGE_BUCKET` | no | `my-video-studio-4f2a1.firebasestorage.app` | Default `<GOOGLE_CLOUD_PROJECT>.firebasestorage.app`. A leading `gs://` is stripped. Must match `VITE_FIREBASE_STORAGE_BUCKET`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **yes** | the whole key file on **one line**: `{"type":"service_account","project_id":"my-video-studio-4f2a1","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n","client_email":"video-studio@my-video-studio-4f2a1.iam.gserviceaccount.com",...}` | Literal `\n` sequences inside `private_key` are converted back to newlines at load time. A leading BOM is trimmed. Must be valid JSON with `project_id`, `client_email`, `private_key`. |
| `VIDEO_STUDIO_ALLOWED_EMAILS` | no | comma-separated, e.g. `abdurahmon@dona.uz,someone@dona.uz` | **Leave empty for the guest E2E** (see 1.14). Empty = every authenticated user allowed. Compared case-insensitively. |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated origins. Empty = all origins allowed (`origin: true`). |
| `ANTHROPIC_API_KEY` | no | `sk-ant-...` | Parsed into the config but **no route in `server/src` reads it** — it changes nothing in this E2E. |

Minimal working file:

```dotenv
PORT=8080
GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
VERTEX_LOCATION=us-central1
FIREBASE_STORAGE_BUCKET=<PROJECT_ID>.firebasestorage.app
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"<PROJECT_ID>", ... }
VIDEO_STUDIO_ALLOWED_EMAILS=
CORS_ORIGINS=http://localhost:5173
```

Start it:

```sh
cd c:/Users/GadgetPro/OneDrive/Desktop/Dona/video-studio/server
npm install
npm run build
node --env-file=.env dist/index.js
# expect: {"level":"info","message":"server listening","time":"...","port":8080,"projectId":"<PROJECT_ID>"}
```

### 2.2 Repo-root `.env.local` (Vite frontend)

| Variable | Shape |
|---|---|
| `VITE_FIREBASE_API_KEY` | `AIzaSy...` (39 chars; asserted at import) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<PROJECT_ID>.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `<PROJECT_ID>` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `<PROJECT_ID>.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | numeric string, e.g. `123456789012` |
| `VITE_FIREBASE_APP_ID` | `1:123456789012:web:abc123def456` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-XXXXXXXXXX` or empty |
| `VITE_FIREBASE_DATABASE_ID` | `(default)` — must stay `(default)`, see 1.5 |
| `VITE_VIDEO_STUDIO_ALLOWED_EMAILS` | empty for the guest E2E |
| `VITE_WORKER_URL` | `http://localhost:8080` — **no trailing slash**; `callWorker` builds `${VITE_WORKER_URL}/${name}` |

Start it:

```sh
cd c:/Users/GadgetPro/OneDrive/Desktop/Dona/video-studio
npm install
npm run dev        # vite, http://localhost:5173
```

Vite only reads `.env.local` at startup — restart after any edit.

---

## 3. curl smoke sequence

Shell variables used below (Git Bash):

```sh
API=http://localhost:8080
WEB_API_KEY=<VITE_FIREBASE_API_KEY>
PROJECT_ID=<PROJECT_ID>
```

### Step 0 — mint an anonymous Firebase ID token

Needed because every route except `/health` requires
`Authorization: Bearer <firebase id token>` (`requireAuth()`).

```sh
curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$WEB_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"returnSecureToken":true}'
```

Expected shape:

```json
{ "kind": "identitytoolkit#SignupNewUserResponse",
  "idToken": "eyJhbGciOi...", "refreshToken": "...", "expiresIn": "3600",
  "localId": "kK3n...uid..." }
```

```sh
TOKEN=<idToken>
UID=<localId>
GEN_ID=e2e-$(date +%s)
```

The token expires in 1 hour; re-run this step if polling outlives it.

### Step 1 — `/health` (unauthenticated)

```sh
curl -s $API/health
```

Expected: `{"ok":true,"uptime":12.34}` — `uptime` is a float in seconds.

### Step 2 — `/testVertexConnection`

```sh
curl -s -X POST $API/testVertexConnection \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"data":{}}'
```

Expected (`status:"ok"` means the service account minted a Google access token):

```json
{ "result": {
    "status": "ok",
    "projectId": "<PROJECT_ID>",
    "location": "us-central1",
    "tokenOk": true,
    "videoModels": ["veo-3.1","veo-3.1-fast","veo-3.0","veo-3.0-fast","veo-2.0"],
    "imageModels": ["imagen-4","imagen-4-fast","imagen-4-ultra","imagen-3","gemini-image"],
    "message": "Vertex AI настроен: проект <PROJECT_ID>, регион us-central1."
} }
```

On credential failure the HTTP status is still 200 but
`status:"error"`, `tokenOk:false`, and `message` carries the Google error text.
This endpoint does **not** prove Veo access — only that the key is accepted.

### Step 3 — create the generation document (required)

`startVideoGeneration` calls `loadOwnedGeneration()` first: the Firestore doc
`video_generations/<GEN_ID>` must already exist **and** have `userId == uid`,
otherwise you get `not-found` / `permission-denied`. In the browser flow the
frontend creates it; over curl, create it through the Firestore REST API with
the same user token (rules allow `create` when `request.resource.data.userId`
matches the caller).

```sh
curl -s -X POST \
  "https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/video_generations?documentId=$GEN_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"fields\":{
        \"id\":{\"stringValue\":\"$GEN_ID\"},
        \"userId\":{\"stringValue\":\"$UID\"},
        \"prompt\":{\"stringValue\":\"A cat walking across a sunlit kitchen table\"},
        \"modelId\":{\"stringValue\":\"veo-3.1-fast\"},
        \"mode\":{\"stringValue\":\"text_to_video\"},
        \"aspectRatio\":{\"stringValue\":\"16:9\"},
        \"duration\":{\"integerValue\":\"8\"},
        \"stylePreset\":{\"stringValue\":\"Cinematic\"},
        \"cameraMotion\":{\"stringValue\":\"Dolly in\"},
        \"status\":{\"stringValue\":\"pending\"},
        \"createdAt\":{\"timestampValue\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},
        \"updatedAt\":{\"timestampValue\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
      }}"
```

Expected: a JSON document echo containing `"name": ".../video_generations/<GEN_ID>"`.
A `403 PERMISSION_DENIED` here means the rules are not deployed or `userId`
does not match the token's uid.

### Step 4 — `startVideoGeneration`

Valid values are enforced by the code: `modelId` must be one of the five
`VEO_MODEL_IDS`; `aspectRatio` must be `16:9` or `9:16`; `duration` is *snapped*
to the nearest supported value (4/6/8, or 5/6/7/8 for `veo-2.0`) rather than
rejected. Defaults if omitted: aspect `16:9`, duration `8`, style `Cinematic`,
camera `Static`.

```sh
curl -s -X POST $API/startVideoGeneration \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"data\":{
        \"generationId\":\"$GEN_ID\",
        \"prompt\":\"A cat walking across a sunlit kitchen table\",
        \"modelId\":\"veo-3.1-fast\",
        \"aspectRatio\":\"16:9\",
        \"duration\":8,
        \"stylePreset\":\"Cinematic\",
        \"cameraMotion\":\"Dolly in\"
      }}"
```

Expected:

```json
{ "result": {
    "ok": true,
    "generationId": "e2e-1754...",
    "status": "processing",
    "operationName": "projects/<num>/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-preview/operations/abc123"
} }
```

Side effects: the Firestore doc gains `status:"processing"`, `provider:"veo"`,
`veoOperationName`, `veoVertexModel`, `updatedAt`; `rateLimits/<UID>` gains a
timestamp (limit: 10 starts per rolling hour).

If Vertex rejects the request, the doc is patched to `status:"failed"` with
`errorMessage`, and the response is an error object — most commonly
`{"error":{"status":"internal","message":"Vertex veo-3.1-fast-generate-preview:predictLongRunning failed: 403 ..."}}`.

### Step 5 — poll `checkVideoGeneration`

```sh
curl -s -X POST $API/checkVideoGeneration \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"data\":{\"generationId\":\"$GEN_ID\"}}"
```

Loop until terminal (Veo typically takes 1–3 minutes; poll every 15 s):

```sh
until curl -s -X POST $API/checkVideoGeneration \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"data\":{\"generationId\":\"$GEN_ID\"}}" | tee /dev/stderr | grep -q '"completed"\|"failed"'; do sleep 15; done
```

While running:

```json
{ "result": { "status": "processing", "resultVideoUrl": null, "error": null } }
```

On success (the server downloads the Veo output and re-uploads it to Firebase
Storage at `video-generations/<UID>/<GEN_ID>/result.mp4`, then writes
`status:"completed"`, `resultVideoUrl`, `resultStoragePath` to the doc):

```json
{ "result": {
    "status": "completed",
    "resultVideoUrl": "https://firebasestorage.googleapis.com/v0/b/<BUCKET>/o/video-generations%2F<UID>%2F<GEN_ID>%2Fresult.mp4?alt=media&token=<uuid>",
    "error": null
} }
```

On failure:

```json
{ "result": { "status": "failed", "resultVideoUrl": null,
              "error": "Veo blocked the generation: <reasons>" } }
```

(Other terminal messages produced by the code: `"Veo finished without returning
a video."`, `"Veo response contained no video payload."`, or the raw Vertex
operation error message.)

### Step 6 — verify the artifact

```sh
curl -s -o e2e.mp4 -w '%{http_code} %{content_type} %{size_download}\n' "<resultVideoUrl>"
```

Expected: `200 video/mp4 <bytes>` with a non-trivial size (a few MB for 8 s).
The URL is public-by-token, so no `Authorization` header is needed.

---

## 4. Browser E2E — prompt for a browser-only Claude agent

> **Known behaviour to plan around.** In the "Создать видео" tab the frontend
> calls `startVideoGeneration` and then relies on the Firestore snapshot
> subscription for updates — it never calls `checkVideoGeneration` (only the
> Cinema Studio tab polls, `src/pages/VideoStudio.tsx:284–289`). Because the
> server only advances the document when `checkVideoGeneration` is called, the
> UI will sit on "Генерация" indefinitely unless someone polls. So: while the
> browser agent waits, **you run the Step 5 poll loop from section 3 with the
> same `generationId`** (copy it out of the Firestore console or from the doc
> that appears in `video_generations`). The moment the server writes
> `status:"completed"`, the page's live subscription flips to "Готово" and the
> video appears. The prompt below tells the tester to report the wait honestly
> either way.

Copy everything between the lines into the browser-extension agent.

---

**TASK — manual E2E of PingTop Video Studio at http://localhost:5173**

You have browser control only: you can navigate, click, type, scroll, read the
page and read the browser console. You have no terminal and no file access. Do
not try to run commands, edit files or open a dev server. If something is not
reachable by clicking or reading, say so instead of working around it.

The app is in Russian. Do the following in order and record what you actually
see at each step.

1. Go to `http://localhost:5173`. It should redirect to `/video-dashboard`.
2. If a card titled **"PingTop AI Video Studio"** with a button
   **"Continue as guest"** appears, click that button. Wait for it to resolve.
   * If instead you land on a red **"Access denied"** card, stop and report it.
   * If a spinner runs for more than 30 seconds, stop and report it.
3. Navigate to the studio: click the link/button **"Открыть Video Studio"** on
   the dashboard, or go to `http://localhost:5173/video-studio` directly.
4. Confirm you are on the **"Создать видео"** tab (it is the default; the tab row
   also contains "Cinema Studio", "CapCut", "История").
5. In the left panel, under the heading **"Движение камеры"**, click **"Долли"**.
   Confirm it becomes the highlighted (white background, black text) option.
6. Click the large prompt text area (placeholder starts with "Опишите сцену")
   and type exactly:
   `Кот идёт по залитому солнцем кухонному столу, крупный план`
7. Leave every other control at its default. Before generating, record these
   as shown on screen: the selected model name (under **"Модель"**), the
   duration under **"Длительность"**, the format under **"Формат"**, and the
   style under **"Стиль"**.
8. Click the yellow-green button at the bottom of the left panel
   (**"Сгенерировать"**). Note the exact time you clicked.
9. Watch the right-hand panel. Expected first state: a status card reading
   **"Генерация"** with a spinner. Report the exact text of that card.
10. Wait and observe for up to **10 minutes**, checking every 30 seconds:
    * If the card changes to **"Готово"** and a video player appears under
      **"Результат" / "Сгенерированное видео"** — click play, and report whether
      the video actually plays, roughly how long it is, and whether there is sound.
    * If the card changes to **"Ошибка"** — copy the error text verbatim.
    * If it is still **"Генерация"** after 10 minutes — that is a valid outcome;
      report it as `still-processing` with the elapsed time. Do not refresh or
      click generate again.
11. Open the browser console and report every error and warning that appears
    there, verbatim, including any red network failures (note the URL and status
    code). Do not paste auth tokens: if a value looks like a long token
    (`eyJ...`), write `<token>` instead.

**Rules**

* Report only what you observed. Never guess, never infer, never say "probably".
* If anything at all differs from what this script describes — different
  wording, a missing button, an unexpected dialog, a blank page, a different
  layout — **stop immediately**, describe exactly what you see (text, position,
  colours) and what you had done just before, and do not continue improvising.
* Do not click "Повторить", do not click generate a second time, do not delete
  anything, do not change settings pages.
* Take note of exact on-screen wording in Russian; do not translate it in the
  report.

**Report format — reply with exactly this structure and nothing else**

```
RESULT: pass | fail | still-processing | blocked

STEPS
1 landing: <what you saw>
2 guest sign-in: <what you saw / what you clicked>
3 studio page: <what you saw>
4 tab: <which tab was active>
5 camera motion: <selected? highlighted?>
6 prompt: <text entered, confirmed visible?>
7 defaults observed: model=<...> duration=<...> format=<...> style=<...>
8 generate clicked at: <HH:MM:SS>
9 first status card: "<verbatim text>"
10 final status after <MM:SS>: "<verbatim text>"
    video player present: yes | no
    playback: <plays / does not play / n-a>  duration: <seconds or n-a>  sound: <yes / no / n-a>

CONSOLE
- <verbatim error or warning, one per line; "none" if clean>

NETWORK FAILURES
- <METHOD URL -> status, one per line; "none" if clean>

UNEXPECTED
- <anything that deviated from the script; "none" if nothing did>
```

---

## 5. Failure triage

| Symptom | Most likely cause | Where to look |
|---|---|---|
| Server exits at startup with `Invalid server configuration:` and a bullet list | Missing/misshaped env var; each bullet names the exact variable | `server/src/config.ts` (`loadConfig`, `parseServiceAccount`); fix `server/.env`; remember the server needs `node --env-file=.env` |
| Startup error `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON` | Key file pasted with real newlines, or the shell mangled the quotes | Re-flatten the JSON to one line; `\n` inside `private_key` must stay as the two characters `\` `n` |
| `GET /health` fine, everything else `401 {"status":"unauthenticated","message":"Sign in is required."}` | No `Authorization: Bearer` header | `requireAuth()` in `server/src/middleware/auth.ts`; check the curl header, or `VITE_WORKER_URL` pointing at a stale origin |
| `401 ... "Invalid auth token."` | Token from a **different Firebase project** than the service account, or expired (1 h) | Web API key vs `FIREBASE_SERVICE_ACCOUNT_JSON.project_id` must be the same project; re-mint via Step 0 |
| `403 {"status":"permission-denied","message":"This account is not allowed to use Video Studio."}` on every call | `VIDEO_STUDIO_ALLOWED_EMAILS` is non-empty and the caller is anonymous (no email claim) | `requireAllowedEmail()` in `server/src/middleware/auth.ts`; clear the variable for guest testing |
| Frontend shows red **"Access denied"** card before any request | `VITE_VIDEO_STUDIO_ALLOWED_EMAILS` non-empty + anonymous user | `src/config/videoStudioAccess.ts`, `src/components/video/VideoAccessGate.tsx` |
| Guest button fails, console shows `auth/operation-not-allowed` | Anonymous sign-in not enabled | Firebase console → Authentication → Sign-in method (prereq 1.11) |
| Console shows `auth/unauthorized-domain` | `localhost` removed from authorized domains | Authentication → Settings → Authorized domains (prereq 1.12) |
| Page is blank, console throws `Firebase config invalid: VITE_FIREBASE_API_KEY missing or placeholder` | `.env.local` not filled, or Vite not restarted after editing it | `src/firebaseApp.ts` `assertConfig()` |
| Browser console: CORS preflight blocked | `CORS_ORIGINS` set to something other than `http://localhost:5173` | `createApp()` in `server/src/app.ts`; empty `CORS_ORIGINS` allows all origins |
| `404 {"status":"not-found","message":"Unknown function: saveClaudeSettings"}` from the Settings page | The Node server implements only the four routes; `src/pages/VideoSettings.tsx:157` still calls a Worker-era function | `server/src/app.ts` `notFound`; expected — stay off the settings page during E2E |
| `404 {"status":"not-found","message":"Video generation was not found."}` from `startVideoGeneration` | The Firestore doc was never created, or it lives in a non-`(default)` database the Admin SDK cannot see | `loadOwnedGeneration()` in `server/src/routes/video.ts`; Step 3 above; `VITE_FIREBASE_DATABASE_ID` |
| `403 "This generation belongs to another user."` | `userId` in the doc ≠ uid of the token (e.g. a token re-minted between steps creates a *new* anonymous user) | Same function; keep `$TOKEN`/`$UID` from one Step-0 run together |
| `400 {"status":"invalid-argument","message":"modelId is invalid."}` | `modelId` not in `veo-3.1 / veo-3.1-fast / veo-3.0 / veo-3.0-fast / veo-2.0` — note `json2video` is offered by the UI model list but is **not** accepted by this server | `VEO_MODEL_IDS`, `server/src/vertex/models.ts`; `src/models/videoModels.ts` |
| `400 "Veo does not support the 1:1 aspect ratio."` | Aspect other than `16:9` / `9:16` | `resolveAspectRatio()`, `server/src/vertex/models.ts` |
| `500 "Vertex ...:predictLongRunning failed: 403 ..."` | Vertex AI API not enabled, billing not on Blaze, or the service account lacks `roles/aiplatform.user` | `callVertex()` in `server/src/vertex/client.ts`; prereqs 1.2/1.3/1.7 |
| `500 "Vertex ...failed: 404 ... was not found"` | Model id not available in `VERTEX_LOCATION`, or preview model not allow-listed for the project | `modelUrl()` in `server/src/vertex/client.ts`; prereq 1.4; try `VERTEX_LOCATION=us-central1` and `veo-3.0-fast` |
| `500 "Vertex ... failed: 429 ..."` | Vertex quota for Veo exhausted | Google Cloud console → IAM & Admin → Quotas |
| `429 {"status":"resource-exhausted","message":"Превышен лимит: 10 генераций в час..."}` | Local rate limit hit | `server/src/middleware/rateLimit.ts`; clear/inspect `rateLimits/<uid>` in Firestore (Admin-only collection) |
| `testVertexConnection` returns `status:"error"`, `tokenOk:false` | Service-account key rejected: wrong/rotated key, clock skew, `private_key` newlines not restored | `getAccessToken()` in `server/src/vertex/client.ts`; the `message` field carries Google's text |
| Poll returns `status:"failed"`, error `Veo blocked the generation: ...` | Safety filtering (`raiMediaFilteredReasons`) | `describeEmptyResult()` in `server/src/vertex/veo.ts`; rewrite the prompt |
| Poll returns `failed`, error `Failed to download the Veo output (HTTP 403)` | Service account cannot read the temporary GCS object Veo wrote | `readVideoBytes()` in `server/src/vertex/veo.ts`; grant storage read on the project |
| Poll flips to `completed` but the video URL 404s / 403s | Storage bucket name mismatch between server and Firebase, or the bucket does not exist | `FIREBASE_STORAGE_BUCKET` vs `VITE_FIREBASE_STORAGE_BUCKET`; `uploadBuffer()` in `server/src/firebase.ts` |
| Server log shows `unhandled error` with `Internal server error.` in the response | Unmapped exception — the real message and stack are only in the server stdout | `errorHandler` in `server/src/app.ts`; read the JSON log line |
| UI stuck on **"Генерация"** forever while the curl poll says `completed` | Firestore snapshot subscription not updating: rules not deployed, wrong database id, or the browser is signed in as a *different* anonymous uid than the doc's `userId` | `subscribeToUserVideoGenerations()` in `src/services/firebaseVideoService.ts`; `firestore.rules`; browser console for `permission-denied` |
| UI stuck on **"Генерация"** and nothing is polling | Expected: the "Создать видео" tab never calls `checkVideoGeneration` | `src/pages/VideoStudio.tsx:284–289` (only Cinema Studio polls); drive the poll from curl as described in section 4 |
| Firestore write from the browser fails with `permission-denied` | Rules not deployed to the new project, or `userId` field missing from the created doc | `firestore.rules`; `createVideoGenerationDocument()` in `src/services/firebaseVideoService.ts` |
| Reference-image upload fails | File >25 MB or a content type outside image/video/audio | `storage.rules` `isAllowedUpload()` |
