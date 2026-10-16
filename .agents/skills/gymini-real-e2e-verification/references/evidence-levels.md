# Evidence levels — worked examples

## REAL BROWSER

A Playwright test in the external harness
(`c:\D_Backup\Test\fitnessassistant-playwright-e2e` at the time this was
written — confirm the current path/location before relying on it)
drives a real running dev stack through the gateway/web containers,
clicking real buttons, waiting for real elements, then asserting a real
DB row or a real rendered string. Example: `TC-PT-003` clicks "Tạo lộ
trình cho khách hàng" → "Tạo bản nháp", waits for "Bản nháp đang chờ học
viên" to render, then queries the real `fitness_roadmaps` table for
`status='DRAFT'`.

## REAL HTTP/API

A direct `request.post/get` call (Playwright's `APIRequestContext`, or
an equivalent `fetch`/`curl`) against the real gateway, with a real
JWT, asserting the real response status/body — no browser rendering
involved, but no mock either. Example: `TC-PT-008`'s IDOR matrix — 6
real HTTP calls with a real attacker token against a real victim's
resource id, asserting 403.

## BACKEND INTEGRATION

A `node:test` file run against the real, isolated `*_test` Postgres
database (via `FITNESS_DATABASE_URL`/`DATABASE_URL` pointed at the test
DB, `FITNESS_DISABLE_REDIS=true` where needed) — real Prisma queries,
real service functions, no HTTP/browser layer. Example:
`coach-nutrition-review.integration.test.ts`'s 16 tests.

## TEST FIXTURE

Direct, explicitly-labeled preparation of prerequisite state — either a
direct Prisma write (only for state with no legitimate self-service
path, e.g. PT-approval flags that normally require an admin reviewing a
real application with documents) or a real API call used purely to set
up a precondition (e.g. calling the real onboarding PUT to trigger a
real bootstrap, ahead of the actual thing under test). A TEST FIXTURE
step must be clearly commented as such and must never BE the mechanism
the test is trying to prove — it only prepares the ground for a REAL
BROWSER/HTTP/INTEGRATION check that follows.

**Real example of doing this right**: the PT-contract E2E fixture
(`fixtures/ptContractFixture.ts`) does NOT write a `Contract` row
directly. It drives the real `request -> accept -> pay` HTTP chain, then
completes settlement with a `GET /payments/vnpay/return` call carrying a
query string HMAC-SHA512-signed with the app's own real
`VNPAY_HASH_SECRET` — a forged CALLBACK (since no real VNPay server is
contacted), but the signature must still pass the real
`verifyWebhookSignature`, so nothing about the real authorization/
settlement code is bypassed. This is labeled "REAL SERVICE FIXTURE," not
"REAL SANDBOX PAYMENT" (no real gateway is contacted) and not a
TEST FIXTURE DB write (the Contract's real state transitions all happen
through real service code).

## CODE AUDIT

Reading the implementation and reasoning about what it does, without
running anything. Legitimate and often sufficient for things that are
genuinely provable by construction (e.g. "no route exists that lets a
PT activate a Roadmap" — confirmed by grep, not by trying to click a
button that doesn't exist). **Not** sufficient when the master task (or
plain common sense) asks for a live test of an actual behavior — e.g.
"does equipment validation actually reject a mismatch" needed a real
HTTP call (`TC-PT-012`) because the CODE AUDIT alone ("I don't see a
call to the equipment validator here") could have missed something a
live 201/400 response settles definitively.
