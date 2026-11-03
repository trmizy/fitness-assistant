# D1 - foundation layer for the Dispute V2.1 admin UI: checks

Evidence label for every number below: **TEST FIXTURE** (pure functions, fake HTTP client, fixtures copied from real response shapes of commit fd199953; no server, no database, no browser was used). Nothing here is REAL BROWSER or REAL HTTP/API.

## Run
| Check | Command (from `frontend/web`) | Result |
|---|---|---|
| Web tests | `npx tsx --test $(find src -path '*__tests__*' -name '*.test.ts')` | **829 / 829 pass**, 0 fail, 0 skipped (baseline 742; +87 new d1 tests: labels/money 26, idempotency/errors/keys 33, API client 16, paid-via-ledger 12) |
| `adminReconciliation.utils.test.ts` (file untouched, `git status` clean) | `npx tsx --test .../adminReconciliation.utils.test.ts` | 38 / 38 pass (the runner counts 38 `it` blocks; the brief said 41) |
| `b4-reconciliation.test.ts` | same | 28 / 28 pass after the legitimate count update (below) |
| `vite build` | `npx vite build --outDir <scratchpad>/d1/dist` | passes (built in 29 s) |
| `tsc` (temp web-only config in the scratchpad, deleted afterwards) | `tsc -p <temp config>` | HEAD 239 errors, working tree 239 errors under the SAME temp config = no increase. The 215 of the master plan came from another temp config that is not recorded; the same-config HEAD comparison is the valid one. All 239 are in unrelated files; the new/changed files add 0 (the one error in `AdminReconciliationBlocks.tsx` line 95 is not in the diff). |

## Changed existing files
- `adminReconciliation.utils.ts`: label `PAID_VIA_LEDGER` = "Đã trả vào ví Gymini"; new tone `ledgerPaid` (not `verified`, not `closed`); `summary.unpaidObligations.paidViaLedger: {count}` (the server sends the count only, no amount).
- `reconciliation/reconciliationView.ts` + `AdminReconciliationBlocks.tsx`: new group/block `obligations-paid-via-ledger` ("Đã trả vào ví Gymini") so those rows are visible again.
- **Group-count tests updated, legitimately**: the new block adds a real group. `b4-reconciliation.test.ts`: 22 -> 23 groups (P13 18 -> 19), with P2 23 -> 24 `<Block>`s, stats keys 22 -> 23, payment-only 18 -> 19, overview total/known 22 -> 23, withItems 21 -> 22, truncated 8 -> 9 (fixtures gained `paidViaLedger`). The 22 original ids are now asserted one by one (`ORIGINAL_22`), so none can be dropped. No other test changed.
- `AdminDisputes.tsx`: header sentence replaced (no more "buổi tập không bị trừ"); ruling error goes through `parseDisputeError`. Nothing else.
- `AdminComplaintsPage.tsx`: one line "Xử lý khiếu nại không tự hoàn tiền." above the resolve button. Nothing else.

## Not checked
- No REAL BROWSER pass; the two page edits (one sentence, one `<p>`, one new table block) were not looked at at 360/375/390/412.
- The API client was never pointed at a real server; routes/bodies are checked against `schemas.ts` and the controller by reading (CODE AUDIT) and against a fake client.
