# Conversational Intelligence — Targeted Remediation

Date: 2026-09-27. Owner: Claude Code (implementation). Input: `docs/codex-conversational-intelligence-final-signoff.md`.
Scope: (1) context-dependent live-routing flakiness, (2) missing-profile 422 surfaced as 500, (3) focused regression + real-browser verification.
Not touched: no new AI framework, no fine-tuning, no orchestration migration, Enterprise Data Agent / Fitness Recommendation Agent not rewritten,
both CI flags keep their code defaults (`CONVERSATIONAL_INTELLIGENCE_V2` off, `CONVERSATIONAL_INTELLIGENCE_V2_LLM` off). No corpus label was edited
(`global-blind-2.json` sha256 still `5b768158…d7571`).

## Status: **COMPLETE for the two reproduced defects — with disclosed caveats (below). Not self-signed-off; handed to Codex for independent verification.**

Evidence labels used: `REAL BROWSER`, `REAL HTTP/API`, `BACKEND INTEGRATION` (node:test **inside the Docker ai-service container** against the isolated
`gymcoach_ai_test` DB), `TEST FIXTURE`, `CODE AUDIT`. Application behaviour was exercised only through Docker containers; host Node ran only the
HTTP client/stress harness, the pure `classifyGlobal` evaluators (no I/O) and the Chromium driver.

---

## 1. Original defects

| # | Defect (from the Codex sign-off) | Severity claimed |
|---|---|---|
| D1 | Same utterance: pure `classifyGlobal()` correct, live bulk run sometimes wrong, isolated run correct (GB2-058, GB2-087 …) | MEDIUM |
| D2 | `readers.ts::readGoal()` — user-service `422 "Complete your profile first"` propagates to a raw HTTP 500 | LOW–MEDIUM |

## 2. D1 — reproduction, root cause, fix

### 2.1 What the evidence showed (nothing was closed by "a rerun passed")

1. **Historic traces** (649 `ci_global_trace` lines): every failure-signature trace (`RECOMMEND(SESSIONS)` ×11) had **no `activeWorkflow`** —
   the router had been given an *empty* context. `START_WORKFLOW` for GB2-087 was likewise context-free.
2. **Pure classifier on the same text, two contexts** (`.tmp-stack/rc-pure.ts`): with the declared context → `CORRECTION` / `SWITCH_WORKFLOW`;
   with an empty context → `UNKNOWN` (then the typed LLM fallback supplies `RECOMMEND(SESSIONS)`) / `START_WORKFLOW`. So the pure classifier and the
   live route **agree whenever they see the same input**; the *input* differed.
3. **Why the live input differed — deterministic, not random** (`.tmp-stack/rc-confound.mjs`, DB dump after the setup turn):

   | profile | setup turn "Tạo lịch tập cho tôi." | DB after setup | correction "à khoan… phải là 3 buổi" |
   |---|---|---|---|
   | **A**: no `preferredTrainingDays` | "Bạn muốn tập mấy buổi mỗi tuần?" | workflow `CREATE_WORKOUT_PLAN\|COLLECTING_SLOTS\|daysPerWeek` | `CORRECTION`, draft created with 3 buổi |
   | **B**: `preferredTrainingDays [1,3,5]` (what every bulk harness used) | a workout **draft** at once | **no workflow row**, one PENDING draft | answered by standalone `RECOMMEND(SESSIONS)` ("Đây chỉ là gợi ý"), draft untouched |

   Every earlier "ruling-out" experiment (15 filler users, 10 docker-log fetches, the "isolated" retests) used profile **A**; the bulk/"7 failing in
   isolation" scripts used profile **B**. That confound — not concurrency, request volume or log-fetch overhead — separates "passes" from "fails".
   (This retracts the earlier hypothesis list in my previous report and in Codex's Phase-6 narrowing; both were tested with profile A only.)

### 2.2 Two independent root causes

* **RC-1 (test harness, not product):** the bulk harnesses *declared* a state ("FIND_PT waiting for budget") but never verified it. Under profile B the state
  does not exist, so the utterance was scored against a context that was never there. Trace association by log order was a second weakness.
* **RC-2 (real product defect, found through RC-1):** a **pending draft** (workout/nutrition/roadmap preview awaiting confirmation) is conversation state that
  CI-V2 did not model. The turn "sai rồi, phải là 5 buổi mỗi tuần" was `UNKNOWN` deterministically → the typed-LLM fallback was **eligible** (the code excluded
  non-`COLLECTING_SLOTS` workflows but not a pending draft) → accepted as `RECOMMEND(SESSIONS)` → answered with a generic recommendation that even
  **contradicted the user** ("gợi ý 3 buổi" after "phải là 5 buổi"), bypassing the draft's own revision router (`routePendingDraftTurn`). Only manifests with the fallback ON.

### 2.3 Instrumentation added (request-scoped, no log-order reliance)

`ci_global_trace` now carries: `correlationId` (= the request `traceId`, already returned to the client), `userId`, `sessionId`, `workflowId/Status/expectedSlot/activeWorkflow`,
`proposalStored`, `pendingDraft`, `deterministicRoute/Topic`, `llmCalled`, `llmAccepted`, final `route/topic/workflow/reason`.
`ci_global_llm_route` carries `correlationId`, raw `llmRoute/llmTopic`, `accepted`, `acceptedRoute`. New `ci_turn_transition` (per turn, from the orchestrator wrapper)
carries workflow before/after + `started|advanced|unchanged|ended|replaced|none` and pending-draft before/after. **Redaction:** profile values (`facts`, `patch`) were
removed from traces (only `factKeys` / `patchKeys` remain); no message text, tokens or profile values are logged (asserted by a test).

### 2.4 Fix (smallest general correction — no phrase patches)

* `router.ts`: `GlobalContext.draft`; a revision cue **with a value** while a draft is pending → `CORRECTION` (the existing "hand the turn back to the workflow/draft layer" route,
  identical semantics to a correction inside a waiting workflow). Same cue family/entity test as the active-workflow branch.
* `global-turn.ts`: the pending-draft flag is computed **before** classification and fed to the router; the typed-LLM fallback is not consulted while a draft is pending
  (this was already the documented rule for pending confirmation cards — it was simply not enforced for drafts).

## 3. D2 — missing profile

**Root cause:** `getUserFitnessContext` → user-service `requireProfile` throws a well-formed `422 "Complete your profile first"`; `readGoal` (and the recommend/proposal steps) had no
handling, the controller maps only `ApiError`, so a *known* condition became `500 INTERNAL_ERROR`. The sibling `readContracts` already degraded gracefully; `readGoal` did not.

**Fix (one boundary):** new `global/profile-errors.ts` classifies the tool-layer error; `fitnessAgent.tryTurn` is now a thin guard around `tryTurnUnguarded` (the unchanged body).
This covers CI-V2 reads/recommendations/proposals **and** the legacy workflow/draft paths that call the same read.

| condition | detected as | result |
|---|---|---|
| profile exists | — | normal answer |
| profile missing | `422` + "Complete your profile first" | friendly Vietnamese guidance naming chiều cao / cân nặng hiện tại / tuổi / giới tính / mục tiêu; **no write, no profile created, no workflow, no draft**; `ci_profile_missing` logged |
| upstream unavailable | 502/503/504 | honest transient answer ("dịch vụ hồ sơ đang gián đoạn… mình chưa thay đổi gì"); `ci_profile_upstream_unavailable` warn logged |
| unexpected upstream failure | 500, non-HTTP errors, other 422 | **rethrown** (still a 500 + error log) |
| authorization | 401 / 403 | **rethrown** — never a successful answer |

The two best-effort `.catch()` sites in `global-turn.ts` that used to swallow every error now rethrow classified failures (so they reach the boundary); unclassified failures keep the old best-effort behaviour.

## 4. Exact production changes

| file | change |
|---|---|
| `conversational-intelligence/global/router.ts` | `GlobalContext.draft`; pending-draft `CORRECTION` rule |
| `conversational-intelligence/global/global-turn.ts` | `correlationId` param; pending-draft flag before classification + in router context; LLM fallback ineligible while a draft is pending; enriched/redacted trace; `rethrowProfileFailures` at the two swallow sites |
| `conversational-intelligence/global/llm-route.ts` | optional `correlationId`; raw-proposal vs accepted logging |
| `conversational-intelligence/global/turn-state.ts` (new) | non-sensitive snapshot + transition description |
| `conversational-intelligence/global/profile-errors.ts` (new) | error classification + guided answers |
| `services/fitness-agent.service.ts` | `tryTurn(question, identity, sessionId, correlationId?)` guard wrapper over `tryTurnUnguarded`; passes `correlationId` to `runGlobalTurn` |
| `llm/orchestrator.service.ts` | passes `trace.traceId` to `tryTurn`; logs `ci_turn_transition` from the outer wrapper (+2 cheap DB reads per turn, only when CI is on) |

Test/verification infra (not production): `__tests__/conversational-intelligence-remediation.test.ts` (16 tests), `test/conversational-intelligence/stress-live.ts`,
`test/ai-chat-full-verification/browser-e2e.mjs` (+`remediation`, `remediationmobile` suites), `live-global.mjs` (fixture-token refresh), verification override
(`CI_V2_LLM_FOR_VERIFICATION`, default `on`, test-only). **Flag defaults in code are unchanged.**

## 5. Stress harness (`stress-live.ts`) — design and outcomes (REAL HTTP/API, Docker)

Design: isolated user per case; state built through **real turns** then **asserted from the DB** (workflow row / stored proposal / pending draft) — an unmet precondition is reported as
`PRECONDITION_FAILED`, never scored as a routing result; every request joined to its trace **by `correlationId`** and checked for the same `userId`+`sessionId` (attribution);
live deterministic route compared with pure `classifyGlobal()` on the context *the server logged*; server-seen context compared with the DB-verified state; per-turn workflow transition recorded.
Modes: sequential (13 scenarios), session chain (4 dependent turns in one session, state + transition asserted after each), interleaved (2 rounds × 15 isolated sessions, seeded shuffle, all
utterances in flight concurrently). Explicit profile variants A/B/C (B = the fixture that hid the defect; the two `fixture-dependence` scenarios prove B is *detected*).

| run (39 turns sent) | fallback | code | precondition failed | attribution mismatch | stale context | live≠pure | route = expected | LLM called | draft revised? | 5xx | chain |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base-on2 | ON | before | 6 (fixture-dependence, expected) | 0 | 0 | 0 | 33/39 | 6 | **0/6 (wrong answer)** | 0 | ok |
| base-off | OFF | before | 6 | 0 | 0 | 0 | 33/39 (draft route `UNKNOWN`) | 0 | 6/6 (legacy router revises) | 0 | ok |
| **fix-on** | ON | after | 6 | 0 | 0 | 0 | **39/39** | **0** | **6/6** | 0 | ok |
| **fix-off** | OFF | after | 6 | 0 | 0 | 0 | **39/39** | 0 | 6/6 | 0 | ok |

Reading: with explicit state there is **no** live≠pure disagreement, no attribution error and no stale context in any of the 4 runs (incl. concurrent interleaving) — i.e. **no nondeterminism was found**; the observed
variance was fixture state + RC-2. (An earlier first baseline `base-on`, harness v1 without the outcome assertion, gave the same 33/39 and `llmCalled 6`.)

Before/after trace for one draft turn ("sai rồi, phải là 5 buổi mỗi tuần", profile B, fallback ON):

```
BEFORE  deterministicRoute=UNKNOWN llmCalled=true llmAccepted=RECOMMEND(SESSIONS) route=RECOMMEND pendingDraft=true workflow=none transition=none
        answer: "Với hồ sơ hiện tại của bạn, mình gợi ý tập khoảng 3 buổi mỗi tuần … Đây chỉ là gợi ý"          (draft untouched, contradicts the user)
AFTER   deterministicRoute=CORRECTION llmCalled=false route=CORRECTION pendingDraft=true workflow=none transition=none
        answer: "Mình đã đổi lịch tập sang 5 buổi/tuần (Thứ 2, Thứ 3, Thứ 4, Thứ 5, Thứ 7) …"                   (draft router revised it)
```

## 6. Error-handling tests

`BACKEND INTEGRATION` (in the container): profile exists ×4 questions; missing ×4 questions (guidance, `updateProfileFields` never called, 0 workflow rows, 0 actions);
503 → transient answer, not the missing-profile text; 500 and non-HTTP errors **rejected**; 401 and 403 **rejected** (also inside the recommendation sub-step that used to swallow errors); classifier table (incl. "other 422 is not guidance").
`REAL HTTP/API` (`rem-missing-http.mjs`, 12/12): a registered user with no profile row → HTTP **200** guidance for height / weight / goal / cut-or-bulk / "Tạo lịch tập" (previously 500); nothing created;
PT-status still works; control user answered from data (181cm); no token / invalid token → 401; B with A's session → 404 with no data. A no-profile user's general-knowledge question → 200 (RAG path is tolerant).

## 7. Regression

| suite | evidence | result |
|---|---|---|
| `tsc --noEmit` (ai-service) | — | clean |
| new remediation tests | BACKEND INTEGRATION (container) | **16/16** |
| CI test files (global + v2 + remediation, incl. corpus-gate tests) | BACKEND INTEGRATION, flags ON | **42/42** |
| agent-workflow-* + fitness-agent-* + CI files, **default flags (OFF)** | BACKEND INTEGRATION | **189/189** |
| agent-workflow-* + fitness-agent-*, verification flags **ON** | BACKEND INTEGRATION | 144/147 — **3 legacy substitution tests fail** (see §9-2) |
| old CI-V2 corpus 171 / holdout 47 | TEST FIXTURE (pure) | 100 %, 0 unit mistakes/bypasses, 0 regressions / holdout unchanged (1 pre-existing `HO-043`) |
| global-blind 164 / holdout2 46 / blind-2 Config A 204 | TEST FIXTURE (pure) | 100 % / 82.6 % / 71.6 % (146/204), `unsafeMisroutes` 0 — **identical to before the change** |
| CI-V2 golden conversation | REAL HTTP/API | **13/13** |
| global golden cases (`live-global.mjs`) | REAL HTTP/API | 22/23 as first executed → **23/23** (the one failure was an *expired fixture JWT* in `users.json` giving 401; verified by a fresh login returning "2.187 kcal" = DB 2187; script now refreshes fixture tokens) |
| safety adversarial (7 prompts, DB-verified) | REAL HTTP/API | **7/7** |
| cross-user isolation (distinct A/B data, session hijack, A's row unchanged) | REAL HTTP/API | **7/7** |
| height (4 phrasings, distinct height/weight/target) | REAL HTTP/API | 4/4 → 181cm |
| PT status / goal read / recommendation / interruption+resume / confirmation card | REAL HTTP/API + REAL BROWSER | pass (see §8) |

Not re-run in this task: the 94-case live "Config B" stratified corpus and the 204-case corpus through live HTTP — this task did not target accuracy. **Note for Codex:** the earlier Config B "flaky" deltas came from a fixture
that never asserted its state; a re-run should use `stress-live.ts`-style preconditions.

## 8. Real browser (REAL BROWSER — existing playwright-core + Chromium harness, real login form, Docker web/gateway/services)

Desktop 1280 px: **15/15**; mobile 390 px: **15/15** (`browser-e2e.mjs remediation | remediationmobile`). Covered: height read shows 181cm and not 90kg/75kg; standalone PT status (no search, no workflow row);
missing profile → guidance naming what to complete, no error surface, input still usable, next question answered, nothing created (**TEST FIXTURE**: the profile row is deleted from the isolated test DB after the page loads —
no self-service path yields "registered without a profile row"); pending FIND_PT → knowledge question → reminder → resume (workflow row id/status/slot identical before/after; resume continues the same workflow);
profile confirmation card appears, writes nothing until clicked, click writes the goal; workout-draft correction revises the draft (5 buổi); no horizontal overflow on read/missing-profile/card views. Screenshots `test/ai-chat-full-verification/results/screenshots/40-…46-rem-*`.

Honest browser notes: (a) my earlier reports said no browser automation was available — that was wrong for this repo (`test/ai-chat-full-verification/browser-e2e.mjs`); (b) the first desktop run had **1 failure**:
the web client aborts the chat stream at **30 s** (`frontend/web/src/app/services/api.ts`), and a *long* RAG answer from the local qwen3:4b takes 40–100 s, so "Protein là gì?" showed "AI phản hồi quá lâu". That is a model-latency limitation, not the reminder logic
(HTTP shows the reminder present); the browser check now asks a one-sentence question ("RIR là gì? Trả lời một câu.", ~25 s) and passes on both viewports. Long RAG answers will still time out in the browser on this local model.

## 9. Remaining defects / caveats (none hidden)

1. **Auth errors surface as HTTP 500, not 401/403** (P3): the tool layer throws a generic `Error` with `status`; the controller maps only `ApiError`. They are *not* turned into successful answers (tested), but the HTTP status is not ideal. Not changed (out of scope).
2. **Behaviour change (P3):** the recommendation sub-step used to swallow *every* error; a classified **authorization** failure there now propagates. Three legacy tests (`fitness-agent-substitution.test.ts` "tryTurn: …" ×3) rely on the old swallowing when run with CI flags ON and no auth stub
   (they hit the real profile tool → 401). They pass at the default flags (189/189). I did not edit those tests; Codex may prefer to stub the tool there.
3. **Local-model/web-client latency (P2 for demos):** 30 s client abort vs 40–100 s local RAG generation (see §8).
4. Typed-LLM fallback accuracy (Config B), the vocabulary gaps and Config C are unchanged and out of scope; default-on is not addressed by this work.
5. The stress harness covers 15 deterministic context-dependent scenarios (not the full corpus); `ci_turn_transition` adds 2 cheap DB reads per CI-on turn (not measured precisely).
6. While a draft is pending (its TTL), the LLM fallback is intentionally not consulted; deterministic reads/recommendations still work.

## 10. Reproduce (for the independent verifier)

```
# stack (Docker only):  docker compose -f docker-compose.test.yml up -d postgres-test redis-test
#   docker compose -f infra/compose/docker-compose.dev.yml -f test/ai-chat-full-verification/docker-compose.verification.override.yml up -d --no-deps auth-service user-service fitness-service ai-service api-gateway web
#   fallback off: prefix with CI_V2_LLM_FOR_VERIFICATION=off and add --force-recreate ai-service
node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/stress-live.ts <label> sequential,chain,interleaved 2     # results/stress-<label>.json
MSYS_NO_PATHCONV=1 docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsx --test src/__tests__/conversational-intelligence-*.test.ts"   # copy test/conversational-intelligence/*.json to /app/test/conversational-intelligence first
node test/ai-chat-full-verification/browser-e2e.mjs remediation remediationmobile
```
Result files kept: `test/conversational-intelligence/results/stress-{base-on,base-on2,base-off,fix-on,fix-off}.json`.
