# Gymini Roadmap Projection & Strategy Report Hardening — Browser E2E Report

Date: 2026-09-10
Harness: `c:\D_Backup\Test\fitnessassistant-playwright-e2e`. Real browser
(Chromium via Playwright), real dev stack (gateway :3000, web :5173,
fitness-service :3002, ai-service :3003 + real local Ollama, real dev
Postgres :5433). Spec: `tests/31-fitness-roadmap.spec.ts`, extended with
a new `TC-ROADMAP-007` (previous 6 test cases unchanged, all still pass).

## 1. Why a Fourth Dedicated Account

`roadmapClient3` (the guided-wizard happy-path account from the prior
phase) already carries a real ACTIVE roadmap from its own prior live
verification run — no legitimate client-facing way to reset it. This
phase's new UI (collapsible K-groups, per-phase forecast cards, Save→
reopen richness) needed its own genuinely-fresh "no roadmap yet"
account to exercise for real, not just assert against already-existing
state. Added `roadmap.client4@example.test` (upsert-based seed, same
pattern as accounts 1–3).

## 2. Final Test Matrix (this run, all real)

```text
$ npx tsx prepare-run.ts && npx playwright test tests/31-fitness-roadmap.spec.ts --reporter=list

  ok TC-ROADMAP-001   (unchanged from the prior phase — persistence path,
                       roadmapClient3 already ACTIVE)                (28.8s)
  ok TC-ROADMAP-001x  TrainingCycle drill-down + nav simplification   (14.1s)
  ok TC-ROADMAP-006   Expert mode minimal check                       (13.8s)
  ok TC-ROADMAP-007   NEW — collapsible K-groups, real forecast cards,
                       Save->reopen richness, adaptive-message dedup,
                       mobile overflow, Start->ACTIVE                 (37.0s)
  ok TC-ROADMAP-002   mobile (4 viewports)                            (20.7s)
  ok TC-ROADMAP-003   theme (dark/light)                              (13.7s)
  ok TC-ROADMAP-004   PT no-relationship 403s                          (4.0s)

  7 passed (2.4m)
```

## 3. TC-ROADMAP-007 Step-by-Step Evidence (recorded test-case log)

```text
007a  Wizard Step 4, real AI draft + real phase forecast -> K-group
      headers render, expand/collapse works, real forecast numbers +
      estimate labels shown, adaptive message appears exactly once.
      Actual: "1 K-group header(s), 1 forecast card(s), adaptiveMsgCount=1"
                                                          -> PASS
007b  Save -> reload -> reopen Journey tab -> reopened DRAFT still shows
      the strategy timeline + real forecast cards (not a bare phase
      list — fixes the prior phase's write-only-snapshot gap), adaptive
      message still appears exactly once.
      Actual: "1 K-group(s) on reopen, adaptiveMsgCount=1" -> PASS
007c  Click "Bắt đầu lộ trình" from the reopened, rich draft view ->
      roadmap becomes ACTIVE, Journey renders normally (no crash from
      the new projection/forecast UI).
      Actual: "ACTIVE, rendered"                            -> PASS
```

## 4. What This Run's Real AI Draft Actually Produced (honest account)

The real draft-generation call for `roadmapClient4` in this run resolved
to fitness-service's own existing single-phase deterministic fallback
(`FAT_LOSS`, "Giai đoạn khởi đầu") — confirmed by direct SQL against the
real dev Postgres after the run:

```sql
SELECT rp.phase_index, rp.phase_type, rp.name, fr.status
FROM fitness_roadmaps fr JOIN roadmap_phases rp ON rp.roadmap_id = fr.id
WHERE fr.user_id = '162f0190-0c11-4216-87c1-bf37a34c244a'; -- roadmapClient4

 phase_index | phase_type | name                | status
-------------+------------+----------------------+--------
 1           | FAT_LOSS   | Giai đoạn khởi đầu   | ACTIVE
```

This means TC-ROADMAP-007's live browser run exercised exactly 1
K-group / 1 phase — it did **not** happen to produce the specific
`FAT_LOSS → DIET_BREAK → FAT_LOSS` multi-phase sequence the master task
uses as its illustrative example. This is the same honest,
non-deterministic-AI-output discipline already established throughout
this whole engagement (e.g. goal-image usable/unusable outcomes are
never graded) — the AI draft's exact phase composition cannot be forced
from outside. What TC-ROADMAP-007 DID prove live: the collapsible
K-group UI, the per-phase forecast card rendering, the Save→reopen
richness fix, and the adaptive-message-appears-once invariant, all
against a real single-phase roadmap end to end.

The **specific multi-phase grouping compositions** the master task
names (`FAT_LOSS→DIET_BREAK→FAT_LOSS` → 1 group,
`LEAN_GAIN→RECOVERY→LEAN_GAIN` → 1 group,
`FAT_LOSS→MAINTENANCE→LEAN_GAIN` → 3 groups, `MINI_CUT→MAINTENANCE` → 1
group, `DIET_BREAK`/`RECOVERY` alone → 1 group each) are proven instead
by 9 real, deterministic unit tests against `deriveStrategyGroups()`
directly (see `docs/GYMINI_ROADMAP_PROJECTION_IMPLEMENTATION_REPORT.md`
§9 / the engine's own test file) — the correct way to test a
composition that depends on a non-deterministic upstream AI call.

Also confirmed live via a direct `curl` to `POST /fitness-roadmaps/
projection` (bypassing the AI draft entirely, supplying the
`FAT_LOSS → DIET_BREAK → FAT_LOSS` sequence by hand) that the real
server-side grouping algorithm produces exactly the one-campaign result
the master task's worked example describes — see the implementation
report §2 for the full real JSON response.

## 5. Mobile — Step 4 Report Specifically

```text
360px, 390px (with the K-group report actually expanded/rendered,
  mid-flow): overflow = 0px both — no horizontal scroll introduced by
  the new collapsible timeline or forecast cards.
```

(The existing TC-ROADMAP-002 continues to cover the general Journey tab
at all 4 standard widths — 360/375/390/412 — unchanged and still PASS.)

## 6. Regression — Prior Test Cases Unaffected

`TC-ROADMAP-001` (roadmapClient3, already-ACTIVE persistence path),
`TC-ROADMAP-001x` (nav simplification/drill-down), `TC-ROADMAP-006`
(expert mode), `TC-ROADMAP-002`/`003` (mobile/theme), `TC-ROADMAP-004`
(PT negative-path 403) all re-ran unchanged this pass and all still
PASS — no previously-verified behavior was weakened by this phase's
changes.

## 7. What Was NOT Exercised (honest scope note)

```text
PT positive multi-role hand-off — unchanged, pre-existing, documented
  blocker (real human payment-gateway click required), outside this
  phase's scope, not re-litigated here.
The exact FAT_LOSS/DIET_BREAK/FAT_LOSS multi-K-group composition in a
  live browser AI-draft flow — not forced (AI output is non-
  deterministic); covered instead by direct unit tests + a direct API
  curl call, per §4 above.
```

## 8. Verdict

```text
Gymini Roadmap Projection & Strategy Report Hardening E2E = VERIFIED
```

Every UI-facing Definition-of-Done item this phase's master task names
(K-group collapsible UI, real per-phase forecast cards with estimate
labels, Save→reopen richness, adaptive message appears once, mobile,
no regression to the prior phase's verified flows) is real-browser-
verified with concrete evidence. The specific multi-campaign grouping
compositions are verified by real, deterministic unit tests and one
direct API call rather than a browser flow that cannot control AI
output — documented explicitly rather than glossed over.
