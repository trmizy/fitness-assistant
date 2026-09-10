# Gymini Training Information Architecture

Date: 2026-09-10
Scope: documents the Training-navigation simplification portion of the
Gymini Guided Roadmap Creation master task — collapsing `TrainingPage`'s
three equal-weight tabs down so `TrainingCycle` is no longer a top-level
concept, while keeping `TrainingCyclePage` fully intact as a drill-down.

## 1. Before

```text
/client/workout (TrainingPage, 3 equal tabs via TabbedPage)
├── "Nhật ký tập"        (WorkoutLogPage)
├── "Chu kỳ tập luyện"    (TrainingCyclePage)  <- equal-weight tab
└── "Lộ trình"            (RoadmapJourneyPage)
```

Problem (master task's own framing): `TrainingCycle` is an *execution/
evaluation* concept nested one level below `FitnessRoadmap`/
`RoadmapPhase` in the real data model (`RoadmapPhase` → `TrainingCycle[]`
→ `WorkoutSchedule`/`NutritionGoal` → `CycleAssessment`), but the old
navigation presented it as a co-equal sibling of the Journey tab — a
concept the user has to separately "know about" and switch to, even
though its content (current cycle progress, adherence, nutrition) is
naturally a sub-view of "where am I on my roadmap right now."

## 2. After

```text
/client/workout (TrainingPage, 2 tabs)
├── "Nhật ký tập"  (WorkoutLogPage — unchanged)
└── "Lộ trình"     (RoadmapJourneyPage)
      └── ActivePhaseDetail (inline current-cycle card):
            - start/end dates, nutrition snapshot, session progress
              (unchanged fields, already existed)
            - NEW: adherence rate, body-weight trend, strength-progress
              score — read from the SAME already-computed
              CycleAssessment.computedMetrics (CycleMetrics) that
              TrainingCyclePage itself reads; never re-derived, never a
              second calculation
            - NEW: "Xem chi tiết chu kỳ" link -> /client/workout/cycle
                    (TrainingCyclePage, full drill-down)

/client/workout/cycle  (NEW route, routes.tsx)
      -> TrainingCyclePage (component itself: zero changes, zero deletions)
```

`TrainingCycle` is now reached the way a genuinely secondary/detail
concept should be: inline summary first, explicit opt-in drill-down for
the full page (session-by-session history, volume charts, per-exercise
progression — everything `TrainingCyclePage` already did and still
does).

## 3. What Was Explicitly NOT Done

```text
TrainingCyclePage.tsx — NOT deleted, NOT modified. Every existing route/
  link/test that might reference it directly (there were none found via
  grep before this change) continues to work; it simply also gained a
  first-class URL (/client/workout/cycle) it never had before (it used
  to be reachable ONLY as a TabbedPage tab, with no direct route).
No backend change. TrainingCycle's own service/controller/routes,
  CycleAssessment, the Decision Engine, adherence/metrics computation —
  none of it was touched. This is purely a frontend navigation/
  composition change.
No new "cycle summary" API — ActivePhaseDetail's new inline metrics read
  fields that were ALREADY present on the data
  RoadmapJourneyPage's own query (getCurrent) already fetches
  (RoadmapPhaseWithCycles.trainingCycles[].latestAssessment.
  computedMetrics) — no new endpoint, no new query.
```

## 4. Why This Is Safe

```text
grep across the whole frontend + the external E2E harness for
  "page-tab-cycle" / "Chu kỳ tập luyện" before removing the tab: zero
  other references found — nothing else depended on that tab existing.
TabbedPage's active-tab state is plain local useState, not coupled to
  any query param or deep link — removing a tab entry from the array is
  a pure, local, side-effect-free change (confirmed by reading
  components/TabbedPage.tsx before making the change).
Bundle-size evidence that the split actually took effect (not just
  source-level): after the change, frontend build output shows
  TrainingCyclePage-*.js as its OWN lazy-loaded chunk (57.96 kB), and
  TrainingPage-*.js shrank from 326.35 kB to 270.28 kB — the removed
  tab's code is no longer bundled into TrainingPage at all, it now only
  loads when a user actually visits /workout/cycle.
E2E-verified live (see GYMINI_GUIDED_ROADMAP_E2E_REPORT.md
  TC-ROADMAP-001x): exactly 2 tabs render, the cycle tab id has zero
  matches, and /client/workout/cycle renders TrainingCyclePage without
  crashing or horizontal overflow, in a real browser against the real
  dev stack.
```

## 5. Data Ownership — Unchanged Invariant

This IA change is presentation-only. The underlying ownership rule this
whole roadmap subsystem has followed since phase 1 is untouched:
`TrainingCycle`/`WorkoutProgram`/`NutritionGoal`/`CycleAssessment` remain
the sole source of truth for actual prescriptions and progress metrics.
`ActivePhaseDetail`'s new inline metrics are a **read-only re-display**
of `CycleAssessment.computedMetrics` — never a new calculation, never
written anywhere, never presented as a `RoadmapPhase`-owned field.
