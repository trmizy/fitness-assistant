---
name: gymini-roadmap-product-flow
description: Gymini's FitnessRoadmap/Journey product model and known current UX debt. Load when touching RoadmapJourneyPage, GuidedRoadmapWizard, Roadmap creation/activation, CycleAssessment UX, progress check-in, or Journey navigation.
---

# Gymini Roadmap Product Flow

The Roadmap **backend** is deep and mostly correct (see
`docs/GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_*.md`,
`docs/GYMINI_CYCLE_TRANSITION_*.md`). The **frontend** has real,
currently-observed UX debt — passing backend tests does not mean the
Roadmap UI is correct. Read `references/roadmap-ux-contract.md` for the
exact current bugs before touching `RoadmapJourneyPage.tsx`.

## The product model

```
NO ROADMAP
  -> guided fitness assessment -> analysis -> report -> Save DRAFT / Start

ACTIVE ROADMAP
  -> current real state (not the one-time creation report)
  -> current nutrition (from the live NutritionGoal, not the projection)
  -> current training (active phase/cycle)
  -> current updated forecast
  -> the original report/input still reachable, not lost
  -> progress/check-in

END OF CYCLE
  -> CycleAssessment -> recommendation -> next cycle/phase

COMPLETED
  -> actual final result vs. the original scenario -> new journey option
```

## Hard rule: "check progress" is not "advance the lifecycle"

`advanceRoadmap` is a lifecycle mutation that requires a legitimately
completed/evaluated `TrainingCycle`. A generic action such as "Xem tiến
độ" / "Cập nhật tiến độ" / "Kiểm tra tiến độ" must **never** blindly call
it. If the cycle isn't ready, show a real state/info/check-in UI — never
surface the raw backend rejection ("No completed cycle is ready for
roadmap advancement.") as if it were the intended UX.

**Currently NOT satisfied** — verified live in this exact code:
`RoadmapJourneyPage.tsx` (around the "Kiểm tra tiến độ" button) gates the
button only on "no ACTIVE cycle exists right now" and its `onClick`
calls `advanceMutation.mutate(roadmap.id)` directly — there is no
distinction between "a cycle is done and evaluated, safe to advance" and
"there's simply no active cycle yet for any other reason." See
`references/roadmap-ux-contract.md` for the fix contract (not to be
attempted without an explicit product task).

## ACTIVE Journey must not hide the creation context

The guided creation flow (Step 4: Báo cáo & Lộ trình) produces a real,
rich report — body composition, BMR/TDEE, activity assumptions, goal,
strategy, phase projections, reasoning. Once the roadmap is ACTIVE, that
context must remain discoverable, not become a one-time screen that
disappears after activation. The ACTIVE view should surface:

- initial/current body data
- goal
- BMR/TDEE where available
- **current calories/macros from the authoritative live `NutritionGoal`**
  — never the original projected numbers presented as if current
- current training frequency
- the original roadmap report (reachable, e.g. via a secondary
  disclosure — not a required always-visible block)
- the current, updated forecast (recomputed from real data, not the
  creation-time scenario)

**Critical distinction**: ACTIVE calories/macros come from the current
`NutritionGoal` (real, versioned, see `gymini-domain-source-of-truth`).
The projected/original calories from the creation report are historical
forecast data — secondary, never presented as "what you should eat
today."

## State-consistency rule

Never render simultaneously contradictory claims, e.g. "Chu kỳ 1/3" next
to "Giai đoạn này chưa có chu kỳ nào đang diễn ra" — unless the copy
itself makes the distinction explicit (a *planned/expected* cycle vs. an
*active* one). Before patching contradictory text:

1. Inspect the real API payload (network tab / `curl`), not the
   frontend's assumption of it.
2. Inspect the React Query cache — is this a stale read?
3. Inspect the actual backend DB state for that roadmap/phase/cycle.
4. Only then decide: backend lifecycle bug, frontend mapping bug, stale
   cache, legacy-data edge case, or a genuinely-needed copy fix.

Never fix contradictory state by rewording the text alone without first
identifying which of the four causes above it actually is.

## One ACTIVE Roadmap at a time

While a Roadmap is ACTIVE, do not offer an unguarded "Tạo lộ trình mới".
Prefer: Điều chỉnh mục tiêu / Xem báo cáo ban đầu / Cập nhật tiến độ /
Kết thúc·lưu trữ lộ trình. A genuinely new Roadmap begins only after the
existing lifecycle is handled per the backend's own rules (completed,
archived, or the single-DRAFT policy naturally supersedes a stale one).

## Creation flow — CTG-inspired, not CTG-copied

Conceptually inspired by CTG Fitness's 4-step shape (Thông tin cơ bản →
Tập luyện & Hoạt động → Mục tiêu → Báo cáo & Lộ trình), with real depth:
body composition, body-fat input methods, BMR/TDEE, activity
assumptions, goal body/image, target, FFMI where meaningful, strategy
groups, phase projections, calories/macros estimates, reasoning. Do
**not** copy CTG's branding/layout or duplicate its implementation.
Gymini stays adaptive: `CycleAssessment` can update the journey
mid-flight; forecasts are estimates, never promises (see
`gymini-fitness-science-guardrails`).

A few concrete, low-confidence signals from CTG Fitness's own public
landing page (`references/ctg-fitness-reference.md` — a marketing page,
not an authenticated in-app walkthrough, so treat as directional
inspiration only, never as a spec to copy verbatim): a short "vài phút"
intake framing before any account exists, plan copy centered on
Vietnamese food (not Western substitutes), a weight-range framing for
the goal ("88kg → 100kg" style), post-session check-ins as the main
adherence mechanic, and AI food-photo analysis for macro tracking.
Gymini's own model is intentionally more rigorous (a real deterministic
`CycleAssessment` engine, versioned `NutritionGoal`, real InBody
measurements) — pull UX/tone inspiration (accessibility, local framing,
low-friction intake) without reducing Gymini's own adaptive depth to
CTG's simpler model.

## Definition of correct behavior

- A user can always answer "where am I, what changed, what should I do
  next" from the ACTIVE Journey view alone, without reading raw JSON.
- No visible state contradicts another visible state on the same
  screen without an explicit explanation.
- A generic "check on my progress" action never silently mutates
  lifecycle state.
- Calories/macros shown as "current" always trace back to the live
  `NutritionGoal`, verifiable by checking `nutrition-goal-plan-
  consistency.service.ts`'s own output if in doubt.

## Common failure modes

- Treating "no ACTIVE cycle" as always meaning "ready to advance."
- Presenting the creation-time forecast as the current state after real
  data has since diverged.
- Fixing a copy/contradiction bug by editing only the JSX string instead
  of tracing the real payload first.
- Building a second, roadmap-specific NutritionGoal/forecast projection
  instead of reading the existing authoritative one.

See `references/roadmap-state-machine.md` for the full
Roadmap/Phase/TrainingCycle/CycleAssessment state graph and
`references/roadmap-ux-contract.md` for the itemized current-bug list
with file references.
