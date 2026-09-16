# Codex — Conversational Workflow Final Targeted Sign-off

Date: 2026-09-15.

Scope: targeted recheck only. This report answers whether the final
deferred-context safety HIGH from
`docs/codex-conversational-ai-coach-evaluation-2-final-signoff.md` is closed
without regression. No full architecture evaluation was performed. No
production code was modified by Codex in this pass.

## Decision

**GO — CONVERSATIONAL WORKFLOW FOUNDATION SIGNED OFF**

Current production code plus the unchanged Codex v2 evaluator show zero
remaining CRITICAL/HIGH/MEDIUM findings for this targeted scope.

## Deferred-context HIGH

**Closed.**

Verified current `finalizeWorkflow()` in
`backend/services/ai-service/src/agent-workflow/orchestrator.ts`:

- Candidate parse remains before slot collection/finalization.
- Early contextual validation still happens when context is sufficient
  (`extractSafeKnownFromMessage()` and single-slot reply handling).
- Missing slots are collected first.
- Once all required slots are known, `finalizeWorkflow()` runs a final
  contextual revalidation loop over `def.slots`.
- That loop calls each slot's own `SlotDefinition.validateContext(value, ctx)`
  before any `PROFILE_UPDATE_CONFIRMATION` can be built.
- If validation fails, the invalid candidate is removed from `known`, the
  workflow stays `COLLECTING_SLOTS`, `expectedSlot` is set to the failing
  slot key, and the user is re-asked with that validator's clarification.
- Confirmation still reloads authoritative context and runs pre-write
  validation before `updateProfileFields()`.

The behavioral revalidation path is generic over `def.slots` and
`validateContext`; it is not implemented as target-weight-specific control
flow. I did note target-weight-specific logging branches remain, but they do
not determine validation, removal, confirmation, or write behavior.

## Reproduction Result

Former HIGH reproduction:

1. Current weight missing.
2. User: `Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, mục tiêu 30kg.`
3. User: `80kg`

Result: **PASS**. The unchanged evaluator case
`unsafe-target-deferred-context-before-confirm` now passes:

- no `PROFILE_UPDATE_CONFIRMATION` containing `30kg`
- no profile write
- no roadmap generation
- `targetWeight` removed/rejected from provisional known slots
- workflow remains `COLLECTING_SLOTS`
- `expectedSlot` becomes `targetWeight`

Recovery in the same workflow also passes via
`agent-workflow-remediation-2.test.ts`: `72kg` produces confirmation, confirm
writes exactly once, then auto-resumes the original `CREATE_ROADMAP` flow to a
roadmap preview.

## Regression Checks

Unchanged Codex v2 evaluator:

```text
npx tsx backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts
decision: GO_WITH_DOCUMENTED_LIMITATIONS
summary: PASS 30 / FAIL 0 / INFO 0 / BLOCKED 0
```

Focused workflow/parser suite:

```text
npx tsx --test backend/services/ai-service/src/__tests__/agent-workflow-remediation-1.test.ts backend/services/ai-service/src/__tests__/agent-workflow-remediation-2.test.ts backend/services/ai-service/src/__tests__/agent-workflow-roadmap-e2e.test.ts backend/services/ai-service/src/__tests__/agent-workflow-program-e2e.test.ts backend/services/ai-service/src/__tests__/agent-workflow-security-e2e.test.ts backend/services/ai-service/src/__tests__/slot-values-parsers.test.ts
tests 50, pass 50, fail 0
```

Program recommendation, memory, and claim-catalog regressions:

```text
npx tsx --test backend/services/ai-service/src/llm/__tests__/memory_extraction.test.ts backend/services/ai-service/src/llm/__tests__/memory_policy.test.ts backend/services/ai-service/src/llm/__tests__/recommendation_claims.test.ts backend/services/ai-service/src/llm/__tests__/program_recommendation_claims.test.ts backend/services/ai-service/src/__tests__/training-program-scoring-v2.test.ts
tests 76, pass 76, fail 0
```

Builds:

```text
npm --prefix backend/services/ai-service run build
PASS

npm --prefix frontend/web run build
PASS, with existing Vite chunk-size warning only
```

## Parser Spot Checks

Ad hoc parser check, in addition to test coverage:

```text
parseTrainingDays("T2 T4 T6") -> [1,3,5]
parseTrainingDays("thứ 2 4 6") -> [1,3,5]
parseTrainingDays("thứ 2, 4, 6") -> [1,3,5]
parseTrainingDays("thứ 2, thứ 4, thứ 6") -> [1,3,5]
parseTrainingDays("thứ 2 - thứ 4 - thứ 6") -> [1,3,5]
parseTrainingDays("tập thứ 2, khoảng 60 phút") -> [1]

parseMinutes("1.5 giờ") -> 90
parseMinutes("1,5 giờ") -> 90
parseMinutes("1.2.3 giờ") -> no_number_found
parseMinutes("-1 giờ") -> no_number_found
```

## Concurrency And Migration

Concurrency remains covered by:

- unchanged v2 evaluator cases `concurrent-start-20`,
  `concurrent-different-workflows`, `concurrent-slot-replies`,
  `concurrent-confirm`
- focused DB-backed tests in `agent-workflow-remediation-1.test.ts`
- `claimForWrite()` conditional `updateMany` path in
  `workflow-state.repository.ts`

Migration check:

```text
npx prisma migrate status
24 migrations found
Database schema is up to date
```

No new migration was introduced for the final safety fix. The existing
workflow invariant migration remains:
`20260916090000_agent_workflow_session_active_unique`.

## PT Flow

Representative FIND_PT and PT search-to-hire checks pass in the unchanged v2
evaluator:

- `find-pt-budget-1.500.000`: PASS
- `find-pt-budget-Không giới hạn`: PASS
- `find-pt-budget-Ngân sách không quan trọng`: PASS
- `pt-search-to-hire-two-step`: PASS

## CI Note

`.github/workflows/docker-test.yml` still does not appear to run the
new workflow-specific AI-service tests/evaluator directly. This remains
INFO-only for this targeted sign-off because the requested production-path
and regression evidence were run locally in this pass.

## Production Files Modified By Codex This Pass

None.

This report was added. Running the unchanged v2 evaluator also refreshed its
existing results artifact at
`backend/services/ai-service/src/evaluation/conversational-workflow-v2/results/conversational-workflow-evaluation-2.json`.

## Final Sign-off

**GO — CONVERSATIONAL WORKFLOW FOUNDATION SIGNED OFF**
