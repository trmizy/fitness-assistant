# n8n Integration - Detailed Current State (fitness-assistant)

## 1. Purpose and scope

This document is the detailed operational reference for n8n integration in this repository.
It reflects the current implementation in Docker, gateway proxy layer, and admin UI.

Current objectives:

- Run n8n as an internal workflow runtime in the same Docker network.
- Expose workflow operations only to admin users via gateway APIs.
- Open n8n Studio from Admin portal without cross-origin/frame breakage.
- Provide smoke test and end-to-end test hooks for integration validation.

## 2. Source of truth (code locations)

Infrastructure:

- [infra/compose/docker-compose.dev.yml](../../../infra/compose/docker-compose.dev.yml)

Gateway (proxy + admin APIs):

- [backend/gateway/src/routes/proxy.routes.ts](../../../backend/gateway/src/routes/proxy.routes.ts)
- [backend/gateway/src/app.ts](../../../backend/gateway/src/app.ts)
- [backend/gateway/src/middleware/rateLimit.middleware.ts](../../../backend/gateway/src/middleware/rateLimit.middleware.ts)

Admin UI:

- [frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx](../../../frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx)
- [frontend/web/src/app/services/api.ts](../../../frontend/web/src/app/services/api.ts)
- [frontend/web/src/app/routes.tsx](../../../frontend/web/src/app/routes.tsx)
- [frontend/web/src/app/components/layout/Sidebar.tsx](../../../frontend/web/src/app/components/layout/Sidebar.tsx)

## 3. Runtime topology

Container/service:

- Service: `n8n`
- Image: `n8nio/n8n:latest`
- Container name: `gymcoach-n8n`
- Port: `5678:5678`
- Persistent volume: `n8n_data:/home/node/.n8n`
- Health endpoint: `GET /healthz`

Gateway integration:

- Gateway talks to n8n internally via `http://n8n:5678`.
- Admin users access n8n through gateway routes under `/admin/workflows/*`.

## 4. Environment variables

Primary env files:

- [.env](../../../.env)
- [.env.example](../../../.env.example)

### 4.1 n8n runtime env

- `N8N_HOST`
- `N8N_PATH` (current local setup uses `/`)
- `N8N_WEBHOOK_URL`
- `GENERIC_TIMEZONE`
- `N8N_BASIC_AUTH_ACTIVE` (current recommended local setup: `false` to avoid UI login conflicts)
- `N8N_BASIC_AUTH_USER`
- `N8N_BASIC_AUTH_PASSWORD`
- `N8N_PUBLIC_API_DISABLED`

### 4.2 gateway to n8n env

- `N8N_BASE_URL`
- `N8N_EDITOR_BASE_PATH`
- `N8N_PUBLIC_API_KEY`
- `N8N_SMOKE_TEST_WEBHOOK_URL`
- `N8N_E2E_WEBHOOK_URL`

Important:

- `N8N_PUBLIC_API_KEY` is required for `/admin/workflows*` listing/execution APIs.
- smoke/e2e endpoints depend on webhook URLs and activated workflows.

## 5. Gateway API and proxy surface

All n8n admin APIs are protected by `authMiddleware` + `requireRoles('ADMIN')`.

### 5.1 admin n8n APIs

- `GET /admin/workflows/meta`
  - checks `n8n /healthz`
  - returns connectivity and studio path metadata

- `GET /admin/workflows`
  - calls `n8n /api/v1/workflows`
  - requires `N8N_PUBLIC_API_KEY`

- `GET /admin/workflows/:workflowId/executions?limit=...`
- `GET /admin/workflows/executions/:executionId`

- `POST /admin/workflows/smoke-test`
- `POST /admin/workflows/full-system-test`
- `POST /admin/workflows/setup-samples`

### 5.2 studio and auth-related proxy routes

Main studio route:

- `/admin/workflows/studio`

Supported aliases normalized to canonical studio route:

- `/admin/workflows/studio/`
- `/admin/workflows/studio/login`
- `/admin/workflows/studio/register`

Also proxied:

- `/rest`
- `/assets`
- `/static`
- `/signin`
- `/login`

### 5.3 hardening applied

To avoid iframe and browser security breakage in admin embedding:

- remove response headers for n8n routes:
  - `X-Frame-Options`
  - `Content-Security-Policy`
  - `X-Content-Type-Options`

To avoid local HTTP cookie/session issues:

- proxy rewrites `Set-Cookie` path to `/`
- strips `Secure` flag in local gateway flow

To avoid asset flooding 429:

- rate limit bypass for n8n-heavy paths (`/admin/workflows/studio`, `/rest`, `/assets`, `/static`, `/signin`)

## 6. Admin UI behavior

Main page:

- [frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx](../../../frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx)

Buttons currently available:

- `Mở Studio`
- `Đăng nhập n8n`
- `Đăng ký n8n`

Note on login/register buttons:

- Both are convenience entry links via gateway aliases.
- Alias routes are redirected to canonical `/admin/workflows/studio?...` to prevent n8n SPA 404.

## 7. Current auth model and owner account flow

Current stable model:

- Gateway admin JWT controls entry to studio URL.
- n8n user-management handles in-studio account/session.
- Basic Auth should remain disabled for local studio login flow unless there is a strict requirement.

Owner lifecycle commands used in operations:

- reset user state:
  - `echo y | docker exec -i gymcoach-n8n n8n user-management:reset`

- create owner via API:
  - `POST http://localhost:5678/rest/owner/setup`

## 8. Validation checklist

### 8.1 rebuild

From repo root:

- `docker-compose --env-file .env -f infra/compose/docker-compose.dev.yml up -d --build --force-recreate`

### 8.2 health and studio

- `GET http://localhost:3000/health`
- `GET http://localhost:5678/healthz`
- open admin workflow page and click studio buttons

Expected:

- studio opens without `Oops, couldn't find that (404)` page
- no iframe blocking due to `X-Frame-Options`

### 8.3 n8n login API quick check

- `POST http://localhost:3000/rest/login`

Expected:

- `200` with user payload when owner credentials are correct

## 9. Common failure patterns and fixes

### 9.1 `404 Oops, couldn't find that` in studio

Likely causes:

- stale URL path (`/studio/login`, `/studio/register`, trailing slash) without canonical redirect
- stale frontend bundle/browser cache

Fix:

- keep alias redirects in gateway
- hard refresh or open incognito after deploy

### 9.2 `401 /rest/login`

Likely causes:

- owner user not initialized/reset mismatch
- Basic Auth conflict with user-management flow

Fix:

- disable Basic Auth for local UI flow
- reset and recreate owner account

### 9.3 iframe/chromewebdata unsafe load error

Likely cause:

- iframe blocked by security headers, then frame URL becomes `chrome-error://chromewebdata`

Fix:

- strip `X-Frame-Options` and restrictive CSP headers for n8n proxy routes

## 10. Security notes

- Keep all `/admin/workflows*` routes admin-only.
- Never commit real `N8N_PUBLIC_API_KEY` to VCS.
- If Basic Auth is re-enabled in production, review login UX and cookie behavior carefully.
- Restrict header relaxations only to n8n proxy paths.

## 11. Operational summary

The n8n module is now a complete admin-operated subsystem with:

- dockerized runtime
- gateway-protected API operations
- embedded studio access with alias normalization
- smoke/e2e integration hooks
- documented reset/recovery flow for login incidents
