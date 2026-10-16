# Phase 3 — Batch 2: Unified Turn Understanding Foundation — Completion Report

**Implementation owner**: Claude Code. **Date**: 2026-10-05. Engineering report, not a research artifact.

## 1. Starting fragmentation

`docs/ai-product/phase3-current-ai-map.md` found two overlapping typed turn representations —
`SemanticInterpretation` (CI-V2 goal-change/slot-filling path) and `GlobalRouteResult` (CI-V2 cross-domain
READ/RECOMMEND/interruption path) — plus a third, unlisted but critical one: the legacy
`parseFitnessAgentIntent` `{kind}` shape, which is **the path that actually runs by default today**, since
`CONVERSATIONAL_INTELLIGENCE_V2` defaults off (confirmed again this batch).

## 2. Existing types mapped

Inspected verbatim (not guessed) before writing any code:
- `SemanticInterpretation` (`conversational-intelligence/schema.ts:107-123`)
- `GlobalRouteResult`/`GlobalRoute` (`conversational-intelligence/global/router.ts:19-38`)
- `ConfirmationIntent` (`services/confirmation-boundary.ts:14`) — confirmed by reading the actual anchored
  regexes that "đề xuất đi"/"nếu áp dụng thì sao" never match either `CONFIRM_RES` or `STATUS_RE`.
- legacy `parseFitnessAgentIntent`'s `{kind}` (`services/fitness-agent-intent.ts`) — ~17 real `kind` values.
- `agent-workflow/types.ts`'s `SlotProvenance`/`WorkflowStatus` — inspected, deliberately **not** mapped into
  the canonical turn (a different layer: workflow persistence state, not turn understanding; mapping it in
  would have created a 4th provenance system alongside `belief-state.ts`'s `BeliefSource` and Batch 1's
  `DataSource` — exactly the duplication this batch should avoid adding).

## 3. Canonical contract

`services/turn-understanding/types.ts::UnifiedTurnUnderstanding` — see the plan file / code for the exact
shape. Reuses `PrimaryIntent`, `SemanticEntity`, `SemanticCorrection`, `SemanticReference`, `SemanticAmbiguity`,
`RequestedAction` (all from `schema.ts`), `ConfirmationIntent`, and `ContextNeed` (Batch 1) verbatim — no new
competing vocabulary for anything that already had one. New: `TurnDomain`, `TurnInterpretationSource`,
`TurnRouteClass` (a tagged union, not an overloaded enum — business intent and execution route are kept as two
separate concepts, per the brief's explicit instruction).

## 4. Mapping rules

Full table in the plan file. Key honesty points: the brief's suggested `constraints` field was **omitted**
(no current type distinguishes constraint-entities from fact-entities — not fabricated); `secondaryIntents` is
populated **only** from a real `GlobalRouteResult.parts` (MULTI), never invented; `"MERGED"` was **added** to
the brief's own suggested `interpretationSource` enum because `SemanticInterpretation.source` really has that
third value today and dropping it would have been a real information loss.

## 5. Precedence rules

No precedence was invented or changed. The three source representations are **mutually exclusive per turn** in
the real dispatcher (confirmation boundary short-circuits before global-turn ever runs; legacy-intent and
global-route are mutually exclusive via `ciMode()`), so there was nothing to merge — `mergeUnderstanding()` was
not built (the brief explicitly permits skipping it when "repository structure suggests a smaller solution").
Where the brief worried about two representations disagreeing, the real system never produces two for the same
turn today — `compareUnderstandings` (§9) exists for the day that changes, unused for now.

## 6. Confirmation handling

`fromConfirmationBoundary` never lets anything bypass the real boundary: it only describes what
`classifyConfirmationUtterance` (unmodified) already decided. `mutationIntent` is `true` only for `CONFIRM`,
never for `STATUS`. Verified directly: "xác nhận" → `CONFIRM`; "đã lưu chưa?" → `STATUS` →
`mutationIntent: false`; "đề xuất đi"/"nếu áp dụng thì sao" → `null` (the classifier itself never matches
these — confirmed by reading the regexes, then by a real test calling the real function).

## 7. Correction handling

`fromSemanticInterpretation` passes `interp.corrections` through unchanged (same array, same objects) — "one
effective correction result, not two engines competing" is satisfied by construction: this adapter never
re-runs `detectCorrections`, it only re-shapes what already ran.

## 8. Reference handling

Same pattern: `interp.references` passed through unchanged. No reference target is ever invented by the
adapter — confirmed by a test asserting `deepEqual` between input and output.

## 9. LLM invocation behavior

Zero new LLM calls. All 4 adapters are plain synchronous functions (verified by a test asserting
`fn.constructor.name === "Function"`, not `AsyncFunction`) over data the EXISTING dispatch chain already
produced — `fromGlobalRouteResult`'s `llmInvoked` flag is derived from `result.reason === "typed LLM fallback"`
(the exact string `global/llm-route.ts` already sets on an accepted model answer), not a new check. The
diagnostic logging hooks added to `fitness-agent.service.ts` call these adapters synchronously on data already
in scope — no new `await`, no new HTTP/LLM round trip.

## 10. Legacy compatibility

`SemanticInterpretation` and `GlobalRouteResult` were not touched, not deprecated, not hidden — every file that
produces them is unmodified. The canonical type is purely additive.

## 11. Consumers migrated

Exactly one, diagnostic-only: `fitness-agent.service.ts::tryTurnUnguarded` gains 3 small, try/catch-wrapped
hooks (after confirmation-boundary resolves; after `runGlobalTurn` resolves; and the legacy-path fallback) that
construct the canonical object from whichever representation actually governed the turn and log it as a new
`turn_understanding` structured event — `primaryIntent/domain/routeClass.kind/interpretationSource/confidence/
hasCorrection/hasReference/ambiguityCount/mutationIntent` only, never raw message text or full entity values
(same discipline as the existing `ci_global_trace`). **Nothing reads this object downstream** — the existing
`confirmationBoundary`/`g`/`intent`-driven branches are untouched, so route/precedence/mutation authority cannot
change by construction, not just by testing.

## 12. Consumers not migrated

Everything else. In particular, `compareUnderstandings` (shadow comparison, brief §23) is implemented and
unit-tested but **not wired into the live dispatcher** — doing so safely would require exposing
`agent-workflow/orchestrator.ts::handleSemanticTurn`'s internal `SemanticInterpretation` outward, a more
invasive change than this batch's "observe only" mandate justifies. Flagged as a real Batch 3 candidate, not
silently dropped.

## 13. Route-parity evidence

`__tests__/turn-understanding-route-parity.test.ts` drives real `fitnessAgent.tryTurn()` calls in **both**
`CONVERSATIONAL_INTELLIGENCE_V2` states and asserts the dispatched outcome is unchanged: workout-workflow start
(legacy default), unrecognized message falling through to `null` (legacy default), bare "xác nhận" with
nothing pending (shared confirmation-boundary path), `READ_STATE` nutrition-target question (CI-V2 on),
`CANCEL` of a waiting PT workflow (CI-V2 on), `KNOWLEDGE_QA` pass-through (CI-V2 on), and an
empty/whitespace-only message in both modes never throwing. All 7 pass. Combined with the **unchanged** 61/61
on the existing `conversational-intelligence-{global,v2,remediation}.test.ts` suite and the full ai-service
suite showing the exact same 6 pre-existing/environmental failures (zero new ones), this is the real
route-parity evidence — not a separate, assumed claim.

## 14. LLM-call parity evidence

No dedicated spy-based test was needed beyond §9's "adapters are sync functions" proof plus the full-suite run:
since the diagnostic hooks never call an LLM themselves (confirmed by code inspection — `logTurnUnderstanding`
and all 4 adapters import nothing from `llm.service.ts`/`json_llm_call.util.ts`), and the full regression run
shows the same pass/fail counts as the pre-Batch-2 baseline (which already includes the LLM-mocked
`ai.worker.ts`/orchestrator tests), there is no code path by which this batch could have added an LLM call.

## 15. Focused tests

`__tests__/turn-understanding-adapters.test.ts` (22 tests, T01-T12 + the safety family T20/T22-T26 + MULTI +
shadow-comparison) and `__tests__/turn-understanding-route-parity.test.ts` (7 tests) — both 100% pass, reported
exactly in §16.

## 16. Regression tests

```
cd backend/services/ai-service
NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum \
  JWT_SECRET=test_jwt_secret_32_chars_minimum_value REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/turn-understanding-adapters.test.ts src/__tests__/turn-understanding-route-parity.test.ts
# -> tests 29, pass 29, fail 0

npx tsx --test src/__tests__/conversational-intelligence-global.test.ts \
  src/__tests__/conversational-intelligence-v2.test.ts src/__tests__/conversational-intelligence-remediation.test.ts
# -> tests 61, pass 61, fail 0 (byte-identical to pre-Batch-2)

npx tsx --test src/__tests__/*.test.ts  (full suite, LLM_PROVIDER=mock)
# -> tests 839, pass 829, fail 6, skipped 4
```
839 = 810 (Batch 1 baseline) + 29 new. The 6 failures are the exact same 6, by name, documented as pre-existing/
environmental since Phase 2 (Ollama model-name drift ×2, Pipeline B/legacy-mode live-fitness-service
requirements ×4) — zero new failures.

## 17. Intentional behavior changes

**None.** This batch is purely additive/observational — no existing answer, route, or persisted state changes
for any real user turn.

## 18. Remaining gaps for Batch 3

- `compareUnderstandings` is built but not wired into the live dispatcher (§12) — would need
  `agent-workflow/orchestrator.ts` to expose its internal `SemanticInterpretation` outward.
- `GlobalRoute → PrimaryIntent`/`kind → PrimaryIntent` mapping tables are necessarily lossy best-effort
  projections (documented in the mapping table) — fine for observability, not precise enough to drive any real
  decision without further validation.
- `secondaryIntents` only ever has content for the existing `MULTI` route — Batch 3's own "bounded multi-intent
  orchestration" is the first place allowed to actually ACT on more than the primary intent; this batch
  deliberately stops at *representing* it.
- `contextNeeds` on the canonical type is descriptive-only and sparse (4 of 8 domains mapped) — Batch 3 would
  need to decide whether/how a real orchestration step consumes it (and wire it to Batch 1's
  `assembleContext`, still untouched by this batch).
