# n8n Integration - Current State in fitness-assistant

## 1. Overview

This document describes the real current n8n integration that is already wired in this repository.
It is based on the running implementation in Docker Compose, API Gateway, and Admin UI.

Main goals of the current integration:

- Run n8n as an internal orchestration service in the same Docker network.
- Expose n8n capabilities to admins via gateway-protected endpoints.
- Embed n8n Studio into Admin UI.
- Support workflow listing, execution inspection, smoke test, and sample workflow bootstrap.

## 2. Where n8n lives in the architecture

n8n is integrated in three layers:

- Infrastructure:
  - [infra/compose/docker-compose.dev.yml](../../../infra/compose/docker-compose.dev.yml)
- Backend (Gateway):
  - [backend/gateway/src/routes/proxy.routes.ts](../../../backend/gateway/src/routes/proxy.routes.ts)
- Frontend (Admin):
  - [frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx](../../../frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx)
  - [frontend/web/src/app/services/api.ts](../../../frontend/web/src/app/services/api.ts)
  - [frontend/web/src/app/routes.tsx](../../../frontend/web/src/app/routes.tsx)
  - [frontend/web/src/app/components/layout/Sidebar.tsx](../../../frontend/web/src/app/components/layout/Sidebar.tsx)

## 3. Docker runtime details

Defined service: n8n

- Image: n8nio/n8n:1.97.1
- Container name: gymcoach-n8n
- Port mapping: 5678:5678
- Data volume: n8n_data -> /home/node/.n8n
- Health check: GET /healthz (inside container)

n8n service is configured in:

- [infra/compose/docker-compose.dev.yml](../../../infra/compose/docker-compose.dev.yml)

Gateway also receives n8n-related env vars in the same compose file so it can call n8n internally as http://n8n:5678.

## 4. Environment variables used for n8n

Canonical template is in:

- [.env.example](../../../.env.example)

Important variables:

Core n8n runtime:

- N8N_HOST
- N8N_PATH
- N8N_WEBHOOK_URL
- GENERIC_TIMEZONE
- N8N_BASIC_AUTH_ACTIVE
- N8N_BASIC_AUTH_USER
- N8N_BASIC_AUTH_PASSWORD
- N8N_PUBLIC_API_DISABLED

Gateway-to-n8n integration:

- N8N_BASE_URL
- N8N_EDITOR_BASE_PATH
- N8N_PUBLIC_API_KEY
- N8N_SMOKE_TEST_WEBHOOK_URL

Notes:

- N8N_PUBLIC_API_KEY is required for workflow/execution APIs via gateway.
- Without N8N_PUBLIC_API_KEY, /admin/workflows returns N8N_API_KEY_MISSING.
- N8N_SMOKE_TEST_WEBHOOK_URL is required for smoke-test endpoint.

## 5. Gateway API surface for n8n

All routes are implemented in:

- [backend/gateway/src/routes/proxy.routes.ts](../../../backend/gateway/src/routes/proxy.routes.ts)

All n8n admin routes are protected by:

- authMiddleware
- requireRoles('ADMIN')

### 5.1 Health and metadata

- GET /admin/workflows/meta
  - Checks n8n health endpoint (/healthz)
  - Returns studioPath, apiEnabled, status, healthStatusCode

### 5.2 Workflows

- GET /admin/workflows
  - Requires N8N_PUBLIC_API_KEY
  - Calls n8n /api/v1/workflows
  - Returns total, active, inactive, workflows[]

### 5.3 Executions

- GET /admin/workflows/:workflowId/executions?limit=20
  - Requires N8N_PUBLIC_API_KEY
  - Calls n8n /api/v1/executions

- GET /admin/workflows/executions/:executionId
  - Requires N8N_PUBLIC_API_KEY
  - Calls n8n /api/v1/executions/:id

### 5.4 Smoke test

- POST /admin/workflows/smoke-test
  - Requires N8N_SMOKE_TEST_WEBHOOK_URL
  - Sends payload to configured webhook URL
  - Returns passed/statusCode/durationMs/responseBody/testedAt

### 5.5 Sample workflow setup

- POST /admin/workflows/setup-samples
  - Requires N8N_PUBLIC_API_KEY
  - Idempotently creates workflow named Gym Coach - Smoke Test
  - Activates the created workflow

### 5.6 Embedded Studio proxy

- /admin/workflows/studio/*
  - Proxied to n8n service
  - Supports websocket upgrade
  - Removes x-frame-options and content-security-policy headers for iframe embedding
  - Supports access token from query string (access_token) then strips it before proxying upstream

## 6. Admin UI integration

Main page:

- [frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx](../../../frontend/web/src/app/pages/admin/AdminWorkflowStudio.tsx)

Features currently present in UI:

- n8n connection status and API key status card
- workflow counts (active/inactive)
- workflow list
- execution list per workflow
- execution detail drawer/expand view
- smoke test trigger
- sample workflow setup trigger
- open embedded studio and open in new tab

Routing and navigation:

- Route: /admin/workflows in [frontend/web/src/app/routes.tsx](../../../frontend/web/src/app/routes.tsx)
- Sidebar item: Workflows in [frontend/web/src/app/components/layout/Sidebar.tsx](../../../frontend/web/src/app/components/layout/Sidebar.tsx)

Frontend API client methods are in:

- [frontend/web/src/app/services/api.ts](../../../frontend/web/src/app/services/api.ts)

Methods:

- getWorkflowMeta
- listWorkflows
- getWorkflowExecutions
- getExecutionDetail
- runSmokeTest
- setupSampleWorkflows

## 7. Monitoring behavior

System monitor includes n8n as optional dependency.

Implementation details:

- Probe key includes n8n in monitor services list
- n8n probe uses /healthz
- n8n is marked optional, so n8n downtime does not reduce core health score

Source:

- [backend/gateway/src/routes/proxy.routes.ts](../../../backend/gateway/src/routes/proxy.routes.ts)

## 8. Existing e2e helper script

There is an admin e2e script that also checks n8n workflow endpoint:

- [scripts/test-admin-e2e.mjs](../../../scripts/test-admin-e2e.mjs)

Current n8n coverage in script:

- Login admin
- Call /admin/workflows
- Report status and payload shape

## 9. How to run and validate now

### 9.1 Rebuild and run Docker stack

From repo root:

- docker-compose --env-file .env -f infra/compose/docker-compose.dev.yml build --no-cache
- docker-compose --env-file .env -f infra/compose/docker-compose.dev.yml up -d --force-recreate
- docker-compose --env-file .env -f infra/compose/docker-compose.dev.yml ps

### 9.2 Basic runtime checks

- Gateway health: GET http://localhost:3000/health
- n8n health: GET http://localhost:5678/healthz
- Admin studio proxy: GET http://localhost:3000/admin/workflows/studio/ (requires admin auth)

### 9.3 Gateway n8n API checks

Use admin JWT and call:

- GET /admin/workflows/meta
- GET /admin/workflows
- GET /admin/workflows/:workflowId/executions
- GET /admin/workflows/executions/:executionId
- POST /admin/workflows/smoke-test
- POST /admin/workflows/setup-samples

## 10. Security notes

- n8n Studio is behind gateway admin auth plus n8n basic auth.
- N8N_PUBLIC_API_KEY is sensitive and must not be committed.
- Keep N8N_BASIC_AUTH_PASSWORD strong and rotate regularly.
- iframe embedding requires header relaxations at gateway proxy; keep route admin-only.

## 11. Known operational caveats

- If N8N_PUBLIC_API_KEY is empty, workflow/execution API endpoints fail by design.
- Smoke test endpoint fails if N8N_SMOKE_TEST_WEBHOOK_URL is not set or workflow is inactive.
- Docker Compose may warn about existing external network name gymcoach-network; this is not necessarily fatal if containers still start and pass health checks.

## 12. Current status summary

At this point, n8n integration in this project is not just an added container.
It is a full admin-operated workflow module with:

- runtime service in compose
- protected gateway API layer
- embedded admin interface
- smoke-test and bootstrap workflow automation hooks

This is the effective baseline for future enhancements.
