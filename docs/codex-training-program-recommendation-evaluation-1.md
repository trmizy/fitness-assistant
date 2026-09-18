# Codex — Training Program Recommendation Independent Evaluation #1

Date: 2026-09-15

Decision: **GO WITH DOCUMENTED LIMITATIONS**

## 1. Scope

Evaluated the training-program recommendation path implemented after PT-Agent Regression #4. This review did not modify production implementation files. It added only an evaluator script and this report.

## 2. Architecture Verified

Actual production call graph:

```text
fitnessAgent.tryTurn(PROGRAM)
  -> fitnessAgentTools.findTrainingPrograms()
  -> fitness-service /workouts/agent/candidates
  -> agentProgramService.candidates() hard filters
  -> scoreTrainingProgram()
  -> sort compatibility.total DESC, program.id ASC
  -> narrateProgramRecommendations()
  -> Program Claim Catalog
  -> optional LLM claim-ID selection
  -> deterministic renderer
  -> PROGRAM_RECOMMENDATIONS
  -> choose()
  -> ACTION_CONFIRMATION(APPLY_TRAINING_PLAN)
  -> confirm()
  -> fitnessAgentTools.applyTrainingPlan()
  -> fitness-service /workouts/agent/apply
  -> agentProgramService.apply() re-runs candidates() and checks fingerprint
```

## 3. Files Inspected

- `backend/shared/src/fitness-agent.ts`
- `backend/shared/src/fitness-agent-scoring.ts`
- `backend/services/ai-service/src/services/fitness-agent-tools.ts`
- `backend/services/ai-service/src/services/fitness-agent.service.ts`
- `backend/services/ai-service/src/llm/program_recommendation_claims.ts`
- `backend/services/ai-service/src/llm/program_recommendation_narrator.ts`
- `backend/services/fitness-service/src/services/agent-program.service.ts`
- `backend/services/fitness-service/src/routes/agent-program.routes.ts`
- `frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx`
- `backend/services/fitness-service/prisma/schema.prisma`

## 4. Hard Filters

`agentProgramService.candidates()` hard-filters:

- profile safety/injury flags -> returns no generic programs;
- required user preference fields: goal, days, experience;
- `WorkoutProgramTemplate.goal === preferences.goal`;
- `daysPerWeek === preferences.days.length`;
- `dataOrigin` matches demo/real mode;
- template is public, owned, or explicitly shared;
- `experienceLevel === profile.experienceLevel`;
- `daysJson` validates as manual program days;
- every referenced exercise resolves to canonical `Exercise`;
- exercise must be `PUBLISHED` and globally owned or owned by user;
- contraindications array must be empty;
- beginner profile rejects non-beginner exercises;
- equipment coverage required by current predicate;
- estimated max session duration <= requested session limit.

Apply re-runs the same candidate lookup and requires `templateId + fingerprint` to match before write.

## 5. Hard-Filter Tests

Code-inspection result: PASS for goal, days/week, experience, visibility, canonical exercise, beginner safety, contraindications, session duration, and stale fingerprint revalidation.

DB-backed hard-filter/E2E test: BLOCKED/UNVERIFIED in this session. The existing DB-backed `agent-program-apply-idempotency.test.ts` failed immediately and then kept the process open without stack details before manual stop.

## 6. Equipment Requirement Semantics

Schema stores `ExerciseEquipment.requirementType` as string with comment `REQUIRED | ALTERNATIVE | OPTIONAL`.

Current code:

```ts
e.equipmentLinks.some(link => !equipment.has(link.equipmentId))
```

Observed semantics:

- REQUIRED: missing equipment -> ineligible. Correct.
- OPTIONAL: missing equipment -> ineligible. Likely incorrect if OPTIONAL means optional.
- ALTERNATIVE: one of two alternatives present -> ineligible. Likely incorrect if alternatives are interchangeable.

Finding: **MEDIUM product correctness**. This is a false-negative recall issue, not an unsafe false-positive issue.

## 7. Soft Score

Actual version: `program-compatibility-v1`.

Weights:

- goal 25
- experience 20
- schedule 20
- equipment 15
- sessionDuration 10
- focusMuscle 5 optional
- durationWeeks 5 optional

Session duration formula targets 85% of available session time, not longest possible session.

## 8. Hard-Filter / Soft-Score Overlap

| Dimension | Hard filter already? | Can eligible candidates differ? | Useful for ranking? |
|---|---:|---:|---|
| goal | Yes | No under current service | Redundant after hard filter |
| experience | Yes | No under current service | Redundant after hard filter |
| schedule | Yes, exact days/week | No under current service | Redundant after hard filter |
| equipment | Yes, full current predicate | No; always 1 for returned candidates | Redundant after hard filter |
| sessionDuration | Hard max only | Yes below max | Useful, low weight |
| focusMuscle | No | Yes, if GoalContext focus exists | Useful but coarse |
| durationWeeks | No | Yes, if user preference exists | Useful optional heuristic |

## 9. Score Variance

Evaluator: `backend/services/ai-service/src/evaluation/program-recommendation/evaluate_program_recommendation.ts`.

Representative post-filter 100-case matrix:

- goal variance: 0
- experience variance: 0
- schedule variance: 0
- equipment variance: 0
- sessionDuration variance: 0.011063
- focusMuscle variance: 0.2211
- durationWeeks variance: 0.093385

Conclusion: most score weight is eligibility-confirmation, not ranking signal.

## 10. Tie Rate

Tie rate: 0.87 in the evaluator matrix, with 13 unique rounded total scores across 100 candidates.

## 11. Score Distribution

- min: 88
- p25: 92
- median: 95
- mean: 94.49
- p75: 97
- max: 100

Compatibility scores cluster high because 80% of base weight is constant after hard filters.

## 12. Weight Rationale

Scientific constraints:

- experience/training status matters;
- resistance training frequency and progression should match training status;
- equipment/safety feasibility is required;
- consistency/adherence matters.

Engineering heuristics:

- exact weights 25/20/20/15/10/5/5;
- 85% session-duration target;
- focus-muscle overlap ratio;
- duration-week closeness.

Unsupported claims:

- no evidence that exact numeric weights are scientifically calibrated;
- no evidence that compatibility total is outcome probability.

Documentation mostly labels weights honestly as engineering/product heuristics.

## 13. Weight Sensitivity

Ablation changed ordering under the exact rounded percentage implementation. Because four high-weight dimensions are constant, this should be interpreted as denominator/rounding sensitivity, not evidence that those dimensions provide candidate-specific information.

## 14. Goal Dimension

Redundant for ranking under current hard filters. Useful as an eligibility/explanation fact.

## 15. Experience Dimension

Redundant for ranking under current hard filters. Useful as an eligibility/safety explanation.

## 16. Schedule Dimension

Redundant for ranking under current hard filters. `PROGRAM_SCHEDULE_PARTIAL_MATCH` cannot occur in the current production candidate path.

## 17. Equipment Dimension

Redundant for ranking under current hard filters. Useful as eligibility explanation. Current equipment predicate likely over-filters OPTIONAL/ALTERNATIVE equipment.

## 18. Session-Duration Dimension

Useful. It differentiates eligible candidates below the hard maximum. The old formula that rewarded longer programs was removed from production ranking; `rg` found no remaining `program-fit-v1`/`timeUtilization` production use.

## 19. Focus-Muscle Dimension

Useful when confirmed GoalContext focus muscles exist. Program focus is deterministic from canonical exercise `muscleGroupsActivated`, not LLM classification.

Limitation: one overlapping muscle group can give full focus overlap if the user's focus list has one item, even if the program is not predominantly focused on that area.

## 20. Duration-Weeks Dimension

Useful only when user supplied `durationWeeks`. Omitted otherwise.

## 21. Missing Data

PASS. `focusMuscle` and `durationWeeks` are omitted from denominator when absent. No optional input is silently scored as 0.

## 22. Cold Start

PASS. Program outcome history is not a scoring dimension.

## 23. Program Outcome History

PASS. No `ClientJourney` or PT historical outcome data is used as program effectiveness evidence.

## 24. Golden Ranking Suite

Evaluator golden scenarios:

- Total: 5
- Pass: 5
- Fail: 0

Coverage: focus present/absent, session-duration preference, duration-week preference present/absent. This is a useful semantic smoke suite, not a full DB-backed E2E suite.

## 25. Determinism

PASS. Ranking is deterministic by `compatibility.total DESC`, then `program.id ASC`. Shuffled input cannot override final stable sort when ids/scores are fixed.

## 26. Claim Catalog

Actual claim types:

- `COMPATIBILITY`
- `GOAL_MATCH`
- `EXPERIENCE_MATCH`
- `SCHEDULE_MATCH`
- `EQUIPMENT_FILTERED`
- `SESSION_DURATION`
- `FOCUS_MATCH`
- `DURATION_WEEKS`
- `SCIENTIFIC_EVIDENCE`
- `NO_OUTCOME_HISTORY`

Claims are candidate-scoped by id prefix. Renderer owns all factual prose.

## 27. Claim Security Attacks

Pure evaluator + targeted tests:

- fake IDs: PASS, ignored
- cross-program IDs: PASS, ignored
- free-form injection: PASS, schema accepts only claim IDs
- fake evidence: PASS, no fake evidence rendered
- outcome claim: PASS, no outcome claim type exists and no-history disclosure is mandatory

## 28. LLM Authority

Can rank: **NO**.

Can write factual prose: **NO**. The model only selects claim IDs.

## 29. Fallback

PASS. LLM disabled/invalid selection falls back to deterministic default claim selection and renderer.

## 30. RAG Role

RAG provides `AgentEvidence` for scientific explanation only. It does not alter eligibility, score, rank, or apply.

## 31. PROGRAM_RECOMMENDATIONS UI

Actually renders:

- candidate name;
- compatibility total;
- days/week, duration weeks, estimated minutes;
- `why[]` explanation;
- program days/exercises;
- evidence block at recommendation level;
- apply button.

Missing/limited:

- component breakdown and reason codes are not rendered;
- `narration.tradeoffs`, `uncertainty`, and `evidenceRefs` are not shown directly except insofar as summary/strengths flow into `why[]`;
- compatibility wording is still a generic “Compatibility Score: X/100”, though server answer clarifies it is not probability.

## 32. Selection Flow

PASS by code inspection. Selection must reference `candidateIds` stored in the recommendation row; arbitrary model-created IDs are rejected.

## 33. Confirmation Flow

PASS by code inspection. Program selection creates `ACTION_CONFIRMATION` with kind `APPLY_TRAINING_PLAN`.

## 34. Apply Flow

PASS by code inspection; DB-backed verification blocked. `execute()` calls `fitnessAgentTools.applyTrainingPlan()` only after explicit confirmation.

## 35. Revalidation

PASS by code inspection. Fitness-service apply re-runs `candidates()` and checks fingerprint.

## 36. Stale Fingerprint

PASS by code inspection; DB-backed test blocked/unverified. Mismatched fingerprint throws 409 before creating program.

## 37. Idempotency

PASS by code inspection; DB-backed test blocked/unverified. `agentActionId` unique lookup returns existing program for repeat action.

## 38. DB E2E

BLOCKED/UNVERIFIED. Local DB-backed test did not produce usable stack output and did not exit cleanly after failing.

## 39. Existing Active Cycle/Program Behavior

Current recommendation flow allows presenting new programs even if user already has active training. The confirmation text warns that applying will replace unfinished schedule and link program to the training cycle. This is acceptable as HITL behavior, but not a proactive “maybe evaluate current cycle first” product behavior.

## 40. RoadmapPhase

Not used. Correct for v1: current program candidate payload has no stable RoadmapPhase-to-template mapping.

## 41. Image GoalContext

Used safely for categorical `focusMuscles` only. Not used for age, sex, medical diagnosis, PED inference, exact body fat, or result guarantees.

## 42. Research Review

Research supports broad dimensions, not exact coefficients. Documentation is honest enough that these are product heuristics constrained by fitness science.

## 43. PT Phase-4 Regression

PASS for targeted suites:

- PT claim catalog suite included in run;
- memory extraction/policy suites included in run;
- no production evidence that program implementation reintroduced `remember_user_fact` as model-selectable.

## 44. Builds / Typechecks

PASS:

- `npm --prefix backend/shared run build`
- `npm --prefix backend/services/ai-service run build`
- `npm --prefix backend/services/fitness-service run build`
- `npm --prefix frontend/web run build`

Targeted tests:

- program + PT claim + memory suites: 47/47 pass
- evaluator script: pass and wrote JSON result

## 45. Findings

CRITICAL: none.

HIGH: none.

MEDIUM:

- Equipment filter likely over-requires OPTIONAL/ALTERNATIVE equipment, reducing valid candidate recall.
- Compatibility total is highly inflated by hard-filter dimensions; most weight does not differentiate eligible candidates.

LOW:

- UI does not render component breakdown/reason codes directly.
- `PROGRAM_SCHEDULE_PARTIAL_MATCH` is dead under current exact days/week hard filter.
- No proactive active-cycle recommendation warning beyond apply confirmation wording.

INFO:

- DB-backed E2E/apply-idempotency/stale-fingerprint evidence unavailable in this session.
- Live LLM quality/latency not measured.
- RoadmapPhase omitted by design.

## 46. Evaluation Debt

- Run DB-backed candidate hard-filter matrix.
- Run DB-backed recommendation -> select -> confirmation -> apply E2E.
- Add focused DB tests for OPTIONAL/ALTERNATIVE equipment semantics.
- Measure real production template score distribution.
- Consider separating eligibility facts from ranking score dimensions.

## 47. Production Files Modified By Codex

Expected: **NONE**.

This evaluation added no production implementation changes.

## 48. Evaluator / Docs Created

- `backend/services/ai-service/src/evaluation/program-recommendation/evaluate_program_recommendation.ts`
- `backend/services/ai-service/src/evaluation/program-recommendation/results/program-recommendation-evaluation-1.json`
- `docs/codex-training-program-recommendation-evaluation-1.md`

## 49. Is Training Program Recommendation Production Methodology Defensible?

**PARTIALLY YES.**

It is safe, deterministic, and auditable. The methodology is defensible as a conservative v1, but the compatibility score should be documented as mostly “eligible + preference fit”, not a strongly discriminative recommender score.

## 50. Does Gymini Now Satisfy The Supervisor Scenario?

**PARTIALLY YES.**

```text
User context
-> recommend PT OR program
-> grounded explanation
-> user selection
-> confirmation
-> safe business execution
```

The architecture and code support this flow. Full production sign-off still needs DB-backed E2E verification and equipment semantics cleanup.

## 51. Final Instruction To Claude

TRAINING PROGRAM RECOMMENDATION may proceed **with documented limitations**.

Targeted improvements:

1. Fix or explicitly define `ExerciseEquipment.requirementType` semantics for OPTIONAL and ALTERNATIVE.
2. Split eligibility facts from ranking score or reduce constant hard-filter dimensions in `compatibility.total`.
3. Add DB-backed E2E tests for recommendation -> choose -> confirm -> apply.
4. Consider rendering component breakdown/reason codes in UI.
5. Keep `program-compatibility-v1` clearly labeled as a deterministic compatibility heuristic, not scientific optimization or outcome prediction.

