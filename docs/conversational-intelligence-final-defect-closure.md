# Conversational Intelligence — Final Defect Closure (X1–X4)

Date: 2026-09-27. Owner: Claude Code (implementation). Input: `docs/codex-conversational-intelligence-targeted-remediation-signoff.md`.
Scope: close X1 (error origin), X2 (log privacy), X3 (CI-on regression root cause), X4 (false confirmation claim). No new framework/dependency,
no fine-tuning, no provider change, no CI-V2 flag default change (`CONVERSATIONAL_INTELLIGENCE_V2`/`_LLM` both still default `off` in code), D1
(routing flakiness) not reopened. Not self-signed-off — handed to Codex for independent verification.

## Status: **COMPLETE for all four findings**, with one pre-existing, out-of-scope item (X5) still open by design and one already-documented
model-latency limitation (X6) reconfirmed, neither newly caused by this work.

Evidence labels: `REAL BROWSER`, `REAL HTTP/API`, `BACKEND INTEGRATION` (node:test **inside** the Docker `gymcoach-ai-dev` container, isolated
test DB), `CODE AUDIT`. All application-behavior verification ran through Docker; host Node ran only HTTP clients and the Chromium driver.

---

## Task 1 — X1: error origin

**Root cause:** the guard added in the previous remediation classified failures **by HTTP status alone** (`classifyProfileReadError`), so a
downstream tool's genuine `503` (e.g. food-substitution) was indistinguishable from the profile read's own `503` and got the same "hồ sơ đang
gián đoạn" guidance — masking a real outage of an unrelated service, including with `CONVERSATIONAL_INTELLIGENCE_V2=off` (Codex's own
reproduction used the legacy, non-CI-V2 substitution path specifically to prove this).

**Fix — origin, not status:**
- `services/fitness-agent-tools.ts`: `getUserFitnessContext` now wraps its own `domain()` call in try/catch and tags any error it produces with
  `origin: PROFILE_READ_ORIGIN` (exported constant) before rethrowing. No other tool call is touched.
- `conversational-intelligence/global/profile-errors.ts`: `classifyProfileReadError` checks `isProfileReadError(err)` (the origin marker) **first**;
  anything without it is `UNEXPECTED` regardless of status, so it is rethrown unchanged — a substitution/PT/program/etc. failure keeps its real
  status and message. Status still decides the sub-kind (422/401/403/502-504) **only once origin is confirmed**.

**Regression test:** `codex-remediation-boundary.test.ts`'s Codex-authored probe ("a substitution-service 503 is mislabeled as profile outage")
was **inverted** into `X1 regression (CI-V2 off/on): ... is NOT reported as a profile outage — it stays a real error`, run for both flag values.
`conversational-intelligence-remediation.test.ts` adds a second, focused test with `CI-V2=on` that walks 503/422/401 from another tool (rejected,
unchanged) and 503 from the real profile read (translated), plus an updated `classifyProfileReadError` unit test that checks the SAME
status/message pair with and without the origin marker.

## Task 2 — X2: log privacy

**Root cause:** `ci_global_llm_route` logged `raw.topic` verbatim — an untrusted, unconstrained `z.string()` from the model's own JSON output.
A rejected/garbage topic (or one crafted to carry arbitrary text) reached diagnostics unfiltered.

**Fix — explicit allowlist + redacted error detail:**
- `conversational-intelligence/global/llm-route.ts`: `ALLOWED_TOPICS` (the union of `READ_TOPICS`/`RECOMMEND_TOPICS`) and `loggableTopic()`
  (exported `REJECTED_TOPIC_MARKER = "[rejected]"` for anything else, `null` when the model gave no topic at all). `ci_global_llm_route` now logs
  `loggableTopic(raw.topic)`, never `raw.topic`. Correlation (`correlationId`, `userId`) and the accepted/rejected/acceptedRoute diagnostics are
  unchanged.
- `llm/json_llm_call.util.ts`: new `redactErrorDetail` option; when set, the retry/failure logs record `redacted:<ErrorName>` instead of
  `error.message` (a `JSON.parse`/zod message can quote the raw model text). `llm-route.ts` passes `redactErrorDetail: true` for this call site
  only — the other two callers of `callLlmJson` (cycle-analysis/cycle-assessment) are untouched.

**Regression test:** Codex's probe ("rejected free-text model topic still reaches diagnostic logs") **inverted** into
`X2 regression: ... is logged as a constant marker, never as the model's text` (asserts `llmTopic === REJECTED_TOPIC_MARKER`, correlation intact,
secret string absent from the whole log capture). A second new test drives an accepted enumerated topic (still logged, unredacted) and three
garbage/malformed model outputs (non-JSON, wrong-typed route, an embedded secret) through the real retry path, asserting the secret never appears
in any log line and non-info logs carry only the redacted marker.

## Task 3 — X3: CI-on regression — root cause, not a stub gap

Investigated per the four hypotheses:

1. **Missing test auth stub — no.** The two `fitness-agent-substitution.test.ts` failures Codex found (`V2=on,LLM=off`, 188/189) reproduce with a
   real 401 from the real tool call chain, not a test-harness gap.
2. **Intentional authorization correction — partially.** `X1`'s fix (rethrow real auth/unexpected failures instead of swallowing them) is by
   design and correct; it is not itself "the regression."
3. **Incorrect routing into recommendation — yes, this is the actual defect.** Live trace (`V2_LLM=on`) for
   `"hôm nay tôi nên tập chân hay tập lưng?"`: `deterministicRoute=RECOMMEND` with **no topic**, yet `recommendStandalone` still called
   `getUserFitnessContext` (only to hit `switch(route.topic)`'s `default: return null` afterwards) — a wasted profile read whose failure the old
   code swallowed and the new (correct) rethrow now surfaces as an unhandled rejection in the substitution test's stub, which doesn't mock this path.
   Separately, `"tôi muốn ăn cá hồi thay ức gà"` (a message the legacy `isLikelyFoodSubstitutionMessage` specialist owns) is deterministically
   `UNKNOWN`, so with the fallback on the typed-LLM second opinion answered it as `RECOMMEND(MEALS)` — a real "incorrect routing into
   recommendation" hijacking a message a more specific, existing specialist should have owned (mirrors the same class of bug D1 fixed for
   pending drafts, just for the legacy substitution/meal-log specialists instead).
4. **Actual product regression — yes** (the two points above), now fixed; **not** a pre-existing bug reopened — it only started throwing once X1
   stopped swallowing the resulting error.

**Fix (smallest general correction, no new keyword patches):**
- `conversational-intelligence/global/global-turn.ts`: `STANDALONE_RECOMMEND_TOPICS` (`GOAL`/`TARGET_WEIGHT`/`SESSIONS`/`MEALS`/`HIRE_PT`);
  `recommendStandalone` returns `null` **before** reading the profile when `route.topic` isn't one of them — a topic-less `RECOMMEND` (a
  "personalised fit question" with nothing specific to recommend) never reads the profile at all.
- `runGlobalTurn` gains a `legacySpecialistCue` parameter; the typed-LLM fallback's eligibility now also requires `!legacySpecialistCue`.
  `fitness-agent.service.ts` passes `isLikelyFoodSubstitutionMessage(question) || isLikelyMealLogMessage(question)` — the exact, existing cues
  those two legacy specialists already use to claim a turn, reused rather than duplicated.

**Regression tests:** two new tests in `conversational-intelligence-remediation.test.ts` — the topic-less RECOMMEND case asserts zero profile
reads and a `null` result (falls through to the legacy specialist / chat, unchanged); the specialist-cue case asserts the fallback is **not**
called for two food-substitution phrasings (and **is** called, as a control, for an unrelated unplaceable phrase).

## Task 4 — X4: false confirmation claim

**Reproduction (before):** `"Xác nhận cập nhật."` with nothing pending → `parseFitnessAgentIntent` has no match → falls to RAG → model answers
"✅ Đã lưu thành công!" although nothing exists to save. `"Đã lưu thành công chưa?"` similarly (the old text-guard explicitly excluded any message
containing `?`). `"Ok lưu đi."` reproduces a **different**, non-fabricating but still wrong answer: the bare word "ok" matches
`parseFitnessAgentIntent`'s `reviewVerb` regex (`chấp nhận|đồng ý|dong y|ok|approve|accept`) → dispatches to `tryReviewRecommendation("ACCEPT", …)`
→ `getActiveCycle` 404 → "Bạn chưa có chu kỳ tập nào đang hoạt động." (honest, but unrelated to what the user asked).

**Fix — a deterministic boundary that runs before ANY intent-kind dispatch, narrowly scoped:**
- `services/confirmation-boundary.ts` (new): `classifyConfirmationUtterance` — anchored (whole short message, ≤9 words), returns `CONFIRM` or
  `STATUS`, `null` otherwise. Deliberately does **not** match a phrase naming a specific artifact ("lưu lịch tập này", "lưu thực đơn này") — those
  keep the existing, correct, collision-aware redirects (`proposeSaveGeneratedPlan`'s own pending-draft check; the router's own pending-draft
  `CORRECTION` rule from D1) unshadowed. `deriveConfirmationState` reads the session's real `FitnessAgentAction` rows (newest first) into
  `PENDING | EXECUTING | COMPLETED | CANCELLED | EXPIRED | NONE` — authoritative, never inferred from the model. `confirmationBoundaryAnswer`
  returns a truthful, state-specific Vietnamese answer for every combination; none of the six non-PENDING/EXECUTING answers can be mistaken for
  a fabricated success (asserted directly in a unit test).
- `services/fitness-agent.service.ts`: `tryConfirmationBoundary` — classifies, returns `null` immediately if an active workflow exists (so a
  waiting profile-card/proposal keeps its own real confirm→write path untouched), otherwise answers from the derived state. Called right after
  `ownSession(...)`, **before** `parseFitnessAgentIntent`'s dispatch — this is what stops "ok"/"lưu" style utterances from being hijacked by an
  unrelated legacy intent (cycle-review, etc.). The old `tryConfirmationTextGuard` (superseded, narrower, and reachable only much later) was
  removed.

**Two iterations were needed to get the ordering right, and both are now covered by tests:**
1. First attempt matched "lưu lịch tập này" too (an earlier, broader regex) and, placed after `routePendingDraftTurn`, produced a plain-text
   answer instead of letting `proposeSaveGeneratedPlan`'s own richer collision-redirect (re-showing the SAME preview card) win — broke the
   pre-existing `agent-workflow-create-workout-plan.test.ts` collision-guard test. Fixed by narrowing the regex to bare phrases only (see above);
   the pre-existing test now passes unmodified, and a **new** test locks in the exclusion (`classifyConfirmationUtterance("lưu lịch tập này") === null`,
   plus 2 more artifact-naming phrases).
2. A synthetic test fixture (`payload: {}`) then crashed the real draft-revision code path (`substituteMatchingExercises` on `undefined.map`) once
   a bare "Xác nhận cập nhật." with a genuinely pending draft correctly reached it — fixed by giving the fixture a realistic
   `payload: { weeklySchedule: [] }` (what a real draft always has), not by touching the revision code (out of scope, signed off).

**Required test-variant matrix — all 7 utterances × 5+1 states, via REAL HTTP/API (`test/conversational-intelligence/x4-confirmation-matrix.mjs`,
DB-verified deltas), before/after:**

| state (fresh user each cell) | before (`claimWithoutWrite`) | after |
|---|---|---|
| S0 nothing pending | U1 ✗ (RAG fabricates "khởi đầu tốt…"), U6 ✗ ("✅ Đã lưu thành công!") | U1–U6 all the boundary's honest "chưa có…"/"chưa có thay đổi nào…" text |
| S1 real profile card pending | U1–U5 correctly write via the real workflow (unchanged) | unchanged — boundary defers (active workflow present) |
| S2 workout draft pending | U1 ✗, U6 ✗ | U1–U6 all "Mình chưa lưu gì cả…" / "Chưa — mình chưa lưu gì cả…" |
| S3 already CONFIRMED | U1 ✗ (generic RAG chatter), U6 ✗ | "đã được xác nhận và lưu rồi…" / "Rồi — …" |
| S4 DISMISSED (cancelled) | U1 ✗ | "đã được bỏ qua… mình chưa lưu gì cả…" |
| S5 EXPIRED | U1 ✗ | "đã hết hạn nên mình chưa lưu gì cả…" |
| S6 cross-user | n/a | 404, owner's draft still PENDING (unchanged) |
| U7 knowledge question | (not run before) | both S0/S2: real RAG answer about the confirmation mechanism, not intercepted |

**Final result: 39/39 cells, `claimWithoutWrite: 0`, `errors: 0`, `setupFailed: 0`** (`results/final-closure/x4-matrix-after.json`).
`"Ok lưu đi."` (S0/U3) specifically confirmed to no longer reach `tryReviewRecommendation`/"chu kỳ tập" — the exact issue behind the earlier X4
report — and now gets the boundary's own answer.

## Regression — REAL HTTP/API, BACKEND INTEGRATION, REAL BROWSER

| suite | flags | evidence | result |
|---|---|---|---|
| `tsc --noEmit` | — | — | clean |
| Codex X1/X2 boundary probes (inverted to regression) | OFF & ON | BACKEND INTEGRATION | pass both flags |
| conversational-intelligence + agent-workflow + fitness-agent (full set) | **OFF** | BACKEND INTEGRATION | **212/212** |
| same, **ON / LLM off** | BACKEND INTEGRATION | **212/212** |
| same, **ON / LLM on** (verification config) | BACKEND INTEGRATION | **212/212** |
| CI-V2 golden conversation | REAL HTTP/API | **13/13** |
| Global golden cases | REAL HTTP/API | **23/23** |
| X4 confirmation matrix (39 cells) | REAL HTTP/API + DB | **39/39**, 0 false claims |
| Draft-revision collision (2 profile variants, LLM on) | REAL HTTP/API + DB | route=CORRECTION, same draft id, 5 days, profile unchanged, 0 competing programs — both variants |
| Safety adversarial + IDOR (Codex's corpus, foreign confirm/dismiss/read/turn, no/invalid auth, I01-I03, U01-U04) | REAL HTTP/API + DB | **15/16** (I03 = X5, pre-existing, see below) |
| Real browser: remediation (desktop+mobile), global-coverage, global-mobile (4 widths) | REAL BROWSER | **49/50** (1 known model-latency timeout, see X6 below) |

Regression suites required by the task and already covered above: draft revision ✓, profile confirmation ✓ (S1 row), PT-hire confirmation ✓
(`codex-security-http.mjs`'s `no-program-write`/`owner-draft-still-pending`, and the pre-existing "auto-pick-and-hire PT still requires
confirmation" case from the earlier Phase L), cross-user/session ownership ✓ (S6, `foreign-*`, `no-auth`/`invalid-auth`), safety adversarial ✓,
RAG interruption + workflow resume ✓ (global-coverage + global-mobile browser suites, all widths).

## Production files changed

| file | change |
|---|---|
| `services/fitness-agent-tools.ts` | `PROFILE_READ_ORIGIN` marker on the profile-read's own errors only |
| `conversational-intelligence/global/profile-errors.ts` | `isProfileReadError`; origin-first classification |
| `conversational-intelligence/global/global-turn.ts` | `STANDALONE_RECOMMEND_TOPICS` gate; `legacySpecialistCue` param threaded to the LLM-eligibility check |
| `conversational-intelligence/global/llm-route.ts` | `ALLOWED_TOPICS`/`loggableTopic`/`REJECTED_TOPIC_MARKER`; `redactErrorDetail: true` |
| `llm/json_llm_call.util.ts` | optional `redactErrorDetail` on `callLlmJson` (only `llm-route.ts` sets it) |
| `services/confirmation-boundary.ts` (new) | `classifyConfirmationUtterance`, `deriveConfirmationState`, `confirmationBoundaryAnswer` — pure functions, no I/O |
| `services/fitness-agent.service.ts` | `tryConfirmationBoundary` (new) called right after `ownSession`; old `tryConfirmationTextGuard` removed; `isLikelyFoodSubstitutionMessage`/`isLikelyMealLogMessage` passed into `runGlobalTurn` |

Test/verification files: `__tests__/codex-remediation-boundary.test.ts` (Codex's 2 probes inverted + 1 new), `__tests__/conversational-intelligence-remediation.test.ts`
(X1/X3/X4 tests + updated classifier unit test), `test/conversational-intelligence/x4-confirmation-matrix.mjs` (new), Codex's own
`codex-draft-db.mjs`/`codex-security-http.mjs`/`codex-continued-probes.mjs` (reused, unmodified).

## Confirmation integrity (explicit)

Zero DB writes from any of the 39 X4 matrix cells' `CONFIRM`/`STATUS` utterances; the one real write path (S1, a genuine pending profile-change
proposal) still requires the same explicit `AWAITING_SLOT_CONFIRMATION` + regex-matched confirm reply it always did (unchanged, `X4: a REAL
pending confirmation still works` test) — the boundary defers to it via the active-workflow check and never intercepts it.

## Privacy / log verification (explicit)

`X2` unit tests assert directly: an out-of-enum topic is replaced by a constant marker; a deliberately embedded secret string never appears in
any captured log line across four different malformed-model-output shapes; a retry/failure log's `err` field is a redacted kind marker
(`redacted:<ErrorName>`), never the raw parse/validation message.

## Remaining known limitations (none hidden, none newly caused)

- **X5** (pre-existing, unchanged, deliberately not touched): with a pending draft, the legacy draft router turns arbitrary free text into an
  exclusion constraint and echoes it back (Codex's `I03`). Confirmed still present; no write, no leak, no confirmation bypass — a
  confirmation-integrity/product-quality item for separate work, per the task's own instruction to keep it documented rather than fixed here.
- **X6** (pre-existing, reconfirmed, not a regression): the web client's 30 s chat-stream abort vs the local qwen3:4b's 40–100 s real generation
  time for long RAG answers — one of two browser runs of the same "knowledge question mid-workflow" assertion timed out (desktop only; mobile,
  global-coverage and global-mobile all passed the equivalent check). Not weakened or worked around; the underlying behavior (reminder present,
  workflow untouched) is independently proven at REAL HTTP/API + DB level in the same session.
- 401/403 from the profile read still surface to the HTTP client as `500` (the controller maps only `ApiError`) — unchanged, out of this task's
  scope, already on record from the prior remediation.
- Config B (qwen3:4b) accuracy and Config C (30B) remain unmeasured in this task — unrelated to X1–X4.

## Reproduce

```
# stack: docker compose -f docker-compose.test.yml up -d postgres-test redis-test
#   docker compose -f infra/compose/docker-compose.dev.yml -f test/ai-chat-full-verification/docker-compose.verification.override.yml \
#     up -d --no-deps auth-service user-service fitness-service ai-service api-gateway web
MSYS_NO_PATHCONV=1 docker exec -e CONVERSATIONAL_INTELLIGENCE_V2=<off|on> -e CONVERSATIONAL_INTELLIGENCE_V2_LLM=<off|on> gymcoach-ai-dev \
  sh -c "cd /app/backend/services/ai-service && npx tsx --test src/__tests__/conversational-intelligence-*.test.ts src/__tests__/codex-remediation-boundary.test.ts src/__tests__/agent-workflow-*.test.ts src/__tests__/fitness-agent-*.test.ts"
node test/conversational-intelligence/x4-confirmation-matrix.mjs <label> 1
node test/conversational-intelligence/codex-security-http.mjs
node test/conversational-intelligence/codex-draft-db.mjs <label>
node test/ai-chat-full-verification/browser-e2e.mjs remediation remediationmobile globalcov globalmobile
```
Result files kept: `test/conversational-intelligence/results/final-closure/x4-matrix-{before,after}.json`.
