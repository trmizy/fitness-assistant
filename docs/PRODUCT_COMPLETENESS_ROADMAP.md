# Product Completeness Roadmap

Date: 2026-09-01

This pass adds stable product surfaces on top of the existing Fitness Assistant
engines: Settings Center, Discover/Library, Exercise/Food/Nutrition/Muscle
library pages, and route-level navigation discoverability.

| Feature | Backend | UI | E2E | Status |
|---|---|---|---|---|
| Settings Center | Existing profile/auth/notification/export APIs reused; unit/energy fields added to `UserProfile` | `/client/settings` with modular sections | Desktop + mobile drawer verified | COMPLETE |
| Account Settings | Existing `PATCH /auth/me`; new authenticated `PATCH /auth/me/password`; no fake email/account-delete controls | Editable display name, read-only email, password change, logout | Settings page + auth tests verified | PARTIAL |
| Appearance | Existing local theme/language context | System/light/dark and language controls | Settings page verified | COMPLETE |
| Units | `unitSystem`, `energyUnit` persisted on profile | Metric/imperial and kcal/kJ controls | DB persistence verified, seed restored | COMPLETE |
| Workout Settings | Local active-workout preferences only | RPE/RIR visibility, fallback rest duration, wake-lock toggle + equipment entry | Settings page + hook test verified | PARTIAL |
| Nutrition Settings | No new deterministic target override | Macro display toggle only | Food UI verified | COMPLETE |
| Notifications | Existing `NotificationPreference` model reused | Entry to real notification preference page | Settings page verified | COMPLETE |
| Privacy/Data | Existing export/import and scoped profile deletion reused | Export/import links; accurate scoped delete label | Settings page verified | PARTIAL |
| Exercise Library | Existing `GET /exercises` reused; added real `difficulty`/`loggingMode` query filters (§16's "difficulty filter if real"/"logging-mode filter") | `/client/exercises` search/filter/list, with difficulty + logging-mode dropdowns | Browser + integration verified | COMPLETE |
| Exercise Detail | Existing catalog, muscle-map, history/progress APIs reused; added `aliases`/`sources` (media/data license) to `GET /exercises/:id` (additive) | `/client/exercises/:id`, shows aliases + data-source/license attribution when present | Browser + integration verified | COMPLETE |
| Food Library | New read-only `GET /food` over existing Food table; added real `sortBy=protein\|carbs\|fats` (§18's "protein-rich/carb-rich/fat-rich") | `/client/foods` browse/search/list + macro sort | Browser + integration verified | COMPLETE |
| Food Detail | New read-only `GET /food/:id` over existing Food table | `/client/foods/:id` | Browser + integration verified | COMPLETE |
| Nutrition Knowledge | Static versioned content module (Vietnamese) | `/client/learn/nutrition` and article detail | Browser verified | COMPLETE |
| Muscle Library | Existing `GET /exercises/muscles` reused | `/client/muscles` | Browser verified | COMPLETE |
| Muscle Detail | New canonical `ExerciseMuscle` related-exercise endpoint; real body-location SVG visualization (reuses body-muscles + the existing muscle-region map, §23's "Body location visualization") | `/client/muscles/:id` | Browser + integration verified | COMPLETE |
| Global Search | Existing exercise/food/muscle APIs plus static nutrition articles reused | `/client/search` and client topbar search | Build verified | COMPLETE |
| Help/About | No fake legal docs | Sections inside Settings | Browser verified | PARTIAL |

## Follow-up Gaps

- Full cross-service delete-account flow is not implemented.
- Email change is not implemented.
- AI Coach style preferences are not implemented because no safe preference
  model exists yet.
- Native health integrations remain coming-later and non-interactive.
- Food category/group filters need a real taxonomy field before UI filters can
  be honest (protein-rich/carb-rich/fat-rich sort IS implemented — it's
  derivable from Food's own numeric columns, unlike a category label).

## Second pass (2026-09-01, same day) — closing remaining §16/§17/§18/§23 gaps

The first pass's own impact analysis flagged these as real, additive,
low-risk gaps rather than deferrals — closed in a follow-up:

- **Exercise Library difficulty/logging-mode filters** — `GET /exercises`
  gained `difficulty` (case-insensitive match on the real advisory
  `difficultyLevel` column) and `loggingMode` (validated against the 5 real
  values) query params; `GET /exercises/filter-options` now also returns
  `difficultyLevels`/`loggingModes` distinct-value lists so the UI dropdowns
  are backend-driven, not hardcoded.
- **Exercise Detail aliases + media/license attribution** — new
  `exerciseRepository.findByIdWithDetails` (separate cache key from the
  existing `findById`, so `getMuscleMap`'s lighter lookup is untouched)
  includes real `ExerciseAlias`/`ExerciseSource` rows; the detail page shows
  a "Tên khác" line when aliases exist and a "Nguồn dữ liệu & bản quyền"
  section with each source's `dataLicense`/`mediaLicense`.
- **Food Library protein/carb/fat sort** — `GET /food` gained
  `sortBy=protein|carbs|fats` (descending, real Prisma `orderBy` on Food's
  own columns) — deliberately kept separate from the still-deferred
  food-group/category FILTER, which would need a real taxonomy field that
  doesn't exist.
- **Muscle Detail body-location visualization** — new
  `SingleMuscleMap.tsx` component (sibling to the existing
  `ExerciseMuscleMap.tsx`, reusing the same `body-muscles` library and
  `MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS` mapping) renders a real front/back
  SVG body chart highlighting the muscle, replacing the earlier text-only
  region label.

## Third pass (2026-09-01, same day) - Food Library existing-column filters

Checked the current state after the previous pass: macro sorting
(`sortBy=protein|carbs|fats`) was already implemented. The missing part was
filtering by fields that already exist on `Food`, without inventing a food
taxonomy/category.

- `GET /food/filter-options` now returns real distinct `source` and `foodForm`
  values from the database, plus the boolean supplement values.
- `GET /food` now supports `source`, `foodForm`, and `isSupplement` query
  filters, all backed by existing `Food` columns and counted with the same
  where clause as the page results.
- `/client/foods` now shows source, form, and supplement filters in browse
  mode and sends those filters to the backend.

The deferred food-group/category filter remains deferred until the database has
a real taxonomy field. This pass only exposes honest filters from columns that
already exist and are populated.

New backend test coverage added to `food-library.integration.test.ts`: filter
options, source/form filtering, and supplement filtering.

New backend tests: `exercise-library-filters.integration.test.ts` (6 tests)
and 3 added to `food-library.integration.test.ts`'s existing file — all
passing against the real dev DB. New Playwright coverage: TC-PC-012 through
TC-PC-015 (see the verification section below) — 15/15 passing.

## Fourth pass (2026-09-01, same day) - Global Search

Added a real global search surface without introducing another catalog or
search index:

- `/client/search?q=...` groups results from existing sources: `GET /exercises`
  with its catalog search, `GET /food/search`, `GET /exercises/muscles`, and
  static versioned nutrition articles.
- The client topbar now has a search box in client workspace that routes into
  `/client/search`.
- Results link to the existing detail pages for exercises, foods, nutrition
  articles, and muscles.

## Verification

- `pnpm --filter @gym-coach/web build`
- `pnpm --filter @gym-coach/auth-service build`
- `pnpm --filter @gym-coach/auth-service exec tsx --test src/__tests__/login-and-refresh.test.ts`
- `pnpm --filter @gym-coach/fitness-service build`
- `pnpm --filter @gym-coach/user-service build`
- `pnpm --filter @gym-coach/web exec tsx --test src/app/utils/units.test.ts`
- `pnpm --filter @gym-coach/web exec tsx --test src/app/hooks/useWorkoutSettings.test.ts`
- `pnpm --filter @gym-coach/user-service exec tsx --test src/__tests__/profile.models.unitPreferences.test.ts`
- `.env`-loaded `pnpm --filter @gym-coach/fitness-service exec tsx --test src/__tests__/food-library.integration.test.ts src/__tests__/muscle-library.integration.test.ts`
- Playwright CLI desktop pass against `http://127.0.0.1:5174`
- Playwright CLI mobile pass against `http://127.0.0.1:5174 --mobile`
- Docker web image rebuilt and smoke-opened at `http://localhost:5173`

Unit conversion coverage passed through the file's intended `node:test` runner:
14/14 passing.

## Independent Playwright verification (2026-09-01, follow-up)

A separate verification pass added `fitnessassistant-playwright-e2e/tests/20-product-completeness.spec.ts`
— 11 real-browser test cases against the live dev stack (all services + web,
freshly restarted so `tsx watch` picked up every edit; seed catalog
confirmed present: 1002 exercises, 13,159 foods). One real login via the
existing `newAuthenticatedPage`/storageState cache (no extra `/auth/*`
budget spent). All 11/11 passing on the final run:

| Test | What it proves |
|---|---|
| TC-PC-001 | All 11 Settings sections render, zero console errors |
| TC-PC-002 | Units toggle genuinely changes ProfilePage's cm↔ft-in display (not decorative) — restores account to metric afterward |
| TC-PC-003 | Workout RPE/RIR switch genuinely flips `aria-checked` |
| TC-PC-004 | Discover landing links to all 4 libraries |
| TC-PC-005 | Exercise Library search ("squat") + detail page against the real 1002-exercise catalog |
| TC-PC-006 | Food Library browse + detail against the real 13,159-row USDA catalog |
| TC-PC-007 | Nutrition Knowledge list + "Protein" article render (static content) |
| TC-PC-008 | Muscle Library "chest" detail shows real related exercises via the canonical `ExerciseMuscle` mapping |
| TC-PC-009 | Desktop Sidebar exposes Settings + Discover |
| TC-PC-010 | 390×844 mobile: no horizontal overflow on Settings/Library/Muscles; mobile drawer exposes Settings |
| TC-PC-011 | Regression — ProfilePage and the Workout page (both structurally edited by this pass) still load cleanly |
| TC-PC-012 | Exercise Library `loggingMode=TIME` filter genuinely narrows the result set (non-zero, ≤ unfiltered) |
| TC-PC-013 | Exercise Detail's "Nguồn dữ liệu & bản quyền" section renders real `ExerciseSource` data |
| TC-PC-014 | Food Library "Nhiều protein nhất" sort genuinely changes the top result vs. default name sort |
| TC-PC-015 | Muscle Detail's body-location visualization renders a real SVG (not just a text label) |

Run with:
```
cd fitnessassistant-playwright-e2e
npx tsx prepare-run.ts && npx playwright test tests/20-product-completeness.spec.ts
```

Final clean run: 15/15 passing. Independently confirmed post-run: the seed
account (`john.doe@example.com`) was left at `unit_system=metric,
energy_unit=kcal` in the real dev DB — the test's own restore-to-metric step
verified via direct `psql` query, not just trusted.

**Flakiness encountered while iterating (all environmental, not product
bugs, each root-caused before moving on)**: a cached Playwright storageState
JWT (`.auth-state/`) went stale twice across the session's real elapsed
time — fixed by deleting the cached file so `ensureStorageState` does one
fresh login (see `fixtures/authState.ts`); the gateway's general 100 req/min
rate limiter was tripped once by rapid repeated full-suite runs in this same
session, not by the product itself (see the existing
`auth-rate-limiter-15min` note this repo already carries); one run hit a
Windows/Chromium `net::ERR_NETWORK_IO_SUSPENDED` blip unrelated to the app.
None of these reflect a real defect — each was diagnosed against direct
`curl`/`docker logs` evidence before being dismissed as environmental.

## Fifth pass (2026-09-01, same day) - Discover media enrichment

Addressed the Discover/Library experience feeling sparse and text-only by
surfacing real media that already exists in the catalog:

- `GET /exercises` now supports `hasVideo=true`, backed by the existing
  `Exercise.videoUrl` column. In the dev DB, 873 of 883 published SYSTEM
  exercises currently have media URLs.
- `GET /food` now supports `hasImage=true`, backed by the existing
  `Food.imageUrl` column. In the dev DB, 39 foods currently have cached image
  URLs.
- `/client/library` is now a real preview hub instead of only four navigation
  cards: media-backed exercises, image-backed foods, nutrition articles, and
  muscle taxonomy entries.
- `/client/exercises`, `/client/exercises/:id`, and `/client/search` now render
  exercise media frames when `videoUrl` is present, with a plain fallback when
  it is not.

## Sixth pass (2026-09-01, same day) - Media-first browsing controls

- `/client/exercises` now has a `Co media` toggle backed by
  `GET /exercises?hasVideo=true`.
- `/client/foods` now has a `Co anh` toggle backed by
  `GET /food?hasImage=true`.
- Exercise detail media now alternates between the two real frame images when
  both frame URLs exist, giving the demonstration a lightweight motion preview
  without inventing video content.

## Seventh pass (2026-09-01, same day) - Rest timer feedback settings

- Workout Settings now includes `Am bao het gio nghi` and `Rung khi het gio
  nghi`, persisted in the same local workout-settings store as RPE/RIR,
  default rest duration, and wake lock.
- `WorkoutLogPage` now triggers browser sound/vibration feedback exactly once
  when the rest timer reaches zero. Both APIs are feature-detected and
  fail-soft, so unsupported browsers keep normal timer behavior.

## Eighth pass (2026-09-01, same day) - Smart prefill setting

- Workout Settings now includes `Dien san thong minh`, persisted in the local
  workout-settings store.
- `WorkoutLogPage` now respects that setting: when disabled, it restores real
  user drafts as before and keeps prescription defaults, but skips
  previous-performance/progression driven smart prefill and does not show the
  smart-prefill source label.
