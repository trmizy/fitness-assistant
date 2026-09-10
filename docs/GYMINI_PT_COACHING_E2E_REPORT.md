# Gymini PT Coaching Workspace — Browser E2E Report

Date: 2026-09-10
Spec: `fitnessassistant-playwright-e2e/tests/33-pt-coaching-workspace.spec.ts`
Accounts: `pt.coaching.workspace@example.test` (PT), `pt.coaching.clientA@example.test`
(Client A — real ACTIVE contract), `pt.coaching.clientB@example.test`
(Client B — deliberately no relationship, the IDOR negative fixture).

## Final result: 12/12 pass (real browser + real HTTP + real service fixture)

```text
TC-PT-001  ACTIVE contract client appears in PT client list/detail; unrelated Client B does not      [REAL BROWSER]              22.6s  PASS
TC-PT-002  PT views real client Overview/Nutrition state after a real onboarding bootstrap            [REAL BROWSER+HTTP]          8.5s  PASS
TC-PT-003  PT creates a real Roadmap DRAFT for Client A                                               [REAL BROWSER]               8.4s  PASS
TC-PT-004  Client A sees PT provenance and starts the draft                                           [REAL BROWSER]              11.8s  PASS
TC-PT-005  PT sees the client's new ACTIVE state + real training/nutrition readiness after handoff    [REAL BROWSER]               8.5s  PASS
TC-PT-006  PT assigns a real workout program, canonical Exercise.id + correct cycle attachment         [REAL BROWSER+HTTP]          9.4s  PASS
TC-PT-007  PT nutrition review renders real NutritionProgram + consistency status                     [REAL BROWSER]               8.3s  PASS
TC-PT-008  security — PT cannot read/write unrelated Client B's data (6 sub-checks)                    [REAL HTTP/API]            0.27s  PASS
TC-PT-009  expired/cancelled relationship loses access — real contract termination, re-checked live    [REAL HTTP/API]            8.5s  PASS
TC-PT-010  mobile viewports (360/375/390/412) — client list + all 4 detail tabs                        [REAL BROWSER]             29.4s  PASS
TC-PT-011  dark/light theme — client list + client detail, no blank/unstyled body                       [REAL BROWSER]             10.1s  PASS
TC-PT-012  §17 equipment-mismatch audit — real exercise Client A has no equipment for                   [REAL HTTP/API]            0.17s  PASS
```

TC-PT-001..010 re-confirmed as a full-suite run (2.1 min) after the two
production-bug fixes and the gateway-proxy fix. TC-PT-011/012 were added
afterward during a final honesty pass (closing two claims that had been
asserted from code reading/token reuse alone rather than live-tested)
and each run and confirmed passing individually.

## §33 — Contract/Payment testability: final status

**VERIFIED — REAL CONTRACT SERVICE FIXTURE + browser coaching flow.**

Not "VERIFIED — SANDBOX REAL PAYMENT" (no real VNPay/ZaloPay/MoMo server
is ever contacted by the fixture) and not "STILL BLOCKED" (the real
activation chain — accept, checkout-intent creation, signature
verification, webhook settlement, reconciliation-driven activation — is
fully exercised with real code, real signatures, real DB rows). This
replaces the prior phase's `PT POSITIVE E2E = BLOCKED BY HUMAN PAYMENT`
status.

## Real browser evidence (selected)

```text
TC-PT-001: Client A row visible in /pt/clients; Client B absent; all 5
  workspace tabs render for Client A.
TC-PT-003: real click "Tạo lộ trình cho khách hàng" -> "Tạo bản nháp" ->
  "Bản nháp đang chờ học viên" visible; DB: status=DRAFT,
  created_by_role=PT, user_id=Client A, 0 TrainingCycle.
TC-PT-004: real "Được PT đề xuất" provenance visible on Client A's own
  Journey tab; client's own activate action -> DB: roadmap ACTIVE, 1
  ACTIVE phase, 1 ACTIVE cycle.
TC-PT-005: PT re-opens Client A -> "Đang thực hiện" + real readiness
  badges "Tập luyện: Chưa có lịch tập" / "Dinh dưỡng: Sẵn sàng" (the
  SAME derived readiness the client's own Journey page computes).
TC-PT-006: real exercise-catalog search -> real assign -> DB: new
  WorkoutProgram owned by Client A, every WorkoutSchedule row's
  training_cycle_id matches Client A's real ACTIVE cycle, every
  exercise_id resolves to a real PUBLISHED catalog row.
TC-PT-010: 0px horizontal overflow at 360/375/390/412 across the client
  list and all 4 detail tabs.
TC-PT-011: real data-theme toggle (dark<->light) on both the client list
  and client detail — body background never transparent/unstyled in
  either theme (same check pattern as tests/31-fitness-roadmap.spec.ts's
  TC-ROADMAP-003).
```

## Real HTTP/API evidence (security + lifecycle)

```text
TC-PT-008a-d, f: GET/POST on Client B (no relationship) -> 403, every time.
TC-PT-008e: POST assign-workout on Client B (valid payload, real exercise
  id) -> 403 (not the earlier 400 — proves the FIX was necessary: before
  it, an invalid payload masked the real authorization boundary).
TC-PT-008g: 0 fitness_roadmaps rows, 0 workout_programs rows created for
  Client B despite 6 attempts.
TC-PT-009a: real POST /contracts/:id/terminate {reason:"PT_CANCELLED"} ->
  200.
TC-PT-009b: GET /coach/clients/:id/summary immediately after -> 403 (no
  stale-authorized cache — the relationship check re-verifies
  Contract.status fresh every request).
TC-PT-012 (§17 audit): real exercise "Advanced Kettlebell Windmill"
  (requires "Kettlebell", which Client A has none of) assigned via
  POST /coach/clients/:id/plans -> 201, NOT rejected. Honest finding,
  not a fix — see Integration Gaps doc #10: manual plan creation (PT
  and client self-service alike) has no equipment gate at all; only
  AI-generated plans are equipment-validated.
```

## REAL SERVICE FIXTURE evidence (contract activation)

```text
POST /contracts/request  -> 201, status=PENDING_REVIEW
PATCH /contracts/:id/accept (REQUIRE_CONTRACT_ESIGN=false) -> 200, status=PENDING_PAYMENT
POST /contracts/:id/pay {provider:VNPAY} -> 200, real vnp_TxnRef + real price
GET /payments/vnpay/return?<HMAC-SHA512-signed with the real VNPAY_HASH_SECRET> -> 302
poll GET /contracts/:id -> status=ACTIVE within 1 real poll (~1s)
```

## Mobile

360/375/390/412 — PT client list (table collapses to mobile cards,
already built) and all 4 detail tabs (Tổng quan/Tập luyện/Dinh
dưỡng/Tiến độ) — 0px horizontal overflow at every breakpoint.

## Bugs found live by this suite (see Implementation Report for fixes)

- P1: `AssignPlanModal.tsx`'s `order` was 0-based, always failing the
  backend's `order >= 1` schema — the real PT workout-assignment action
  was completely broken. Fixed.
- P1/infra: `/me/service-packages` was never proxied by the gateway —
  unreachable from any real browser session. Fixed.

## Not implemented in this E2E pass

- A full real CycleAssessment cycle (to drive Approve/Modify/Reject
  through the browser) was not forced — that flow is already
  end-to-end proven at the backend level
  (`coach-nutrition-review.integration.test.ts`, 16/16 real-Postgres
  tests) and forcing a real multi-week assessment cycle live in the
  browser was out of this test's reasonable scope (same reasoning
  precedent as the prior Cross-System phase's own AI-failure-injection
  decision).
- PT Dashboard-wide aggregate "clients needing attention" — documented
  as a P2 (Integration Gaps doc), not built, to avoid an unaudited N+1.
