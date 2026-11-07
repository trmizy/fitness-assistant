# B5 — Tài chính › Rút tiền (`/admin/finance/withdrawals`) — checks

Evidence label: **MOCK BROWSER TEST** (Playwright 1.61.1 + `page.route`, vite dev, no real backend/API/DB). T2 (backend integration on `gymcoach_payment_test`) = **NOT RUN** this batch.

## Results
- `npx tsx --test` (all `__tests__`, frontend/web): 627/627 pass (565 baseline + 18 new `b5-withdrawal-queue.test.ts` + tests added concurrently by other workers). TEST FIXTURE (pure unit tests).
- `vite build` to scratchpad `b5/dist`: passes.
- tsc temp web-only config (deleted): 227 errors, 0 in B5 files (baseline 236; not increased).
- Mock browser `b5.mjs`: **172/172** checks pass (`mock-results.json`), at 1440 light, 390 light, 1440 dark. Servers stopped afterwards.

## Covered (172 checks)
chips + counts + per-chip totals/oldest; `?status=` deep link, invalid/PAID fallback, back/forward, legacy `?tab=withdrawals` redirect;
disabled "Đã chuyển / Từ chối" chips with "cần API lịch sử rút tiền (G-08)"; no requester name / balance (muted note);
H-02 approve dialog + E-04 double click = 1 POST + busy/Esc inert; E-05 500 inline + blocked + no retry; 409 stale + refetch;
A-04 mark-paid from PENDING ("bỏ qua bước Duyệt"), H-03 from APPROVED, bank ref required/trimmed, 1 POST;
E-07 network loss (1 POST, reload button re-GETs, no re-POST); 400 INVALID_STATUS and 409 ALREADY_PAID stale; 500;
reject (reason required, body, APPROVED unlock text); empty (both / chip-specific + link); loading skeleton; E-02 list 500 and network ≠ empty + retry; 403;
A-03 100 rows (≥60/≥40, ≥ total, banner) vs 99 rows (exact); E-08 stale note (clock fast-forward), refresh-failed-with-data, refresh clears it;
copy full ids (clipboard); keyboard (chips, disabled chips focusable), dialog focus trap (16 Tab/Shift+Tab), Esc + focus returns to the opener, reduced-motion skeleton;
axe serious+critical = 0 on `#admin-main` (PENDING + APPROVED) at 1440, 390, 1440-dark; no horizontal overflow at 390 (list, dialog, 60 rows, after interactions).
B1 regression (E-02/E-04/E-05/E-07 + INVALID_STATUS + payload) re-run with the same assertions on the new layout: all pass, same testids kept.

## Known open (not B5-owned) — `mock-known-issues.json`
axe color-contrast (serious) INSIDE the shared `shared/MoneyActionDialog.tsx` (B1; read-only for B5): `text-muted-foreground` labels (4.09:1 dark, 4.34:1 light), amber notice text (4.46:1 light), and the global default `Button` (`--button-bg #059669` + white = 3.76:1 light). Not changed here to keep the B1 contract; suggested fix: tokens `adm-text-2` / `st-warning` and a contrast-safe confirm button. B5 uses its own AA button (`bg-st-success text-adm-bg`) for "Đã chi trả".

## Deviations / notes
- Radix AlertDialog without a trigger does not return focus (B1 claim was not true): B5 returns focus to the opener itself, and to the active chip when the row left the list.
- "Duyệt" label shortened; the optional-reservation wording kept in aria-label, title and a visible note.
- Requester name, available balance, history chips: not shown (G-08).
