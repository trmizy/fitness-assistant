# 08 — Module Readiness

Scope: every business module found in the repository. A module is not assumed to exist because a schema or a route file exists.

Status per module: `READY_WITH_GAPS`, `NOT_READY`, `PARTIAL`, `LEGACY_DEAD_CODE`, or `RESEARCH_ONLY`.

| Module | Status | Gaps |
|---|---|---|
| Authentication | NOT_READY | G-01, G-02, G-05, G-06, G-07 |
| Profile and onboarding | PARTIAL | Profile fields and defaults; `sessionDurationMinutes` defaults to 60 (research caveat) |
| InBody measurements | NOT_READY | Destructive migration history (G-04); day-boundary tests missing |
| Workouts (self-service and AI plans) | PARTIAL | Equipment validation gap (below); idempotent import verified by schema |
| Training cycles and roadmap | PARTIAL | Active-invariants enforced in DB; end-to-end runtime tests not in this audit |
| Nutrition | PARTIAL | Goal invariant in SQL (G-27); concurrency tests (P4-T03) |
| Coach (PT) | PARTIAL | Relationship re-check verified in code; runtime isolation not tested (G-24) |
| Marketplace | PARTIAL | Withdraw owner check verified; other mutations not traced (G-24) |
| Chat and calls | PARTIAL | Socket participant check verified; call authorization not traced |
| Conversational Intelligence | PARTIAL | Default off; LLM bypass of flag (G-17) |
| Payments | PARTIAL | MoMo and VNPay verified; PayOS, ZaloPay and money flows unverified (G-23) |
| Wallet | NOT_VERIFIED | Not traced |
| Gym management and partners | PARTIAL | Internal secret handling (G-10); membership plan scoping migration (destructive history, G-04) |
| Booking | NOT_VERIFIED | `user-service` booking availability migration exists; flows not traced |
| Membership | NOT_VERIFIED | Gym-service membership plans; flows not traced |
| Admin | PARTIAL | Gateway-enforced admin (G-08); AI admin router guarded |
| Notifications | NOT_VERIFIED | `notification.client.ts` in fitness; provider not traced |
| Uploads | NOT_VERIFIED | `/imports` (15 MB) and image uploads (6 MB); content validation not traced |
| Exercise catalog | PARTIAL | Shared cache (G-29); catalog hygiene tools in `scripts/` |
| Knowledge / RAG | PARTIAL | Qdrant availability (G-19) |
| Mobile app | PARTIAL | SecureStore for tokens (verified); cache clearing on logout (verified); other flows not traced |
| Web app | PARTIAL | Token storage not verified; cache clearing not verified (see checklist) |
| Research BPM benchmark | RESEARCH_ONLY | Not part of product |

## Equipment-compliance gap (product, not research)

Equipment validation (`validateAiPlanExerciseEquipment`) runs only on the AI generation path. Self-service and coach-created manual programs
pass existence and ownership checks, not equipment checks (documented in `gymini-ai-workout-grounding` and `docs/GYMINI_PT_COACHING_INTEGRATION_GAPS.md` #10).
This is a product decision, not an audit finding to change silently. It must be decided before launch and recorded.

## Exercise catalog integrity

- `Exercise.id` is the canonical identity (documented). Persistence validates ids through `validateExerciseIds`.
- `USER_CUSTOM` visibility is enforced in the reference resolver (`exercise-reference-resolver.service.ts` `visibilityWhere`) and in history
  reads. Shared cache risk: G-29.
- Duplicate normalised names are not merged automatically (documented decision; not a bug).

## Legacy and dead code candidates

- Lambda entrypoints (G-36).
- Demo paths in payment and agentic services (G-36).
- `training/`, `reports/`, root cost JSON (G-35).

## Decision list for the owner

1. Equipment gating for manual programs (product).
2. Conversational Intelligence in the first release (product and risk).
3. Payment providers in the first release (product).
4. Whether booking, membership, notifications and uploads are in the first release.
