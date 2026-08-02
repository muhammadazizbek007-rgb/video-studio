#!/usr/bin/env bash
#
# Provisions the Google Cloud side of Video Studio: a project, the Vertex AI API, and a
# service account whose key the API uses to call Veo and Imagen.
#
# What this script deliberately does NOT do: create the OAuth 2.0 *client* (the id and
# secret used for "Sign in with Google"). Google exposes no supported CLI or API for
# creating a Web-application client — `gcloud iap oauth-clients` only covers
# Identity-Aware Proxy brands, which requires a Workspace organisation and produces a
# client that is not usable for a public sign-in page. That step is Console-only and is
# printed at the end.
#
# Usage:
#   ./setup-gcp.sh --project-id video-studio-prod [--billing-account 0X0X0X-0X0X0X-0X0X0X]
#                  [--key-out ./service-account.json] [--location us-central1]
#
# Re-running is safe: every step checks for the resource before creating it.

set -euo pipefail

PROJECT_ID=""
BILLING_ACCOUNT=""
KEY_OUT="./service-account.json"
LOCATION="us-central1"
SA_NAME="video-studio-vertex"

die() { printf '\nerror: %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project-id)      PROJECT_ID="${2:-}"; shift 2 ;;
    --billing-account) BILLING_ACCOUNT="${2:-}"; shift 2 ;;
    --key-out)         KEY_OUT="${2:-}"; shift 2 ;;
    --location)        LOCATION="${2:-}"; shift 2 ;;
    -h|--help)         sed -n '2,20p' "$0"; exit 0 ;;
    *)                 die "unknown argument: $1" ;;
  esac
done

[ -n "$PROJECT_ID" ] || die "--project-id is required"
command -v gcloud >/dev/null 2>&1 || die "gcloud is not installed (brew install --cask google-cloud-sdk)"

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  die "gcloud has no active account. Run:  gcloud auth login"
fi
ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"
note "authenticated as ${ACCOUNT}"

step "Project ${PROJECT_ID}"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  note "already exists, reusing"
else
  gcloud projects create "$PROJECT_ID" --name="Video Studio"
  note "created"
fi
gcloud config set project "$PROJECT_ID" >/dev/null

step "Billing"
# Vertex AI refuses to serve a project without billing, and the failure surfaces much
# later as an opaque 403 on the first generation — so it is checked up front.
if gcloud beta billing projects describe "$PROJECT_ID" \
     --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
  note "already enabled"
elif [ -n "$BILLING_ACCOUNT" ]; then
  gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
  note "linked ${BILLING_ACCOUNT}"
else
  note "NOT enabled, and no --billing-account was given."
  note "Available accounts:"
  gcloud beta billing accounts list --format='table(name,displayName,open)' 2>/dev/null || \
    note "  (none visible to ${ACCOUNT})"
  die "re-run with --billing-account <ID>, or enable billing in the Console"
fi

step "APIs"
for api in aiplatform.googleapis.com iamcredentials.googleapis.com; do
  if gcloud services list --enabled --format='value(config.name)' | grep -qx "$api"; then
    note "${api} already enabled"
  else
    gcloud services enable "$api"
    note "${api} enabled"
  fi
done

step "Service account ${SA_NAME}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  note "already exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Video Studio Vertex AI"
  note "created ${SA_EMAIL}"
fi

# aiplatform.user is the least privilege that can call Veo and Imagen. The account needs
# nothing else: media is stored on the VPS, not in Cloud Storage.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user" \
  --condition=None >/dev/null
note "granted roles/aiplatform.user"

step "Service account key"
if [ -f "$KEY_OUT" ]; then
  note "${KEY_OUT} already exists — leaving it alone (delete it to mint a new key)"
else
  umask 077
  gcloud iam service-accounts keys create "$KEY_OUT" --iam-account="$SA_EMAIL"
  chmod 600 "$KEY_OUT"
  note "written to ${KEY_OUT} (mode 600)"
fi

step "Done — GOOGLE_SERVICE_ACCOUNT_JSON"
note "The API takes the key as raw JSON on ONE line. Produce it with:"
printf '\n    jq -c . %s\n' "$KEY_OUT"
note "and paste the result as GOOGLE_SERVICE_ACCOUNT_JSON in your env file."
note ""
note "Also set:  GCP_PROJECT_ID=${PROJECT_ID}"
note "           VERTEX_LOCATION=${LOCATION}"

cat <<EOF

────────────────────────────────────────────────────────────────────────
REMAINING MANUAL STEP — the OAuth client (Console only, ~2 minutes)

 1. https://console.cloud.google.com/auth/branding?project=${PROJECT_ID}
    Configure the consent screen. User type "External" unless ${ACCOUNT}
    belongs to a Workspace org and only that org should sign in.
    App name, support email, developer contact. Save.

 2. https://console.cloud.google.com/auth/clients?project=${PROJECT_ID}
    Create client -> Application type "Web application".

 3. Authorised redirect URIs — add BOTH:
       http://localhost:8080/api/auth/google/callback
       https://YOUR_DOMAIN/api/auth/google/callback
    Google permits http only for localhost; production must be https, and
    the URI must match \${API_PUBLIC_URL}/api/auth/google/callback exactly
    — no trailing slash, no path differences.

 4. Copy the client id and secret into your env file:
       GOOGLE_OAUTH_CLIENT_ID=...
       GOOGLE_OAUTH_CLIENT_SECRET=...

 5. While the consent screen is in "Testing", only accounts listed under
    Audience -> Test users can sign in. Add yourself, or publish the app.

Restrict who may use the studio with ALLOWED_EMAILS (comma-separated).
Leaving it empty lets ANY Google account that completes sign-in straight in.
────────────────────────────────────────────────────────────────────────
EOF
