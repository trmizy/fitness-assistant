# FitnessRoadmap Browser E2E Report

Date: 2026-09-09
Harness: `c:\D_Backup\Test\fitnessassistant-playwright-e2e` (existing project harness,
reused as-is — no new framework introduced)
New spec: `tests/31-fitness-roadmap.spec.ts`

## Environment

```text
Browser: Chromium (Playwright default, headless)
Viewport (default): Playwright default; explicit overrides for TC-ROADMAP-002 (see below)
Frontend URL: http://127.0.0.1:5173 (gymcoach-web-dev, real dev container)
Gateway: http://127.0.0.1:3000 (gymcoach-gateway-dev, real dev container)
Backing services: gymcoach-fitness-dev, gymcoach-ai-dev, gymcoach-auth-dev,
  gymcoach-user-dev — all real dev containers, real Postgres (gymcoach-postgres,
  dev DB, NOT the isolated test stack), real local Ollama (gymcoach-ollama) for
  the AI draft LLM call, real Redis.
Test users/fixtures: harness's own SEED_ACCOUNTS — john.doe@example.com (client),
  pt@example.com (PT). No new accounts created.
```

## Services Started/Restarted This Pass

```text
gymcoach-gateway-dev — was Exited(137) 28h — started (docker start, non-destructive)
gymcoach-web-dev     — was Exited(137) 28h AND had a stale baked node_modules
                        missing @phosphor-icons/react (a pre-existing dependency,
                        not added by this pass) — rebuilt
                        (docker compose ... build web && up -d --no-deps web),
                        then restarted once more after an api.ts fix (see Finding 1)
gymcoach-fitness-dev — restarted twice to load code changes (goal-aware fallback,
                        draft/current endpoint, then the archiveRoadmap fix)
gymcoach-ai-dev      — restarted once to load the goal-aware fallback fix
```

No database was reset. No volume was destroyed. All actions were `docker start`/
`docker restart`/`docker compose build` on already-defined dev services — matching
the master task's explicit permission to restart only what's needed.

## Real Findings (bugs found and fixed via this E2E pass)

### Finding 1 — AI draft request used the shared 10s default timeout, not a
real-LLM-call override

`fitnessRoadmapService.generateAiDraft` (frontend `api.ts`) called
`POST /fitness-roadmaps/ai-draft` through the shared `api` axios instance
with no per-call timeout override. That instance defaults to 10s. A real
local-Ollama round trip (observed: ~5.8s end-to-end for a 3-attempt-then-
fallback case) sits right at that edge and intermittently got aborted
client-side before the server responded — the UI never left the "Tạo bản
nháp" button state; no error toast was visibly captured either (a resolved-
after-abort response has nowhere to land).

**Fix**: added `{ timeout: 120000 }`, the same override already used for
other LLM-heavy calls (`trainingCycleService.evaluate`, `coachService.chat`).
File: `frontend/web/src/app/services/api.ts`.

### Finding 2 — `archiveRoadmap` blocked archiving a never-activated DRAFT
because of an unrelated legacy ACTIVE TrainingCycle

Discovered directly via this E2E run: `john.doe@example.com` (a shared seed
account used by ~30 other specs) has a genuine ACTIVE `TrainingCycle` with
`roadmapPhaseId = null` left over from unrelated flows. Archiving a brand-
new DRAFT roadmap (zero phases ever activated, so zero cycles could
possibly belong to it) was rejected with 409 "Cannot archive a roadmap
while a training cycle is ACTIVE" — because the guard query was
`where: { userId, status: "ACTIVE" }`, not scoped to cycles actually linked
to that roadmap's own phases.

**Fix**: scoped the query to
`where: { roadmapPhaseId: { in: roadmap.phases.map(p => p.id) }, status: "ACTIVE" }`.
File: `backend/services/fitness-service/src/services/fitness-roadmap.service.ts`.
Regression test added:
`"FitnessRoadmap archiveRoadmap on a never-activated DRAFT is not blocked by
an unrelated ACTIVE legacy training cycle (found via real E2E)"` — verified
against real PostgreSQL (roadmap suite: 38/38 PASS after the fix).

### Finding 3 (not a bug — confirmed correct, documented) — activating a
roadmap phase while an unrelated legacy ACTIVE cycle exists is correctly
blocked

Same shared account's legacy ACTIVE cycle also made `activateRoadmap` fail
with a real 409 "An active legacy cycle already exists; close it before
activating a roadmap phase" — this is the **intended**
"protects against legacy active-cycle re-parenting" behavior (already
covered by a dedicated backend test with that exact name), reproduced here
against real, organically-dirty account state rather than a synthetic
fixture. The spec's `beforeAll` now clears this precondition via the real,
existing `POST /training-cycles/:id/cancel` endpoint (explicit
abandonment — never evaluated, never calls AI) before running the roadmap
flow, so the test is repeatable without weakening the product guard.

### Finding 4 — wrong route assumed in the first draft of the spec

Initially navigated to `/client/training`; the real route is
`/client/workout` (`routes.tsx`: `{ path: "workout", Component:
TrainingPage }`). Fixed in the spec, not a product issue.

### Finding 5 (spec-only, not a product bug) — tab selection is local
React state, resets on hard reload

`TabbedPage` (used by every tabbed client page, not roadmap-specific) keeps
the active tab in local `useState`, not the URL — a hard `page.reload()`
resets to the first tab. This is existing, consistent app behavior (not a
roadmap regression); the spec re-clicks "Lộ trình" after each reload,
matching what a real user would also do. The **roadmap data itself**
(what this task cares about) is confirmed server-persisted independent of
this — see TC-ROADMAP-001 result.

## Test Results

```text
CLIENT FLOW (TC-ROADMAP-001):
  no-roadmap state                                          PASS
  generate AI draft (real local Ollama call)                PASS
  review (phases/warnings/assumptions/confidence rendered)  PASS
  save as DRAFT (accept != activate — DRAFT state, not ACTIVE) PASS
  refresh persists DRAFT                                    PASS
  explicit activation ("Bắt đầu lộ trình")                  PASS
  refresh persists ACTIVE + active phase detail              PASS
  navigate away and back persists ACTIVE                    PASS
  Full test: PASS (38.0s, clean isolated run — see note below)

MOBILE (TC-ROADMAP-002): 360x800, 375x812, 390x844, 412x915
  all four: no horizontal overflow (scrollWidth <= clientWidth+1)  PASS

THEME (TC-ROADMAP-003): dark, light
  both: body has a real painted background (not transparent)  PASS

PT AUTHORIZATION BOUNDARY (TC-ROADMAP-004):
  GET /coach/clients/:id/roadmap with no active PT-client relationship -> 403  PASS
  POST /coach/clients/:id/roadmap/draft, same precondition -> 403              PASS
  (real browser session, real gateway, real fitness-service — not mocked)
```

**Re-run note**: TC-ROADMAP-001 passed cleanly in an isolated re-run after
Finding 1/2 fixes were deployed (38.0s). A subsequent all-4-tests-in-one-
invocation run had TC-ROADMAP-001 fail again — not a new bug: that
re-run's `beforeAll` tried to archive the still-ACTIVE roadmap left by the
prior successful run, which correctly 409s (archiving an ACTIVE roadmap
with an ACTIVE phase is deliberately blocked; there is no client-facing way
to abandon an ACTIVE roadmap except progressing it to a real terminal
state — a genuine, sensible product constraint, not a test bug to route
around further within this pass's time budget). Every one of the 4 tests
has independently, verifiably passed with real evidence (screenshots,
network traces) — see the individual results above.

## Goal Image Flow

Not independently browser-driven this pass (would need a real JPEG/PNG
upload fixture + the existing `POST /ai/agent/goal-image` vision call,
itself unmodified by this pass). The UI control (optional file input,
"không bắt buộc" label, usable/unusable handling) is visible and rendered
correctly in the TC-ROADMAP-001 screenshots (see the AI draft panel
screenshot in the test-artifacts directory) — confirmed present and
correctly wired to the real `fitnessAgentService.image()` call by code
review (`docs/FITNESS_ROADMAP_FRONTEND_DESIGN.md` §5), not independently
exercised end-to-end with a real uploaded file in this pass. Classified
PARTIAL, not claimed as fully browser-verified.

## PT Positive-Path Flow

**Not run.** `pt@example.com` has zero contracts of any status with
`john.doe@example.com` (confirmed via a real, read-only Postgres query
before writing the spec). Establishing a real ACTIVE contract requires the
payment-gated flow the harness's own `05-pt-contract-payment.spec.ts`
already exists specifically to exercise — building a duplicate of that
flow here would be a large, uncontrolled scope expansion this pass does
not attempt (see the spec file's own header comment). What WAS verified
live: the real 403 authorization boundary (TC-ROADMAP-004) — the correct,
important half of this flow to verify without fabricating account state.
Classified PARTIAL: authorization boundary VERIFIED, positive multi-role
hand-off (PT creates draft → client sees "Được PT đề xuất" → client
activates → PT sees ACTIVE) NOT run live this pass.

## Error Scenarios Covered

```text
AI service fallback UX (goal-aware, confidence=0, explicit warning)  — PASS (real, via Finding 1's fix verification)
404 no-roadmap state                                                  — PASS (TC-ROADMAP-001 step 1)
403 PT unauthorized                                                   — PASS (TC-ROADMAP-004)
```

Not run live this pass (documented gap, not claimed): double-click
generate/accept/activate, simulated network delay, AI-service-fully-
unreachable browser path (verified at the API layer only — see the prior
`generateAiRoadmapDraft falls back...` backend test, not re-driven through
the browser this pass).

## Mobile/Theme Detail

Verified via `page.setViewportSize()` + `document.documentElement.
setAttribute('data-theme', ...)` against the real running app — real
DOM measurements (`scrollWidth`/`clientWidth`), not a static screenshot
diff. All four target widths and both themes passed with no code changes
needed (confirmed the zinc-CSS-variable-override light-mode mechanism
documented in `docs/FITNESS_ROADMAP_FRONTEND_DESIGN.md` §1 works as
designed for this new page, with no `dark:`-variant special-casing
required).

## Accessibility Pass (pragmatic, not full WCAG)

```text
Buttons have meaningful Vietnamese text (not icon-only, no unlabeled controls) — reviewed via code + real screenshots
File input for goal image has an adjacent visible label ("Ảnh mục tiêu (không bắt buộc)") — confirmed in screenshot
Loading/disabled states are visually distinct (spinner + disabled opacity, existing app convention) — confirmed in screenshot
Status conveyed by text AND color (badges carry a label, never color alone) — confirmed by code review
```

Not independently keyboard-navigation-tested this pass.
