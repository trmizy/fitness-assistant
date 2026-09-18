# ADR: ClientJourney ↔ InBody Attribution

**Status**: Accepted · **Date**: 2026-09-14 · **Related**: `docs/ai-agent-system-feasibility-audit.md` §2.4/§11, `docs/ai-agent-system-migration-plan.md` Phase 4

## Context

`ClientJourney` (`user-service/prisma/schema.prisma`, model at line 1107) already has a `contractId` foreign key to `Contract`, and every field a derivation needs (`baselineWeight`, `baselineBodyFat`, `endingWeight`, `endingBodyFat`, `sessionsPrescribed`, `sessionsCompleted`, `goal`, `experience`, `verificationStatus`, `dataOrigin`). The gap found by the feasibility audit was not the schema — it's that nothing writes to this table.

The open question was how to attribute an `InBodyEntry` (`userId`, `date`, `weight`, `bodyFatPct`, ...) to "the PT/contract active at the time it was measured," since `InBodyEntry` has no FK to `ptUserId` or `contractId`.

## Options considered

**Option 1 — explicit FK.** Add `InBodyEntry.contractId` (nullable), populated at measurement-creation time. Requires a schema migration, a backfill decision for historical rows (which would all be `null`, permanently unattributable), and a new write-path responsibility (whatever creates an `InBodyEntry` would need to know the user's current contract). Rejected: this repo's own `gymini-scope-control` convention is explicit — *"No schema migration by default... only add a new table/column if a real audit proves the existing models genuinely cannot represent the needed state."* A migration is not needed here (see Option 2), so it is not justified.

**Option 2 — date-range derivation (chosen).** `Contract` already has `startDate`, `completedAt` (set exactly once, in `contract.service.ts::checkAndCompleteContract`), and — critically — a **snapshotted** `sessionDurationMinutes` taken at signing time (never drifts, unlike a live lookup). At the moment a contract completes, derive:
- `baselineWeight`/`baselineBodyFat`/`baselineLeanMass` from the client's `InBodyEntry` with the latest `date <= contract.startDate` (nearest-before).
- `endingWeight`/`endingBodyFat`/`endingLeanMass` from the client's `InBodyEntry` with the latest `date <= contract.completedAt`.

No schema change required.

**Option 3 — link through another authoritative relationship.** Considered `TrainingCycle` (fitness-service) as the attribution anchor instead of `Contract` (user-service). Rejected for this phase: `TrainingCycle` lives in a different service/database from `InBodyEntry`/`Contract` (both in user-service), so this would require a cross-service join user-service cannot do directly — real complexity for no attribution-quality gain over Option 2, since `Contract.startDate`/`completedAt` are already reliable, service-local timestamps.

## Decision

**Option 2.** Derive attribution from `Contract.startDate`/`completedAt` overlapping `InBodyEntry.date`, computed once, at contract-completion time, with **no schema migration**.

## Known limitation (accepted, documented — not silently ignored)

If a client has more than one `Contract` with a different PT whose date ranges overlap the same `InBodyEntry`, that entry's ending/baseline attribution is ambiguous. **Mitigation implemented in the derivation service** (`client-journey-derivation.service.ts`): before deriving, check for any other `Contract` for the same `clientUserId` with a different `ptUserId` whose `[startDate, completedAt ?? endDate ?? now]` range overlaps this contract's range. If found, **skip derivation entirely for this contract** (fail-safe: no `ClientJourney` row, not a misattributed one) and log the skip reason. This is intentionally conservative — an undercounted cohort is always preferable to a wrongly-attributed one, per the project's own "never claim more than the evidence supports" convention.

## Causal-claim boundary (per feasibility audit §16 / implementation task §16)

A derived `ClientJourney` row records **association**, never **causation**. `summarizeJourneys()` (`backend/shared/src/fitness-agent-scoring.ts`) already encodes this in its output `note` field ("Observed association among similar clients; not a causal effect or guaranteed result.") — the derivation service does not add any language implying the PT caused the outcome. `goalAchievement` (see the derivation service's `deriveGoalAchievement()`) is computed as a directional, conservative label (`IMPROVED`/`NO_CHANGE`/`REGRESSED`/`UNKNOWN`), never a "success"/"failure" verdict.

## Idempotency (no schema constraint needed)

The derivation runs from exactly one call site (`contract.service.ts::checkAndCompleteContract`, the only place `ContractStatus.COMPLETED` is ever set in the codebase — verified by a full-repo grep). It performs a `findFirst({ where: { contractId } })` check before creating, so a retried call (e.g. the natural-completion path being invoked twice for the same contract, which the existing code already guards against via the `status !== ACTIVE` early-return) is a safe no-op. No new unique constraint was added — see "why no migration" above; a second layer of DB-level uniqueness was judged unnecessary given the single call site and the existing status guard.

## Consequences

- Zero migration risk — this phase is purely new service code plus one small, additive call from an existing, already-tested completion path.
- `goal`/`experience`/`trainingDays` are captured from the client's **current** `UserProfile` at contract-completion time, not a historical snapshot from when the contract started — a known, accepted simplification (the same profile fields are not versioned anywhere else in the codebase either). If a client's stated goal changed mid-contract, the derived journey reflects the goal at completion time, not at signing. Documented, not hidden.
- `nutritionAdherence` is left `null` in every derived row — no reliable cross-service signal exists for this within user-service today, and inventing one was explicitly out of scope for this phase.
