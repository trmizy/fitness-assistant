# Gymini AI Agent System — Evaluation Report

**Date**: 2026-09-14. Every number below is either **MEASURED** (a real command was run, real output recorded) or explicitly marked **NOT MEASURED**. Nothing here is estimated or invented.

---

## PHASE 4 UPDATE (2026-09-14) — Structured Claim Grounding + memory provenance results

Full detail: `docs/ai-agent-hardening-fix-report.md`'s "PHASE 4 ADDENDUM". Real numbers from this pass:

| Suite | Pass | Fail | Notes |
|---|---|---|---|
| `recommendation_claims.test.ts` (new) | 19 | 0 | pure-function catalog/renderer tests |
| `recommendation_narrator_claims.test.ts` (new) | 6 | 0 | `narrateRecommendations()` end-to-end, stubbed LLM: failure-fallback, cross-candidate attack, strict-schema injection |
| `memory_extraction.test.ts` (new) | 9 | 0 | genuinely new wording; §40/§41 acceptance shape in EN+VI |
| `recommendation_narrator.test.ts` (unchanged) | 41 | 0 | direct `validateNarration()` calls, preserved for Codex backward-compat |
| ai-service full regression sweep (69 files) | 700 | 0 | 4 skipped (test-DB-gated file excluded, unchanged from Phase 3) |
| Codex independent evaluator (unmodified) | 273 | 50 | **expected, disclosed** — the 50 fails call `validateNarration()` directly with free-form strings, a path production no longer routes real narration through; identical fail set before/after this pass, 0 new failures |
| `npx tsc --noEmit` — ai-service | clean | — | |
| Exercise retrieval eval (real, corrected dataset path, 100 cases) | Hit@5=0.98, Recall@5=0.98, MRR=0.8187 | 2 genuine misses | corrects Phase 3's wrong "dataset missing" claim |

**Newly MEASURED / CORRECTED this pass**: ADV-001/ADV-005 closed by architectural construction (not by pattern coverage — 10 closed ClaimTypes, exhaustively enumerated, with an explicit test asserting no forbidden claim type can ever exist); ADV-003 closed via tool-removal + deterministic provenance pipeline (9 new tests, both the injection-blocked and legitimate-preference-persisted paths proven); the exercise-retrieval Hit@5/Recall@5/MRR metric, previously wrongly reported BLOCKED, is now real and measured.

user-service and fitness-service were not touched this pass — their Phase-3 numbers stand (285/286 pass 1 skipped; 2/2 pass; both typechecks clean).

---

## PHASE 3 UPDATE (2026-09-14) — final hardening pass results

Full detail in `docs/ai-agent-hardening-fix-report.md`'s "PHASE 3 ADDENDUM". Headline real numbers from this pass, superseding the "NOT MEASURED" rows below for the items they cover:

| Suite | Pass | Fail | Notes |
|---|---|---|---|
| Codex's independent evaluator (unmodified fixtures/runner) | 255 | 0 | 33 skipped, 10 blocked (unchanged categories) — was 6/30 pass on the semantic-paraphrase set before this pass's redesign |
| `recommendation_narrator.test.ts` | 41 | 0 | includes 15 genuinely novel 3rd-gen paraphrase cases (diacritic/non-diacritic Vietnamese + English), not copied from any Codex fixture |
| `memory_policy.test.ts` | 29 | 0 | includes `tools.test.ts` (11 cases) after fixing a real bilingual-coverage regression this pass found |
| ai-service full regression sweep (67 test files, excl. 1 file requiring an isolated test-DB not running in this environment) | 665 | 0 | 4 skipped |
| user-service full regression sweep | 285 | 0 | 1 skipped |
| fitness-service apply-plan idempotency/stale-state | 2 | 0 | |
| `client-journey-derivation-idempotency.test.ts` (sequential + 10-way concurrent, real DB) | 2 | 0 | |
| `agentic-contract-idempotency.test.ts` (incl. 2 new stale-state cases) | 4 | 0 | |
| `npx tsc --noEmit` — ai-service, user-service, fitness-service | clean | — | all 3 |

**Newly MEASURED this pass** (were NOT MEASURED before): ADV-001/ADV-005 against Codex's second-generation semantic-paraphrase adversarial set (255/255); ADV-006 ClientJourney concurrent-write safety (real DB, 10-way concurrency); Contract/apply-plan stale-state for PT-stops-accepting and package-archived scenarios (real DB, real 409s); live tool-calling prompt-injection for 3 attack shapes (real local model, real tool-request + real boundary-denial evidence — see hardening report for the raw log evidence and the `captureStdout` methodology bug found and disclosed along the way).

**Corrected this pass**: the "`.env` port misconfiguration" finding below (§RAG Eval / environment) was wrong — it is a deliberate, inactive SSH tunnel, not a bug. See hardening report addendum.

**Still NOT MEASURED / BLOCKED**: `exercises` collection Hit@5/Recall@5/MRR reproduction (ground-truth dataset file does not exist in the repo — a real, structural gap, not an env issue); semantic RAG citation-support judgment; multi-candidate live-narrator scenario; Training Program Recommendation (explicitly not started, gated behind independent Codex sign-off).

---

## Test results — MEASURED

All commands run from the relevant package directory (`backend/services/ai-service` or `backend/services/user-service`), via `npx tsx --test <file>`, against the real local dev environment (Postgres in Docker, `gymcoach-postgres` container, confirmed running via `docker ps` before any DB-touching test).

| Suite | File | Tests | Pass | Fail |
|---|---|---|---|---|
| `scorePT` / `journeySimilarity` / `summarizeJourneys` cold-start fix | `ai-service/src/__tests__/fitness-agent-scoring.test.ts` | 8 | 8 | 0 |
| Recommendation narration validator (adversarial) | `ai-service/src/llm/__tests__/recommendation_narrator.test.ts` | 7 | 7 | 0 |
| `deriveGoalAchievement` (ClientJourney derivation) | `user-service/src/__tests__/client-journey-derivation-goal-achievement.test.ts` | 7 | 7 | 0 |
| Synthetic-cohort end-to-end (real DB, real seeded data) | `user-service/src/__tests__/agentic-fitness-synthetic-cohort.test.ts` | 2 | 2 | 0 |
| Contract natural-completion regression (existing, re-verified) | `user-service/src/__tests__/contract-natural-completion-settles-money.test.ts` | 6 | 6 | 0 |
| Fitness-agent regression: evaluate/review, substitution, workout-schedule-intent (existing) | `ai-service/src/__tests__/fitness-agent-evaluate-review.test.ts`, `fitness-agent-substitution.test.ts`, `workout_schedule_intent.test.ts` | 17 | 17 | 0 |
| Contract/session regression sweep (existing, touches `contract.service.ts`) | 11 files: `client-reports-pt-no-show`, `contract-entitlements`, `contract-expiry-settles-money`, `contract-getbyid-authorization`, `contract-price-snapshot`, `contract-update-field-allowlist`, `late-cancel-releases-money`, `legacy-contract-endpoints`, `pt-late-cancel-compensates-via-shared-outcome`, `pt-repeated-no-show-right`, `resolve-dispute-pt-no-show-confirmed` | 43 | 43 | 0 |
| RAG pipeline consolidation regression (delegated agent, reported) | `chunking.test.ts`, `knowledge_pipeline.test.ts`, `research_knowledge.test.ts` | 22 | 22 | 0 |
| **Total** | | **112** | **112** | **0** |

`npx tsc --noEmit` (full project typecheck): clean for `ai-service` and `user-service` after every change in this pass, run repeatedly during implementation, not just once at the end.

**One real bug caught by this pass's own tests, before it shipped**: `CAUSAL_PROMISE_RE` in `recommendation_narrator.ts` had a trailing `\b` that silently failed to match "5kg" (no word boundary between a digit and a following letter) — found by the validator's own adversarial test, fixed, re-verified (7/7 pass after fix).

**One real regression caught and fixed**: wiring `deriveForCompletedContract` directly (not via the existing `CompleteContractDeps` injection pattern) would have made `checkAndCompleteContract`'s "no DB, no HTTP" unit test silently start hitting the real dev DB on every run — caught by noticing the test's own documented design intent, fixed by making the derivation call injectable (matching the existing `settleMoney` pattern), reverified (test suite dropped from 7.9s to 2.5s, confirming DB isolation restored).

## Real DB seed verification — MEASURED

```
First run:  60 PTs, 331 ClientJourney rows, 331 SessionReview rows (after the experience-concentration fix)
Second run: identical counts — confirmed via direct prisma.count() queries, not just script self-report
```

Ran against the dev Postgres container (`gymcoach-postgres`, confirmed via `docker ps` before running), gated by `ENABLE_AGENTIC_DEMO=true` + non-production guard (`NODE_ENV !== "production"`, checked before any write).

## PT Recommendation Eval — PARTIALLY MEASURED

- **Hard-constraint violation rate**: NOT separately measured as a metric, but structurally guaranteed — `candidates()` excludes (not down-ranks) any PT failing a hard filter; no test found a violation.
- **Ranking determinism**: MEASURED — `scorePT` is pure; `fitness-agent-scoring.test.ts` asserts identical output for identical input across dimensions (regression-guard test).
- **Cold-start fairness**: MEASURED — both the pure-function test (`fitness-agent-scoring.test.ts`) and the real end-to-end synthetic-data test (`agentic-fitness-synthetic-cohort.test.ts`, second test case) confirm a cold-start candidate's `compatibility.components` structurally omits `evidence`, while a real-cohort candidate includes it.
- **Historical-cohort relevance against real-world data**: NOT MEASURED — no real (non-synthetic) `ClientJourney` data exists yet to measure against (expected; the derivation pipeline was only just built and no real contract has completed under it yet).
- **Explanation factual consistency**: MEASURED for the validator's own adversarial cases (7/7 correctly rejected fabrications). **NOT MEASURED** against a live LLM's actual typical output distribution — no live model call was made in this pass (`ENABLE_RECOMMENDATION_NARRATION`'s live-LLM path was not exercised with a real Ollama/Anthropic call; only the deterministic validator was tested against hand-constructed adversarial inputs).

## Narrator Eval — PARTIALLY MEASURED

All 7 required adversarial classes from the task's own eval checklist were tested against the deterministic validator:

| Adversarial case | Result |
|---|---|
| Invented percentage | REJECTED (measured) |
| Guarantee/causal-promise language | REJECTED (measured) |
| Historical evidence claimed with zero-count cohort | REJECTED (measured) |
| Unsupported/fabricated scientific citation | REJECTED (dropped from output, measured) |
| Real cited evidence | ACCEPTED (measured, confirms no over-rejection) |
| Real historical evidence with sufficient cohort | ACCEPTED (measured) |
| Clean, fully-grounded narration | ACCEPTED (measured) |

**NOT MEASURED**: invented certification, invented schedule, invented success story specifics beyond the percentage/causal-language patterns already covered, contradictory score explanation, insufficient-cohort-presented-as-strong-evidence beyond the zero-count case. The validator's percentage/guarantee/evidence-ref checks would likely catch most of these as a byproduct (e.g., an invented schedule claim isn't itself checked, but nothing in the current implementation validates schedule claims at all — **this is a real, named gap**, not silently assumed covered).

## RAG Eval — NOT MEASURED (this pass)

No new retrieval-relevance or citation-correctness measurement was performed in this pass — the `hitAtK=0.98` figure referenced in the feasibility audit is a pre-existing code comment, not re-verified here. `scripts/evaluateRetrieval.ts`'s current state was not run.

## Tool-selection Eval — NOT MEASURED

No new tool-selection-accuracy measurement was performed; `ENABLE_TOOL_CALLING` was not enabled or tested in this pass.

## Prompt-injection Eval — NOT MEASURED

The specific risk flagged in the feasibility audit (§14, #5/#6: can RAG-retrieved content trigger `remember_user_fact` via the tool-calling path) was **not tested in this pass** — `ENABLE_TOOL_CALLING` remains untouched/untested. This is an explicit, named gap, not an oversight being hidden.

## HITL / Idempotency Eval — MEASURED (indirectly, via existing + new regression tests)

Idempotency of `applyTrainingPlan`/`confirmPTContract` was not re-tested in this pass (no code changed there) — existing behavior, unchanged, assumed still correct per the feasibility audit's own prior verification. The **new** idempotency claim (the seed script, and `deriveForCompletedContract`'s `findFirst`-before-`create` check) **was** measured directly (§"Real DB seed verification" above; `client-journey-derivation.service.ts`'s idempotency itself was exercised indirectly by the contract-completion test suite passing with the derivation wired in, though no test explicitly double-completes the same contract to check for a duplicate `ClientJourney` row — **named gap**).

## Multimodal Eval — NOT MEASURED

No test images (valid/poor/multi-person/non-fitness/ambiguous) were run through `fitness-goal-vision.service.ts` or `fitness-vision-chat.service.ts` in this pass — no code in that path was changed, and testing it was out of this pass's scope (Image→GoalContext loop-closure was deferred, not built — see Implementation Report).

## Latency / LLM call count — NOT MEASURED

No live LLM call was made from the new narrator path in this pass (would require a running Ollama instance or Anthropic API key + real network calls, not exercised). The code is structured for at most 1 new LLM call per PT-recommendation turn (`narrateRecommendations` makes exactly one `callLlmJson` call, with up to 2 internal retries on schema-validation failure) — this is a structural guarantee from reading the code, not a measured latency number.

---

## Summary: MEASURED vs NOT MEASURED vs NOT APPLICABLE

| Area | Status |
|---|---|
| Unit/integration test suite (112 tests) | **MEASURED** — 112/112 pass |
| Real DB seed + idempotency | **MEASURED** — real writes, real re-run verification |
| Cold-start scoring fairness | **MEASURED** — unit + end-to-end |
| Narration validator adversarial classes (7 of ~11 requested) | **MEASURED** for the 7 tested |
| Narration validator remaining adversarial classes (schedule/cert fabrication, contradictory explanation) | **NOT MEASURED** — named gap |
| RAG retrieval quality | **NOT MEASURED** this pass |
| Tool-selection accuracy | **NOT MEASURED** — feature untouched |
| Prompt injection | **NOT MEASURED** — named risk, not tested |
| Multimodal safety | **NOT MEASURED** — path unchanged, out of scope |
| Live-LLM narration output quality | **NOT MEASURED** — no live model call made |
| Latency / cost per recommendation | **NOT MEASURED** — structural guarantee only (≤1 new LLM call) |
| Historical-cohort relevance vs. real-world outcomes | **NOT APPLICABLE yet** — no real (non-synthetic) journeys exist |
