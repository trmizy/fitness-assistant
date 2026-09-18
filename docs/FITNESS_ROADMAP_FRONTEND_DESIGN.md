# FitnessRoadmap Frontend Design ("Fitness Journey")

Date: 2026-09-09
Scope: `frontend/web`
Status: Design + implementation (Phase C, STEP 9) — built and production-build
verified; **not** live-browser-tested this pass (§6, honest gap).

## 1. What Was Audited First

```text
Framework:        React 18 + Vite 6 + react-router 7
Styling:          Tailwind v4, written directly against dark-mode zinc
                   classes (bg-zinc-900, text-zinc-400, ...) — NOT via
                   `dark:` variants. Light mode is achieved for free by
                   frontend/web/src/styles/theme.css overriding the zinc
                   CSS-variable scale itself, so writing normal zinc/green
                   classes (as every existing page already does) already
                   supports both themes with zero extra work.
State/data:       @tanstack/react-query (queryKey arrays, useMutation +
                   invalidateQueries), zustand elsewhere (not needed here).
API client:       axios instance in services/api.ts; every service is a
                   plain object of typed async functions wrapping api.* —
                   trainingCycleService is the closest existing analogue.
Toasts:            sonner (toast.success/toast.error).
Icons:             @phosphor-icons/react, aliased on import
                   (e.g. `SparkleIcon as Sparkles`) — existing convention.
Navigation:        TabbedPage groups related pages under one nav entry as
                   pills — TrainingPage already does this for "Nhật ký tập"
                   / "Chu kỳ tập luyện".
Existing analogue: TrainingCyclePage.tsx (short-term cycle detail/decision
                   UI) — its card/badge/progress-bar Tailwind patterns are
                   reused directly for visual consistency, not reinvented.
```

**Decision**: add "Lộ trình" (Journey) as a third tab inside the existing
`TrainingPage` (alongside "Nhật ký tập"/"Chu kỳ tập luyện") rather than a
new top-level nav entry — reuses existing navigation exactly as the master
task's §6.7 instructs, and keeps the short-term (cycle) and long-term
(roadmap) views one tap apart, which matches how they're actually related
in the data model (`RoadmapPhase 1→N TrainingCycle`).

## 2. What Was Built

```text
frontend/web/src/app/pages/client/RoadmapJourneyPage.tsx  (new)
frontend/web/src/app/pages/client/TrainingPage.tsx         (+1 tab)
frontend/web/src/app/services/api.ts                       (+fitnessRoadmapService, +types)
```

Component breakdown inside `RoadmapJourneyPage.tsx`:

```text
RoadmapJourneyPage    — root: loads /fitness-roadmaps/current, routes to one
                         of the states below by roadmap.status / 404
NoRoadmapState         — "you have no roadmap yet" + two CTAs (AI / manual)
AiDraftPanel           — goal + timeframe + optional goal-image -> generate
                         -> review (summary/phases/warnings/assumptions) ->
                         accept (creates DRAFT, then immediately activates)
ManualCreatePanel      — quick-start form: name/goal/one starting phase ->
                         create + activate
PendingRebuildBanner   — shown when projection.pendingRebuild is set ->
                         preview proposal -> apply
ActivePhaseDetail      — active phase's active cycle: dates, latest
                         ACTIVE NutritionGoal calories/protein, workout
                         schedule completion count — all read from the
                         real projection response, nothing computed/faked
                         client-side
PhaseTimeline          — full phase list with status dot/color + dates +
                         cycle-completion count per phase
```

## 3. States Covered (master task §6.3, §22)

```text
loading            — spinner
no roadmap (404)   — NoRoadmapState
DRAFT               — "activate" CTA
ACTIVE              — timeline + active phase detail + pending-rebuild banner
COMPLETED           — trophy banner + "start a new roadmap" CTA
ARCHIVED            — read-only banner + "start a new roadmap" CTA
CANCELLED           — read-only + "start a new roadmap" CTA (same as ARCHIVED)
AI draft loading    — button spinner inside AiDraftPanel
AI draft failed     — surfaced via toast.error (mutation onError) + the
                       panel simply lets the user retry — no crash/broken
                       state
insufficient data   — the deterministic AI-draft fallback (confidence 0)
                       is rendered as an explicit amber notice inside the
                       draft review, not hidden
REBUILD pending      — PendingRebuildBanner
```

Error handling: the root query distinguishes a real 404 ("no roadmap yet",
a normal, expected state — never shown as an error) from any other error
(shown with a retry button), matching the master task's explicit "loading
states / empty states / API errors" requirement.

## 4. Reuse Discipline (master task §2 hard invariant)

The page never renders or edits calories/macros/exercises directly — it
only ever displays fields already coming from `NutritionGoal`/
`WorkoutSchedule` inside the roadmap projection response (`activeCycle.
nutritionGoals`, `activeCycle.schedules`), and the only roadmap-specific
mutations it calls are the lifecycle actions
(`create/activate/advance/rebuild-preview/rebuild-apply/archive`) — never a
nutrition or workout write endpoint. `ManualCreatePanel`'s "starting
phase" only sets `phaseType`/duration/objective (roadmap-phase orchestration
fields), never a calorie or exercise value.

## 5. Optional Goal Image (Phase D hook, wired end-to-end)

`AiDraftPanel` has an optional file input that calls the **already
existing** `fitnessAgentService.image()` (→ `POST /ai/agent/goal-image`,
`fitness-goal-vision.service.ts` — not built or modified by this pass). If
the result's `usable` flag is `false` (or the call fails), the panel shows
a plain "ảnh không dùng được" note and continues normally without the
image — the flow is fully usable with zero images. If usable, the returned
`{ muscularity, relativeLeanness, focusMuscles }` is passed straight
through as `goalVisualAttributes` on the `generateAiDraft` call, with an
explicit on-screen note that it is "chỉ mang tính gợi ý, không phải số đo
cơ thể" (style hint only, never a body measurement) — matching the vision
service's own disclaimer verbatim.

## 6. Testing Performed — And What Was NOT Done (honest)

```text
npx vite build   -> PASS, 0 errors, 0 new warnings beyond pre-existing
                    chunk-size notices (TrainingPage's chunk grew from
                    280.83 kB to 305.44 kB, expected for one new page)
```

**Not done this pass, reported honestly rather than claimed**: a live,
browser-driven walk-through of the actual running app (create → AI draft →
accept → activate → view active phase → pending-rebuild → complete) was
**not** performed. Doing so needs the gateway container restarted with the
new `/fitness-roadmaps` proxy rule (backend/gateway/src/routes/
proxy.routes.ts) and a running frontend dev/preview server behind a
logged-in test user — a real, non-trivial additional setup step this pass
did not take, to avoid either skipping it silently or rushing it. The
production build passing is real evidence the code compiles and bundles
correctly; it is not evidence of correct runtime behavior in the browser.
Recommended next step: restart `gymcoach-gateway-dev`/`gymcoach-web-dev` (or
run `pnpm dev` locally) and manually walk the flow once, or drive it with
the project's E2E harness (`fitnessassistant-playwright-e2e/`).

## 7. Responsive / Theme

No custom breakpoints or `dark:` classes were introduced — every class used
is one already used across the app's existing pages (`p-4 md:p-6`,
`grid-cols-2 sm:grid-cols-3`, `flex-col sm:flex-row`), so it inherits the
same mobile-first responsive behavior and automatic light/dark support
(§1) as every other page, by construction rather than by a separate
verification pass. This was not independently re-verified at 360/375/390/
412px in an actual browser this pass (same honest caveat as §6).
