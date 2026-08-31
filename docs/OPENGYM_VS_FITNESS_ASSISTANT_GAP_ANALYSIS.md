# openGym vs Fitness Assistant — Gap Analysis (Workout/Training Domain)

> Read-only research + code audit deliverable. No source code copied from
> openGym (AGPL-3.0 — see License section below). Every "Fitness Assistant"
> column claim is grounded in a direct code/schema read on 2026-08-23, not
> assumed from design docs. Every openGym claim is grounded in its public
> README/feature description (via the canonical Gitea mirror, see Sources),
> not its source code. See `docs/OPENGYM_RESEARCH_SOURCES.md` for the full
> source list and `docs/TRAINING_PROGRESSION_ARCHITECTURE.md` for the design
> that follows from this analysis.
>
> Scope: **workout/training-progression domain only**, per the task that
> produced this document. Auth, admin, localization, muscle-map visualization,
> and multi-profile/passkey features of openGym are out of scope — Fitness
> Assistant already has its own (different, more elaborate) auth/RBAC system
> and those features aren't part of what this task is evaluating.

## License / clean-room implementation notes

- openGym's canonical home moved off GitHub: `github.com/DuarteSantos8/openGym`
  now 404s. The live project is at **`gitea.com/DuarteSantos/openGym`**.
  `github.com/arvids-unavailable/openGym`, named as a possible fork in the
  task brief, is confirmed to be a fork (5 commits, not kept in sync) — not
  used as the reference; the Gitea original was used instead.
- **Code license: AGPL-3.0.** Strong copyleft — the project's own docs state
  it "explicitly prohibits proprietary forks." Exercise metadata/instructions
  are separately MIT-licensed (`hasaneyldrm/exercises-dataset`); exercise
  images/animations are © Gym Visual under separate terms. Neither the MIT
  metadata nor the Gym Visual media is used by this task (Fitness Assistant
  has its own exercise catalog with its own separately-reviewed licensing —
  see `docs/research/fitness-data-source-and-license-review.md`).
- **Nothing was fetched or read below README/feature-list granularity.** No
  openGym source file, component, schema, or test was opened. Every openGym
  row below is a behavior/feature description, not a code reference.
- This repo already has a directly comparable precedent for the same
  situation: `docs/research/fitness-data-source-and-license-review.md` flags
  **LiftLog** (also AGPL-3.0) as "reference for UX/feature *patterns* only...
  never copy source code." The same rule is applied here.
- Everything implemented as a result of this analysis (see
  `TRAINING_PROGRESSION_ARCHITECTURE.md` and the implementation report) is
  written from Fitness Assistant's own existing conventions and data model,
  independently — not translated or adapted from openGym code, which was
  never read.

## openGym — feature/behavior summary (for reference only)

Self-hosted, privacy-first gym/bodyweight tracker (React 19 + Vite frontend,
Node.js backend, JSON-file storage, Docker Compose). Training-domain-relevant
behavior, as publicly described:

- Guided workout sessions that **prefill weights from the previous attempt**;
  freestyle mode does the same from history.
- Rest timer that **survives the app being closed** (via notifications) +
  **screen wake lock** during an active session.
- Exercise logging modes: standard weighted (reps×weight), bodyweight
  (reps-only, auto-detects load-carrying variations), timed (planks/hangs/
  carries by duration), cardio (time + speed), reps-per-side (unilateral).
- **Warm-up sets are excluded from progression/1RM calculations** by design.
- Supersets: created mid-session, paired/unpaired freely.
- **Five named progression policies**: linear, Greyskull LP (AMRAP + double
  jumps + 10% resets), double progression through a rep range, time addition
  (for timed exercises), bodyweight rep-climbing. Missed reps block load
  advancement; stall detection triggers an automatic deload.
- e1RM per exercise with its own progress curve; PR detection.
- Reschedule a workout without touching the underlying weekly plan.
- Import from FitNotes/Strong/Hevy/Apple Health exports; unrecognized
  exercise names become user-created entries.
- Full offline-capable PWA + a sideloadable Android APK.

## Gap matrix

| Capability | openGym | Fitness Assistant (code-verified 2026-08-23) | Status | Evidence in FA code | Gap | Recommendation | Priority |
|---|---|---|---|---|---|---|---|
| Previous-set/performance prefill | Prefills weight from last attempt, guided + freestyle | No per-exercise history endpoint found anywhere in `fitness-service/src/controllers` (only nutrition-goal history and exercise-catalog review history exist); `WorkoutLogPage.tsx` only shows `previousBestWeightKg` as a **PR comparison label**, not a prefill of actual last-session sets | **MISSING** | `fitness-service/src/controllers/*` (no history route); `WorkoutLogPage.tsx:4868` (`(trước: {pr.previousBestWeightKg}kg)` — PR context, not prefill) | Real, high-value gap — this is the single most impactful UX item per the task's own P0 list | Add a "last performance for this exercise" read path, surfaced as reference context in the logging UI, kept explicitly separate from any recommended target (per task instruction: previous performance ≠ recommended target) | **P0** |
| Deterministic per-exercise progression engine | 5 named policies, stall→deload, missed-reps block advancement | **Confirmed absent.** Exhaustive search for `progression`, `nextTarget`, `suggestedWeight`, `recommendedWeight`, `progressionPolicy`, `doubleProgression`, `linearProgression` across `fitness-service/src` returns **zero** matches outside test/engine files for the *cycle-level* (not exercise-level) engine | **MISSING** | grep across `fitness-service/src` (see checkpoint) | The training-cycle decision engine (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD) operates at the *program/cycle* level only — nothing translates that into "what should I lift today for this specific exercise" | Build a deterministic per-exercise progression engine, subordinate to the existing cycle decision (see architecture doc §Precedence) | **P0** |
| e1RM | Per-exercise, with progress curve, dedicated UI | `estimate1RM()` (Epley) exists, single source of truth, unit-tested (`estimated-1rm.util.test.ts`) — but only ever called from `computeE1rmTrend()` inside the **cycle metrics** aggregator (weekly-top per top-5-most-frequent exercises for a training-cycle report), not exposed as a general "current e1RM for exercise X" read | **PARTIAL** | `utils/estimated-1rm.util.ts`, `services/training-cycle-metrics.service.ts:159` | Formula choice is sound and well-justified (see `gym-fitness-research.md` §7 — Epley is the right default for the 2-10 rep range this app's sets mostly fall in); the gap is *exposure*, not correctness | Reuse `estimate1RM()` (do not duplicate) in the new progression/PR engine for a standalone per-exercise e1RM read | **P1** |
| PR detection | Detects PRs, implies multiple types given "per-exercise weight tracking" + progress curves | `computeNewPRs()` exists — **weight-only** (cycle-max weight vs all-time-before-cycle max per exercise name). No rep PR, volume PR, e1RM PR, duration PR, or distance PR | **PARTIAL** | `training-cycle-metrics.service.ts:188` | Real gap for exercises where load isn't the meaningful axis (bodyweight reps, planks, cardio) — a weight-only PR check can never fire for those | Add rep-PR and e1RM-PR alongside the existing weight-PR; duration/distance PR gated on the schema additions below | **P0** (rep/e1RM PR), **P1** (duration/distance PR, depends on schema work) |
| Bodyweight exercise semantics | Reps-only bodyweight mode; auto-detects load-carrying variations; dedicated bodyweight rep-climbing progression | `WorkoutSet.weight: Float?` is a single generic field. `EquipmentType.BODYWEIGHT` exists as an *equipment filter tag* only — nothing distinguishes "no added load" from "true zero," and there is no captured body weight at the time of the set | **MISSING** | `fitness-service/prisma/schema.prisma:20-30` (enum only), no `bodyWeightAtSetKg`/external-load split anywhere | Matches the task's own explicit warning (§16): don't store "pull-up weight = 0" and treat it as no resistance | Additive nullable fields, not a reinterpretation of `weight` (backward compatible) — see architecture doc | **P0** |
| Timed / cardio logging (duration, distance, speed) | Timed exercises by duration; cardio by time+speed | `WorkoutExercise.duration: Int?` exists ("seconds for holds/cardio") at the **exercise** level only — no per-set duration, and **zero** distance/speed/pace fields anywhere in `fitness-service/prisma/schema.prisma` (confirmed via targeted grep, only a false-positive comment match) | **PARTIAL** (duration) / **MISSING** (distance/speed) | `schema.prisma:209` (`duration Int?`); grep for distance/pace/speed on schema.prisma returns no real fields | Real, confirmed gap — cardio exercises (`ExerciseType.CARDIO` already exists as a taxonomy value) have no way to log distance or pace today | Additive per-set `durationSeconds`/`distanceMeters` fields | **P0** (schema), **P1** (full cardio UI) |
| Unilateral / reps-per-side | Reps-per-side field | `WorkoutSet.side: LEFT \| RIGHT \| BOTH` already exists (added in the advanced-set-logging pass) | **COMPLETE** | `schema.prisma:264`, `docs/advanced-set-logging.md` | None | Reuse as-is | — |
| Warm-up set exclusion from PR/e1RM | Explicit, by design | `WorkoutSet.setType` (`WARMUP`/`WORKING`/`TOP`/`BACKOFF`/`FAILURE`) exists in the schema, but `computeNewPRs`/`computeE1rmTrend`/`computeVolumeByWeek` do not filter on it at all — verified by reading the full function bodies, not assumed | **PARTIAL — low real-world impact today.** `advanced-set-logging.md` already documents that no UI path sets `setType` outside direct API calls, so in practice very few real rows carry `WARMUP` yet | Filter by `setType !== 'WARMUP'` when computing PR/e1RM in the new engine | Industry convention (not peer-reviewed), consistent with how this repo already classified "top set"/"back-off set" terminology in `advanced-set-logging.md` | **P1** — correct to fix while touching this code, not urgent on its own given near-zero current data impact |
| Rest timer | Persists through app close (notifications), wake lock | Exists (`WorkoutLogPage.tsx`) but is pure component `useState`/`setInterval` — no persistence across navigation/reload, no Wake Lock API usage anywhere in `frontend/web` (confirmed via grep), hardcoded 90s default (not per-exercise) | **PARTIAL — fragile** | `WorkoutLogPage.tsx:1972-2287` | Matches task's explicit worry: "Không để timer phụ thuộc hoàn toàn vào component local state nếu user chuyển screen" | Persist an end-timestamp (survives remount/reload), add Wake Lock as progressive enhancement (feature-detected, never a hard dependency) | **P0** |
| Superset | Create mid-session, pair/unpair freely | **Confirmed absent** — zero matches for "superset" anywhere in `fitness-service/src` | **MISSING** | grep, see checkpoint | Real UI + data-model scope (semantic grouping, not string hacks, per task §23) | Design only in this pass; too large to implement safely alongside the P0 items without its own dedicated review | **P1** |
| Reschedule (move a missed session without duplicating it) | Explicit feature | No `moveSchedule`/reschedule endpoint found; `schedule-lock.util.ts` only *locks* past dates, doesn't move sessions. `WorkoutSchedule.status` has no `SKIPPED` writer (already documented as a known gap in `docs/workout-log-audit.md`) | **MISSING** | grep across `fitness-service/src`; `docs/workout-log-audit.md` "Known Gaps" | Confirmed, and already self-documented as a gap before this task started | Out of scope for this pass's P0 (schedule-model change, cross-cuts `WorkoutSchedule.status` design already flagged as needing dedicated review) | **P1** |
| Offline PWA / Wake Lock infra | Full offline PWA + Android APK | No service worker, no `manifest.json` found anywhere under `frontend/web` (confirmed via file search) | **MISSING** | file search, `frontend/web` | Large scope (full PWA), Wake Lock alone is much smaller and folded into the rest-timer P0 item above | Document only; do not build full offline-first in this pass | **P2** |
| Import (Strong/Hevy/FitNotes/Apple Health) | Explicit importers | Not present | **MISSING** | — | Expected — this is explicitly P2 in the task's own priority scheme | Not started | **P2** |
| Muscle-group maps / activity heatmap | Three visualization modes + GitHub-style heatmap | Not found in fitness-service or frontend workout pages | **MISSING** | — | Visualization-only, no domain-correctness impact | Not started | **P2** |
| Multi-formula e1RM (support alternate formulas) | Not clearly stated in openGym's public description | Single formula (Epley), deliberately — see `estimated-1rm.util.ts`'s own doc comment | **DIFFERENT_BY_DESIGN** | `utils/estimated-1rm.util.ts` | None — see `gym-fitness-research.md` §7: Epley is well-justified for this app's typical 2-10 rep range; a very recent (2026, non-peer-reviewed preprint) alternative formula exists but is explicitly noted as not yet appropriate to adopt as a default | No change recommended | — |
| Training-cycle-level decision engine (macro KEEP/PROGRESS/ADJUST/DELOAD/REBUILD, safety flags, RAG evidence, LLM-explains-never-decides) | Not part of openGym's stated feature set (no cross-session adaptive coaching engine described) | **Already substantially more sophisticated than openGym's stated feature set** — 6-state decision engine, 5 independent insufficient-data gates, safety-flag detection (`HIGH_PAIN_SCORE`, `RISING_PAIN_TREND`, `SHARP_PERFORMANCE_DROP_WITH_HIGH_FATIGUE`), versioned `CycleAssessment` audit trail, LLM output always overridden by the deterministic decision (confirmed in `docs/TRAINING_CYCLE_DECISION_ENGINE.md` §5 and cross-checked against `cycle-decision.engine.ts`/`cycle-metrics.engine.ts`) | **COMPLETE / EXCEEDS** | `services/cycle-decision.engine.ts`, `services/cycle-metrics.engine.ts`, `docs/adaptive-training-cycle-evaluation.md` | None — this is the layer the new per-exercise engine must sit *underneath* (see architecture doc §Precedence), not something to rebuild | Reuse; do not duplicate | — |

## What this means, in priority order

**P0 (this pass's implementation target):**
1. Deterministic per-exercise progression engine.
2. Previous-performance-prefill (read path + UI surfacing).
3. PR engine: add rep-PR and e1RM-PR to the existing weight-PR.
4. Bodyweight/timed/cardio schema additions (additive, backward-compatible).
5. Rest-timer persistence rework + Wake Lock progressive enhancement.
6. Cycle/exercise progression precedence rule (the existing cycle engine must
   be able to cap what the new exercise engine proposes — see architecture doc).

**P1 (documented, not built this pass):** superset, reschedule, warm-up-set
filtering in PR/e1RM (low current impact), duration/distance PR types, full
cardio logging UI.

**P2 (documented, not built this pass):** offline-first PWA, Strong/Hevy/
FitNotes/Apple Health import, muscle-group maps/heatmap.

## Explicitly not re-audited this pass

Auth/RBAC, admin dashboard, localization, passkey/multi-device sync, nutrition
domain, PT/gym-owner flows — none of these are part of openGym's
training-domain feature set this task was scoped to compare against, and
Fitness Assistant's own auth/RBAC is a materially different (and, per prior
session docs, already production-hardened) system not being replaced.
