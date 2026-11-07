# Codex hand-back — Dispute V2.1 frontend D5 / D7 / D6 (2026-11-04)

## Scope and verdict

Work stayed in `D:/admin-fr` on `admin-finance-redesign`. This is a **fixture-only frontend hand-back, not acceptance of the full brief**. The web suite and build pass, and the temporary typecheck is at baseline, but the required mock-browser matrix is incomplete. G1 and member G22–G23 writes are deliberately hidden because the gym service offers no reliable flag/capabilities read for those surfaces. Do not call these flows finished or enabled. No backend, Docker, database, package install, or real API was used.

Evidence terminology throughout: **TEST FIXTURE** means unit/source tests; **MOCK BROWSER TEST** means Playwright against local Vite with `page.route` fixtures. Neither is a deployed integration test.

### Common verification

| Check | Result |
| --- | --- |
| TEST FIXTURE, all `src/**/__tests__/*.test.ts`, serial `npx.cmd tsx --test` | **1,064 passed; 0 failed; 0 skipped** (baseline 1,050/1,050) |
| Temporary TypeScript config specified in brief | **215 errors**, exactly baseline; no additional owned-file errors. Existing `Outlet`/`NavLink`/`Toaster` JSX type errors remain in shell/routing. |
| Vite production build to `%TEMP%/gymini-dispute-v21-final-build` | **Passed** after final P7 change, 1m 25s; existing >500 kB chunk warning |
| Existing reconciliation utility suite | **38 passed**, not changed |
| Mock browser | Partial, details and screenshots in `d5/CHECKS.md`, `d6/CHECKS.md`, `d7/CHECKS.md` |
| Axe serious/critical | **Unknown**: axe was not available/run. Never interpreted as zero. |

The local screenshot PNGs in `d5/`, `d6/`, `d7/` are ignored by `docs/admin-redesign/.gitignore` by repository policy, but remain on disk. Mock scripts remain outside the repository at `%TEMP%/gymini-dispute-v21-mock/`. All scripts intercept `/api/**` and abort non-local hosts.

## D5 — PT dispute UI

Changed the existing `frontend/web/src/app/pages/admin/disputes/` API/types/errors/labels, queue, workspace, action slots, and overview/evidence/finding/approval/history/execution tabs; updated `AdminDisputes.tsx`, `components/layout/{Topbar,admin/AdminTopbar}.tsx` for minimal notification navigation. Added `actions/{CloseActions,ExecutionActions,PolicyActions,executionModel}` and `workspace/{policyModel,tabs/PolicySection}`. Added `pages/admin/__tests__/d5-v21-contract.test.ts`. The party route remains in `pages/disputes/`; its mandatory key path was aligned in the existing dispute client.

The queue uses server paging and both session statuses; case filters are URL-backed; `hasCase` prevents legacy ruling; `CASE_EXISTS` points to the case. The workspace renders server `allowedActions` and effective capabilities, execution state/history, close reasons, access/session information, and case/contract policy reviews. Confirmations and error mapping do not equate business completion with money received, and do not read `ledger.result`.

**TEST FIXTURE:** four new D5 checks, within the 1,064/1,064 full-suite result. **MOCK BROWSER TEST:** 360/390/1440 queue, two session types, 51-row paging indicator, `hasCase` legacy ruling hidden, URL exec-status filter, one POST on double-click, no horizontal overflow. See `d5/CHECKS.md`. Browser coverage of all new errors, `CASE_EXISTS`, policy four-eyes, close actions, party submit key, action/capability combinations, keyboard/focus/axe remains **not done**.

## D7 — money exceptions in Finance › Reconciliation

Changed `AdminReconciliationBlocks.tsx`, `AdminReconciliationPanel.tsx`, `reconciliation/reconciliationView.ts`; added the `reconciliation/moneyExceptions/` module (API, type normalisers, models, labels/errors, data/write hooks, D65-B and late-open views/dialogs, shared parts). Added `pages/admin/__tests__/d7-money-exceptions.test.ts`. Existing Finance chips/groups remain; D7 state uses `?view=` and adds no route.

D65-B reads P1–P3 and offers P4/P5 plus the newer P6 rejection/P7 handover behind `d65bResolution`. P4 sends structured evidence refs (`EVIDENCE` UUID/hash or `LEDGER_OP` key), never a user-entered amount. P5/P7 result text distinguishes 200 executed from 202 `NOT_EXECUTED`; a third admin can request handover but the server must confirm that the original approver is inactive. Late-open reads/status/ledger observations and claim/handover/propose/approve/reject/retry/recovery actions are behind `lateOpenReconciliation`; `OPEN` never means paid. Every write uses the shared idempotent action path and token identity.

**TEST FIXTURE:** eight new D7 checks, within 1,064/1,064. The existing 38 reconciliation utility checks are unchanged. **MOCK BROWSER TEST:** flag-off at 360 light/1440 dark; flag-on at 390 with four-eyes disabled, P5 200/202, P6 reject, P7 handover 202, one POST per double-click and strict body fields. Late-open mock retry covered `EXECUTED`, `BLOCKED`, `FAILED`, `IN_FLIGHT`; exhausted → open recovery sent one reason-only POST. See `d7/CHECKS.md`. P4 browser submit, P7 200, remaining late-open actions/recovery decisions, full keyboard/focus/axe remain **not browser-verified**. The P4 source preview does not supply a picker for verifiable evidence IDs/hash/ledger keys; admins must obtain them externally, a usability gap.

## D6 — gym/membership complaint cases

Changed `AdminComplaintsPage.tsx`, `routes.tsx`, `components/layout/Sidebar.tsx`, and `types/index.ts` minimally for the old page, case and member read routes. Added `pages/admin/complaints/` (case API/types/errors/labels/models, queue parts, workspace tabs/forms) and `pages/complaints/MyGymComplaintCasesPage.tsx`. Added `pages/admin/__tests__/d6-gym-contract.test.ts`. Old-page function inventory is in `d6/PARITY.md`.

Old complaints now use H1 `limit`/`offset`/`meta`, validate status values, pick `assignedAdminId` from an ADMIN list, and direct `CASE_REQUIRED` to a case; resolving an old complaint still does **not** auto-refund. Admin gym-case G2–G4 read screens and G5–G19 forms use G3 `allowedActions[]`; backend `case.service.ts:1083–1084` computes these with the effective gym flag, and the server rechecks writes. Member G20–G21 use the member-safe read projection. The G18 refund text names the wallet route only when the server confirms execution.

**TEST FIXTURE:** four new D6 checks, within 1,064/1,064. **MOCK BROWSER TEST:** old complaint dialog at 390, member list/detail at 360/1440, no horizontal overflow. See `d6/CHECKS.md`. The full decision → execute sequence, admin G5–G19 interactions, `GYM_CASE_DISABLED` browser handling, account switch, keyboard/focus/axe and member submit remain **not browser-verified**.

**G1 and G22–G23 remain blocked at the UI:** no gym capabilities endpoint exists. For G1 there is no case `allowedActions` before opening; for G22–G23 the member `canSubmit` field at `case.service.ts:1000` depends on status but not on `gymCaseEnabled()`. Their forms are hidden and a muted explanation is rendered. The G1 form implementation exists but is dormant until a reliable flag signal is supplied. This is deliberate fail-closed behavior, not completed parity.

## Contract/document conflicts and source choice

1. `DISPUTE_V21_API_CONTRACT_FINAL.md:187–196,199` says G2–G4 and G20–G21 reads are READY, while its summary at `:233–234` still counts those five as BLOCKED. Backend gym routes/tests and the detailed rows win; D6 read views were built, but no deployed gateway claim is made.
2. The same contract's `:199` first describes H1 as paginated with `meta` and `X-Total-Count`, then ends “H1 still unpaginated.” The gym implementation/test and the first statement win. Old complaints use opt-in server paging; unpaginated legacy behavior is not assumed.
3. The initial brief names D65-B P1–P5, but the current contract/backend also define P6 reject, P7 handover and `REJECTED`. Current code wins; D7 supports P6/P7 and replacement proposal after rejection. No money is moved on rejection.
4. The brief's shorthand P4 `evidenceRefs[1..20]` does not reveal the strict per-reference object schema. Backend controller/service and current contract row P4 win; D7 sends structured verified references, not free-text strings.
5. G3 admin `allowedActions` *is* flag-aware (`case.service.ts:1083–1084`), while G21 member `canSubmit` is not (`:1000`). No gym capabilities read route was found. D6 therefore trusts admin `allowedActions` but does not infer member or G1 write availability from status alone.

These are the disagreements identified in the supplied contract/brief against the inspected source; no undocumented policy was invented to resolve them.

## Existing tests updated for the changed contract

All were existing D1–D3 tests, changed only where V2.1 explicitly replaced the old contract; none were removed or skipped:

- `d1-api-client.test.ts`: new endpoints, mandatory idempotency and response shapes.
- `d1-labels-financial.test.ts`: V2.1 money/status language.
- `d2-queue-model.test.ts`: new queue statuses, paging and legacy-case guard.
- `d2-source-guards.test.ts`: forbid stale `ledger.result`/constant reads and unsafe routes while allowing new execution/policy clients.
- `d2-workspace-model.test.ts`: new execution/close/policy state and tab behavior.
- `d3-action-model.test.ts`: current server action/response contracts.
- `d3-source-guards.test.ts`: preserve safety guards but permit approved V2.1 execution/policy actions.
- `disputes/__fixtures__/disputeCaseFixtures.ts`: representative V2.1 fields used by those tests.

No D4 test or `adminReconciliation.utils` test was edited.

## Required follow-up before acceptance

1. Complete the section 7 mock-browser matrix with all flags/statuses, forbidden-body assertions, keyboard/focus, 360/375/390/412/1440 and dark mode, and axe serious/critical = 0. The current screenshots prove only the scenarios written in the batch checks.
2. Supply a trusted gym-case capabilities read for pre-case G1 and member G22–G23, or an explicit product/backend-approved alternative. Until then keep their writes hidden.
3. In an authorized isolated environment later, migrate/deploy the backend and run actual integration against it; this was explicitly prohibited in this task.

No `git add`, commit, stash, reset, checkout, merge, rebase or push was performed. No temporary `tsconfig.d5tmp.json` remains. No files were written under `D:/FitnessAssistant` or `D:/fa-bc`.

