# FitnessRoadmap PT Positive-Path E2E Report

Date: 2026-09-09
Status: `BLOCKED` (human-dependency, not a code defect) — documented honestly
rather than faked or silently skipped.

## What Was Attempted

Per the closure task's instruction, `05-pt-contract-payment.spec.ts` and its
`fixtures/realPayment.ts` helper were read in full **before** writing any
new test code, specifically to reuse the real contract/payment flow rather
than duplicate it.

## What Was Found

`fixtures/realPayment.ts`'s own header comment states the design decision
explicitly:

> "P0 comprehensive-E2E redesign (Phase E2+) — real sandbox payment,
> **always manual**. Per the user's explicit instruction: wherever a real
> purchase needs paying, the script shows the real gateway screen and
> **STOPS** — no auto-fill attempt... a human on the other end always
> finishes the transaction."

Concretely: `selectGatewayAndPay()` selects the gateway (VNPay/ZaloPay/
MoMo) inside the app's own payment dialog, then prints
`__WAITING_FOR_MANUAL_PAY_CLICK__` and blocks on
`page.waitForURL(GATEWAY_URL_PATTERN, { timeout: 300_000 })` — it does
**not** click the app's own "Thanh toán" button itself. A real human must:

1. See the printed marker.
2. Click "Thanh toán" in the already-open dialog.
3. Complete the real VNPay/ZaloPay/MoMo checkout on the real gateway page.

`05-pt-contract-payment.spec.ts`'s own real-payment test
(`TC-PTC-PAY-001: [REAL PAYMENT]`) sets `test.setTimeout(900_000)` — 15
minutes — for exactly this reason: it is designed to wait on a live human,
not to run unattended.

## Why This Cannot Be Completed Autonomously This Pass

An unattended agent session has no human available to click through a real
payment gateway's real checkout UI. Attempting to "wait it out" would
either time out uselessly after 5–15 minutes with nothing paid, or — the
only alternative — bypass the manual-payment design entirely (e.g. writing
a `Contract` row directly to the database, or forging a payment-gateway
webhook callback). Both of those are explicitly forbidden by this closure
task's own rules (`8.1`: "Do NOT solve by... direct random DB deletion...
weakening archive guard"; the same "never fabricate state, never touch
data outside real flows" discipline the harness's own `cleanup.ts` already
follows — see `RETAINED_NO_DELETE_API` entries there) and would produce a
misleading "PASS" for something that never actually happened through the
real payment system.

**The user was asked directly** (mid-session) whether to sit through the
real payment click live. The answer was: skip the real payment flow and
document this as a blocker rather than spend that time now.

## What WAS Verified Live This Pass Instead

The half of the PT flow that does not require an ACTIVE contract — the
**authorization boundary** — was verified live, real browser, real
gateway, real fitness-service, real Postgres (`TC-ROADMAP-004`):

```text
GET  /coach/clients/:clientId/roadmap        (no active relationship) -> 403, clean JSON error
POST /coach/clients/:clientId/roadmap/draft  (no active relationship) -> 403, no draft created
```

This is the correct, important half to verify without fabricating account
state — it is also the half most likely to hide a real security bug if
broken (an unauthorized PT reading or writing a client's roadmap), and it
is now proven correct against the real running stack, not just unit tests.

## Backend Verification (unchanged from this pass's other work, already real)

`getClientRoadmap`/`createRoadmapDraftForClient`'s full positive-path
behavior (PT sees a client's pending draft; PT creating a duplicate draft
returns the existing one; the client alone can activate it; the PT still
cannot activate/advance/rebuild/archive) **is** verified — against real
PostgreSQL, via `coach.service.integration.test.ts` and
`fitness-roadmap.service.integration.test.ts` (see
`docs/FITNESS_ROADMAP_CLOSURE_IMPLEMENTATION_REPORT.md` §2/§3). What is
NOT verified is the same behavior driven through two real logged-in
browser sessions (PT + client) handing off through a real UI, because that
requires the real ACTIVE contract this report explains is blocked.

## How To Complete This With A Human Present

```text
1. cd c:\D_Backup\Test\fitnessassistant-playwright-e2e
2. npx tsx prepare-run.ts
3. npx playwright test tests/05-pt-contract-payment.spec.ts --headed
   — click through TC-PTC-REQUEST-001 -> TC-PTC-ACCEPT-001 -> TC-PTC-PAY-001,
     completing the real payment step when prompted (the console prints
     __WAITING_FOR_MANUAL_PAY_CLICK__ and the exact next click needed).
4. Once that PT (pt@example.com) + client (john.doe@example.com) contract
   is ACTIVE, either:
   a. temporarily point tests/31-fitness-roadmap.spec.ts's PT positive-path
      test at that same client/PT pair instead of SEED_ACCOUNTS.roadmapClient
      + SEED_ACCOUNTS.pt (they currently have no relationship), or
   b. repeat steps 1–3 using SEED_ACCOUNTS.roadmapClient as the buyer, to
      get a contract between pt@example.com and roadmap.client@example.test
      specifically (cleaner — keeps the roadmap spec's dedicated account
      isolated from john.doe's other 30-spec state, per
      docs/FITNESS_ROADMAP_REPEATABILITY_REPORT.md).
5. Then walk: PT opens client -> ClientRoadmapCard -> "Tạo lộ trình cho
   khách hàng" -> client logs in -> sees "Được PT đề xuất" on the
   RoadmapJourneyPage's DraftRoadmapDetail -> activates -> PT logs back in
   -> ClientRoadmapCard now shows the ACTIVE roadmap.
```

## Status

```text
PT NEGATIVE (authorization boundary): VERIFIED LIVE
PT POSITIVE (multi-role hand-off):    BLOCKED — human-dependency (real payment gateway),
                                       not a code defect; backend logic for it is
                                       independently VERIFIED (real Postgres, no browser)
```
