# D6 — gym/membership complaint checks (2026-11-04)

## TEST FIXTURE

- Full web suite: **1,064 passed / 0 failed**, including four `d6-gym-contract.test.ts` checks. Baseline 1,050/1,050.
- Typecheck: **215 errors**, equal to baseline; no new D6-owned-file error. Vite production build: **passed**.
- Contract/source checks cover H1 paging, `CASE_REQUIRED`, gym read-only status, member-safe projection, and G1/G22/G23 request shape. They are not proof that the write routes are enabled.

## MOCK BROWSER TEST

All `/api/**` requests used `page.route` fixtures; non-local hosts were aborted. Scratch scripts: `%TEMP%/gymini-dispute-v21-mock/d6-admin.cjs` and `d6-member.cjs`.

- Admin old complaint dialog at **390 px**: start and resolve controls present, no-auto-refund warning visible, gym-case write-off note visible, no horizontal overflow. Screenshot: `admin-complaint-dialog-390.png`.
- Member case list/detail at **360 and 1440 px**: member-safe read view visible, no internal private status marker, no horizontal overflow. Screenshots: `member-list-360.png`, `member-detail-360.png`, `member-detail-1440.png` (local, ignored by review `.gitignore`).

## Blocked and unverified

- **G1 and G22–G23 write forms are not exposed.** Backend has no gym-case capabilities endpoint. The member `canSubmit` field is not an effective-flag signal. Treating those flags as unknown/off follows the brief. Admin workspace G5–G19 is different: its server `allowedActions[]` is computed with `gymCaseEnabled()` (backend `case.service.ts:1083–1084`), so forms are shown only for actions explicitly allowed by that response. A full mocked decision → execute flow was **not browser-run**, so it cannot be claimed as verified.
- Browser scenarios not run: G1/open existing navigation, full decision/execute, a returned `GYM_CASE_DISABLED`, member submit and account switch, 375/412 widths, dark mode, keyboard/focus, axe. Axe serious/critical count is **unknown**.
- The read pages are built for G2–G4 and G20–G21. They have not been exercised against a migrated service/gateway (explicitly out of scope).

