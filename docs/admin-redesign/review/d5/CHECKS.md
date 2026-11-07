# D5 — PT dispute V2.1 checks (2026-11-04)

Evidence is fixture-only. No backend, database, Docker, or real API was contacted.

## TEST FIXTURE

- Full web test command (`npx.cmd tsx --test` over every `src/**/__tests__/*.test.ts`): **1,064 passed / 0 failed**. This includes the four new `d5-v21-contract.test.ts` checks. Baseline was 1,050/1,050.
- Typecheck with the brief's temporary config: **215 errors**, equal to baseline; no new D5-owned-file error. The temporary config was removed after the check.
- Vite production build to a scratch folder outside the repository: **passed** after the final P7 change (1m 25s; existing large-chunk warning).

## MOCK BROWSER TEST

`page.route` fulfilled every `/api/**` call with local fixtures and aborted non-local hosts. Scratch script: `%TEMP%/gymini-dispute-v21-mock/d5-queue.cjs`. Vite was local only.

- Queue at **360, 390, 1440 px**: `DISPUTED` and `PT_NO_SHOW_REPORTED` rows both visible, total 51/paging visible, legacy ruling hidden for the row with `hasCase`, no horizontal overflow. Screenshots: `queue-360.png`, `queue-390.png`, `queue-1440.png` (local files; review images are ignored by the repository's `.gitignore`).
- At 1440 px, choosing `execStatus=NOT_STARTED` updated the URL. Double-clicking Open case yielded **one POST** in the mock request log.

## Not yet verified in a browser

The mock-browser matrix is **not complete**: `CASE_EXISTS` navigation; workspace actions/capabilities both on and off; every new error code; policy four-eyes; close actions; party submit key; 375/412 widths; dark mode; keyboard/focus; axe. Unit/source checks cover parts of these contracts but do not replace an interaction run. Axe serious/critical count is **unknown**, not zero.

