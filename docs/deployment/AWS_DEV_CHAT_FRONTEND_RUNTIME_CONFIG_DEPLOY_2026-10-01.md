# AWS DEV — Chat Frontend Runtime-Config Deploy (Phase 3.5)

Date: 2026-10-01. Account `191798898985`, region `ap-southeast-1`. **Owner explicitly authorized this frontend bundle deployment** (the one action Phase 3 could not complete, blocked by the session's own permission classifier). Scope: frontend bundle deployment only. No Chat ALB/NAT created, Aurora not started, OpenSearch/DB/IAM/Bedrock/backend services untouched, Chat feature not enabled — all independently re-verified unchanged (Step 1, Step 12).

Builds on `docs/deployment/AWS_DEV_CHAT_ON_DEMAND_MIGRATION_2026-10-01.md`, which implemented and build-validated this code but could not ship it.

## Source files involved

- `frontend/web/src/app/config/serverUrl.ts` — `loadRuntimeConfig()` fetches `/runtime-config.json` once at boot (1.5s timeout, never throws); `chatSocketTarget()` and `isChatWsEnabled()` both check it with correct priority (per-device `localStorage` override > runtime config > build-time `VITE_CHAT_WS_URL`/`VITE_ENABLE_CHAT_WS` > same-origin fallback).
- `frontend/web/src/app/services/socket.ts` — `chatSocketTarget()` evaluated lazily inside `getSocket()`, not at module load, so it picks up the fetched config.
- `frontend/web/src/main.tsx` — awaits `loadRuntimeConfig()` before the first `render()`.

All 3 confirmed present and correct by direct re-read before building (Step 2) — no HARD STOP triggered.

**Feature-flag semantics confirmed untouched** (Step 3): `.env.production`'s `VITE_ENABLE_CHAT=false` / `VITE_ENABLE_CHAT_WS=true` are exactly what they were before this phase — not edited. `runtime-config.json`'s `chatEnabled` is purely an infra-availability signal (`isChatWsEnabled()` only short-circuits to `false` when the server-pushed config explicitly says so; it never overrides the build-time flags to `true`), never a product decision.

## Build result

- Command: `pnpm build` (`vite build`, default mode `production`, auto-loads `.env.production`)
- Duration: 24.14s (Vite-reported), 29.27s wall clock including pnpm overhead
- Output: `frontend/web/dist/`
- Main bundle: `assets/index-DclWmUqI.js` (905.26 kB, gzip 269.19 kB)
- Stylesheet: `assets/index-1-plbgpv.css`
- 200+ route-chunk files (content-hashed, one per lazy-loaded page)

## Bundle verification (Step 5, before upload)

- `grep -l "runtime-config.json" dist/assets/*.js` → **present** in `index-DclWmUqI.js` — the fetch logic is really compiled in, not just a theoretical source-level change.
- Old original ALB hostname (`fitness-assistant-dev-chat-alb...`) → **absent** from the bundle entirely.
- Phase-3's temporary ALB hostname (`dev-chat-alb-282271276...`, itself already deleted) → **present once**, as the build-time `VITE_CHAT_WS_URL` fallback value (expected — that was the last value in `.env.production` when this was built). **Not a hard dependency**: `chatSocketTarget()` checks `runtimeConfig.chatWsUrl` first, and `isChatWsEnabled()`'s `runtimeConfig.chatEnabled === false` check disables the WS attempt entirely regardless of this fallback — confirmed by re-reading the logic, not assumed.
- No secrets (`ANTHROPIC_API_KEY`, AWS credentials, etc.) found in the bundle.

## S3 backup metadata (Step 6, before deploy)

| Object | Previous ETag | Previous LastModified | VersionId |
|---|---|---|---|
| `index.html` | `9aff89c79ad9f5b41f3531505eed1dc0` | 2026-09-30T08:05:20Z | `DQm4ASoAZ5iw9p53HQpHZ3HGZFQP1DWs` |
| `runtime-config.json` | `a1929e37d39286b442af6424e338e312` | 2026-10-01T10:16:35Z | `shfoFb2sW8tW2G5gg1JXa3_IryJG8JPv` |

Content before deploy: `runtime-config.json` already read `{"chatWsUrl":"","chatEnabled":false}` (pushed by Phase 3's `dev-stop.ps1 -Chat -Execute` at freeze time) — already the correct frozen state.

Bucket versioning: **Enabled** — every object in this bucket has a full version history, giving a real rollback mechanism (see Rollback section). 211 asset objects existed before this deploy.

## Deploy performed (Step 7, owner-authorized)

Used the existing runbook pattern (`docs/aws-deployment/AWS_DEPLOYMENT_RUNBOOK.md`), with `runtime-config.json` explicitly excluded from the sync so `--delete` could never remove or overwrite it:

```
aws s3 sync frontend/web/dist s3://fitness-assistant-frontend-dev-191798898985 \
  --delete --cache-control "max-age=31536000,public" \
  --exclude index.html --exclude runtime-config.json
aws s3 cp frontend/web/dist/index.html s3://.../index.html \
  --cache-control no-cache --content-type text/html
```

Both commands exited 0. Hashed assets got long-cache (immutable filenames), `index.html` got `no-cache` (same as before).

| Object | New ETag | New LastModified |
|---|---|---|
| `index.html` | `8e75ee553f9235f9d0f4d4db89f32907` | 2026-10-01T10:45:27Z |
| `runtime-config.json` | `a1929e37d39286b442af6424e338e312` (unchanged) | 2026-10-01T10:16:35Z (unchanged) |

Confirmed `runtime-config.json` was never touched by the sync (identical ETag/VersionId before and after).

## Frozen runtime config (Step 8)

Explicitly (re-)wrote and uploaded `{"chatWsUrl":"","chatEnabled":false}` with `Cache-Control: no-cache`, `Content-Type: application/json`, per instruction — already correct from Phase 3's freeze, now re-confirmed deliberately rather than assumed. New ETag `2f860c5a808a2ac81b167a959465ccb7`. No secrets.

## Live verification (Step 9)

Site: `http://fitness-assistant-frontend-dev-191798898985.s3-website.ap-southeast-1.amazonaws.com` (confirmed via `get-bucket-website`; both the `.` and `-` region-separator endpoint forms resolve, used the `.` form as canonical).

| Check | Result |
|---|---|
| `index.html` loads | HTTP 200, references `/assets/index-DclWmUqI.js` — the new bundle |
| Main JS bundle loads | HTTP 200, 905,262 bytes (matches build output exactly) |
| CSS loads | HTTP 200 |
| `runtime-config.json` loads | HTTP 200, body `{"chatWsUrl":"","chatEnabled":false}` — correct frozen state, live |
| Old/deleted ALB reference active | **NO** — confirmed via Step 5's bundle grep (old name absent) + this fetch (config says disabled) |
| Chat WS attempt while frozen | **NOT_VERIFIABLE** by HTTP fetch alone (would need a running browser's network tab) — supported by **CODE AUDIT**: `CallContext.tsx`'s `useEffect` only calls `connectSocket()` when `chatWsEnabled` is true, and `isChatWsEnabled()` short-circuits to `false` the instant `runtimeConfig.chatEnabled === false`, which the live fetch just confirmed is the server-pushed value. This is **REAL HTTP/API + CODE AUDIT** evidence, not a **REAL BROWSER** observation — stated precisely per this project's evidence-labeling convention. |

## Regression check (Step 10)

SPA routing fallback (pre-existing `ErrorDocument: index.html` behavior, unchanged by this deploy) confirmed still working: `/login` and `/app/plans` return HTTP 404 (S3 website hosting's standard behavior — the error document is served as the *body* while the status code stays 404; this is how the site has always behaved, not a regression) with the app shell's `<title>` present in the body, meaning the SPA bootstrap document is correctly served for client-side routes. No AI inference run, no users created, no backend state mutated — this check was pure static-asset HTTP fetching.

## Future Chat reconnect, confirmed without creating Chat (Step 11)

Dry-run only (`-Execute` never passed):
- `dev-start.ps1 -Chat` prints: `{ chatWsUrl: '<ChatLoadBalancerDnsName output>', chatEnabled: true } -> s3://.../runtime-config.json`
- `dev-stop.ps1 -Chat` prints: `{ chatWsUrl: '', chatEnabled: false } -> s3://.../runtime-config.json`

Both scripts' logic is unchanged since Phase 3 and was proven live then (both directions actually executed and verified in that phase).

## Cost state (Step 12)

```
Aurora status:                    stopped          -> OK
NAT Gateways available/pending:   0                -> OK
Chat ALB state:                   absent            -> OK
Chat ECS desired/running:         0/0               -> OK
Unattached EBS volumes:           1 (vol-0c0a7abcb61186356) -> KNOWN_DEFERRED_ITEM, pre-existing, unrelated
```
No new paid infrastructure resulted from this frontend deployment (S3 storage/request costs for a static site are the same negligible, already-existing cost category as before).

## Regressions

None found. The SPA routing fallback behaves identically to before. The one pre-existing dependency (build-time `VITE_CHAT_WS_URL` fallback pointing at an already-deleted ALB) is now provably unreachable code in practice, since `runtime-config.json`'s `chatEnabled: false` is checked first and disables the WS attempt before that fallback value would ever matter.

## Rollback instructions

If a regression is later found in this deploy:
1. **Static assets / index.html**: the bucket has versioning enabled. Restore the previous `index.html` version (`VersionId: DQm4ASoAZ5iw9p53HQpHZ3HGZFQP1DWs`) via `aws s3api copy-object --copy-source "fitness-assistant-frontend-dev-191798898985/index.html?versionId=DQm4ASoAZ5iw9p53HQpHZ3HGZFQP1DWs" ...`, or restore the full previous asset set from their individual versions (every deleted/overwritten object is still recoverable this way, not permanently lost).
2. **runtime-config.json**: already correctly frozen (`chatEnabled:false`); no rollback needed for it specifically — it never changed behavior for real users either way.
3. No backend, database, or infrastructure rollback is applicable — this phase touched only the S3-hosted frontend bundle.

---

## Final response (as requested)

- **FRONTEND_BUILD: PASS** (`pnpm build`, 24.14s, clean compile)
- **RUNTIME_CONFIG_CODE_PRESENT_IN_BUILD: YES** (confirmed via grep on the actual built bundle, not just source)
- **FRONTEND_DEPLOY: PASS** (`aws s3 sync` + `index.html` upload, both exit 0, new ETag confirmed)
- **RUNTIME_CONFIG_DEPLOY: PASS** (excluded from the bundle sync so it was never at risk; explicitly re-confirmed/re-written separately)
- **RUNTIME_CONFIG_CACHE_CONTROL: no-cache** (confirmed via `head-object` after upload)
- **LIVE_FRONTEND_LOAD: PASS** (index.html, main JS bundle, CSS, and runtime-config.json all HTTP 200 on the live S3 website endpoint)
- **OLD_CHAT_ALB_REFERENCE_ACTIVE: NO** (original ALB hostname absent from the bundle entirely; the one stale hostname present is an inert fallback superseded by the live disabled config)
- **CHAT_WS_ATTEMPT_WHILE_FROZEN: NOT_VERIFIABLE** by HTTP fetch alone — but CODE AUDIT + the live config fetch together confirm the connect call is correctly gated off
- **COST_STATE_CHANGED: NO**
- **NAT: 0**
- **CHAT_ALB: 0**
- **AURORA: STOPPED**

**CHAT_FRONTEND_RUNTIME_RECONNECT: READY**

**NEXT_RECOMMENDED_PHASE: OPENSEARCH_RECONNECT**

**HARD STOP. Not proceeding automatically into OpenSearch.**
