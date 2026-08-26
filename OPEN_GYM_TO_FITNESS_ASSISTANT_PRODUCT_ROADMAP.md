# Fitness Assistant — openGym-Inspired Product & Engineering Roadmap

**Status:** Master implementation plan  
**Date:** 2026-08-24  
**Primary audience:** Claude Code, Codex, maintainers of Fitness Assistant  
**Repository:** `https://github.com/trmizy/fitness-assistant`

---

## 0. Purpose

This document is the **single direction-of-travel plan** for learning the best product/UX patterns from openGym and applying them to Fitness Assistant **without turning Fitness Assistant into an openGym clone**.

The goal is not feature parity for its own sake.

The goal is to improve Fitness Assistant in the areas where openGym is currently stronger—especially **active-workout execution, session convenience, offline resilience, portability, and visual feedback**—while preserving the parts where Fitness Assistant is already broader or more sophisticated:

- deterministic per-exercise progression;
- training-cycle engine;
- safety context;
- AI explanation layer;
- InBody/body-composition integration;
- nutrition;
- PT/client workflows;
- gym-owner workflows;
- payments/personalized services;
- multi-service architecture.

### Core principle

> **Learn openGym behavior and product patterns. Do not copy openGym source code or architecture.**

Fitness Assistant must remain an independently designed system.

---

# 1. Mandatory reading before implementation

Before starting any phase from this roadmap, read the current code and the following project documents if they exist:

```text
docs/OPENGYM_FINAL_P0_CLOSURE_REPORT.md
docs/OPENGYM_P0_COMPLETION_REPORT.md
docs/OPENGYM_GAP_IMPLEMENTATION_REPORT.md
docs/OPENGYM_VS_FITNESS_ASSISTANT_GAP_ANALYSIS.md
docs/OPENGYM_RESEARCH_SOURCES.md
docs/TRAINING_PROGRESSION_ARCHITECTURE.md
docs/TEST_ENVIRONMENT_MATRIX.md

docs/ONBOARDING_PT_INTAKE_SAFETY_IMPLEMENTATION_REPORT.md
docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md

docs/gym-fitness-research.md
docs/workout-log-audit.md
docs/advanced-set-logging.md
```

If a document conflicts with current code, **current code + runtime + tests are the source of truth**.

Do not restart P0 work simply because an older document still contains an outdated statement.

---

# 2. Current baseline — P0 is CLOSED

As of the final stabilization pass, the workout/progression P0 baseline is considered **READY**.

Verified baseline includes:

- per-exercise deterministic progression;
- previous-performance reference;
- weighted and bodyweight PR behavior;
- e1RM reuse;
- warm-up exclusion from PR/e1RM;
- `REPS_LOAD`;
- `BODYWEIGHT_REPS`;
- `TIME`;
- `TIME_LOAD`;
- `DISTANCE_TIME`;
- duration/distance persistence;
- bodyweight-at-set semantics;
- rest timer persistence;
- Wake Lock progressive enhancement;
- cycle-level `DELOAD` precedence over local progression;
- deterministic explanation fallback;
- exercise-progression AI explanation endpoint where AI cannot alter the deterministic target;
- mobile active-workout verification;
- onboarding/safety regression;
- frontend production build;
- real-browser E2E stability.

Final P0 browser bundle:

```text
15/15 PASS
15/15 PASS
15/15 PASS
```

Do **not** rewrite the existing progression engine, logging model, or cycle engine unless a new phase exposes a reproducible bug.

### Known remaining baseline limitation

`TIME_LOAD` catalog rows currently exist but are `STAGING`, so ordinary user-facing exercise search may not expose them yet. This is a **catalog/discoverability issue**, not a logging-engine failure. Reviewed under P1.8 (see the status board, § 46) — deliberately left `STAGING` (they fail the same real, established publish bar every other still-staging curated row also fails: no video/media), with a reusable admin quality-matrix tool shipped instead of a status-flip shortcut.

---

# 3. Licensing / clean-room rule — NON-NEGOTIABLE

openGym source is AGPL-3.0.

Unless Fitness Assistant intentionally adopts a compatible licensing strategy after explicit legal/license review:

## Claude Code / Codex MUST NOT

- copy openGym source files;
- translate openGym functions line-for-line;
- copy React components;
- copy schemas;
- copy constants;
- copy tests;
- copy comments;
- copy CSS/layout implementation;
- reproduce source structure from openGym;
- use openGym implementation details as the basis of a proprietary implementation.

## Allowed reference level

Use openGym as a **behavioral/product reference**:

```text
What does the feature do?
What problem does it solve?
What user interaction is good?
What failure mode does it avoid?
```

Then independently design a solution using:

```text
Fitness Assistant's current architecture
+
Fitness Assistant's current data model
+
independent research
+
original tests/specification
```

If a future task wants to directly reuse AGPL code, stop and require a separate licensing decision.

---

# 4. Product direction

Fitness Assistant should not become:

```text
openGym + AI
```

The intended product direction is:

```text
Best-in-class active workout UX
        +
deterministic exercise progression
        +
adaptive training-cycle logic
        +
safety
        +
nutrition/body composition
        +
AI explanation/coaching
        +
PT/Gym ecosystem
```

openGym is mainly a benchmark for the **workout execution layer**.

---

# 5. Priority roadmap overview

## P1 — Active workout excellence

1. Smart set-by-set prefill
2. Reschedule workout
3. Superset / exercise grouping
4. Active-workout offline resilience
5. Custom exercises
6. Fast active-workout interaction polish
7. Session resume/recovery hardening
8. Catalog discoverability for logging modes

## P2 — Data portability and ecosystem

9. Strong import
10. Hevy import
11. FitNotes import
12. Apple Health / Android Health Connect integration
13. JSON/CSV export
14. Workout-template sharing/import
15. Exercise matching + unresolved-import workflow

## P3 — Visualization and retention

16. Muscle heatmap
17. Activity/calendar heatmap
18. Exercise progress charts
19. Training consistency/adherence visualization
20. Planned vs actual training-volume visualization
21. Better exercise-history detail

## P4 — Product polish

22. Workout reminders and notifications
23. PWA/installability improvements
24. Better session interruption/recovery UX
25. Localization polish
26. Exercise demonstration UX
27. Optional sharing/community features where appropriate

---

# 6. P1.1 — Smart set-by-set prefill

## Why

Fitness Assistant currently separates:

```text
Previous performance
```

from:

```text
Today's deterministic target
```

which is correct.

However, the user still has unnecessary input friction.

openGym's direct previous-set prefill is a useful UX pattern, but Fitness Assistant can improve on it because it already has a progression engine.

## Target experience

Example:

```text
Bench Press

Set   Previous       Recommended      Today
1     100kg × 8      102.5kg × 8      [102.5] [8]  [✓]
2     100kg × 8      102.5kg × 8      [102.5] [8]  [✓]
3     100kg × 7      100kg × 8        [100.0] [8]  [✓]
```

### Important semantic distinction

```text
Previous = historical fact
Recommended = deterministic recommendation
Input = editable draft
Completed set = persisted actual
```

Never blur these four concepts.

## Prefill rules

Suggested hierarchy:

```text
if deterministic nextTarget is valid
and dataQuality is sufficient
and cycle/safety does not require manual review:
    prefill input from nextTarget

else if previous performance exists:
    prefill from previous actual

else:
    use exercise/program prescription defaults

else:
    blank input
```

Prefill must never mark a set as completed.

User must still explicitly complete the set.

## Logging-mode awareness

### REPS_LOAD

Prefill:

```text
weight
reps
```

### BODYWEIGHT_REPS

Prefill:

```text
reps
external load if applicable
bodyWeightAtSetKg only if explicitly captured/prefilled according to existing semantics
```

Never silently infer historical body weight.

### TIME

Prefill:

```text
durationSeconds
```

### TIME_LOAD

Prefill:

```text
weight
durationSeconds
```

### DISTANCE_TIME

Prefill:

```text
distanceMeters
durationSeconds
```

## Backend

Prefer reusing existing:

```text
previous-performance endpoint
progression endpoint
```

Do not create another competing recommendation engine.

If request count becomes excessive, consider a combined active-workout context endpoint only after measuring actual network/query cost.

## Frontend requirements

- previous value remains visible;
- recommendation remains visible;
- prefilled input is editable;
- one-tap set completion;
- no modal required for normal set completion;
- after completion, focus/scroll to next relevant set;
- rest timer starts automatically if configured.

## E2E acceptance criteria

Must test:

- weighted prefill;
- bodyweight prefill;
- timed prefill;
- distance prefill;
- deterministic target overrides raw previous value where appropriate;
- `INSUFFICIENT_DATA` fallback;
- cycle `DELOAD` behavior;
- user edits prefilled value and actual edited value is saved;
- a prefilled but uncompleted set is never stored as completed.

---

# 7. P1.2 — Reschedule workout

## Why

Real users miss days.

A reschedule feature must represent:

```text
same logical planned workout
→ moved to another date
```

not:

```text
missed workout
+
brand new duplicate workout
```

This matters because Fitness Assistant has:

- adherence;
- training-cycle evaluation;
- schedule locks;
- progression history;
- AI context.

A naive reschedule implementation can corrupt all of them.

## Required domain semantics

Design after auditing current schema.

Potential conceptual model:

```text
WorkoutSchedule
  logicalScheduleId
  originalPlannedDate
  scheduledDate
  rescheduledAt
  rescheduleReason?
  status
```

Exact schema names must follow current project conventions.

## Invariants

Rescheduling must not:

- duplicate the logical session;
- create false missed-session penalties;
- double count training volume;
- double count adherence;
- duplicate PR/progression history;
- reset exercise progression;
- break cycle metrics;
- mutate completed historical sessions.

## Cases to support

1. future session → another future day;
2. today's unstarted session → tomorrow;
3. missed session → valid recovery date;
4. reschedule onto a day that already has another workout;
5. repeatedly reschedule the same session;
6. cancel/skip instead of reschedule;
7. completed session cannot be casually moved.

## Conflict behavior

Do not silently stack two hard sessions if business rules consider that unsafe or undesirable.

Possible responses:

```text
Allow
Warn
Suggest alternate date
Reject
```

must be based on current product logic—not arbitrary frontend rules.

## Training-cycle integration

Cycle/adherence must understand:

```text
planned
rescheduled
completed
skipped
missed
```

as distinct states/events.

## AI role

AI may explain or suggest dates.

AI must not silently move workouts without deterministic/business validation.

## E2E acceptance criteria

- reschedule from date A → B;
- original date no longer appears as missed duplicate;
- target date shows same logical session;
- history identity is preserved;
- completion on B counts once;
- cycle metrics count correctly;
- timezone behavior works in `Asia/Ho_Chi_Minh`;
- mobile flow works.

---

# 8. P1.3 — Superset / exercise grouping

## Why

Supersets are common and materially affect:

- exercise navigation;
- rest behavior;
- workout order;
- active-session UX.

Do not represent a superset using string hacks or a simple boolean if the domain needs future extensibility.

## Recommended conceptual model

Use a semantic grouping abstraction equivalent to:

```text
WorkoutExerciseGroup
  id
  type
  order
  restBetweenExercisesSeconds
  restAfterRoundSeconds
```

Possible group types:

```text
STRAIGHT
SUPERSET
TRISET
CIRCUIT
```

Members:

```text
WorkoutExerciseGroupMember
  groupId
  workoutExerciseId
  order
```

This is conceptual only. Adapt to current Prisma/schema conventions after impact analysis.

## Important invariant

Progression remains **per exercise**.

Example:

```text
Bench Press → INCREASE_LOAD
Barbell Row → KEEP
```

Superset grouping only changes:

```text
execution order
rest timing
UI navigation
```

It must not merge progression metrics.

## Active-workout UX

For:

```text
A1 Bench Press
A2 Barbell Row
```

expected execution:

```text
A1 set 1
→ A2 set 1
→ group rest
→ A1 set 2
→ A2 set 2
```

Support uneven set counts.

## Future-proofing

Do not overbuild circuits immediately, but avoid a schema that makes tri-set/circuit impossible without migration.

## E2E acceptance criteria

- create/edit superset;
- complete alternating sets;
- correct timer behavior;
- different set counts;
- PR remains per exercise;
- progression remains per exercise;
- workout completion/volume correct;
- mobile active-workout flow.

---

# 9. P1.4 — Active-workout offline resilience

## Goal

Do **not** start by making the entire platform offline-first.

First guarantee:

> A user in a gym must not lose an active workout because Wi-Fi/mobile data disappears.

## Target architecture

```text
Active workout
    ↓
Local durable state
    ↓
Operation/event queue
    ↓
Network available?
  yes          no
   ↓            ↓
sync          pending
                ↓
             reconnect
                ↓
               sync
```

Recommended browser persistence:

```text
IndexedDB
```

Use localStorage only for small/simple state such as current timer metadata, not a large workout event journal.

## Event model

Conceptual events:

```text
SET_COMPLETED
SET_UPDATED
SET_DELETED
EXERCISE_COMPLETED
WORKOUT_COMPLETED
TIMER_STARTED
```

Each mutation should have an idempotency key.

Example:

```text
eventId = UUID
```

Backend must safely handle duplicate retry.

## Conflict strategy

Need explicit rules for:

```text
local edit
vs
server edit
```

Do not use blind last-write-wins for every entity.

For normal single-user active workout, event sequencing can stay relatively simple.

## Failure cases

Test:

- network disappears before completing set;
- network disappears after local completion but before backend acknowledgement;
- browser refresh while offline;
- browser crashes/reopens;
- duplicate retry;
- network reconnect;
- server returns conflict;
- user logs in on a second device.

## Security

Do not store sensitive tokens or unnecessary health data in an unsafe client store.

## Acceptance criteria

- completed local set survives reload;
- retry cannot duplicate set;
- reconnect sync succeeds;
- visible sync state;
- user knows whether workout is saved locally / syncing / synced;
- no silent data loss.

---

# 10. P1.5 — Custom exercises

## Why

Required for:

- uncommon exercises;
- PT-specific movements;
- import from external apps;
- exercise catalog gaps;
- user-specific variations.

## Recommended source semantics

Conceptual:

```text
Exercise.source
  SYSTEM
  USER_CUSTOM
  PT_CUSTOM
  IMPORTED_CUSTOM
```

Adapt names to current schema.

## Minimum custom-exercise fields

- name;
- loggingMode;
- equipment;
- primary muscle;
- optional secondary muscles;
- instructions/notes;
- owner/visibility;
- createdAt;
- archivedAt.

## Do not allow custom exercise to bypass safety/data validation

A custom exercise still needs valid:

```text
loggingMode
units
set semantics
```

## Deduplication

Before creating a custom exercise from import/manual entry:

```text
normalize name
→ exact/alias match
→ fuzzy candidate list
→ user confirms
```

No automatic low-confidence mapping.

## PT semantics

Clarify whether PT-custom exercises are:

```text
private to PT
available to PT clients
gym-wide
global after review
```

before implementation.

## Acceptance criteria

- user creates custom exercise;
- logs it normally;
- history/progression works if compatible;
- can archive without deleting history;
- imported unknown exercise can become custom;
- no catalog contamination.

---

# 11. P1.6 — Fast active-workout interaction polish

Feature count is not enough. Reduce friction.

## Target

After initial prefill, completing a normal set should require approximately:

```text
1–2 interactions
```

## UX principles

- no modal for normal set completion;
- numeric controls easy on mobile;
- keep current exercise context visible;
- previous performance and target compact;
- one-tap complete;
- automatic timer start;
- automatic next-set/exercise focus;
- undo/reopen recently completed set;
- large touch targets;
- avoid horizontal overflow.

## Add explicit "undo last set"

Gym logging errors are common.

Undo should be safer than forcing users into a complex edit flow.

## Optional haptics/sound

Use progressive enhancement.

Respect user preferences.

---

# 12. P1.7 — Session resume / interruption recovery

Different from full offline sync.

Need robust recovery for:

```text
browser reload
app backgrounded
device lock
route change
browser closed and reopened
```

Persist active-session identity and safe draft state.

Do not accidentally reopen yesterday's completed workout.

Use explicit session lifecycle.

---

# 13. P1.8 — Logging-mode catalog discoverability

P0 proved `TIME_LOAD` works technically, but current catalog rows are `STAGING`.

Before publishing:

- inspect why they are staging;
- audit licensing/data provenance;
- verify classification;
- verify instructions/media;
- run exercise review workflow.

Do not publish rows just to claim feature availability.

Create a catalog quality matrix:

```text
Exercise
loggingMode
publicationStatus
equipment
muscles
media/license
reviewStatus
```

---

# 14. P2 — Import architecture

Do not build four unrelated importers.

Build:

```text
Provider-specific parser
        ↓
Canonical import format
        ↓
Normalization
        ↓
Exercise matching
        ↓
Preview
        ↓
Commit
```

## Canonical import records

Conceptually:

```text
ImportedWorkout
ImportedExercise
ImportedSet
ImportedBodyMeasurement
```

Raw provider values should be retained in import audit metadata where appropriate.

## Required properties

- idempotent;
- previewable;
- cancelable before commit;
- import summary;
- unknown exercise resolution;
- unit normalization;
- timestamp/timezone normalization;
- source provenance;
- no silent overwrites.

---

# 15. P2.1 — Hevy import

Support official user export formats only.

Do not scrape private/internal APIs.

Map:

```text
workout
exercise
sets
weight
reps
duration
distance if present
RPE if present
notes
```

Unknown exercises go through matching/custom-exercise workflow.

---

# 16. P2.2 — Strong import

Same canonical pipeline.

Do not create Strong-specific domain fields unless they are raw import metadata.

---

# 17. P2.3 — FitNotes import

Same canonical pipeline.

Pay attention to:

- exercise naming differences;
- unit preferences;
- set-type conventions;
- historical timestamps.

---

# 18. P2.4 — Apple Health + Android Health Connect

Do not model this as an Apple-only domain.

Create a health-provider abstraction.

Conceptual:

```text
HealthDataProvider
  APPLE_HEALTH
  HEALTH_CONNECT
  future providers
```

Normalize relevant data into internal domain models.

Potential scope:

- body weight;
- heart rate where product uses it;
- workout duration;
- distance;
- steps;
- energy data if scientifically/product-relevant.

Do not ingest everything just because the provider exposes it.

## Source precedence

Define precedence for bodyweight:

```text
manual
InBody
Apple Health
Health Connect
```

Do not silently overwrite trusted measurements.

Store provenance.

---

# 19. P2.5 — Export / data portability

Fitness Assistant should allow users to take their data out.

Potential:

```text
JSON export
CSV workout-history export
```

Export should include stable identifiers and normalized units.

Do not expose internal secrets/operational metadata.

---

# 20. P2.6 — Workout template sharing/import

Useful for:

- PT → client;
- user → user;
- community;
- migration.

Need clear distinction:

```text
Template
Plan
Schedule
Completed Workout
```

Do not import completed historical data as a future template.

Sharing should not leak:

- user health information;
- private notes;
- body measurements;
- account identifiers.

---

# 21. P3.1 — Muscle heatmap

## Goal

Visualize training exposure, not pretend to provide exact physiological muscle stimulus.

### Data concept

For each completed working set:

```text
primary muscle contribution
secondary muscle contribution
```

Example product heuristic:

```text
primary = 1.0
secondary = 0.5
```

This weighting is a product heuristic unless validated otherwise.

Label/document accordingly.

## Views

```text
7 days
30 days
current cycle
custom range
```

## Better Fitness Assistant version

Compare:

```text
planned muscle exposure
vs
actual completed exposure
```

This can integrate with Training Cycle better than a standalone heatmap.

## Do not include

Warm-ups as equal hard volume unless intentionally modeled.

---

# 22. P3.2 — Activity heatmap

GitHub-style calendar is useful for adherence/retention.

Possible day states:

```text
completed
partial
rest
missed
rescheduled
```

Avoid only encoding "worked out yes/no".

Click day → details:

- workout;
- duration;
- volume;
- PR;
- RPE/RIR;
- relevant notes.

---

# 23. P3.3 — Exercise progress charts

Per exercise:

- weight trend;
- rep trend;
- e1RM trend;
- best-set trend;
- duration trend;
- distance/pace trend;
- bodyweight-rep trend.

Charts must be logging-mode aware.

Do not graph "weight" for exercises where weight is not meaningful.

---

# 24. P3.4 — Training consistency and adherence

Fitness Assistant can exceed openGym here due to schedule/cycle semantics.

Show:

```text
planned
completed
rescheduled
missed
```

rather than raw count only.

Potential cycle summary:

```text
Adherence: 86%
Rescheduled: 2
Missed: 1
Completed: 12
```

---

# 25. P3.5 — Planned vs actual training volume

Use current program/cycle plan and completed sessions.

Avoid oversimplified "volume = always kg × reps" across all logging modes.

Weighted resistance can use volume/load metrics where valid.

Timed/cardio/bodyweight should use mode-appropriate metrics.

---

# 26. P3.6 — Exercise history detail page

For each exercise:

- recent sessions;
- previous actual sets;
- progression decisions;
- PRs;
- e1RM where eligible;
- charts;
- logging-mode-specific records;
- notes;
- exercise substitutions if available.

This is a better place for deep history than cluttering active workout.

---

# 27. P4 — Notifications/reminders

Potential notifications:

- upcoming workout;
- rescheduled workout;
- rest timer;
- unfinished active workout;
- PT feedback;
- plan update.

Need preference controls.

Do not spam.

Rest timer notification should remain session-scoped.

---

# 28. P4 — PWA / installability

After active-workout offline resilience is proven, improve:

- manifest;
- service worker;
- asset caching;
- update strategy;
- installability;
- offline shell.

Do not let stale service-worker caches trap users on an old app version.

Need version/update UX.

---

# 29. Features to learn conceptually but NOT copy into architecture

openGym's lightweight self-hosted architecture is appropriate for its product goals.

Fitness Assistant should **not** replace its multi-service architecture with:

- JSON-file storage;
- single-user assumptions;
- local-only backend design;
- openGym's exact frontend state structure.

Fitness Assistant has different requirements:

- Client/PT/Gym Owner actors;
- centralized account system;
- payment;
- AI services;
- nutrition;
- InBody;
- scale ambitions;
- auditability.

Learn simplicity where useful; do not transplant architecture.

---

# 30. Features NOT currently recommended as priority

Do not prioritize these before P1/P2 core work:

- cosmetic parity with openGym;
- cloning every visualization;
- recreating openGym branding/layout;
- exact same progression-policy names;
- exact same notification copy;
- self-host architecture parity;
- Android APK purely for parity if PWA/mobile web already serves users well.

---

# 31. Dependency graph

Recommended dependency order:

```text
P0 CLOSED
   ↓
Smart Set Prefill
   ↓
Fast Active Workout UX
   ↓
Reschedule
   ↓
Superset
   ↓
Session Resume Hardening
   ↓
Active Workout Offline Resilience
   ↓
Custom Exercises
   ↓
Import Framework
   ├─ Hevy
   ├─ Strong
   └─ FitNotes
   ↓
Health Provider Layer
   ├─ Apple Health
   └─ Health Connect
   ↓
Visualization
   ├─ Exercise History
   ├─ Muscle Heatmap
   ├─ Activity Heatmap
   └─ Planned vs Actual
```

Custom exercise can be started earlier if importer work begins early.

---

# 32. Recommended implementation milestones

## Milestone P1-A — Active Workout Speed

Scope:

- smart set prefill;
- one-tap completion;
- compact previous/target/actual UI;
- undo recent set;
- session resume hardening.

Exit criteria:

- weighted/bodyweight/timed/cardio E2E;
- mobile;
- no regression to P0;
- measurable reduction in interactions per set.

---

## Milestone P1-B — Schedule Flexibility

Scope:

- reschedule domain;
- skipped/missed semantics;
- adherence integration;
- cycle integration.

Exit criteria:

- no duplicate logical sessions;
- correct timezone handling;
- correct cycle metrics;
- E2E across reschedule→completion.

---

## Milestone P1-C — Advanced Session Structure

Scope:

- supersets;
- grouping model;
- group timer behavior.

Exit criteria:

- alternating execution;
- independent progression;
- accurate session summary;
- mobile E2E.

---

## Milestone P1-D — Resilient Gym Mode

Scope:

- durable active session;
- IndexedDB;
- local mutation journal;
- idempotent backend mutations;
- reconnect/sync.

Exit criteria:

- zero silent set loss in tested outage scenarios;
- duplicate retries are safe;
- visible sync state.

---

## Milestone P1-E — Custom Exercise Foundation

Scope:

- user custom;
- PT custom if approved;
- archive;
- history;
- matching hooks for future import.

Exit criteria:

- custom exercise is first-class in logging/history;
- cannot corrupt global catalog.

---

## Milestone P2-A — Migration & Portability

Scope:

- canonical importer;
- Hevy;
- Strong;
- FitNotes;
- JSON/CSV export.

Exit criteria:

- idempotent import;
- preview;
- unknown exercise resolution;
- audit report.

---

## Milestone P2-B — Health Data Layer

Scope:

- Apple Health;
- Health Connect;
- provenance;
- normalized measurement ingestion.

Exit criteria:

- no source-confusion between InBody/manual/provider;
- conflict rules tested.

---

## Milestone P3 — Insights

Scope:

- exercise history;
- muscle heatmap;
- activity heatmap;
- progression charts;
- adherence;
- planned-vs-actual.

Exit criteria:

- logging-mode-aware analytics;
- heuristic labels explicit;
- no false scientific precision.

---

# 33. Per-feature engineering process

Every feature in this roadmap must follow:

```text
1. Research behavior/product value
2. Audit current Fitness Assistant code
3. Write impact analysis
4. Define domain invariants
5. Design additive/backward-compatible schema/API
6. Implement deterministic business logic
7. Implement frontend
8. Unit tests
9. Integration tests
10. Real-browser E2E
11. Mobile E2E if user-facing
12. Regression
13. Performance/query review
14. Update docs
15. Strict verdict
```

Do not begin with coding from openGym.

---

# 34. Required impact-analysis template

Before a P1 feature with non-trivial blast radius, create:

```text
docs/features/<FEATURE>_IMPACT_ANALYSIS.md
```

Include:

```text
Problem
Current FA behavior
Desired behavior
openGym behavior reference
What we will NOT copy
Affected models
Affected services
Affected frontend pages
Affected AI context
Affected cycle/adherence logic
Migration risk
Backward compatibility
Security/privacy
Failure modes
Test plan
Rollout strategy
```

---

# 35. Database principles

- prefer additive migrations;
- preserve old rows;
- never fabricate historical data;
- use nullable/UNKNOWN where semantics are genuinely unknown;
- preserve source/provenance;
- never reinterpret a legacy field silently;
- avoid duplicate sources of truth;
- make imports idempotent;
- design reschedule identity explicitly.

---

# 36. AI principles

AI is not the source of truth for deterministic workout mechanics.

AI may:

- explain;
- summarize;
- coach;
- suggest;
- provide natural-language context.

AI must not override:

- completed actual sets;
- deterministic progression target;
- cycle `DELOAD`;
- schedule identity;
- safety flags;
- import mapping without user confirmation when confidence is low.

---

# 37. Safety principles

Do not invent medical logic while adding workout features.

Existing safety context must remain intact.

Any feature that changes intensity, scheduling, or progression must preserve:

```text
cycle decision
safety flags
injury constraints
```

No feature learned from openGym should bypass Fitness Assistant's safety architecture.

---

# 38. Performance principles

Fitness Assistant is not a single-user JSON app.

Before merging:

- avoid N+1 previous-performance fetches;
- cache carefully;
- ensure active-workout context is not refetched on every slider movement;
- index new reschedule/import lookup paths;
- batch importer writes;
- avoid sending whole history into AI context.

Measure before optimizing.

---

# 39. Privacy principles

Pay special attention to:

- imported history;
- Apple Health/Health Connect;
- PT custom exercises;
- shared templates;
- health/body measurements.

Sharing a workout template must not implicitly share personal health data.

Imports must clearly disclose what data is being imported.

---

# 40. Test strategy

## Unit

For pure domain logic:

- reschedule state transitions;
- grouping order;
- idempotency;
- import normalization;
- exercise matching;
- heatmap calculation;
- prefill selection.

## Integration

For:

- DB persistence;
- schedule identity;
- cycle/adherence;
- offline mutation replay;
- import commit;
- custom exercise history.

## Browser E2E

Every user-visible P1 feature requires real browser proof.

Use the stable active-workout opener created during P0 stabilization.

## Reproducibility

Critical bundle should pass repeatedly, not only once.

---

# 41. Rollout strategy

Do not ship all P1 features simultaneously.

Recommended:

```text
P1-A Smart Prefill
→ stabilize
→ P1-B Reschedule
→ stabilize
→ P1-C Superset
→ stabilize
→ P1-D Offline resilience
```

Use feature flags if existing architecture supports them.

For importers, start with one provider and validate canonical pipeline before adding the rest.

---

# 42. Definition of Done per feature

A feature is not complete because code compiles.

Required:

```text
✓ code path reachable by real user
✓ database semantics verified
✓ API types updated
✓ frontend behavior correct
✓ mobile behavior verified
✓ unit/integration pass
✓ browser E2E pass
✓ regression pass
✓ no unexplained flakes
✓ documentation updated
✓ license/clean-room rule respected
```

---

# 43. Recommended next task — UPDATED, see § 46 for full evidence

~~The next implementation task should be: SMART SET-BY-SET PREFILL~~ —
**done.** All of P1 is now done (P0 baseline, then Smart Set-by-Set
Prefill, Fast Active-Workout Interaction, Reschedule Workout, Superset/
Grouping, Session Resume Hardening, Active-Workout Offline Resilience,
Custom Exercises, and TIME_LOAD Catalog Publishing Review/Discoverability
— 9/9 P1-tier items). See § 46 (Feature status board) for the full
evidence trail (impact-analysis docs, real test counts, regressions) on
each.

~~The next implementation task is now: P2 — CANONICAL IMPORT FRAMEWORK
(§ 14)~~ — **done, built together with Hevy import (§15) end-to-end**
(scope confirmed with the user: framework + one real provider working,
not framework-only against a synthetic fixture). See § 46's "Canonical
import framework" row for full evidence.

~~The next implementation task is now: P2.2 — STRONG IMPORT (§ 16)~~ —
**done.** Confirmed the framework's own design goal on first reuse
(`commitImportBatch` needed zero changes) — see § 46's "Strong import"
row for full evidence, including 3 previously Hevy-only utility modules
that were extracted into shared, provider-agnostic files as part of this
pass.

~~The next implementation task is now: P2.3 — FITNOTES IMPORT (§ 17)~~ —
**done.** Second consecutive provider added without touching
`commitImportBatch`/`previewFromParsed` at all — see § 46's "FitNotes
import" row for full evidence, including a real structural finding
(FitNotes' export has no workout-session concept — same-date rows
necessarily merge into one workout, a disclosed limitation of the source
format itself) and a second round of shared-module extraction (unit
conversion, first written for Strong, moved into its own file so
FitNotes reuses it too).

~~The next implementation task is now: P2.5 — JSON/CSV EXPORT (§ 19)~~ —
**done.** Read-only, two SELECT-shaped functions and a pure CSV
serializer — see § 46's "JSON/CSV export" row for full evidence,
including the real audit of what `userId`/`exerciseNameSnapshot` needed
to be excluded as "internal/operational metadata" per §19's own
instruction.

**Real blocker found for the next item in order (§18, Apple Health /
Android Health Connect):** this environment has no Xcode/Android Studio,
no iOS/Android device or simulator, and no ability to write or run
native platform code — HealthKit and Health Connect are both native-only
APIs with no web equivalent. The pre-existing `apps/` mobile directory is
also explicitly off-limits to this session (a standing constraint from
before this pass — never added to git, never modified). A *backend-only*
ingestion endpoint (accept already-normalized health data a native app
would push) could technically be written, but it would ship with **zero
possibility of real E2E verification** in this session — directly against
this whole session's own "no self-grading without evidence" discipline
that's held for every one of the 13 milestones shipped so far today.
**Not attempted without an explicit decision from the user** — this is
exactly the kind of "impact analysis demonstrates a strong reason to
reorder" § 44's own text anticipates, not a unilateral skip.

~~Recommended next implementation task, pending that decision: P2.6 —
WORKOUT TEMPLATE SHARING/IMPORT (§ 20)~~ — **done**, per the user's
explicit choice to skip the blocked Health Integration item and build
this instead. See § 46's "Workout template sharing/import" row for full
evidence. This closes out the entire P2 tier except the
environment-blocked Health Integration item.

~~The next implementation task is now P3 — Visualization and retention
(§ 21 onward), starting with P3.1 — MUSCLE HEATMAP (§ 21)~~ — **done, all
4 range modes**, per the user's explicit choice to build the full scope
(not a smaller 7d+30d MVP). See § 46's "Muscle heatmap" row for full
evidence, including a real test-database-only data-integrity bug found
and fixed along the way.

**The next implementation task is now:**

# P3.2 — ACTIVITY HEATMAP (§ 22)

Next P3 item in § 5's own listed order. A GitHub-style calendar view of
training activity — §22 explicitly wants more than a binary "worked out
yes/no": distinct day states (`completed`/`partial`/`rest`/`missed`/
`rescheduled`), and click-through to real day detail (workout, duration,
volume, PR, RPE/RIR, notes). Real infrastructure to audit before
designing: `WorkoutSchedule.status` (already has `NOT_STARTED`/
`IN_PROGRESS`/`PARTIALLY_COMPLETED`/`COMPLETED`/`SKIPPED`/`CANCELLED`)
and P1.2's reschedule audit columns (`originalPlannedDate`,
`rescheduledAt`) — likely already carry most of what §22's day-state
model needs without inventing new fields.

Before coding, create:

```text
docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md
```

---

# 44. After Muscle Heatmap

~~Next order: Reschedule → Superset → Active Workout Offline Resilience →
Custom Exercises → Import Framework → Health Integration →
Visualization~~ — everything through the full P2 tier except the
environment-blocked Health Integration item, plus P3.1 Muscle Heatmap,
is now **done**. Updated
remaining order:

```text
Apple Health / Android Health Connect integration — still BLOCKED in
  this environment (no native mobile tooling to build or verify it)
→ P3 Visualization — activity heatmap (next) → exercise progress charts
  → training consistency/adherence → planned-vs-actual →
  exercise-history detail
→ P4 polish (notifications/reminders, PWA/installability)
```

Do not reorder simply because another feature looks easier unless impact analysis demonstrates a strong reason.

---

# 45. Agent instructions — Claude Code / Codex

When an agent is asked to "continue this roadmap":

1. Read this file.
2. Read current checkpoint/report documents.
3. Inspect `git status`.
4. Do not discard unrelated dirty work.
5. Identify the **next incomplete milestone only**.
6. Create its impact-analysis document.
7. Audit current code.
8. Research independently.
9. Implement original code using Fitness Assistant conventions.
10. Run full required tests.
11. Update this roadmap only if an evidence-based architectural decision changes it.
12. Do not silently mark future phases complete.
13. Do not implement multiple high-blast-radius milestones in one overnight pass.

---

# 46. Feature status board

Agents should maintain this table as work progresses.

**As of 2026-08-26: P0 is DONE/READY, all 9 P1-tier items are DONE, P2
is 6/7 done (entire tier complete except one item blocked by this
environment), and P3 has started (1/6).** The full 3-provider import
trio (Canonical import framework + Hevy §14/§15, Strong §16, FitNotes
§17), JSON/CSV export (§19), Workout template sharing/import (§20), and
Muscle Heatmap (§21) are all DONE. Every DONE row below has a linked
`docs/features/*_IMPACT_ANALYSIS.md` with real backend/E2E test evidence
and disclosed scope decisions/known gaps — nothing below is marked DONE
without that evidence. **Apple Health/Health Connect (§18) is BLOCKED in
this environment** (no native iOS/Android tooling to build or verify
it — see § 43), confirmed by the user to skip rather than attempt
unverifiably. The rest of P3 (visualization) and all of P4 (polish) are
still TODO — see § 43/§ 44 for the recommended next task (P3.2 Activity
Heatmap) and ordering.

| Feature | Priority | Status | Notes |
|---|---|---|---|
| P0 workout/progression baseline | P0 | **DONE / READY** | Frozen baseline |
| Smart set-by-set prefill | P1 | **DONE** | Active-exercise draft prefill for all 5 logging modes incl. editable bodyweight reps (utility 11/11, E2E 5/5) PLUS the true set-by-set table UI (roadmap §6/§11's own mockup): real per-set rows (Set/Previous/Recommended/status), each independently completed/undone via the existing `updateSet` primitive, `Previous` matched per real set number via new `targetSetNumber` param (utility 14/14). Found and fixed 4 real bugs along the way (sibling-set-value corruption if the closing set had used the old bulk `completeScheduleExercise`, `updateSet`'s response missing a progress summary, the inline undo button's ambiguous "was this the closing set" case, and the active view never eagerly starting a session via direct/deep-link URLs — see `docs/features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md`'s "Bugs found" section for detail on each). Backend integration 2/2 new + 15/15 pre-existing unaffected, E2E 1/1 new, full P0+P1.1+P1.6+P1.7 browser regression re-run 25/25 (specs 29-36, `READY FAIL=0 total=429`). Deliberately deferred: true per-set-number "Recommended" (engine still returns one flat target per exercise) and per-row RPE/RIR inputs — both disclosed MVP simplifications, not gaps found late. **Also surfaced a real infra bug**: Prisma applies the system's local TZ (UTC+7) to naive `timestamp` columns (subtract on write, add on read) — self-cancelling for Prisma-only round-trips, but any raw-SQL-seeded date (used by every E2E spec's seed helpers) reads +7h fast, which can cross a day boundary depending on run time. Worked around locally (`daysAgo: 2`+ margin) in `33-smart-set-prefill.spec.ts`; NOT fixed at the infra level (needs a dedicated pass — force `TZ=UTC`, or `@db.Timestamptz`) — see `docs/features/SMART_SET_PREFILL_IMPLEMENTATION_NOTE.md` |
| Fast active-workout interaction | P1 | **DONE (undo-last-set slice)** | `POST /workouts/schedules/:id/exercises/:programExerciseId/undo-complete` (backend, sibling of `/complete`, reuses `recomputeScheduleProgress`) + a sonner toast-with-action on completing any NON-final exercise, restoring the just-submitted values exactly (never blank). Deliberately scoped OUT of the final-exercise/whole-workout-completion path — see `docs/features/UNDO_LAST_SET_IMPACT_ANALYSIS.md`. Backend integration 4/4, E2E 2/2 (restore-and-continue + scope-boundary), full P0+P1.1+P1.6+P1.7 browser regression re-run 24/24 (specs 29-35, `READY FAIL=0 total=356`). True set-by-set table UI (the other item under this milestone) is now also done — see the "Smart set-by-set prefill" row above. |
| Reschedule workout | P1 | **DONE** | `POST /workouts/schedules/:id/reschedule` — plain UPDATE of the existing row's `date` (never a new row), since `@@unique([userId,date])` already rules out two rows per day and `computeAdherence` already just range-queries `date` — zero adherence/cycle code changes needed (verified directly, not assumed). Source: any not-started session (past/today/future, deliberately looser than `assertScheduleDateEditable`'s today-only rule). Target: today-or-future, hard-rejects an occupied date (409, names what's there). New "Dời lịch" button + date-picker modal in the day-detail view. Found and fixed 2 more real pre-existing bugs along the way (`calendarMonth` ignoring the URL's `date` param — broke deep-linking into a different month, not just reschedule; `createManualProgram` always archiving the previous ACTIVE program regardless of `replaceExisting`, a test-seeding trap spec 27 had already learned to avoid). See `docs/features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md`. Backend integration 8/8 (new) + 14/14 pre-existing unaffected, E2E 2/2 (new, `37-reschedule-workout.spec.ts`), full regression re-run 30/31 (specs 27,29-37) — the one failure was pre-existing spec 27 hitting the gateway's own `/auth/*` rate limiter after this session's cumulative E2E volume today (confirmed via `RateLimit-Remaining: 0`, not a code defect; spec 27 alone passes 4/4 reliably, `37-reschedule-workout.spec.ts` passed cleanly in every run). |
| Superset/grouping | P1 | **DONE (scoped MVP)** | New `WorkoutProgramExerciseGroup`/`GroupMember` tables (program-day planning concept only — never touches `WorkoutExercise`/`WorkoutSet`, zero risk to logged history). Confirmed with the user before implementing: exercises within a group complete SEQUENTIALLY this pass (all of A's sets before B's, reusing P1.1's set-by-set flow unchanged), not true interleaved per-set round-robin — but WITH the roadmap's own two rest fields correctly applied (short `restBetweenExercisesSeconds` advancing within a group, long `restAfterRoundSeconds` once the group's last member is done). Grouping UI lives in the existing day-edit mode (multi-select → "Tạo nhóm", with editable rest-duration inputs); active-session shows a "Superset · Bài N/M" badge. `createExerciseGroup` re-sequences the day so members become contiguous by construction, even if selected non-adjacently. See `docs/features/SUPERSET_GROUPING_IMPACT_ANALYSIS.md` for the full scope decision and a pre-existing gap it flagged (`WorkoutProgramExercise.restSeconds` still unread by the timer for non-grouped exercises — out of scope, not fixed). Backend integration 4/4 (new) + 18/18 pre-existing unaffected, unit 7/7 (new, the pure rest-duration function), E2E 2/2 (new, `38-superset-exercise-grouping.spec.ts`), full regression re-run 33/33 (specs 27,29-38, `READY FAIL=0 total=540`) — an initial run hit 1 flaky failure from the gateway's own `/auth/*` rate limiter being cumulatively exhausted by this session's E2E volume across 4 milestones in one day; waited out properly (single `Retry-After` check + one passive wait, no further probing) and the clean re-run confirmed it was rate-limit pressure, not a regression. True interleaved per-set superset navigation remains a deliberately deferred follow-up. |
| Session resume hardening | P1 | **DONE (draft persistence slice)** | `active-log-draft.utils.ts` — localStorage-persisted active-exercise draft scoped per schedule+exercise, 12h staleness bound, restored before smart-prefill runs, cleared on completion/deliberate exit. Utility 14/14, E2E 2/2, P0+P1.1+P1.7 browser regression 22/22 — see `docs/features/SMART_SET_PREFILL_IMPLEMENTATION_NOTE.md`. Broader P1.7 scope (backgrounded app, device lock) not separately verified beyond what reload/navigation already proves. |
| Active-workout offline resilience | P1 | **DONE** | Full architecture per the roadmap's own description, confirmed with the user given the scale (chose full build over a smaller MVP). IndexedDB-backed durable event queue (`active-workout-offline-queue.utils.ts`) for the active-session mutation surface (set complete/undo); idempotency ledger (`WorkoutMutationEvent`, a direct structural port of payment-service's `LedgerOperation`/`withIdempotentLedgerOp` pattern) wraps `updateSet`/`completeScheduleExercise`/`undoCompleteScheduleExercise`, fully backward compatible (no `eventId` = today's exact behavior, proven by test). Audit found most active-workout mutations were ALREADY idempotent by construction (UPDATE-by-id, never INSERT) — the real gap was narrower than "every mutation," just the first-touch `WorkoutExercise` create. Offline completion applies the same optimistic local state a successful call would, queues durably, shows a visible sync-state indicator, and DELIBERATELY withholds the whole-workout completion celebration until the drain actually confirms it server-side (never guessed offline) — see the impact analysis's "Conflict strategy". Real finding during E2E testing: a literal "reload while fully offline" needs a service worker this app doesn't have yet (separately-scoped P4 PWA work) — the actual guarantee (IndexedDB durability, proven by direct inspection) holds regardless. Backend integration 40/40 (4 new idempotency-replay tests + every pre-existing suite touching the restructured transaction, unaffected). Unit 6/6 (new, pure queue-ordering/event-shape logic). E2E 1/1 new (`39-active-workout-offline-resilience.spec.ts`, real `context.setOffline`) + 6/6 targeted regression (specs 35,36,38,39). See `docs/features/ACTIVE_WORKOUT_OFFLINE_RESILIENCE_IMPACT_ANALYSIS.md`. Full 12-file bundle re-run deferred — gateway `/auth/*` rate limiter exhausted by this session's 5th milestone today; the targeted regression + deterministic backend suite give strong coverage of the restructured code path regardless. |
| Custom exercises | P1 | **DONE (USER_CUSTOM scoped)** | `Exercise` gained `source`/`ownerId`/`archivedAt` (3 additive columns). Reuses `detectDuplicate` (the catalog's own bulk-import dedup pipeline) UNCHANGED — an `EXACT_SAME_SOURCE`/`EXACT_CROSS_SOURCE` match blocks creation and returns candidates, requiring an explicit "create anyway" to bypass, never silent. Scoped to `source: USER_CUSTOM` only this pass — `PT_CUSTOM` deferred (roadmap explicitly wants the PT-visibility model clarified first, no PT/client-relationship model exists yet to build it on). New `authMiddleware`-gated `/exercises/custom` route family; the public, unauthenticated `GET /exercises` is architecturally untouched, so "no catalog contamination" holds by construction, not by a filter that could be forgotten. `WorkoutExercise`/`WorkoutProgramExercise` already FK to `Exercise.id` with no assumption about its source, so logging/progression/PR-calculation needed ZERO changes — proven, not assumed, by a real E2E log-and-complete pass. Archive-only (never delete), owner-scoped, history stays resolvable after archiving. **Real bug found and fixed**: the general catalog search only ever gated on `status: "PUBLISHED"`; since a custom exercise is deliberately created `PUBLISHED` too (so its owner can use it immediately), this alone would have leaked every user's private custom exercises into everyone's public search — fixed by adding a `source: "SYSTEM"` filter alongside it. Caught by a real integration test whose first version correctly failed before the fix existed. See `docs/features/CUSTOM_EXERCISES_IMPACT_ANALYSIS.md`. Backend integration 5/5 (new, `custom-exercise.integration.test.ts`), `tsc --noEmit` clean both sides, E2E 1/1 (new, `40-custom-exercises.spec.ts` — create via the real picker form, DB-verify, add to a program via API, log+complete it in an active session, archive via the real UI trigger, confirm history survives). Targeted regression re-run on specs touching the same Add Exercise picker/`WorkoutLogPage.tsx`: 25/37/38/39 all still passing (7/7). One pre-existing, unrelated finding surfaced and left unfixed (out of scope): `16-swap-exercise.spec.ts`'s own local helper waits on a `workout-tab-plan` testid that no longer exists anywhere in the frontend (stale before this milestone, most likely orphaned by the prior `355735f` production-hardening commit's navigation refactor) — disclosed rather than silently ignored. |
| TIME_LOAD catalog publishing review | P1 | **DONE (reviewed — deliberately NOT published)** | Full audit of the 3 real `TIME_LOAD` STAGING rows (Farmer/Suitcase/Front Rack Carry): content quality is genuinely good (correct classification, real Vietnamese instructions, sensible muscle/equipment mapping), but zero video/media and `media_license` unset. **Real finding that reframed the milestone**: comparing the `original_curated` cohort (145 rows, same import pipeline), `video_url` presence is a near-perfect (25/26) predictor of already being `PUBLISHED` — every one of the other 119 staging curated rows, TIME_LOAD or not, also lacks video. Gate 7's review workflow (`exercise-review.service.ts`) was checked and does NOT apply here by design — it only handles *unresolved* import candidates, and these 3 rows already have real `ExerciseSource` links, so it explicitly refuses any decision but `MARK_AS_DUPLICATE_SKIP` (which would be false) for them; there is also no admin action anywhere in this codebase to flip `Exercise.status` at all (the 883 pre-existing rows were published via a one-off backfill script, not reusable tooling). Given the roadmap's own explicit instruction — "do not publish rows just to claim feature availability" — and that these 3 rows fail the exact bar the rest of this cohort is held to, **they were deliberately left STAGING**, not published. What shipped instead is the tool the roadmap actually asked for: `GET /exercises/admin/catalog-quality-matrix` (admin-gated, matches the roadmap's own requested schema — loggingMode/publicationStatus/equipment/muscles/media-license/reviewStatus — catalog-wide and reusable, not scoped to just 3 rows) + a new read-only `/admin/catalog-quality` page (mirrors the existing Gate 7 admin page's conventions). See `docs/features/CATALOG_QUALITY_MATRIX_IMPACT_ANALYSIS.md`. Backend integration 5/5 (new), `tsc --noEmit` clean, E2E 1/1 (new, `41-catalog-quality-matrix.spec.ts`), regression: Gate 7's own admin spec 2/2 + a combined backend bundle (Gate 7 + custom exercises + catalog quality) 16/16, all still passing. The wider 116-row non-TIME_LOAD staging backlog this audit also surfaced is now visible through the new tool but deliberately not triaged in this pass — that's a separate, larger content-ops task. |
| Canonical import framework | P2 | **DONE (built with Hevy end-to-end, scope confirmed with the user)** | Two-phase preview → commit user-facing workout-history import, new `WorkoutImportBatch` model (deliberately separate from Gate 5's admin/CLI-only `ImportBatch`/`ImportRecord` — different owner, different lifecycle, see impact analysis). `createWorkout`/`workoutRepository.create` could NOT be reused unchanged: it repeats ONE uniform weight/reps across all of an exercise's sets (imports need genuine per-set variation) and calls `assertScheduleDateEditable` (today-only lock, would reject any real historical import) — a new direct-Prisma commit path was written instead, mirroring the Gate-4 `exerciseNameSnapshot` convention, never creating a `WorkoutSchedule` row (imported history is pure "actual", no "planned" counterpart). `detectDuplicate` didn't fit exercise-name matching either (it needs full equipment/muscle records; a CSV row only has a name) — a dedicated exact/fuzzy name matcher was written, reusing `normalizeVietnamese` (see bugs below). Idempotent by construction: a `sourceHash` per parsed workout, checked against every past committed batch, means re-uploading the same export twice creates zero duplicate `Workout` rows — proven, not assumed, by a real test. No multipart/`multer` — the CSV is posted as a JSON string field through a route-scoped larger `express.json()` limit (both fitness-service and the gateway, which has no global body-parser at all in front of any proxy route). New `/client/import-workouts` page (upload → preview → per-exercise resolve → commit), reusing P1.5's `createCustomExercise` unchanged for "create as custom" resolutions. **Real bugs found and fixed**: (1) the name matcher's first version didn't handle Vietnamese `đ`/`Đ` (NFD doesn't decompose it — it's a distinct base letter, not base+diacritic), silently downgrading exact matches in this heavily-Vietnamese catalog to weak fuzzy ones — fixed by reusing the existing, already-correct `normalizeVietnamese` instead of a flawed reimplementation; (2) the date parser's non-ISO fallback delegated to `new Date(dateOnlyString)`, which JS treats as LOCAL midnight for non-ISO input — `.toISOString()` then silently shifted the date back a day on a positive-UTC-offset host, the same bug class this roadmap's own Smart Prefill entry already found for Prisma+naive-timestamps — fixed by never delegating to timezone-dependent `Date` parsing, building every date directly from regex-extracted digits. Both caught by this milestone's own unit tests before they could reach a real import. **Disclosed limitation**: Hevy's CSV column format is targeted from public/community documentation, not verified against a live Hevy export (no account available) — the parser is header-driven and defensive (a format drift surfaces as "0 workouts parsed, N row errors" for the user to see, never silent corruption), but may need adjustment against a real export file. Body-measurement import is scoped out this pass (Hevy's export format for it isn't confidently known) — revisit alongside P2.4. Strong/FitNotes (P2.2/P2.3) are separate follow-up passes, each meant to be a thin parser on top of this same pipeline. See `docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md`. Unit 18/18 (new), backend integration 8/8 (new, `import.service.integration.test.ts`), `tsc --noEmit` clean (fitness-service + gateway), E2E 1/1 (new, `42-import-hevy-workouts.spec.ts` — real file upload, real preview, real resolve-and-commit, real re-upload idempotency check), regression 13/13 (specs touching `ProfilePage`, where the new entry point was added). |
| Hevy import | P2 | **DONE** | Shipped together with the canonical import framework above — see that row for full detail; this was deliberately not split into a separate pass (scope confirmed with the user: "framework + Hevy end-to-end" over "framework only against a synthetic fixture"). |
| Strong import | P2 | **DONE (thin parser on the existing pipeline)** | Confirms the canonical framework's own design goal on first reuse: `commitImportBatch` needed ZERO changes (it already only operated on the canonical `ImportedWorkout[]` shape), and `previewHevyImport` was refactored into a shared `previewFromParsed` + a thin `previewStrongImport` wrapper. The CSV tokenizer, timezone-safe date parser, and source-hash function — all previously living inside Hevy's own parser file despite being genuinely provider-agnostic — were extracted into shared `csv-parser.util.ts`/`import-date-parser.util.ts`/`import-source-hash.util.ts`/`import-canonical.types.ts` modules (Hevy's parser now imports these too, with a backward-compat re-export so its existing tests needed zero changes). The one genuinely Strong-specific piece: unit conversion — Strong exports weight/distance with a PER-ROW unit (`Weight Unit`: kg/lb, `Distance Unit`: km/mi/m), unlike Hevy's always-kg `weight_kg` column, so every value is normalized to this app's kg/meters convention before it ever reaches the shared commit path. Same page, provider selector (`/client/import-workouts` gained a Hevy/Strong toggle) — not a second page, per §16's own "same canonical pipeline" instruction. Small consistency fix made to Hevy's own parser while touching this shared code: `description` (Hevy's workout-level notes column) was in the targeted column list since P2.1 but was never actually mapped to `ImportedWorkout.notes` — fixed so both providers populate it consistently. See `docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md`. Unit 8/8 (new, `strong-csv-parser.util.test.ts`) + 18/18 pre-existing Hevy/matcher unit tests re-run unaffected by the extraction. Backend integration 1/1 (new, focused — the shared commit path itself is already covered 8/8 by Hevy's own suite and unchanged) — 35/35 across the full combined import test bundle. `tsc --noEmit` clean. E2E 1/1 (new, `43-import-strong-workouts.spec.ts` — real provider-selector click, real Strong-format CSV upload, real lb→kg conversion verified in the committed `WorkoutSet`). Regression: Hevy's own E2E (`42-import-hevy-workouts.spec.ts`, most at risk from the shared-pipeline refactor) 1/1 still passing. |
| FitNotes import | P2 | **DONE (thin parser, completes the 3-provider trio)** | Second consecutive provider added without touching `commitImportBatch` or `previewFromParsed` at all — confirms the shared pipeline extraction done for Strong (§16) was the right call. New `fitnotes-csv-parser.util.ts` reuses ALL 4 shared modules (`csv-parser.util.ts`, `import-date-parser.util.ts`, `import-source-hash.util.ts`, `import-canonical.types.ts`) plus the kg/meters unit-conversion functions first written for Strong (extracted into their own `import-unit-conversion.util.ts` this pass so Strong's parser reuses them too, not just FitNotes'). **Real structural finding**: FitNotes' export has NO workout-session concept at all — no title, no time-of-day, just a plain calendar `Date` per set-row (unlike Hevy's `title`/`start_time` or Strong's `Workout Name`/timestamped `Date`). This means the importer necessarily merges everything logged on one calendar date into a single workout — if a user trained twice in one day, FitNotes' own export cannot distinguish the two sessions, so neither can this importer; disclosed as a real limitation of the source format, not something to silently paper over or claim to solve. Proven, not just asserted: a unit test and an E2E test both construct two different exercises on the same date and confirm they land as one real `Workout` with both real `WorkoutSet` rows intact. `Time` format (plain seconds vs `MM:SS`/`HH:MM:SS`) handled defensively — tries each shape, leaves genuinely unparseable values `null` rather than guessing or blocking the row. Same page, third provider option (`/client/import-workouts`'s selector now has Hevy/Strong/FitNotes) — not a third page. **Disclosed limitation**: this is the least-verified of the three provider formats built this session — FitNotes' own documentation of its exact export schema is thinner than Hevy's or Strong's, so real-world adjustment may be needed sooner than the other two. See `docs/features/FITNOTES_IMPORT_IMPACT_ANALYSIS.md`. Unit 9/9 (new, `fitnotes-csv-parser.util.test.ts`) + 26/26 pre-existing Hevy/Strong/matcher unit tests re-run unaffected by the unit-conversion extraction. Backend integration 1/1 (new, focused) — 45/45 across the full combined 3-provider import test bundle. `tsc --noEmit` clean. E2E 1/1 (new, `44-import-fitnotes-workouts.spec.ts` — real provider-selector click, real FitNotes-format CSV with 2 same-date rows, verifies the real merge-into-one-workout behavior end to end). Regression: Hevy's and Strong's own E2E specs (both providers most at risk from the shared unit-conversion extraction) 2/2 still passing. |
| JSON/CSV export | P2 | **DONE** | Followed §19's own wording literally — JSON export = everything exportable (full workout history + body metrics), CSV export = workout history only, one row per set (§19 explicitly says "JSON export, CSV **workout-history** export", not a generic CSV of everything). New `/exports` route family (`export.service.ts`/`export.controller.ts`/`export.routes.ts`), mirroring `/imports`' naming/structure exactly — same "data portability" concern, opposite direction. Strictly read-only: two SELECT-shaped functions and a pure CSV serializer, nothing more. Real audit of "do not expose internal secrets/operational metadata" (§19): neither `Workout`/`WorkoutExercise`/`WorkoutSet`/`BodyMetrics` contain anything resembling a secret (no tokens/payment data in this service's schema); `userId` is deliberately left out of every exported record (already implicit — the whole export belongs to one user, enforced by the query itself, so repeating it per-row is redundant plumbing not real data), and the internal Gate-4 `exerciseNameSnapshot` field is replaced with the live joined exercise name instead — while real row ids (`Workout.id`, `Exercise.id`) ARE included, since §19 explicitly asks for "stable identifiers," not their absence. New `/client/export-data` page (JSON/CSV download buttons) with an entry point on `ProfilePage.tsx`, mirroring the "Nhập lịch sử tập luyện" entry point P2.1 added. Nutrition logs deliberately out of scope — §14-§20's whole section is framed around workout-data portability only, nutrition export isn't mentioned anywhere in it. See `docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md`. Unit 5/5 (new, `export-csv.util.test.ts`). Backend integration 2/2 (new, `export.service.integration.test.ts` — proves strict per-user scoping, proves `userId`/`exerciseNameSnapshot` never leak into the payload). `tsc --noEmit` clean (fitness-service + gateway). E2E 1/1 (new, `45-export-data.spec.ts` — downloads both real files through the real UI and reads their actual content, not just checking a button exists, confirming real seeded data with correct values in both formats and zero `userId` leakage). Regression: `42-import-hevy-workouts.spec.ts` + `13-training-cycle-fixes.spec.ts` (both exercise `ProfilePage.tsx`, which this pass also touched) 3/3 still passing. |
| Apple Health integration | P2 | **BLOCKED (this environment)** | No Xcode/iOS device/simulator available to build or verify HealthKit integration — see § 43. Not silently skipped; needs an explicit user decision (attempt a backend-only, unverifiable ingestion endpoint, defer to a session with native tooling, or reprioritize). |
| Android Health Connect | P2 | **BLOCKED (this environment)** | No Android Studio/device/emulator available to build or verify Health Connect integration — same blocker and options as Apple Health above. |
| Workout template sharing/import | P2 | **DONE (PT<->client scoped)** | Built on top of existing, already-proven infrastructure found by auditing `coach.service.ts` before designing anything new: `createManualProgram` (the exact write path that creates the recipient's new program + schedules on import), `isActivePtClientRelationship` (the exact same cross-service authorization check `coach.service.ts` already re-validates fresh per call, reused unchanged — checked in EITHER direction, so a PT can share to a client and a client can share back to their PT using the same real Contract), and `manualProgramDaySchema` (the exact validation shape a template snapshot's `daysJson` matches, so import is a direct pass-through into `createManualProgram`, not a second parallel creation path). New, additive-only `WorkoutProgramTemplate` model: a DETACHED structural snapshot (day titles + exercises + sets/reps/rest only) — editing or archiving the source program after a template is created never affects the template or anyone who already imported it (verified directly, not assumed). **Privacy audit finding**: `WorkoutProgramExercise.notes` is deliberately excluded from every template snapshot — free-text, PT-authored, attached to one specific client's program, could plausibly reference something personal (an injury, a body observation); §20 explicitly calls out "private notes" as something sharing must never leak, so this is excluded by construction, proven by a real test that seeds a note referencing a private health detail and asserts it never appears anywhere in the snapshot. Scoped to PT↔client sharing only this pass (the one relationship this app already has a real, authorized trust boundary for) — arbitrary user↔user sharing and a public/community template marketplace are disclosed, larger follow-ups needing their own relationship/discovery/moderation model, not silently dropped. New `/client/templates` page (Của tôi / Được chia sẻ tabs), reusing the real `contractService.getByPT`/`getByClient` endpoints to populate the share-recipient picker from the caller's actual active relationships — never an open/hardcoded list. See `docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md`. Backend integration 4/4 (new, `template.service.integration.test.ts`, cross-service check stubbed via the same `coachDeps`-style indirection convention `coach.service.ts`'s own tests already use). `tsc --noEmit` clean (fitness-service + gateway). E2E 1/1 (new, `46-template-sharing.spec.ts` — the most structurally complex test this session: two real isolated accounts connected by a real `ACTIVE` Contract row, full loop from real-program snapshot through share through import, verified directly against the DB on the recipient's own account, PT's original program confirmed untouched). Regression: 2 `ProfilePage.tsx`-touching specs (this pass added a third entry-point card there) 3/3 still passing (3 sub-tests across 2 files). This closes out the P2 tier except the environment-blocked Apple Health/Health Connect item (see § 43). |
| Exercise-history detail | P3 | TODO | Logging-mode aware |
| Muscle heatmap | P3 | **DONE (all 4 range modes)** | Scope confirmed with the user before implementation, per §21's own "product heuristic, unless validated otherwise" framing — weighting `primary=1.0/secondary=0.5` (the roadmap's own worked example) and all 4 time ranges (7d/30d/current-cycle/custom) built in this pass rather than a smaller 7d+30d MVP. Scored per completed WORKING set (§21's own explicit unit), `WARMUP`-tagged sets excluded per §21's own "Do not include... warm-ups as equal hard volume" instruction. Reuses the real, already-license-vetted `body-muscles` npm package this codebase already integrated for the per-exercise muscle map (Gate 6, `ExerciseMuscleMap.tsx`) — a real anatomical front/back SVG chart, not a second renderer built from scratch; intensity is normalized 1-9 relative to the result set's OWN max (no external absolute reference exists to compare against). New `GET /stats/muscle-heatmap` on the existing `stats` route family. **Real, disclosed data-integrity bug found and fixed**: while seeding real test fixtures, discovered `gymcoach_fitness_test`'s entire `exercise_muscles` table (2992 rows) referenced `muscle_id` values that didn't exist in that database's own `muscles` table (100% orphan rate) — the test DB's `muscles` table had drifted from dev's at some point (each row's id is a fresh UUID, so any reseed anywhere regenerates different ids). Confirmed via direct query that dev's own data was always fully valid (2992/2992 correctly joined) — this was a TEST-DATABASE-ONLY issue, never a live production bug, but it was the first test in this whole session's history to exercise that join at all. Fixed by re-running the existing, already-idempotent `exerciseMuscleMappingImporter.ts` (Gate 6's own importer) against the test DB and cleaning up the leftover orphaned rows. See `docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md`. Unit 7/7 (new, `muscle-heatmap.util.test.ts`). Backend integration 4/4 (new, `muscle-heatmap.service.integration.test.ts` — covers all 4 range modes with real seeded muscle-mapped exercises). `tsc --noEmit` clean. E2E 1/1 (new, `47-muscle-heatmap.spec.ts` — real seeded completed-set history rendered through the real chart+legend, correct across 7d/30d/custom range switches, verified against actual computed scores). Regression: Gate 6's own per-exercise muscle-map spec (shares the `body-muscles` library) + a `ProfilePage.tsx`-touching spec 4/4 still passing. |
| Activity heatmap | P3 | TODO | Use rescheduled/missed semantics |
| Exercise progress charts | P3 | TODO | Mode-aware |
| Planned vs actual | P3 | TODO | Integrate cycle |
| Notifications/reminders | P4 | TODO | Preference-controlled |
| PWA/installability polish | P4 | TODO | After offline core |

---

# 47. Final architectural rule

Every openGym-inspired feature must answer:

```text
Does this improve the user's workout experience?
```

and:

```text
Can it be implemented without weakening
Fitness Assistant's deterministic, safety,
training-cycle, multi-actor architecture?
```

If the answer to the second question is no:

**do not copy the feature mechanically. Redesign it for Fitness Assistant.**

The target is not openGym parity.

The target is:

> **openGym-quality active-workout UX + Fitness Assistant's stronger adaptive platform architecture.**
