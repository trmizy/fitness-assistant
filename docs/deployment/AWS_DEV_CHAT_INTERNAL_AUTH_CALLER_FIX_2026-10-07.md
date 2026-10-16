# AWS DEV — User/Fitness → Chat Internal Auth Caller Fix — 2026-10-07 (Phase 14A)

No secret value — `INTERNAL_SERVICE_SECRET`, `INTERNAL_API_SECRET`, any authorization header, JWT,
or SMTP credential — appears anywhere in this report. **Code fix + regression tests only. Zero AWS
mutations.**

## Bug Summary

Three caller sites in User-service and Fitness-service authenticate to chat-service's internal
routes by sending an `x-internal-secret` header. All three previously built that header's value
from `process.env.INTERNAL_API_SECRET` — a variable that is configured **only** on chat-service's
ECS task definition, never on any of the 12 backend Lambdas (including User and Fitness). Every
Lambda is instead configured with `INTERNAL_SERVICE_SECRET`. As a result, all three calls always
sent an **empty string** as the auth header, chat-service always rejected them with `401`, and all
three call sites swallowed this via a bare `.catch()` that only logged a generic, undifferentiated
warning — making a permanent configuration/auth defect indistinguishable from an ordinary transient
network failure.

This is a **caller-side bug only**. Chat-service's receiver code is correct and was not modified.
Per the phase's explicit constraint, Chat's env var name (`INTERNAL_API_SECRET`) was not renamed and
neither secret was rotated — this fix only changes which environment variable the three callers read
from, while continuing to send it under the same `x-internal-secret` header name chat-service
expects. This works because Phase 13C-B's live rotation already keeps `INTERNAL_SERVICE_SECRET`
(all 12 Lambdas) and `INTERNAL_API_SECRET` (Chat's ECS) holding the identical rotated value.

## Source Discovery Table

| Source | File | Function | Target | Method | Header sent (before) | Header sent (after) | Secret source (before) | Secret source (after) | Error handling (before) |
|---|---|---|---|---|---|---|---|---|---|
| User | `user-service/src/services/notification.service.ts` | `pushToSocket` (called by `create`, `pushTransient`) | Chat `/internal/push-notification` | POST | `x-internal-secret` = `""` | `x-internal-secret` (resolved) | `INTERNAL_API_SECRET` only | `INTERNAL_SERVICE_SECRET \|\| INTERNAL_API_SECRET` | generic `.catch()` warn, raw `err` object logged |
| User | `user-service/src/services/room-close-resolution.service.ts` | `endOpenRoomCall` (called by `runRoomCloseResolution`, 4 sites) | Chat `/internal/calls/end-by-session` | POST | `x-internal-secret` = `""` | `x-internal-secret` (resolved) | `INTERNAL_API_SECRET` only | `INTERNAL_SERVICE_SECRET \|\| INTERNAL_API_SECRET` | generic `.catch()` warn, `err.message` only (already safe) |
| Fitness | `fitness-service/src/clients/notification.client.ts` | `pushCycleAssessmentNotification` | Chat `/internal/push-notification` | POST | `x-internal-secret` = `""` | `x-internal-secret` (resolved) | `INTERNAL_API_SECRET` only | `INTERNAL_SERVICE_SECRET \|\| INTERNAL_API_SECRET` | `try/catch` warn, `(error as Error).message` only (already safe) |

A fourth function in the same fitness-service file, `createPersistentNotification` (Fitness →
User, not Fitness → Chat), was read and confirmed **already correct** — it uses
`x-service-secret: process.env.INTERNAL_SERVICE_SECRET || ""` and was left untouched.

## Chat Receiver Contract (read fresh from source, not inferred)

`backend/services/chat-service/src/app.ts`:

```
Line 58-62  POST /internal/push-notification
Line 93-97  POST /internal/calls/end-by-session
```

Both routes: read header `req.headers["x-internal-secret"]`, compare via exact string equality
against `process.env.INTERNAL_API_SECRET`, and return a flat `401 {"error":"Unauthorized"}` for
both the missing-header and wrong-value cases (no distinguishing status code between them). Not
modified, not started, not inferred — read directly from the current file.

## Root Cause

A historical naming inconsistency: the Lambda-side convention is `INTERNAL_SERVICE_SECRET`; the
chat ECS-side convention is `INTERNAL_API_SECRET`. Two existing, correctly-implemented call sites in
this same codebase (`chat-service/src/chat.policy.ts`, `chat-service/src/push-relay.ts`) already
resolve this exact inconsistency with a fallback read order:
`process.env.INTERNAL_SERVICE_SECRET || process.env.INTERNAL_API_SECRET || ""`. The three buggy call
sites were simply never updated to use this same precedence — they read `INTERNAL_API_SECRET` alone,
which is `undefined` on every Lambda, so the header was always sent as `""`.

## Canonical Caller Pattern (Phase 14A.4)

Searched the codebase for an existing outbound-caller helper for "resolve the shared internal
secret, distinguish a definite auth rejection from a transient failure." None exists — the only
precedent found (`ai-service/src/middleware/auth.middleware.ts`'s `isDefiniteTokenRejection`) is
receiver-side/incoming-token-verification-specific, not reusable as an outbound-caller helper.

Decision: reuse the **existing, already-correct fallback precedence**
(`INTERNAL_SERVICE_SECRET || INTERNAL_API_SECRET`) verbatim from chat-service's own
`chat.policy.ts`/`push-relay.ts` at all three call sites — not a new architecture, just applying the
pattern this codebase already established for this exact naming inconsistency. No shared cross-service
helper module was introduced: the three call sites live in two different services with different
target endpoints/payload shapes, and the small amount of new per-site logic (resolve secret once at
module load, skip + log if absent, classify a response as a 401 auth-rejection vs. other failure in
the existing `.catch()`) is simple enough that duplicating it three times keeps the diff minimal and
legible, consistent with this codebase's own existing duplication of the identical fallback pattern
across chat-service's two files.

## Implementation

All three call sites changed identically in shape:

1. The module-level secret constant now reads `process.env.INTERNAL_SERVICE_SECRET ||
   process.env.INTERNAL_API_SECRET || ""` instead of `process.env.INTERNAL_API_SECRET || ""`.
2. Before sending the request, each caller now checks whether the resolved secret is empty. If so,
   it logs a structured `logger.error(...)` identifying the missing configuration and returns/skips
   — the HTTP call is never attempted, and an empty/undefined header is never sent.
3. The existing `.catch()` (or `try/catch`) is preserved — chat-service being genuinely unreachable
   remains best-effort, exactly as before, with the existing generic `logger.warn`.
4. A new branch checks `err?.response?.status === 401` and, if so, logs a distinctly-labeled
   `logger.error` (not the generic warn) identifying a probable secret desync between the two
   services — this is the "stop silently swallowing a real auth/config defect" requirement.
5. Request payloads, URLs, timeouts (`3000ms`), and all surrounding business logic are byte-for-byte
   unchanged.
6. `notification.service.ts::pushToSocket`'s pre-existing `.catch((err) => logger.warn({ err }, ...))`
   was additionally tightened to `logger.warn({ err: err?.message }, ...)` — it was the one call site
   of the three that logged the raw `AxiosError` object rather than just its `.message` (the other two
   already did this correctly). This is a direct secret-safety fix for the file being touched anyway,
   not scope expansion.

No other User/Fitness functionality was changed. `createPersistentNotification` (the correct
Fitness→User path) was read and left untouched.

## Error Handling (Phase 14A.7)

| Failure | Classification | Log level | Behavior |
|---|---|---|---|
| Secret unconfigured | Config bug | `error` | HTTP call skipped entirely; sweep/notification business logic unaffected |
| Chat returns 401 | Auth/config desync | `error` | Logged distinctly; business logic unaffected (best-effort preserved) |
| Chat unreachable/timeout/5xx | Transient | `warn` (unchanged) | Logged as before; business logic unaffected (best-effort preserved) |

Nothing that was intentionally best-effort (per each file's own doc comments — a missed real-time
push or a missed call-end notice is explicitly tolerated product behavior) was changed to throw or
block. Only the *log classification* of a genuine auth/config failure changed, from indistinguishable
to observable.

## Secret Safety

- No log call in any of the three touched files passes the secret value itself — only
  `err?.response?.status` (a number) or `err?.message`/`(error as Error).message` (a string that
  never contains request headers).
- Reviewed the full diff (`git diff` on all three files) line by line: no `console.log`, no
  `JSON.stringify(process.env)`, no logging of the resolved secret constant, no secret value in any
  thrown/logged string.
- All 8 new test files use fake, clearly-labeled placeholder secrets (`FAKE-...-not-real`) and
  additionally assert, in the 401-scenario tests, that neither fake secret value appears in any
  captured log call.

## Regression Tests

8 new `node:test` files (this codebase's existing test convention — `tsx --test
src/__tests__/*.test.ts`), fake secrets only, no AWS calls. Each scenario needing a different
`process.env` configuration lives in its own file, since the three callers resolve their secret
once from `process.env` at module-load time and `tsx --test` runs each matched file as its own
subprocess — confirmed necessary after an initial single-file draft silently shared stale env state
across its own test cases.

**fitness-service** (`src/__tests__/chat-internal-auth-fitness-*.test.ts`, 5 files/tests):
- `-configured`: header name + `INTERNAL_SERVICE_SECRET` value correct, payload unchanged, no error
  logged on success.
- `-fallback`: falls back to `INTERNAL_API_SECRET` when `INTERNAL_SERVICE_SECRET` is unset.
- `-401`: a secret-mismatch 401 is logged as a distinct error (not the generic warn), never thrown,
  no secret value in any log.
- `-network-failure`: an unreachable chat-service stays on the generic best-effort warn (not
  promoted to the auth-rejection error), never thrown.
- `-missing-secret`: neither env var set → zero HTTP calls attempted, a config error is logged.

**user-service** (`src/__tests__/chat-internal-auth-*.test.ts`, 3 files covering both call sites):
- `-configured`: both `pushToSocket` (via the DB-free `notificationService.pushTransient`) and
  `endOpenRoomCall` (via `runRoomCloseResolution`'s fully dependency-injected Case 1) send the
  correct header/value; payload unchanged; the room-close sweep's real status transition and in-app
  notifications land normally.
- `-401`: both call sites log the distinct auth-rejection error (not the generic warn — the one
  incidental Firebase-not-configured warning from an unrelated code path was explicitly excluded from
  that assertion rather than making the check falsely strict), never throw, no secret in any log.
- `-missing-secret`: neither env var set → zero HTTP calls from either call site; both log a config
  error; the sweep's real business outcome (status transition + both participants notified) still
  lands — confirming the missing secret only costs the best-effort chat notice, not the actual
  session resolution.

A local-loopback-connection warm-up request was added to the `-401` user-service test after an
initial run showed the very first outbound HTTP call in that subprocess occasionally taking longer
than the production code's fixed `3000ms` axios timeout on this Windows environment — an
environment/timing artifact, not a code defect; the warm-up eliminates the race without changing any
production timeout value.

`endOpenRoomCall` and `pushToSocket` are both unexported; they were exercised exclusively through
their real exported callers (`pushTransient`, `runRoomCloseResolution`) rather than via any new
export added just for testing.

## Test Run Results

**New regression tests — fitness-service** (`npx tsx --test
src/__tests__/chat-internal-auth-fitness-*.test.ts`): `5/5 pass`, `0 fail`. REAL HTTP against a
local mock server standing in for chat-service's real contract; CODE AUDIT for the secret-safety
log-content assertions.

**New regression tests — user-service** (`npx tsx --test src/__tests__/chat-internal-auth-*.test.ts`):
`4/4 pass`, `0 fail`. Same evidence class. One iteration surfaced genuine test-harness races (not
production defects): this Windows environment's first loopback connection in a process can
occasionally exceed the production code's fixed `3000ms` axios timeout, and a mock server reused
across two call sites needed to wait for a *new* request rather than any already-seen one. Both were
test-only fixes (a connection warm-up + bounded retries, and a per-call cursor on the mock server's
request-wait helper); no production file or timeout value was changed to accommodate them. Re-run
twice after the fix, deterministic pass both times.

**TypeScript**: `npx tsc --noEmit` — clean, zero errors, in both `user-service` and `fitness-service`.

**Full existing suite — user-service** (`src/__tests__/*.test.ts`, 308 tests): **305 pass, 0 fail, 3
skip**. The 3 skips are pre-existing and environmental: 1 requires a real local Ollama instance
(`extractInBodyVision`), 2 are pre-existing minor skip-marked cases unrelated to this change. Several
unrelated, already-existing tests that happen to exercise `notificationService.create`/`pushTransient`
without configuring a chat secret now correctly surface the new
`"[notification] INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET not configured - skipping real-time push
to chat-service"` error log as a side effect — expected, and none of those tests' own assertions
depend on that push succeeding, so none regressed. One earlier run transiently reported mass DB
failures (`Can't reach database server at localhost:5433`) when a local dev Postgres container was
momentarily down between runs — confirmed unrelated to this change (DB came back up moments later)
and re-run clean; this is recorded for transparency, not glossed over.

**Full existing suite — fitness-service** (`src/__tests__/*.test.ts`): **did not complete even with
a 400-second bound** — confirmed by letting it run to that bound and inspecting which files `tsx
--test` itself marked as killed: `agent-program-apply-idempotency.test.ts`,
`agent-program-equipment-semantics.test.ts`, and `ai-workout-grounding.integration.test.ts` (each
reported at ~397.7-397.8s, i.e. still executing when the 400s bound terminated the process) - all in
the AI-workout-grounding/exercise-catalog domain, which this project's own
`gymini-ai-workout-grounding`/`gymini-parallel-agent-safety` skills flag as a separate, actively-owned
(Codex) workstream. Confirmed, not assumed: none of those three files imports any of this phase's 3
touched files (`notification.service.ts`, `room-close-resolution.service.ts`,
`notification.client.ts`) - grepped directly. Every test observed before that point passed with no
failures, and DB-dependent integration tests correctly SKIPPED with this service's own pre-existing
`"Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database"` convention. This is
reported honestly as **incomplete/environment-blocked** (a real, pre-existing hang in an unrelated
workstream's test file, not a timing artifact and not something this phase introduced or should fix),
not claimed as a pass.

## Files Changed

- `backend/services/user-service/src/services/notification.service.ts` — `pushToSocket` secret
  resolution, fail-safe skip, 401 classification, raw-`err`-object log tightened to `err.message`.
- `backend/services/user-service/src/services/room-close-resolution.service.ts` — `endOpenRoomCall`
  secret resolution, fail-safe skip, 401 classification.
- `backend/services/fitness-service/src/clients/notification.client.ts` —
  `pushCycleAssessmentNotification` secret resolution, fail-safe skip, 401 classification.
- 8 new test files (listed above under Regression Tests) — no existing test file was modified.
- This report.

No `docs/*.md` file other than this new report was touched. No IaC, no `scripts/aws/*`, no API
Gateway, no Lambda/ECS configuration.

## Live Deployment Status

**Zero AWS mutations.** No `aws lambda update-function-code`/`update-function-configuration`, no
`aws ecs register-task-definition`/`update-service`, no API Gateway change, no Secrets Manager
change, no schedule change. Chat, AI, and Network were not started. The continuously-running Backend
(Aurora, Secrets Manager VPCE, the 13 DEV-pausable schedules) was not touched.

## Runtime Verification Plan (for a future deployment phase — not executed now)

1. Deploy the three updated files to User and Fitness Lambdas (standard `update-function-code`,
   with the established `--query` discipline to avoid any environment-variable echo).
2. Start Network temporarily (NAT required for the Lambdas to reach Chat's ALB) and start Chat.
3. Trigger each of the three code paths for real (a workout-schedule notification, a cycle
   assessment, and an open-room sweep tick) and confirm via CloudWatch that chat-service now returns
   `200`, not `401`, and that the realtime socket event is actually emitted.
4. Stop Network/Chat again per the continuous-session discipline already established in Phases
   13B–13D.

## API Gateway Backlog (recorded, not fixed — out of this phase's scope)

- `POST /auth/password-reset/request` — implemented in code, returns `404` live (missing from DEV
  API Gateway) — first found in Phase 13D-B.
- `PATCH /auth/me/password` — was added manually to API Gateway in Phase 13A because it was missing
  from whatever IaC/config is supposed to own this API's route list; that ownership gap itself is
  still unresolved.

Both feed a future "API GATEWAY + IaC + CI/CD HARDENING" phase.

## Continuous Session State

Not touched by this phase. Backend/Aurora remain exactly as the prior phase (13D) left them — this
phase performed source reads, local code edits, and local test runs only.
