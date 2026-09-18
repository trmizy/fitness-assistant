# Gymini Guided Roadmap Creation — Browser E2E Report

Date: 2026-09-10
Harness: `c:\D_Backup\Test\fitnessassistant-playwright-e2e` (external,
outside the app repo). Real browser (Chromium via Playwright), real dev
stack (gateway :3000, web :5173, fitness-service :3002, ai-service :3003,
real local Ollama for the AI draft, real dev Postgres :5433), real
`POST /ai/agent/goal-image` vision call with a synthetic (non-personal)
PNG fixture. Spec: `tests/31-fitness-roadmap.spec.ts` (rewritten this
phase — supersedes the prior "closure pass" spec entirely, since the old
two-flat-button creation UI no longer exists).

## 1. Why Three Dedicated Accounts

```text
roadmapClient  — already carries a real ACTIVE roadmap left over from an
                 earlier verification phase (2026-09-09). There is no
                 legitimate client-facing way to abandon an ACTIVE
                 roadmap+phase, so this account can only ever exercise
                 the "already ACTIVE, verify persistence" branch — used
                 for TC-ROADMAP-001x/002/003/004 (nav/mobile/theme/PT-403
                 checks, none of which need a "no roadmap" precondition).
roadmapClient2 — dedicated to the minimal Expert-mode check (TC-ROADMAP-006).
roadmapClient3 — NEW this phase. Dedicated solely to the guided-wizard
                 happy path (TC-ROADMAP-001) so it could run against a
                 genuinely fresh "no roadmap yet" account and produce
                 real Save/Start DB evidence, not just a persistence
                 check of already-existing state.
```

First run attempt correctly discovered this problem live (not
hypothesized): pointing TC-ROADMAP-001 at `roadmapClient` took the
"already ACTIVE" short-circuit branch (confirmed via the recorded test
case log showing only `TC-ROADMAP-001-rerun`, none of the `-a` through
`-h` sub-steps) — meaning the Save/Start DB-evidence assertions were
never actually exercised. Fixed by adding a third dedicated seed account
(`roadmap.client3@example.test`, upsert-based, same pattern as the other
two) and repointing the happy-path test at it.

## 2. A Real Bug This E2E Run Caught (and the fix)

First real run against `roadmapClient3` failed at the Step 4 assertion
for the permanent adaptive-Gymini messaging:

```text
Error: strict mode violation: getByText(/Lộ trình này không cố định/)
resolved to 2 elements:
  1) <p>Chưa đủ dữ liệu tỷ lệ mỡ cơ thể để so sánh chi ti…</p>
  2) <div>Lộ trình này không cố định — sau mỗi chu kỳ tập l…</div>
```

Root cause: `fitness-diagnosis.engine.ts`'s `buildDiagnosisReasoning()`
always appended the exact same "Lộ trình này không cố định..." sentence
as its last line, AND the wizard's Step 4 renders a separate, dedicated,
always-visible paragraph with the identical sentence — the same copy was
on screen twice. Fixed by removing the trailing sentence from
`buildDiagnosisReasoning`'s own output (the wizard's dedicated permanent
paragraph is the one, single home for that messaging, matching the
master task's own explicit distinction between "Nhận định lộ trình"
reasoning and a separately-described "permanent" adaptive-messaging
block). Updated the corresponding unit test
(`fitness-diagnosis.engine.test.ts`) and integration test
(`fitness-roadmap.service.integration.test.ts`) to assert the sentence
is *absent* from `reasoning` instead of present — both re-run green
(191/191, see implementation report §10). `gymcoach-fitness-dev`
restarted to load the fix; re-verified live via curl before re-running
the E2E suite.

## 3. Final Test Matrix (this run, all real)

```text
$ npx tsx prepare-run.ts && npx playwright test tests/31-fitness-roadmap.spec.ts --reporter=list

  ok TC-ROADMAP-001   guided wizard (4 steps) -> diagnosis + report ->
                      Save (DRAFT, 0 cycles) -> Start (ACTIVE, 1 cycle)
                      -> refresh persists                          (1.0m)
  ok TC-ROADMAP-001x  TrainingCycle drill-down route reachable, old
                      3-tab nav confirmed gone                    (14.4s)
  ok TC-ROADMAP-006   Expert mode preserved as secondary path, still
                      creates a DRAFT                              (15.7s)
  ok TC-ROADMAP-002   mobile viewports, no horizontal overflow      (21.3s)
  ok TC-ROADMAP-003   dark/light theme render                       (14.0s)
  ok TC-ROADMAP-004   PT no-relationship 403s                        (5.2s)

  6 passed (2.3m)
```

## 4. TC-ROADMAP-001 Step-by-Step Evidence (recorded test-case log,
verbatim from `02-test-cases.csv`)

```text
001a  No-roadmap state offers the guided wizard as primary ("Tạo lộ
      trình cùng Gymini") + "Tạo lộ trình nâng cao" secondary link;
      wizard opens on Step 1                          -> PASS
001b  Fill weight/height/age/gender + manual body-fat% -> advances to
      Step 2                                            -> PASS
001c  Select "Vận động vừa" -> real BMR/TDEE energy breakdown renders,
      reconciled to TDEE. Actual: "BMR row visible: BMR (công thức
      Mifflin-St Jeor)"                                 -> PASS
001d  Pick goal, target weight/timeframe, upload synthetic goal image
      (real POST /ai/agent/goal-image call) -> disclaimer text shown;
      usable=false handled cleanly, no crash            -> PASS
001e  Step 4 renders Fitness Diagnosis + Roadmap Report with K-groupings,
      reasoning text, the permanent adaptive-messaging, Save/Start
      buttons. Actual: "2 K-group(s) rendered"           -> PASS
001f  Click "Lưu để xem sau" -> DB evidence:
      status=DRAFT, trainingCycles=0                     -> PASS
001g  Rapid double-click "Bắt đầu lộ trình" -> DB evidence:
      ACTIVE, 1 activate request, activePhases=1, trainingCycles=1
                                                          -> PASS
001h  Refresh + navigate away and back -> ACTIVE persists -> PASS
```

## 5. DB Evidence — Independently Re-Verified by Direct SQL

Beyond the test's own `readOnlyQueryOnDb` assertions, re-queried
directly after the run finished, against the real dev Postgres:

```sql
SELECT fr.status, fr.created_by_role,
       count(rp.id) FILTER (WHERE rp.status='ACTIVE') AS active_phases,
       count(tc.id) AS cycles
FROM fitness_roadmaps fr
LEFT JOIN roadmap_phases rp ON rp.roadmap_id = fr.id
LEFT JOIN training_cycles tc ON tc.roadmap_phase_id = rp.id
WHERE fr.user_id = '<roadmapClient3's real user id>'
GROUP BY fr.id, fr.status, fr.created_by_role;

 status | created_by_role | active_phases | cycles
--------+------------------+---------------+--------
 ACTIVE | AI               |             1 |      1
```

Confirms, independent of the test code: **exactly one ACTIVE
RoadmapPhase, exactly one TrainingCycle** for the roadmap the guided
wizard created and started — matching the master task's explicit
requirement verbatim ("Start creates exactly one ACTIVE phase/cycle").
`created_by_role=AI` confirms the wizard's Save/Start flow reused the
existing `acceptAiRoadmapDraft` (AI-attributed) code path unchanged, not
a new one.

## 6. Expert Mode (TC-ROADMAP-006) — Also Real DB Evidence

```text
status=DRAFT, createdByRole=CLIENT, trainingCycles=0
```

Confirms the raw `phaseType` picker (`ManualCreatePanel`, moved behind
"Tạo lộ trình nâng cao") is unchanged, still fully functional, still
creates a real DRAFT with zero TrainingCycle rows, attributed to
`CLIENT` (not `AI`) as expected for the non-AI creation path.

## 7. Mobile / Theme

```text
360x800 / 375x812 / 390x844 / 412x915 — overflow=0px (all 4, PASS)
dark   — body background rgb(10, 10, 10)   (real painted color, PASS)
light  — body background rgb(248, 250, 252) (real painted color, PASS)
```

## 8. What Was NOT Exercised (honest scope note)

```text
PT positive multi-role hand-off (PT creates a draft for an active
  client, client sees/activates it) — unchanged from every prior phase's
  documented blocker: requires a real human clicking through
  fixtures/realPayment.ts's deliberately-manual real-payment-gateway
  flow to establish an ACTIVE PT-client contract. Not attempted this
  pass — same honest, evidenced blocker as
  docs/FITNESS_ROADMAP_PT_POSITIVE_E2E_REPORT.md, not re-litigated here.
AI scan body-fat method — not exercised because it is a disabled/
  "Sắp ra mắt" button in the UI by design (no safe service exists);
  confirmed by direct code inspection, not by attempting to click a
  disabled control in the browser.
```

## 9. Verdict

```text
Gymini Guided Roadmap Creation E2E = VERIFIED
```

Every critical path the master task's Definition of Done names for the
guided-wizard flow (guided creation, body-fat input methods, activity/
TDEE display, goal-friendly selection, goal image with disclaimer,
Fitness Diagnosis screen, richer Roadmap Report with K-groupings,
reasoning + permanent adaptive messaging, Save=DRAFT/0-cycles,
Start=ACTIVE/1-cycle via the existing lifecycle, TrainingCycle drill-
down reachable, nav simplified to 2 tabs, expert mode preserved
secondary, mobile, theme, PT negative-path 403) is real-browser-verified
with concrete DB evidence, in a run performed after fixing one real bug
this same E2E pass caught.
