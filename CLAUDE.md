# Gymini Non-Negotiable Project Rules

Gymini (Fitness Assistant) is a pnpm-workspace monorepo:
`backend/services/{fitness-service,user-service,ai-service,auth-service,
chat-service,gym-service,payment-service}`, `backend/gateway`,
`frontend/web`. These rules apply to every session in this repo. Task-
specific procedures live in `.claude/skills/` and load only when
relevant — see the list at the bottom of this file.

## Investigate Before Editing

- Never speculate about source code that has not been inspected.
- Search/read the real implementation, schemas, APIs and tests first.
- `docs/*.md` reports are evidence/history, not current truth — code is
  authoritative. A report can describe a bug that was already fixed, or
  a design that was later superseded.
- Before broad implementation, determine root cause and which model
  actually owns the data in question.
- Do not implement UI guesses around an unknown backend state — read the
  real API response shape first.

## Git / Parallel-Agent Safety

- Always inspect `git status` / `git branch` / `git diff` / `git log`
  before edits.
- Claude Code and Codex may be working concurrently in this same working
  tree.
- Never overwrite unrelated working-tree changes.
- Never run `git reset --hard` or `git clean -fd`.
- Never force-push.
- Never commit unless explicitly requested.
- Treat another agent's active workstream as read-only unless a minimal,
  clearly-documented compatibility change is genuinely required to keep
  something building/running. See `gymini-parallel-agent-safety`.

## Scope Control

- Fix the actual requested problem.
- Do not invent adjacent features.
- Do not reopen a workstream a `docs/*_VERIFICATION_REPORT.md` marked
  VERIFIED/CLOSED unless new real evidence demonstrates a defect.
- Prefer the smallest architecture-consistent correction.
- P0/P1 findings may justify an immediate fix even outside the original
  ask. Large P2/product-expansion ideas must be documented (in a report,
  not silently built) before implementation. See `gymini-scope-control`.

## Source of Truth

Never create a second competing source of truth for any of these:

| Model | Owns |
|---|---|
| `UserProfile` | user demographic/profile context |
| InBody / measurements | measured body state |
| `FitnessRoadmap` | the long-term journey |
| `RoadmapPhase` | a strategic phase |
| `TrainingCycle` | one execution/evaluation block |
| `WorkoutProgram` | the training prescription |
| `WorkoutSchedule` | cycle-owned scheduled execution (the real program↔cycle link — `TrainingCycle.planId` is never written) |
| `Exercise.id` | canonical exercise identity |
| `NutritionGoal` | authoritative calories/macros |
| `NutritionProgram` | the meal-plan execution derived from a `NutritionGoal` (via `sourceGoalId`) |
| `CycleAssessment` | adaptive decision authority (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD) |
| `RecommendationAudit` / `CoachClientActionAudit` | audit/provenance |
| Forecast (`fitness-roadmap-forecast.engine.ts`) | a non-binding scenario only — never overwrites an actual measurement |

See `gymini-domain-source-of-truth` before adding any new field or
calculation that crosses these boundaries.

## User Isolation

- Every user-owned surface must be safe across logout/login/account
  switch.
- Backend authorization is not enough by itself: stale frontend
  cache/query state from the previous user must never remain visible.
- User-scoped React Query cache/local stores must be cleared or
  identity-scoped on account switch.
- Never trust a `userId`/`clientId` supplied by request body when the
  authenticated identity should be authoritative — every PT/coach
  mutation must re-verify the real relationship server-side, not trust
  a body param. See `gymini-account-session-isolation`.

## Testing Claims

Use exact evidence labels — never blur them:

`REAL BROWSER` · `REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`

- Never call code reading "E2E".
- Never call fixture preparation a real user flow.
- Never call a scoped regression run "full repository regression" —
  say which suites actually ran.
- Never mark something VERIFIED without the evidence to back it.
- Automated DB-backed tests use the isolated test-database convention
  (`*_test` / `postgres-test` DB, `FITNESS_DISABLE_REDIS=true` where
  applicable) — never mutate the dev/prod DB merely to make a test pass.

See `gymini-real-e2e-verification`.

## Product UX

- Design for normal users, not database entities — hide internal
  enums/IDs/domain terminology unless the user genuinely needs them.
- Avoid page explosion: prefer one primary workflow surface with
  drill-down detail over one page per backend entity.
- Mobile-first: check 360/375/390/412 on every touched surface.
- Preserve Gymini's existing dark/light theme tokens — no one-off
  hardcoded colors.

See `gymini-ui-information-architecture`.

## Available project skills

- `gymini-roadmap-product-flow` — Roadmap/Journey UX, creation flow, CycleAssessment UX, the current known Journey UX debt.
- `gymini-account-session-isolation` — auth, logout/switch, React Query cache, stale-user-data bugs.
- `gymini-domain-source-of-truth` — which model owns which value, before adding a field/calculation.
- `gymini-cross-system-journey` — any task crossing more than one service/domain in the client journey.
- `gymini-ui-information-architecture` — new/changed pages, tabs, navigation, mobile.
- `gymini-ai-workout-grounding` — AI workout generation, Exercise identity, equipment, substitution.
- `gymini-fitness-science-guardrails` — body composition, BMR/TDEE, calories/macros, forecasts.
- `gymini-real-e2e-verification` — any "test/verify/done/production-ready" request.
- `gymini-parallel-agent-safety` — dirty working tree, Codex mentioned, large multi-service change.
- `gymini-scope-control` — large/ambiguous requests, "continue everything", audits.
