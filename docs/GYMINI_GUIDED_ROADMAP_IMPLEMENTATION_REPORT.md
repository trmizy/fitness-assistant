# Gymini Guided Roadmap Creation — Implementation Report

Date: 2026-09-10
Scope: transform the bare two-flat-button roadmap creation UI into a
guided, 4-visible-step wizard; add a read-only Fitness Diagnosis engine
(BMR/TDEE/FFMI/target-realism/reasoning); extend the AI roadmap-draft
contract with optional target fields; simplify Training navigation from
3 equal tabs to 2, folding TrainingCycle inline into the Journey page as
a drill-down. No FitnessRoadmap/RoadmapPhase lifecycle redesign — every
change extends the already-verified DRAFT→ACTIVE path, single-pending-
draft policy, AI-draft contract, and PT integration built in prior
phases. See `docs/GYMINI_GUIDED_ROADMAP_CREATION_DESIGN.md` for the full
17-section design this implements.

## 1. New Backend Module — `fitness-diagnosis.engine.ts`

`backend/services/fitness-service/src/services/fitness-diagnosis.engine.ts`
(new file). Pure calculation, no I/O, no AI dependency — mirrors
`nutrition-bootstrap.engine.ts`'s own architectural discipline so the
diagnosis screen works even if ai-service is down.

```text
computeEnergyBreakdown(input) -> { bmr, bmrFormula, tdee, components[] }
  Calls computeInitialNutritionPrescription() directly (goal="MAINTENANCE",
  goal-neutral) — the ONE authoritative BMR/TDEE calculation, never
  reimplemented. Allocates the real (TDEE - BMR) gap across illustrative,
  labeled rows (steps/training/TEF/other) that ALWAYS reconcile exactly
  to that same real gap — verified by a dedicated unit test asserting
  bmr + sum(components) === tdee for every input combination tried,
  including all-zero training/steps (remainder folds into "Hoạt động
  khác", never dropped).

computeFfmi(weightKg, heightCm, bodyFatPct) -> { fatFreeMassKg, ffmi, normalizedFfmi }
  Standard, well-established formula (Kouri et al. 1995 normalized
  variant) — confirmed via repo-wide grep that no FFMI calculation
  existed anywhere in the product before this.

assessTargetRealism(input) -> { warnings[], suggestedMinTimeframeWeeks }
  Deterministic, non-medical sanity check on requested weight-change
  timeframe against literature-cited safe weekly-rate bounds (same
  hall-2011/garthe-2011 sources nutrition-bootstrap.engine.ts already
  cites). Warn-only, same "never hard-block" principle as safety
  screening — never silently substitutes a different timeframe.

buildDiagnosisReasoning(args) -> string
  Deterministic, template-based Vietnamese reasoning text (never an LLM
  call). Renders "Chưa đủ dữ liệu" instead of fabricating a comparison
  when body-fat data is missing on either side.
  CORRECTION (docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md §29):
  this originally also appended the permanent adaptive-Gymini messaging
  ("Lộ trình này không cố định...") as its own last line — a real bug
  found by this phase's own E2E run (the wizard's Step 4 renders that
  same sentence again as its own dedicated, always-visible element, so
  the two together duplicated it on screen). Fixed the same day, before
  this document was originally published, but this section's own prose
  and the curl example below still described the pre-fix behavior — now
  corrected to match final code. The permanent adaptive-Gymini messaging
  lives ONLY in the wizard's dedicated Step 4 paragraph (and
  DraftRoadmapDetail's own copy on reopen), never inside `reasoning`.
```

## 2. New API — `POST /fitness-roadmaps/diagnosis`

Read-only. Zero database write, zero AI call. Every input field is an
OPTIONAL override of the caller's stored user-service profile/InBody —
works with nothing supplied at all (falls back to stored data, then to
explicit `dataCompleteness` flags / null fields for the frontend to
render "Không đủ dữ liệu").

```text
models/fitness-roadmap.models.ts: + fitnessDiagnosisInputSchema, FitnessDiagnosisInput
services/fitness-roadmap.service.ts: + getDiagnosis(userId, input)
  - fetches real profile/InBody via existing fetchUserProfile/
    fetchLatestInBodyOnOrBefore (same clients generateAiRoadmapDraft uses)
  - InBody-measured body-fat % always outranks a manual/visual wizard
    estimate, same priority the AI draft context already applies
  - calls fitness-diagnosis.engine.ts's four functions
  - returns { current, target, energyBreakdown, dataCompleteness, safety,
    targetRealism, reasoning }
controllers/fitness-roadmap.controller.ts: + diagnosis handler
routes/fitness-roadmap.routes.ts: + POST /diagnosis (registered before
  the /:roadmapId param routes for readability; no path collision since
  it's a distinct top-level literal segment)
```

Gateway: no change needed — `router.use("/fitness-roadmaps", ...)` in
`backend/gateway/src/routes/proxy.routes.ts` already proxies the whole
prefix (added in a prior phase), confirmed by reading the rule before
concluding no gateway edit was required.

Live-verified against the real dev stack (not just unit tests):

```text
$ curl -X POST http://localhost:3000/fitness-roadmaps/diagnosis \
    -H "Authorization: Bearer <real token>" \
    -d '{"weightKg":82,"heightCm":178,"age":29,"gender":"MALE","activityLevel":"MODERATELY_ACTIVE"}'

{"current":{"weightKg":82,...,"bodyFatPct":null,"ffmi":null},
 "energyBreakdown":{"bmr":1793,"bmrFormula":"mifflin_st_jeor","tdee":2779,
   "components":[{"label":"Bước chân hằng ngày","kcal":0,...},
     {"label":"Tập kháng lực","kcal":0,...},
     {"label":"Tiêu hao tiêu hóa (TEF)","kcal":986,...},
     {"label":"Hoạt động khác","kcal":0,...}]},
 "dataCompleteness":{"weight":true,...,"bodyFatPct":false},
 "reasoning":"Chưa đủ dữ liệu tỷ lệ mỡ cơ thể để so sánh chi tiết — lộ
   trình dựa trên mục tiêu bạn đã chọn. Lộ trình này không cố định —
   sau mỗi chu kỳ tập luyện, Gymini sẽ đánh giá lại dữ liệu thực tế..."}
```

**CORRECTION (see docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md §2/§7
and §29 above)**: the `energyBreakdown.components` shape shown in this
captured example is now stale on two counts, both fixed by the Roadmap
Projection & Strategy Report Hardening phase: (1) `reasoning` no longer
ends with the "Lộ trình này không cố định..." sentence (see the
correction above); (2) there is no longer an independent `"Tiêu hao
tiêu hóa (TEF)"` row at all — that was a fixed-15%-of-gap fabricated
line with no defensible independent calculation behind it. The current,
correct shape for this exact zero-steps/zero-training input is:

```text
"components":[{"label":"Hoạt động & tiêu hao khác","kcal":986,"estimated":true}]
```

One honestly-labeled catch-all row, still reconciling exactly to the
same real TDEE — see `docs/GYMINI_ROADMAP_PROJECTION_IMPLEMENTATION_REPORT.md`
§2 for the live-verified current output.

1793 + 0 + 0 + 986 + 0 = 2779 — reconciles exactly, confirming the
invariant holds in real (not just unit-tested) output.

## 3. AI Roadmap-Draft Contract Extension

Optional, additive fields only — never required, never changes the
deterministic goal→phaseType fallback mapping.

```text
fitness-service models/fitness-roadmap.models.ts:
  generateAiRoadmapDraftSchema + targetWeightKg, targetBodyFatPercent,
  trainingDaysPerWeek (all optional)
services/fitness-roadmap.service.ts: generateAiRoadmapDraft's payload
  now threads input.targetWeightKg (outranks stored profile.targetWeight
  when supplied) / targetBodyFatPercent / trainingDaysPerWeek into the
  ai-service request

ai-service schemas/roadmap-draft.schemas.ts:
  + profile.targetBodyFatPercent (targetWeightKg/trainingDaysPerWeek
  already existed from a prior phase)
  trainingDaysPerWeek min relaxed from 1 to 0 — a user reporting zero
  current training days is a real, valid wizard input, never rejected
services/roadmap-draft.service.ts: prompt gains a targetNote line
  ("Mục tiêu số cụ thể do khách hàng đặt... KHÔNG phải một cam kết kết
  quả") only when a target was supplied — never a numeric guarantee.
```

## 4. Frontend — Guided Wizard

New file `frontend/web/src/app/pages/client/GuidedRoadmapWizard.tsx`
(~700 lines). One continuous component, 4 internal steps
(`useState<number>` step 1-4), never four separate routed pages.

```text
Step 1 — Thông tin cơ bản:
  Prefills age/gender/heightCm/currentWeight from profileService.getProfile()
  and inbodyService.getHistory() (InBody weight/bodyFatPct override the
  profile's own currentWeight when present — real measurement wins).
  Body-fat input: "Nhập số liệu" (manual number), "Ước lượng qua hình ảnh
  tham khảo" (4 visual-reference tiers with % ranges, no AI scan), a
  disabled "Quét bằng AI · Sắp ra mắt" button (title explains why: no
  safe AI body-scan service exists — confirmed by reading
  fitness-goal-vision.service.ts's own code, which is explicitly for
  desired-look attributes, never body measurements), and a "Dùng lại số
  liệu InBody" toggle when a real InBody entry exists.

Step 2 — Tập luyện & Hoạt động:
  5-tier activity-level picker (same Vietnamese labels/order as
  ProfilePage.tsx, so the vocabulary matches elsewhere in the app),
  trainingDaysPerWeek/dailyGoalSteps inputs, then a live Energy
  Expenditure card (BMR row + steps/training/TEF/other rows + TDEE row),
  powered by the new getDiagnosis call — reused, never a competing
  frontend formula.

Step 3 — Mục tiêu:
  User-friendly goal picker (WEIGHT_LOSS/MUSCLE_GAIN/MAINTENANCE/
  ATHLETIC_PERFORMANCE with emoji+description — never a raw phaseType
  enum), target weight/timeframe, target body-fat % + FFMI preview
  tucked behind a collapsed "Tuỳ chọn nâng cao" section. Goal Image moved
  here (reuses fitnessAgentService.image -> POST /ai/agent/goal-image
  unchanged), with a required disclaimer paragraph directly under the
  file input.

Step 4 — Báo cáo & Lộ trình:
  Fitness Diagnosis card: current-vs-target MetricCard grid (weight,
  body-fat %, FFMI, TDEE) — renders "Không đủ dữ liệu" per-metric when a
  value is null, never a fabricated number. Reasoning text from the
  diagnosis engine. Roadmap Report card: reuses the existing
  generateAiDraft call (auto-triggered on entering Step 4), shows total
  duration + projected end date (derived directly from the real
  first/last phase dates — never a separate calculation), K1/K2/K3
  strategy groupings (see §5), warnings, the permanent adaptive-Gymini
  messaging, and the roadmap name input. "Bắt đầu lộ trình" and "Lưu để
  xem sau" buttons.
```

## 5. K1/K2/K3 Phase Grouping — Pure Frontend Presentation

`groupPhasesIntoK()` in `GuidedRoadmapWizard.tsx` chunks the real,
already-generated `RoadmapAiDraft.phases[]` by a 3-bucket classification
of `phaseType` (CUT: FAT_LOSS/MINI_CUT; BUILD: LEAN_GAIN/RECOMPOSITION/
PERFORMANCE; STABILIZE: MAINTENANCE/DIET_BREAK/RECOVERY), merging
consecutive same-bucket phases into K1, K2, K3... groups. **No new
table, no new column** — pure derivation, confirmed by design doc §16's
explicit "NONE" migration decision.

## 6. Save/Start Semantics — Reused, Not Reinvented

```text
"Lưu để xem sau" -> fitnessRoadmapService.acceptAiDraft(...)
  Same call DraftRoadmapDetail's flow always used. Creates a DRAFT
  FitnessRoadmap via the existing single-pending-draft policy
  (createDraftRoadmap) — zero TrainingCycle rows, confirmed by E2E DB
  evidence (see E2E report).

"Bắt đầu lộ trình" -> acceptAiDraft(...) then fitnessRoadmapService.activate(...)
  Same two existing calls chained — the exact reuse the master task
  required ("accept-then-activate, reusing existing acceptAiDraft +
  activate calls, unchanged backend lifecycle"). Once a DRAFT already
  exists (after Save), the unchanged DraftRoadmapDetail component's own
  "Bắt đầu lộ trình" button activates it — no new activation code path.
```

`configuration.diagnosisSnapshot` — new sibling key next to the existing
`configuration.aiDraft`, additive, in `FitnessRoadmap.configuration`
JSONB. Snapshots what the wizard showed the user at Save/Start time.
Never read back as an authoritative value by anything server-side — a
display convenience only, matching the design doc's explicit decision.

## 7. Navigation Simplification

```text
frontend/web/src/app/pages/client/TrainingPage.tsx: 3 tabs -> 2 tabs
  (Nhật ký tập, Lộ trình). The "Chu kỳ tập luyện" tab is gone.
frontend/web/src/app/routes.tsx: + { path: "workout/cycle", Component:
  TrainingCyclePage } — new drill-down route. TrainingCyclePage.tsx
  itself was NOT touched/deleted.
frontend/web/src/app/pages/client/RoadmapJourneyPage.tsx: ActivePhaseDetail
  now also renders adherence rate, body-weight trend, and strength-
  progress-score from the active cycle's own latestAssessment.
  computedMetrics (the SAME already-computed CycleMetrics
  TrainingCyclePage itself reads — never re-derived), plus a "Xem chi
  tiết chu kỳ" link to /workout/cycle for the full drill-down.
```

Confirmed via `grep` across the entire external E2E harness that no
other spec referenced the removed "cycle" tab id or the old creation-UI
button text before making this change.

## 8. Expert Mode — Preserved, Repositioned

`ManualCreatePanel` (raw `phaseType` enum picker) is unchanged code —
only its entry point moved. `NoRoadmapState` now shows the guided wizard
as the single primary button ("Tạo lộ trình cùng Gymini") and a small
secondary underlined text link ("Tạo lộ trình nâng cao (tự chọn từng
giai đoạn)") below it — never equal-weight, never the default.

The old `AiDraftPanel` component (raw goal-buttons + timeframe, no
diagnosis, no report) was deleted as genuinely dead code once the wizard
replaced its only call site — confirmed via grep that nothing else in
the frontend referenced it before removing it.

## 9. API/Type Additions — `frontend/web/src/app/services/api.ts`

```text
+ FitnessDiagnosisInput, FitnessDiagnosisResult (interfaces)
+ fitnessRoadmapService.getDiagnosis(input)
  fitnessRoadmapService.generateAiDraft(input) input type extended with
  targetWeightKg/targetBodyFatPercent/trainingDaysPerWeek (all optional)
```

## 10. Build/Regression Evidence

```text
fitness-service tsc --noEmit:                 EXIT 0
ai-service tsc --noEmit:                      EXIT 0
frontend vite build:                          EXIT 0 (TrainingCyclePage
  now its own lazy chunk; TrainingPage's own bundle shrank 326KB -> 270KB,
  confirming the tab removal actually took effect, not just source-level)

fitness-roadmap.service.integration.test.ts:  44/44 PASS (was 40, +4 new
  getDiagnosis tests — real Postgres, port 55433)
coach.service.integration.test.ts:             7/7  PASS (unchanged)
fitness-diagnosis.engine.test.ts (new):       12/12 PASS (pure unit)
pure baseline (5 engine/util files):         128/128 PASS (unchanged)
                                             ─────────────
                                             191/191 PASS, 0 fail

ai-service roadmap-draft.test.ts:             22/22 PASS (was 19, +3 new
  request-schema tests for targetBodyFatPercent/trainingDaysPerWeek=0)
```

No previously-passing test was weakened or deleted to make room for a
new one — every regression count above is a net increase over the prior
phase's verified baseline.

## 11. Files Changed (this phase)

```text
Backend — fitness-service:
  src/services/fitness-diagnosis.engine.ts (NEW)
  src/__tests__/fitness-diagnosis.engine.test.ts (NEW)
  src/models/fitness-roadmap.models.ts (+ fitnessDiagnosisInputSchema,
    generateAiRoadmapDraftSchema target fields)
  src/services/fitness-roadmap.service.ts (+ getDiagnosis; payload
    threading in generateAiRoadmapDraft)
  src/controllers/fitness-roadmap.controller.ts (+ diagnosis handler)
  src/routes/fitness-roadmap.routes.ts (+ POST /diagnosis)
  src/__tests__/fitness-roadmap.service.integration.test.ts (+4 tests)

Backend — ai-service:
  src/schemas/roadmap-draft.schemas.ts (+ targetBodyFatPercent,
    trainingDaysPerWeek min 1->0)
  src/services/roadmap-draft.service.ts (+ targetNote prompt line)
  src/__tests__/roadmap-draft.test.ts (+3 tests)

Backend — auth-service:
  prisma/seed.ts (+ roadmap.client2@example.test, second dedicated
    E2E account for the Expert-mode check)

Frontend:
  src/app/pages/client/GuidedRoadmapWizard.tsx (NEW)
  src/app/pages/client/RoadmapJourneyPage.tsx (NoRoadmapState rewired to
    the wizard + expert-mode secondary link; dead AiDraftPanel removed;
    ActivePhaseDetail gains inline cycle metrics + drill-down link)
  src/app/pages/client/TrainingPage.tsx (3 tabs -> 2)
  src/app/routes.tsx (+ /workout/cycle drill-down route)
  src/app/services/api.ts (+ FitnessDiagnosisInput/Result, getDiagnosis,
    generateAiDraft input extension)

External E2E harness (c:\D_Backup\Test\fitnessassistant-playwright-e2e):
  fixtures/auth.ts (+ SEED_ACCOUNTS.roadmapClient2)
  tests/31-fitness-roadmap.spec.ts (rewritten for the guided wizard;
    see docs/GYMINI_GUIDED_ROADMAP_E2E_REPORT.md)

Docs:
  docs/GYMINI_GUIDED_ROADMAP_CREATION_DESIGN.md (prior — design gate)
  docs/GYMINI_GUIDED_ROADMAP_IMPLEMENTATION_REPORT.md (this file)
  docs/GYMINI_GUIDED_ROADMAP_E2E_REPORT.md (new)
  docs/GYMINI_TRAINING_INFORMATION_ARCHITECTURE.md (new)
  docs/GYMINI_GUIDED_ROADMAP_VERIFICATION_REPORT.md (new)
```

No migration added (53/53 unchanged, re-confirmed). No file belonging to
the parallel Canonical Exercise Identity / AI Workout Grounding /
Equipment / MovementPattern / Substitution / Catalog work was touched —
`git status` was checked before this phase began and none of those paths
appear in the diff above.
