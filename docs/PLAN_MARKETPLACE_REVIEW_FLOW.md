# Flow C — Plan Marketplace Review, Versioning & Adoption

> Verified against the actual implementation on branch `feature/session-feedback-pt-mode` (Phase 8 of `docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md`). Builds on the pre-existing `WorkoutPlan → PublishedPlan → PlanReview` chain (ai-service) — extended, not replaced.

## Actors
- **Publisher** — a user who completed a `WorkoutPlan` and published it.
- **Reviewer/Adopter** — a user browsing the marketplace.
- **ai-service** — owns `PublishedPlan`, `PlanReview`, `PlanImprovementSuggestion`, `PlanAdoption`.
- **fitness-service** — owns the `/workouts/from-ai-plan` internal endpoint that actually materializes an adopted plan into a calendar (pre-existing, reused unchanged).

## End-to-end sequence

```mermaid
sequenceDiagram
    participant P as Publisher
    participant R as Reviewer/Adopter
    participant AI as ai-service
    participant FS as fitness-service

    P->>AI: POST /marketplace/plans {sourcePlanId, title, description}
    AI-->>P: PublishedPlan {version:1, moderationStatus:SUBMITTED}
    Note over AI: Admin moderation (unchanged) — APPROVE sets approvedBy (Phase 8 addition), REJECT requires a note.

    R->>AI: GET /marketplace/plans (browse, APPROVED only)
    R->>AI: GET /marketplace/plans/:id (detail incl. sourcePlan.weeklySchedule, qualityScore)

    R->>AI: POST /marketplace/plans/:id/adopt {startDate, selectedWeekdays}
    AI->>AI: require moderationStatus===APPROVED
    alt Listing has an ACTIVE TrainingPackage
        AI->>AI: require a PAID TrainingPackagePurchase by this adopter
        Note over AI: 402 if missing — closes the audit-identified gap where a<br/>PAID purchase alone never created anything usable.
    end
    AI->>FS: POST /workouts/from-ai-plan (same internal call the self-save flow already uses)
    FS-->>AI: created WorkoutProgram + schedules
    AI->>AI: persist PlanAdoption {accessBasis, purchaseId}
    AI-->>R: the created program

    Note over R: R must complete a training cycle on the ADOPTED plan before reviewing it —<br/>hasCompletedCycleForPlan (unchanged eligibility gate).

    R->>AI: POST /marketplace/plans/:id/reviews {rating, comment, goalFit, difficultyFit, enjoyment, clarity, equipmentFit, timeFit, resultsPerception, wouldUseAgain, complaintTags[], freeText}
    AI->>AI: persist PlanReview (multi-dimensional, all new fields nullable/optional)
    AI->>AI: recomputeQualityScore(listingId) — plan-quality-scorer.ts, DETERMINISTIC, no AI
    AI-->>R: 201 review

    P->>AI: POST /marketplace/plans/:id/improvement-suggestions
    AI->>AI: computePlanQualityScore(reviews) + sample review freeText
    AI->>AI: LLM interpret -> Zod validate -> deterministic fallback on failure
    AI->>AI: persist PlanImprovementSuggestion
    AI-->>P: {suggestions[], summary}
    Note over AI: Advisory ONLY — moderationStatus is untouched. The AI never edits or<br/>publishes anything; verified by "never changes moderationStatus (no auto-publish)" test.

    opt Publisher acts on a suggestion
        P->>AI: POST /marketplace/plans/:id/republish {sourcePlanId?, changelog, improvementReason}
        AI->>AI: create a NEW PublishedPlan row {version: old+1, previousVersionId: old.id, moderationStatus: SUBMITTED}
        Note over AI: The OLD row is never mutated or deleted — every existing<br/>TrainingPackage/TrainingPackagePurchase/PlanAdoption referencing<br/>old.id keeps working exactly as before. New version re-enters<br/>moderation from scratch; never inherits APPROVED.
        AI-->>P: new PublishedPlan (SUBMITTED, pending re-approval)
    end
```

## Versioning — concretely, why old assignments stay stable

`republishVersion` (`marketplace.service.ts`) is an INSERT, never an UPDATE-in-place on the row a purchase/adoption/package points at. `TrainingPackage.publishedPlanId`, `TrainingPackagePurchase` (via the package), and `PlanAdoption.publishedPlanId` all reference a specific `PublishedPlan.id` — since that id's row is untouched by a republish, every historical reference continues to resolve to exactly the content it pointed at when created. `listVersionHistory` walks the `previousVersionId` chain (a recursive SQL CTE) plus any newer version pointing back, so a caller holding any version's id can discover the full lineage.

Verified directly by test (`marketplace-phase8.integration.test.ts`): *"republishVersion: creates a NEW row, never mutates the old one, and resets moderation to SUBMITTED"* — asserts the old row's `moderationStatus` and `version` are byte-identical after a republish.

## Deterministic quality score vs. AI improvement suggestions — the boundary

| | `plan-quality-scorer.ts` | `plan-improvement.service.ts` |
|---|---|---|
| Computes | `qualityScore` (0–1), `commonComplaints`, `difficultyFitDistribution`, `wouldUseAgainRate` | Free-text `suggestions[]` + `summary` |
| Method | Pure function, weighted average over answered review dimensions, no AI | LLM reads the scorer's OWN output + a bounded sample of review free-text |
| Can it publish/edit a listing? | No — read-only aggregation, cached on `PublishedPlan.qualityScore` | No — persists only to `PlanImprovementSuggestion`; the publisher must manually `republish` to act |
| Test evidence | 9/9 unit tests (`plan-quality-scorer.test.ts`) covering missing-dimension neutrality, complaint-driven penalty, [0,1] bounding | 12/12 unit tests (`feedback-analysis.test.ts` pattern) — same belt-and-braces conventions reused: deterministic fallback on LLM failure |

This mirrors the same rule the whole feature set follows end-to-end (see `docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md`'s "Không để AI tự bịa metric"): a rule engine computes every number; AI only ever interprets and explains.

## Multi-dimensional review — backward compatibility

`PlanReview.rating`/`comment` (the original two fields) are untouched — a client built before Phase 8 that only ever posts `{rating, comment}` continues to work exactly as before; every new dimension (`goalFit`, `difficultyFit`, `enjoyment`, `clarity`, `equipmentFit`, `timeFit`, `resultsPerception`, `wouldUseAgain`, `complaintTags`, `freeText`) is nullable and the aggregator treats a missing dimension as "not answered," never as a zero/negative signal (verified by `plan-quality-scorer.test.ts`'s "missing dimensions are never treated as a zero" test).

## Verified by test

- `marketplace-phase8.integration.test.ts` (ai-service, 8 tests, real DB) — versioning non-destructiveness, 403 for a non-owner republish, full version-lineage retrieval, 404 for adopting a non-APPROVED listing, 402 for adopting a package-gated listing without a purchase, quality-score recompute on review submission, 403 for a non-owner improvement-suggestion request, and the no-auto-publish guarantee.
- `plan-quality-scorer.test.ts` (ai-service, 9 tests, pure unit) — every scoring edge case.
