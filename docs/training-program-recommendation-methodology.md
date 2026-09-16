# Training Program Recommendation Methodology

Date: 2026-09-15 (v1) · **Updated 2026-09-15 for v2** — see `docs/training-program-recommendation-v2-score-design.md` for the full before/after rationale. This file now documents v2, the production scorer; v1's original weights/formula are kept as historical reference below and in `fitness-agent-scoring.ts::scoreTrainingProgram`/`PROGRAM_SCORING` (unchanged, still exported for Codex's evaluator).

## Principle

Deterministic-first, LLM-as-selector. Program ranking is computed by TypeScript from already-fetched structured data. The LLM may only choose claim IDs from a server-built catalog; final Vietnamese prose is rendered deterministically by the server.

## Hard Filters

Hard filters remain in `fitness-service/src/services/agent-program.service.ts`.

Eligible templates must match the user's goal, days/week, experience level, visibility, canonical exercise availability, safety constraints, equipment coverage, and session duration limit. Apply revalidates the same constraints using `templateId` + `fingerprint`.

**Equipment coverage (fixed for v2)**: now reuses the canonical `isExerciseAvailable()` predicate (`equipment-availability.util.ts`) — `REQUIRED` links must all be owned, `ALTERNATIVE` links form an OR-group (owning any one satisfies it), `OPTIONAL` links never gate eligibility at all. Previously every link was treated as `REQUIRED` regardless of its real type (a real false-negative recall bug, fixed this pass — see `docs/training-program-recommendation-v2-score-design.md`).

## Soft Ranking (v2 — production)

Implemented in `backend/shared/src/fitness-agent-scoring.ts::scoreTrainingProgramV2()`.

Version: `program-compatibility-v2`.

**Principle**: only dimensions that can actually vary among already-eligible candidates are weighted. `goal`/`experience`/`schedule`/`equipment` are exact hard filters (above) — every eligible candidate already matches all four, so they contribute zero differentiating information and are represented as `eligibilityReasons` instead (confirmatory facts, never weighted into `total`).

Weights:

- sessionDuration: 70
- focusMuscle: 20, only when confirmed goal intent has specific focus muscles
- durationWeeks: 10, only when the user provided preferred duration

Optional dimensions are removed from the denominator when absent — never scored as 0 (same rule v1 used, now the only rule governing `total`). When **all three** are absent (`signalCount === 0`), every eligible candidate ties at a fixed `total: 100` with a mandatory `ZERO_RANKING_SIGNAL` disclosure — an honest tie, not a fabricated score.

Eligibility reason codes (always present for an eligible candidate, confirmatory only):

- `PROGRAM_GOAL_ELIGIBLE` / `PROGRAM_EXPERIENCE_ELIGIBLE` / `PROGRAM_SCHEDULE_ELIGIBLE` / `PROGRAM_EQUIPMENT_ELIGIBLE`

Ranking reason codes (only when the corresponding dimension is present):

- `PROGRAM_SESSION_DURATION_STRONG_MATCH` / `PROGRAM_SESSION_DURATION_ACCEPTABLE`
- `PROGRAM_FOCUS_MUSCLE_MATCH`
- `PROGRAM_DURATION_WEEKS_MATCH` / `PROGRAM_DURATION_WEEKS_PARTIAL_MATCH`
- `PROGRAM_ZERO_RANKING_SIGNAL` (when `signalCount === 0`)

**Weight rationale**: fitness science informs which dimensions are reasonable to rank on (session length, focus alignment, program duration all plausibly matter), not the exact numbers 70/20/10 — those are engineering heuristics, not a scientifically calibrated optimum. See `docs/training-program-recommendation-v2-score-design.md` for the full comparison against v1 (real measured tie rate 0.87 → 0.58, real divergence check).

### v1 (historical — kept unchanged in code for evaluator backward compatibility)

`scoreTrainingProgram()`/`PROGRAM_SCORING` (`program-compatibility-v1`) weighted goal 25 / experience 20 / schedule 20 / equipment 15 / sessionDuration 10 / focusMuscle 5 / durationWeeks 5 — kept exactly as originally implemented so Codex's own evaluator (which imports these two names directly) keeps measuring the same, real, documented v1 behavior. Not used in production since this pass.

## Narration

Implemented in:

- `ai-service/src/llm/program_recommendation_claims.ts`
- `ai-service/src/llm/program_recommendation_narrator.ts`

Claim types (v2) split eligibility from ranking: `GOAL_ELIGIBLE`, `EXPERIENCE_ELIGIBLE`, `SCHEDULE_ELIGIBLE`, `EQUIPMENT_ELIGIBLE` (eligibility — why this program is in the list at all); `SESSION_DURATION`, `FOCUS_MATCH`, `DURATION_WEEKS` (ranking — the only claims that can differ between eligible candidates); `COMPATIBILITY`, `SCIENTIFIC_EVIDENCE`; `NO_OUTCOME_HISTORY` and `ZERO_RANKING_SIGNAL` (mandatory disclosures, rendered regardless of LLM selection).

There is deliberately no claim type for guaranteed results, medical/PED advice, superiority, price, hidden schedule promises, or real-world outcome cohorts.

## Limitations

RoadmapPhase and active TrainingCycle are audited but not used as scoring dimensions because the candidate payload currently does not expose a stable phase-to-template mapping. This avoids inventing roadmap semantics that are not present in the current data model.
