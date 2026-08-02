## What changed

<!-- One or two sentences. Name the user-visible behaviour or the API surface, not the files. -->

## Why

<!-- The problem this solves. Link the issue if there is one. -->

## How it was verified

<!-- What you actually ran or clicked: `pnpm verify`, `pnpm e2e`, a manual flow, a screenshot. -->

## Checklist

- [ ] `pnpm verify` passes locally (lint, typecheck, unit tests, build)
- [ ] Tests cover the change, or there is a reason in this PR why they do not
- [ ] No new `any`, no `.js`/`.jsx` sources, relative imports in `apps/api` carry `.js`
- [ ] No secrets, tokens or real credentials in the diff, the tests, or the fixtures

## Deployment

- [ ] **Env / secrets**: this PR adds or renames an environment variable or repository secret
      <!-- If checked: list them, and say where they must be set (GitHub secrets, infra/env/*.env on the VPS). -->
- [ ] **Data migration**: existing MongoDB documents need a backfill or an index change
      <!-- If checked: say whether the new code reads the old shape safely while the migration runs. -->
- [ ] **Manual step on deploy**: something beyond `deploy.sh` is required
      <!-- If checked: write the exact commands, and how to undo them. -->

<!-- None checked means: merge to main deploys this on its own with no human action. -->
