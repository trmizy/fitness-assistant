# Content Library Implementation Report

Date: 2026-09-01

## Third pass follow-up (2026-09-01) - Food filters

Checked the previous implementation: macro sort was already present, but
existing-column filters were not. Added `GET /food/filter-options` and
`GET /food` filters for `source`, `foodForm`, and `isSupplement`, all backed by
populated fields on the existing `Food` table. `/client/foods` now renders
source, form, and supplement dropdowns in browse mode.

Food group/category remains deferred because no real taxonomy field exists.
New food integration coverage: 10/10 passing in `gymcoach-fitness-dev`.

## Summary

Added the client Discover/Library surfaces:

- `/client/library`
- `/client/exercises`
- `/client/exercises/:id`
- `/client/foods`
- `/client/foods/:id`
- `/client/learn/nutrition`
- `/client/learn/nutrition/:slug`
- `/client/muscles`
- `/client/muscles/:id`
- `/client/search`

## Data Sources

- Exercise Library uses the existing `Exercise` catalog through `GET /exercises`.
- Exercise Detail composes existing exercise detail, muscle-map, and history
  endpoints.
- Food Library and Food Detail use the existing `Food` table through new
  additive read-only endpoints, `GET /food` and `GET /food/:id`.
- Nutrition Knowledge uses static versioned content in
  `nutritionKnowledge.ts`; it is not generated live by an LLM.
- Muscle Library uses the existing canonical muscle taxonomy endpoint.
- Muscle Detail uses a new read-only `GET /exercises/muscles/:muscleId/exercises`
  endpoint backed by canonical `ExerciseMuscle` mappings.
- Global Search reuses the exercise catalog search, food search, muscle
  taxonomy, and static nutrition articles; it does not create a second catalog
  or live-generated knowledge source.

## Privacy And Visibility

- Public exercise browse and muscle-related exercise lists expose only
  `PUBLISHED` + `SYSTEM` exercises.
- Food and muscle catalog data are global reference data.
- Personalized muscle exposure reuses the existing authenticated muscle heatmap
  endpoint and stays scoped to the current user.

## Verification

- Fitness-service build passed.
- Food and muscle library integration tests passed: 8/8.
- Browser desktop verified Discover, Exercise list/detail, Food list/detail,
  Nutrition Knowledge list/detail, and Muscle list/detail.
- Browser mobile verified the drawer entry points and Settings layout.
- Docker web image was rebuilt after dependency drift was found in the stale
  container; `http://localhost:5173` now opens without the previous Vite import
  overlay.

## Deferred

- Food group/category filters.
- Planned-vs-actual muscle exposure aggregation.

## Follow-up (2026-09-01)

- `FoodDetailPage`, `NutritionKnowledgePage`, `NutritionArticlePage`,
  `MuscleLibraryPage`, `MuscleDetailPage`, and all 12 curated
  `nutritionKnowledge.ts` articles were originally written in English,
  inconsistent with every other client-facing page in this app (including
  the rest of this pass's own Settings Center). Rewritten to Vietnamese to
  match. No `data-testid`s, route slugs, or data shapes changed — the new
  `fitnessassistant-playwright-e2e/tests/20-product-completeness.spec.ts`
  suite (11/11 real-browser tests) was re-run afterward and stayed green.
- Added `fitnessassistant-playwright-e2e/tests/20-product-completeness.spec.ts`
  — independent, automated, real-browser verification of every surface in
  this report plus the Settings Center (see
  `docs/PRODUCT_COMPLETENESS_ROADMAP.md`'s "Independent Playwright
  verification" section for the full test list and how to run it).

## Second pass follow-up (2026-09-01) — closing §16/§17/§18/§23 gaps

The original impact analysis correctly flagged these as real, additive gaps
rather than deferrals; closed in the same session:

- **Exercise Library**: `GET /exercises` gained `difficulty` and
  `loggingMode` filters (both real, previously-unfiltered columns);
  `GET /exercises/filter-options` now returns their distinct values so the
  two new dropdowns are backend-driven.
- **Exercise Detail**: `GET /exercises/:id` now additionally includes
  `aliases` (`ExerciseAlias`) and `sources` (`ExerciseSource`, carrying
  `dataLicense`/`mediaLicense`) — spec §17's "Aliases if available" /
  "Media/license attribution", previously populated in the DB but never
  read by any endpoint.
- **Food Library**: `GET /food` gained `sortBy=protein|carbs|fats` — spec
  §18's real, computable "protein-rich/carb-rich/fat-rich" allowance,
  explicitly kept separate from the still-deferred category/food-group
  filter (no taxonomy field exists for that).
- **Muscle Detail**: new `SingleMuscleMap.tsx` (sibling to
  `ExerciseMuscleMap.tsx`, same `body-muscles` library) replaces the
  text-only region label with a real front/back SVG visualization — spec
  §23's "Body location visualization".

New tests: `exercise-library-filters.integration.test.ts` (6, real dev DB),
3 more added to `food-library.integration.test.ts`, and Playwright
TC-PC-012–TC-PC-015. Full suite: 15/15 passing.

## Fourth pass follow-up (2026-09-01) - Global Search

Added `/client/search?q=...` and a client topbar search box. Results are grouped
by real existing sources: exercise catalog API, food search API, muscle taxonomy
API, and static nutrition articles. Each result routes to the existing detail
surface instead of duplicating domain data.

## Fifth pass follow-up (2026-09-01) - Discover media enrichment

The Discover page now previews real catalog content instead of only linking to
four library sections. It pulls media-backed exercises via `hasVideo=true`,
image-backed foods via `hasImage=true`, nutrition articles from the static
knowledge module, and muscles from the canonical taxonomy endpoint. Exercise
cards, exercise detail, and global search now render media frames from the
existing `Exercise.videoUrl` field.

## Sixth pass follow-up (2026-09-01) - Media-first browsing controls

Added library filters for media-backed browsing: `Co media` on exercises and
`Co anh` on foods. Exercise detail previews now alternate between the two real
exercise frame images when available, so the page shows a lightweight movement
demo without fabricated video.
