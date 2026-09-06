# Product Completeness Pass — Impact Analysis

Date: 2026-09-01

Scope: Settings Center + Exercise/Food/Nutrition/Muscle Library + Help/About/Data
Management + navigation discoverability. This is a **product-shell** pass on top
of an already-feature-complete engine layer (P0–P4 OpenGym roadmap CLOSED per
`docs/OPEN_GYM_ROADMAP_CLOSURE.md`; Advanced Training Methods and AWS Lambda
foundations landed most recently, `6d5e223`). Nothing here restarts or
duplicates that work — it wires existing engines into browsable, settable
product surfaces.

All findings below are verified against current code (git HEAD `6d5e223`), not
docs, per the instruction that code+runtime+tests are the source of truth
where they disagree with any report.

---

## 1. Current navigation structure

Frontend is a Vite + React 18 SPA (`frontend/web`), `react-router` v7 data
router, single route tree in `frontend/web/src/app/routes.tsx`. No file-based
routing, no i18n framework (custom runtime auto-translate via
`useAutoTranslate`/`<AutoText>`, not static catalogs).

- **Desktop sidebar**: `components/layout/Sidebar.tsx` — role-aware nav array
  (`clientNavFull`, `ptWorkspaceNav`, `gymOwnerNav`, `adminNav`). Client has 9
  items today (Dashboard, InBody, Kế hoạch AI, Tập luyện, Dinh dưỡng, Dịch vụ,
  Trò chuyện, Ví, Hồ sơ).
- **Topbar**: `components/layout/Topbar.tsx` — theme/language switches,
  notification bell (real backend-backed), user dropdown. The dropdown's
  **"Cài đặt" (Settings) button exists but is a dead stub** — no `onClick`,
  no route (line 456-458). This is the literal gap PC1 closes.
- **Mobile bottom nav**: `components/layout/BottomNav.tsx` — 5 fixed slots for
  client (Dash/Tập/Ăn/Chat/Hồ sơ), hidden entirely for admin/gym_owner. PT-in-PT
  view gets its own 5 slots. There is no "More" tab today.
- Client-only route namespace `/client/*` already has 10+ leaf pages that are
  functionally "settings" or "library" pages but are surfaced only as link-out
  cards from `ProfilePage`, never from a dedicated hub: `training-equipment`,
  `import-workouts`, `export-data`, `templates`, `muscle-heatmap`,
  `activity-heatmap`, `notification-preferences`.

**Decision**: do not add bottom-nav slots. Fix the dead Topbar "Cài đặt"
button to route to `/client/settings`; add "Cài đặt" and "Khám phá" to the
Sidebar client nav (desktop + drawer, which is also how mobile users reach
non-bottom-nav destinations today — `Topbar`'s hamburger opens the same
`Sidebar` drawer on small screens per `AppShell.tsx`); keep the existing
ProfilePage link-out cards but re-point the ones that are true "settings" at
the new Settings Center sections instead of their standalone routes (routes
themselves stay alive/unbroken — Settings Center links into them where a
dedicated sub-page already earns its keep, e.g. Notification Preferences,
Export/Import, Training Equipment).

## 2. Current Profile vs Settings overlap

`ProfilePage.tsx` (856 lines) mixes three concerns today:
1. Fitness/body facts — weight journey, height/weight/DOB/gender, goals,
   activity level, experience, diet, injuries. **This stays in Profile.**
2. Account-ish display — name/email shown read-only, avatar upload.
3. Settings-shaped link-out cards — equipment, import, export, templates,
   muscle heatmap, activity heatmap, notification preferences.

**Rule applied for this pass** (per spec §6): Profile = fitness/body facts.
Settings = app/account/preferences. Concretely:
- Avatar upload and name editing move under Settings → Account (Profile keeps
  a read-only summary card linking to Settings → Account, since photo is also
  shown in Profile's weight-journey header — no data duplication, one
  `profileService` call backs both).
- The equipment/import/export/templates/heatmap/notification-preferences
  link-out cards on ProfilePage are **not removed** (they're real, working
  entry points other flows already deep-link to); Settings Center adds its
  *own* entry points to the same routes so both surfaces are internally
  consistent, and ProfilePage's cards get a short "or manage in Cài đặt"
  pointer rather than being duplicated as separate implementations.

## 3. Current user preference storage — ground truth

| Preference | Storage today | Scope |
|---|---|---|
| Theme (dark/light) | `localStorage["fitness-assistant.theme"]` via `SettingsContext.tsx` | device-local only, **not** account-scoped |
| Language (vi/en) | `localStorage["fitness-assistant.language"]` via `SettingsContext.tsx` | device-local only |
| Units (kg/lb, cm/ft-in, km/mile) | **Does not exist.** `utils/units.ts` has pure conversion functions used only by the onboarding wizard to accept ft/in/lb *input*, converted to canonical cm/kg immediately. No persisted preference anywhere, frontend or backend. | N/A |
| Energy unit (kcal/kJ) | **Does not exist.** kcal-only everywhere in fitness-service schema. | N/A |
| Workout behavior (rest timer, RPE/RIR display, smart prefill) | **Does not exist as settings** — all hardcoded/always-on in the 8953-line `WorkoutLogPage.tsx`. Wake Lock is always-attempted progressive enhancement. Rest duration is sourced from the program prescription, not a user default. | N/A |
| AI Coach style/verbosity | **Does not exist anywhere** (grepped both user-service and ai-service — zero hits). Coach persona is a single hardcoded string in `ai-service/src/llm/prompt_builder.ts`. | N/A |
| Notification preferences | **Real, persisted, working.** `NotificationPreference` model, user-service, 5 boolean fields, `GET/PUT /notifications/preferences`. | Account-scoped (Postgres) |

**Implication for PC1**: theme/language are the only "preferences" with any
persistence today, and they're deliberately device-local (a reasonable
existing choice — no backend field, no endpoint). The spec asks to avoid
localStorage-only for *account-scoped* preferences unless justified; keeping
theme/language as localStorage is justified (device display preference, zero
data sensitivity, already shipped/working, changing its storage model is out
of scope and would be a gratuitous rewrite of a working feature). **Units and
Energy unit are new, genuinely account-scoped preferences** (a user's
kg-vs-lb choice should follow them across devices) — these get a real backend
field (see §9).

## 4. Existing notification preference model

`user-service/prisma/schema.prisma` `NotificationPreference` (PK `userId`):
`workoutUpcomingEnabled`, `workoutRescheduledEnabled`,
`workoutUnfinishedEnabled`, `planUpdatedEnabled`, `ptFeedbackEnabled` — exactly
5 booleans, all wired end-to-end (in-app + realtime socket push only; **no
email/SMS/native push delivery exists for any notification type**, confirmed
in `auth-service/src/services/email.service.ts` — only used for OTP/register).
14 other event types (`CONTRACT_*`, `SESSION_*`) exist in the
`NotificationEventType` enum but are **deliberately never gated** by any
preference (code comment, `notification.service.ts:28-33` — always sent, no
opt-out designed). `NotificationPreferencesPage.tsx` already renders a clean
UI for the 5 real types. **PC1 action**: reuse this page as-is inside Settings
→ Notifications (link-in, not reimplemented) since it is already correct and
complete for what the backend actually supports; do not invent toggles for
the 14 non-gated types.

## 5. Existing unit/display preferences

None (see §3). New minimal backend field required — see §9.

## 6. Current exercise catalog APIs

`fitness-service`, mounted at `/exercises`:

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /exercises` | search/list, filters: `search, bodyPart, muscleGroup, equipment, activityType, type, ids`, paginated (`page`,`limit`, default 30/max 100) | Always `status:PUBLISHED, source:SYSTEM` — USER_CUSTOM never leaks in. No `difficulty`/`loggingMode` filter today (gap, additive). |
| `GET /exercises/filter-options` | distinct bodyParts/equipments/activityTypes/types/muscleGroups | legacy `muscleGroupsActivated` taxonomy, not canonical `Muscle` table |
| `GET /exercises/muscles` | canonical `Muscle` taxonomy (`code, nameVi, nameEn, anatomyRegion, parentMuscleId`) | this **is** the Muscle Library's data source |
| `GET /exercises/:id/muscle-map` | real primary/secondary `ExerciseMuscle` breakdown for one exercise | |
| `GET /exercises/:id` | single exercise, bare scalar row (Redis-cached 300s) | no `include` — aliases/equipment/sources need separate calls or a new richer detail endpoint |
| `GET /exercises/:id/substitute` | equipment-aware substitute (auth) | |
| `GET /exercises/custom`, `POST /exercises/custom`, `DELETE /exercises/custom/:id` | owner-scoped USER_CUSTOM CRUD | never public |

**Verdict: sufficient to build Exercise Library + Detail without new backend
work**, with one small additive gap: the bare `GET /exercises/:id` doesn't
include aliases/equipment, so Exercise Detail needs 2-3 parallel calls
(`GET /exercises/:id`, `GET /exercises/:id/muscle-map`, and reuse
`GET /exercises/exercise-progress` history APIs for the personal section) —
acceptable, matches "prefer composition over new endpoints" (§31).

## 7. Current food/nutrition APIs

Real `Food` model exists (`fitness-service`, 13k+ USDA rows: `fdcId, name,
calories, protein, carbs, fats, source, foodForm, isSupplement,
realisticServingMaxG`) plus `FoodAlias`/`FoodSource`. **But only
`GET /food/search?q=` exists** — no list/browse/paginate, no `GET /food/:id`,
no category field on `Food` at all (no food-group taxonomy exists in the
schema — confirmed, not just unexposed). Meal logging (`NutritionLog`) is
free-text, not FK'd to `Food` (explicit code comment: "we do NOT recompute
macros" from Food). Calorie/macro targets are a real deterministic engine
(`ai-service/src/llm/nutrition_calculator.ts`, stored via `NutritionGoal`,
`goalMode: RECOMMENDED|CUSTOM`) with **user override already shipped**
(`PUT /nutrition/goals`) — Settings must not re-invent this, only surface a
toggle for macro-detail *display*, never a calorie-target override path (§10
constraint upheld).

**Verdict: Food Library needs two small new backend endpoints** —
`GET /food` (paginated browse/list) and `GET /food/:id` — both trivial reads
off the existing `Food` table/repository (`food.repository.ts` already has
`searchByName`; adding `findMany`/`findById` is additive, no schema change).
No food-group filter is buildable (no source-of-truth field) — per §18/§26,
do not invent a classification; ship search + basic sort only, document the
category filter as a data gap, not a UI gap.

## 8. Current muscle APIs/data

Real dedicated tables: `Muscle` (`code, nameVi, nameEn, anatomyRegion,
parentMuscleId`) + `ExerciseMuscle` (`exerciseId, muscleId, role`), seeded
from `data/catalog/taxonomy/ref_muscles.csv` (29 real muscle codes — chest,
upper_chest, mid_chest, lower_chest, front_delts, side_delts, rear_delts,
triceps, biceps, forearms, lats, upper_back, mid_back, traps,
spinal_erectors, abs, obliques, transverse_abs, glutes, quads, hamstrings,
adductors, abductors, calves, hip_flexors, rotator_cuff, cardiovascular,
mobility, core). `GET /exercises/muscles` lists them;
`GET /exercises/:id/muscle-map` gives per-exercise breakdown (invertible for
"exercises that train muscle X" by filtering the full exercise list against
this, or — cheaper — a new light aggregation query). `GET /stats/muscle-heatmap`
(auth, `range=7d|30d|cycle|custom`) computes **real weighted set-volume per
muscle** for "sets this week" style personalization — reusable as-is for
Muscle Detail's personalized section. **No planned-vs-actual muscle exposure
exists** (only actual) — documented as deferred, not built (would require a
new aggregation joining `WorkoutSchedule`/`WorkoutProgramExercise` through
`ExerciseMuscle`, out of scope for this pass, real backend work).

**Verdict: Muscle Library list page needs one new small endpoint** —
"exercises by muscle" (`GET /exercises?muscleId=` or a dedicated
`GET /exercises/muscles/:id/exercises`) since today's muscle filter on
`GET /exercises` only matches the *legacy* `muscleGroupsActivated` string
array via a hardcoded alias dict, not the canonical `ExerciseMuscle` table —
using it for Muscle Detail's "related exercises" would silently miss/mismatch
exercises that only have canonical mappings. This is the one real gap.

## 9. Reusable components

- `components/settings/ThemeToggle.tsx`, `LanguageSwitcher.tsx` — reused
  as-is inside Settings → Appearance (not reimplemented).
- `pages/client/NotificationPreferencesPage.tsx` — reused as the Settings →
  Notifications section body.
- `pages/client/ExportDataPage.tsx`, `ImportWorkoutsPage.tsx` — reused as
  Settings → Privacy & Data's Export/Import entry points (link-in, no logic
  copy).
- `pages/client/TrainingEquipmentSettingsPage.tsx` — reused as Settings →
  Workout's equipment sub-entry.
- `utils/units.ts` — the kg/lb/cm-ft-in conversion functions are reused
  directly for the new Units settings' live preview and for library page
  display formatting (still frontend-only conversion at the display
  boundary, canonical storage stays cm/kg — spec §8 upheld).
- Existing pagination/search UI patterns (`AdminCatalogQuality.tsx`,
  `PTDiscoveryPage.tsx` use debounced search + query-string params) are the
  template for Exercise/Food Library search — no new pattern invented.

## 10. Missing backend endpoints (full list, all additive/non-breaking)

| New endpoint | Service | Purpose | Risk |
|---|---|---|---|
| `PATCH /profile/me/preferences` (or extend `PUT /profile/me`) | user-service | persist `unitSystem` ("metric"\|"imperial") + `energyUnit` ("kcal"\|"kj") on `UserProfile` | low — 2 new nullable-with-default scalar columns, additive migration |
| `GET /food` | fitness-service | paginated food browse (name sort, no category filter — none exists) | low — read-only, reuses `Food` table |
| `GET /food/:id` | fitness-service | food detail | low |
| `GET /exercises/muscles/:muscleId/exercises` | fitness-service | canonical-mapping-correct "exercises that train muscle X", paginated | low — read-only join query over existing `ExerciseMuscle` |

No endpoint touches money flow, contracts, or any P0-P4 engine logic. No
existing endpoint's contract changes (all additive).

## 11. Privacy implications

- Exercise Library/Detail: must keep `source:SYSTEM` gate (never list another
  user's `USER_CUSTOM` exercises) — reuse the exact same visibility predicate
  already used by `GET /exercises` and `statsService.getExerciseProgress`
  (`source:"SYSTEM" OR (source:"USER_CUSTOM" AND ownerId===callerId)`).
- Food Library: `Food` rows are global reference data (USDA), no per-user
  ownership — no privacy gate needed beyond standard auth.
- Muscle Library: same — global taxonomy, but the *personalized* "sets this
  week" section on Muscle Detail must scope to the caller's own `userId`
  (reuses `GET /stats/muscle-heatmap`, which already does this).
- Settings → Privacy & Data: confirmed **no safe scoped-deletion capability
  exists** end-to-end today (`DELETE /profile/me` only deletes the
  `UserProfile` row + fire-and-forget AI-conversation cascade; it leaves the
  auth-service login credential, fitness data, contracts, payments, and chat
  history untouched — not a real "delete account"). Per spec §13 ("do not
  invent a delete action if backend does not support safe scoped deletion"),
  this pass **documents the gap and exposes only what's real** (link to the
  existing `DELETE /profile/me` labeled accurately as "xoá dữ liệu hồ sơ" with
  an explicit note of what it does NOT delete, not a "Delete Account" button
  implying full account removal) — building true cross-service account
  deletion is flagged as follow-up work, out of scope here.

## 12. Actor visibility

Settings Center and Library pages are built for **CLIENT first**, matching
the existing `/client/*` route namespace and `AppShell`. PT accounts already
get the client nav/shell when `activeView==="client"` (`ptClientNav =
clientNavFull`), so PT-as-client automatically gets Settings/Discover for
free with zero extra wiring — verified via `Sidebar.tsx` logic. PT's own
workspace nav (`ptWorkspaceNav`), gym-owner, and admin navs are **not**
touched by this pass; their own Settings/Library needs (if any) are declared
out of scope and left for a future pass, per spec §27's explicit instruction
to make this explicit rather than force a shared shell.

## 13. Mobile navigation constraints

Bottom nav is a hard 5-slot layout (`BottomNav.tsx`), already saturated with
daily-use actions. No slot is added. New entry points route through: (a) the
Sidebar drawer (opened by Topbar hamburger on mobile — already responsive),
(b) the fixed Topbar user-avatar dropdown (always rendered, all breakpoints),
(c) ProfilePage link-out cards. This matches spec §4's explicit instruction
not to create a dozen bottom-nav tabs, and reuses an already-mobile-proven
drawer pattern instead of inventing a new "More" tab that doesn't exist in
the current shell.

## 14. Implementation plan (priority order, per spec §38)

| # | Milestone | Backend work | Frontend work |
|---|---|---|---|
| PC1 | Settings Center | +2 `UserProfile` columns, 1 endpoint | `SettingsPage` + 8 section components, fix Topbar stub, Sidebar entry |
| PC2 | Exercise Library + Detail | none (compose existing) | `ExerciseLibraryPage`, `ExerciseDetailPage` |
| PC3 | Food Library + Detail | +2 endpoints (`GET /food`, `GET /food/:id`) | `FoodLibraryPage`, `FoodDetailPage` |
| PC4 | Nutrition Knowledge Library | none (new static content module, no schema) | `NutritionKnowledgePage`, `NutritionArticlePage` + curated content file |
| PC5 | Muscle Library + Detail | +1 endpoint (`GET /exercises/muscles/:id/exercises`) | `MuscleLibraryPage`, `MuscleDetailPage` |
| PC6 | Help/About/Data Management | none | About/Help sections inside Settings (§15), no separate pages needed |
| PC7 | Discover landing + nav integration | none | `DiscoverPage`, Sidebar/Topbar wiring |

Each milestone ships with its own unit/integration/E2E coverage and a short
implementation-report doc, then the status board (`docs/PRODUCT_COMPLETENESS_ROADMAP.md`)
is updated — matching this repo's established one-PR-per-roadmap-row
convention (see `docs/OPEN_GYM_ROADMAP_CLOSURE.md` history).

## 15. Known deliberate deferrals (documented, not silently dropped)

- **AI Coach settings**: no backend preference model exists and building one
  correctly (persona verbosity without ever weakening deterministic
  progression/deload/safety rules, per spec §12) is nontrivial product work.
  This pass ships the section as informational-only ("AI luôn tuân theo giáo
  án và an toàn tập luyện; không có tuỳ chọn ảnh hưởng đến quyết định") with
  no live toggle, rather than fabricate a setting the backend can't honor.
- **Connections** (Apple Health / Health Connect / Garmin / Fitbit): all
  native-blocked per `docs/OPEN_GYM_ROADMAP_CLOSURE.md`. Section ships as
  "Sắp có" (Coming later), non-interactive, per spec §14.
- **Delete account**: real UI exposes only the real, narrow, existing
  `DELETE /profile/me`, labeled for what it actually does. Full cross-service
  account deletion is out of scope (§11 above).
- **Workout settings**: only toggles with real, safely-implementable backing
  behavior ship (RPE/RIR display visibility; end-workout confirmation).
  Rest-timer default duration and smart-prefill on/off are **not** exposed
  this pass — they're threaded through an 8953-line `WorkoutLogPage.tsx` in
  ways that would require careful surgery beyond this pass's budget; shipping
  a toggle that silently doesn't change behavior would violate spec §9's
  explicit rule, so they're left off rather than faked.
- **Muscle planned-vs-actual exposure**: no aggregation exists; Muscle Detail
  ships actual-only (reusing the heatmap endpoint), planned comparison
  flagged as follow-up.
- **Global search**: no cross-service search pattern exists anywhere in the
  codebase today. Per spec §25, MVP stays per-library search; no cross-library
  search engine is built.

---

## Addendum — closing state (2026-09-01)

This pass ran with a second session working the same plan concurrently in
the same worktree; both converged on the same file layout because both
read this document and `routes.tsx` as they were written. Two findings
above were superseded by real work landed during implementation, recorded
here rather than silently edited into the sections above:

- **§6/§11 "no change-password endpoint exists"**: superseded. A real,
  authenticated `PATCH /auth/me/password` now exists
  (`backend/services/auth-service`) — verifies the current password,
  stores a fresh bcrypt hash, and revokes all refresh tokens for the
  account on success. Settings → Account exposes it. Email change and full
  cross-service account deletion remain not implemented, unchanged from
  the original analysis.
- **§15 "rest-timer default duration and smart-prefill on/off ... left off
  rather than faked"**: partially superseded. A real fallback rest-timer
  duration and a real Screen Wake Lock on/off both landed, wired into
  `WorkoutLogPage.tsx` at the same call sites this document identified.
  Smart-prefill on/off remains unimplemented, as originally assessed.

See `docs/PRODUCT_COMPLETENESS_ROADMAP.md` for the final status board and
`docs/features/SETTINGS_CENTER_IMPLEMENTATION_REPORT.md` /
`docs/features/CONTENT_LIBRARY_IMPLEMENTATION_REPORT.md` for the
implementation reports.

---

Next: PC1 Settings Center implementation.
