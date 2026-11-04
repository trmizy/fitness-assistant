# D7 — money-exception checks (2026-11-04)

## TEST FIXTURE

- Full web suite after the final P7 wording fix: **1,064 passed / 0 failed**, including eight `d7-money-exceptions.test.ts` checks. The existing 38 reconciliation utility tests passed without modification.
- Typecheck: **215 errors**, equal to baseline; no new D7-owned-file error. Vite production build: **passed**.
- Source/fixture tests cover flag gating, no typed amount/actor fields, structured P4 evidence references, P6 reject/P7 handover bodies, four-eyes refusal, 202 `NOT_EXECUTED` wording, rejected reproposal, late-open action bodies, and status/ledger labels. This is not a real write execution.

## MOCK BROWSER TEST

All `/api/**` calls used `page.route` fixtures; non-local hosts were aborted. Scratch scripts: `%TEMP%/gymini-dispute-v21-mock/d7-flags-off.cjs`, `d7-flags-on.cjs`, and `d7-late.cjs`.

- D65-B flag **off** at **360 px light** and **1440 px dark**: read surface and muted feature-off notice visible, **zero write buttons**, no horizontal overflow. Screenshots: `held-off-360.png`, `held-off-dark-1440.png` (local files ignored by review `.gitignore`).
- D65-B flag **on** at **390 px** with local fixtures: proposer cannot approve or reject (both disabled, zero POST); second admin's approve returned mock **202 NOT_EXECUTED** with a warning that the ledger has not confirmed the credit, and mock **200 EXECUTED** with wallet-only wording. Double-click on each submit yielded **one POST** with `reason`, `conflictOfInterestDeclaredNone:true` and an idempotency key, with no actor/amount field. P6 reject yielded a no-money result. P7 handover by a third admin returned mock 202; the warning now tells the takeover admin to check and retry P7, not the departed approver. Escape closed the approve dialog and focus returned to its opener before reopening. All four action screens had no horizontal overflow. Screenshots: `approved-not-executed-390.png`, `executed-390.png`, `rejected-390.png`, `handover-not-executed-390.png`.
- Late-open flag **on** at **390 px**: an `OPEN` obligation with `unpaid=100000` was shown as still owed before each write. Mock retry responses `EXECUTED`, `BLOCKED`, `FAILED`, and `IN_FLIGHT` produced distinct messages; only `EXECUTED` said 100,000 ₫ was credited to the Gymini wallet. Each double-click produced **one POST** with an empty body (the L8 route does not consume an idempotency header). An `EXECUTION_EXHAUSTED` fixture showed the recovery path; opening a supplemental run sent one POST containing only `reason` and an idempotency key, with no money claim. No horizontal overflow. Screenshots: `late-executed-390.png`, `late-blocked-390.png`, `late-failed-390.png`, `late-in-flight-390.png`, `late-recovery-390.png`.

## Not yet verified in a browser

P4 propose and P7 200 variant; late-open claim/handover/propose/approve/reject and recovery approval/rejection; reconciliation row links; 375/412 widths; full keyboard/focus traversal and axe. Apart from the Escape/focus-return interaction above, these are implemented or source-tested in part but **not browser-verified**. Axe serious/critical count is **unknown**.

P4 accepts structured evidence IDs/hash or ledger-operation keys because the backend verifies those references. P2 preview does not provide a selectable list of valid references; the admin needs the identifiers from an external record. This is a usability gap, not proof of execution.

