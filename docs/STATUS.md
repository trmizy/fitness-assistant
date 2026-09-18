# Work remaining and documentation policy

Updated 2026-09-07. This is the single continuation list, replacing scattered
root roadmaps, QA snapshots, overnight checkpoints, and superseded reports.
Code, migrations, and freshly run tests take precedence over historical claims.

## Active work

Nutrition changes are in the working tree, including PT review, an InBody
reassessment trigger, Smart Substitute variants with Vietnamese-region
personalization (region field, 4 substitute modes, and a real food-catalog
data-quality fix), a calorie safety-floor unification (a real 3-way
inconsistency — engine 1200 / PT-modify's old uncommented 800 / client
self-edit's total absence of a floor — fixed to one shared, existing
constant), and diet-break/maintenance-phase modeling (new
`PROPOSE_DIET_BREAK` adaptive decision, researched — Byrne et al. 2017
MATADOR study for the mechanism, general coaching guidance for the actual
cadence used, both cited and clearly labeled PRODUCT_HEURISTIC, never
claimed as a direct study citation — with matching cross-service (ai-
service) and frontend updates, since both had hardcoded decision-type
enums/maps that would have silently mishandled an unrecognized value) —
see [Nutrition](nutrition.md). The InBody trigger's
gating/notify logic (including a real concurrent-claim race, found and
fixed) and the Smart Substitute engine both now have passing integration-
test suites, not just source presence — `inbody-reassessment.integration.
test.ts` 13/13, `nutrition-food-substitution.engine.test.ts` 9/9,
`vietnamese-region-food.config.test.ts` 8/8. The fitness-service Food
catalog (13,159 USDA rows + Vietnamese aliases) is now actually seeded in
the test DB, which it wasn't before 2026-09-07 — see Nutrition.md for the
real alphabetical-match data-quality bugs this surfaced and fixed. Use
[Nutrition](nutrition.md) for the current source map, tests to run, and
outstanding work. Do not restart from the obsolete claim that PT review or
InBody reassessment has no implementation. Since the above: the diet-break
decision also got a PT-initiated manual trigger (`triggerDietBreakRecommendation`,
full stack, browser-verified against dev) and a client-facing "weeks until
eligible" progress indicator on TrainingCyclePage; the dev DB's 553 stale
`curated_vi_food_aliases` rows were deleted; and the Exercise/Equipment
catalog seed gap noted below under QA infrastructure is now fixed, not just
diagnosed — see that entry for detail.

## Follow-ups carried forward, not freshly verified

These preserve unresolved questions from old reports. Reproduce or inspect
current code before treating any item as an open defect.

- AI: live model safety/evaluation quality; retain deterministic guards and
  final plan validation. Recheck structured allergen filtering and the audit/
  quarantine workflow for old semantically invalid workout plans.
- Release assurance: provider sandbox E2E for SMS, signing, payments, refunds,
  escrow and ledger reconciliation; real vision ground-truth evaluation.
- QA infrastructure: rate-limit-related browser flakiness, slow Docker test
  builds, and host Prisma-engine file locking. Use current test scripts.
  The 2026-09-07 gap noted here previously (`scripts/prisma-test.mjs` never
  ran the Food/Exercise/Equipment seed scripts, so `equipment`/
  `exercise_equipment` were 0 rows on a fresh test DB) is now FIXED, not
  just diagnosed: `seedExercises()`'s skip guard now compares against
  `raw_exercises.json`'s own count instead of `> 0`, so a partial catalog
  self-heals instead of getting stuck forever; `seed_equipment.ts`,
  `seed_equipment_gap_exercises.ts`, `freeExerciseDbProvenanceImporter.ts`,
  and `exerciseMuscleMappingImporter.ts` (the latter two populate
  ExerciseSource/ExerciseMuscle, an adjacent gap the same investigation
  surfaced) are now chained into one idempotent `prisma/seed_all.ts`,
  wired as both `db:seed` and the `prisma.seed` config Dockerfile/
  Dockerfile.dev's `prisma db seed` step already runs — so this is no
  longer a manual, easy-to-forget step. Verified end-to-end against the
  test DB: 873/873 exercises mapped, 0 generic-machine fallbacks, all 34
  equipment-integrity tests pass, muscle-heatmap/exercise-history/
  exercise-progress/planned-vs-actual/activity-heatmap pass (their own
  hardcoded "real seeded exercise id" UUIDs — 5 files — went stale the
  moment the catalog was reseeded with fresh ids, since
  `Exercise.exerciseName` has no unique constraint to make ids stable
  across reseeds; fixed by looking the id up by name at test-setup time
  instead, in all 5). Same investigation also found and fixed a real
  production-deploy blocker unrelated to any of the above: the
  `20260907030000_agentic_fitness` migration.sql in fitness-service,
  ai-service, AND user-service each had a stray UTF-8 BOM as their very
  first byte, which is a hard Postgres syntax error under `prisma migrate
  deploy` (works under dev's `db push`, which ignores migration files
  entirely and explains why it went unnoticed) — both the production
  Dockerfiles use `migrate deploy`, so this would have failed every
  fresh deploy of all three services. BOM stripped from all three files
  (nothing had successfully applied it anywhere, confirmed before
  editing), migration re-applied cleanly to all three test DBs.
  Remaining, confirmed still separate and NOT touched by this fix: (1) a
  large shared-test-DB cross-file pollution issue — many integration
  tests create standalone Exercise/Food rows that never get cleaned up,
  so "every exercise has equipment/muscle data"-style integrity checks
  are inherently order/history-dependent in a persistent test DB, not
  something a seed fix can close; (2) `curated_vi_exercise_catalog` (the
  ~145-item Vietnamese exercise catalog from `newExerciseImporter.ts`,
  Gate 5/7) has never been imported into the test DB at all (only dev
  has it) — `exercise-muscle-map.integration.test.ts`'s
  "every canonical Vietnamese-catalog exercise ... resolves a primary
  muscle" test fails for that reason and did before this fix too; a
  separate, larger scope decision (STAGING-review workflow, convergence
  runs) than the base-catalog seed gap this fix closes.
- Personalized PT services: verify escrow/milestone/refund/concurrency coverage
  against current ledger code before following the old financial backlog;
  retain rating, system-message, hybrid-booking and service-discovery follow-ups.
- Advanced training: strategy labels, per-set prescription editor, and a
  deliberate policy for chain-aware drop-set/rest-pause analytics.
- Mobile: native Apple Health/Health Connect and release-build verification;
  web completion does not establish native integration support.
- Product: account deletion scope, workout settings, accessibility/language
  consistency, and loading/error/empty-state distinctions remain review topics.

## Historical records

The 2026-09-07 cleanup removed duplicate plans, completed-session reports,
temporary notes, old deployment snapshots, and old QA result dumps. Useful
operational sections were merged into their topic guide. A local ZIP outside
the repository preserves the pre-cleanup documents, including uncommitted
Nutrition reports. Previously committed versions remain available in Git:

```sh
git log --all -- path/to/old-document.md
git show 1e9e8ea:path/to/old-document.md
```

The second command applies only to files present at that revision. Uncommitted
reports require the local backup. Historical test numbers and environment
statuses do not establish current production readiness.

## Keep documentation small

- Start from [the documentation index](README.md).
- Update an existing topic guide instead of adding a report for each session.
- Record active follow-ups here; remove resolved items after verification.
- Keep component runbooks, scientific/license provenance, and design records
  still cited by code or migrations. File age alone is not a deletion reason.
- Treat retained audit/design records as historical unless checked against code.
- Keep credentials, generated schemas, temporary logs, and copied test output
  out of the documentation tree.
