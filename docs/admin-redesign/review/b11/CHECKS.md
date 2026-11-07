# B11 — Integration QA of the new admin web (T2 + T3) on an ISOLATED stack

Date 30/10/2026 · worktree `D:/admin-fr` (branch admin-finance-redesign, HEAD a12113a2, backend unchanged from f0d9812c) · run by Sonnet 5.5.
Evidence labels: BACKEND INTEGRATION · REAL HTTP/API · REAL BROWSER · TEST FIXTURE. Everything below ran on an isolated stack with `_afr_test` databases — **not dev, not production**.

## 1. Isolation setup

| Item | Value |
|---|---|
| Databases (Postgres-test container, host port 55433, credentials from `docker/test` + the repo's own integration-test headers) | `gymcoach_{auth,user,payment,gym,ai}_afr_test` — created by me (no name clash), schema by each service's own `prisma migrate deploy` (auth 12, user 69, payment 21, gym 33, ai 26 migrations; **all applied, no drift workaround was needed**). Target host/db was printed and asserted (`localhost:55433` + `_afr_test`) before each migrate (`scripts/migrate.sh`). |
| Backend processes (from `D:/admin-fr/backend/**`, `tsx src/server.ts`) | auth 43001, user 43004, payment 43007, gym 43006, ai 43003, gateway 43000. fitness (43002) and chat (43005) NOT started (not needed): the dashboard monitor therefore shows 4/6 services and the browser console shows chat-socket WebSocket errors — environment, not a defect. |
| Redis | Dev Redis (6379) never touched. Gateway: `REDIS_URL` unset (in-memory rate limit). payment/user/gym/auth: no Redis. ai-service starts a BullMQ worker on `REDIS_HOST:PORT` db 0 (it would have competed with the dev ai queue) → pointed at a throw-away container `gymini-afr-redis` (redis:7-alpine, 127.0.0.1:46379), removed at the end. `FITNESS_DISABLE_REDIS=true`. |
| Gateways | `VNPAY_SIMULATE=true` (the repo's mock/simulate checkout, `NODE_ENV=development`), dummy `VNPAY_TMN_CODE/HASH_SECRET`; SMTP unset (register returns `devOtp`); `LLM_PROVIDER=mock`; Qdrant absent (ai-service runs degraded, irrelevant to refunds). No external call. |
| Web | vite dev on 127.0.0.1:45173, temp config (`scripts/vite.afr.config.mts`, cacheDir in scratchpad, `GATEWAY_PROXY_TARGET=http://localhost:43000`). `node_modules/.vite` untouched. |
| Connection audit | after the run, `netstat` of my listener PIDs: established connections only to 55433, 4300x, 46379 — none to 5433/6379/3000–3007/5173/9000. |
| Scheduled sweeps | All backend schedulers (user-service settlement sweep, ai-service personalized-service auto-accept sweep, payment/gym jobs) ran against the `_afr_test` DBs only. |
| Deviations from a clean worktree | (a) the worktree has no per-service `node_modules`; I created **junctions** `D:/admin-fr/backend/{services/*,gateway}/node_modules → D:/FitnessAssistant/...` (link only, no install; `@gym-coach/shared` therefore resolves to the main tree's built `dist`, source identical to base — only line endings differ). (b) bootstrap data by SQL in MY DBs (TEST FIXTURE): role ADMIN/GYM_OWNER/PT in auth DB (no API creates the first admin); a verified `gym_partners` + OWNER account row for the gym owner (partner onboarding needs document uploads/MinIO); an APPROVED `pt_applications` row + `isPT` profile for the PT (ai-service "approved PT" gate). Everything else went through real HTTP (register + OTP, owner/brands, owner/gyms, admin approve, plan, memberships, VNPay-simulate payment, service listing/purchase/intake/start-review/refund-request, withdrawal requests). |

## 2. T2 — BACKEND INTEGRATION (existing suites on `_afr_test`)

| Suite | Command (cwd = service dir) | Result |
|---|---|---|
| payment-service: all `*.integration.test.ts` (41 files) | `tsx --test --test-concurrency=1 src/__tests__/*.integration.test.ts`, `DATABASE_URL=…gymcoach_payment_afr_test` | **766 tests, 766 pass, 0 fail, 0 skipped** (1211 s). Log: `payment-integration.log` |
| user-service: admin-reconciliation, session-refund-state, 6 × settlement-*.integration, legacy-refund-notice-inventory, + contract-expiry/natural-completion settles-money, resolve-dispute-pt-no-show, session-dispute-type, settle-tracked | same runner, `DATABASE_URL=…gymcoach_user_afr_test` | **85 tests, 81 pass, 0 fail, 4 skipped** (the 4 are env-gated `legacy-refund-notice-inventory`). Re-run of that file with `INVENTORY_TEST_USER/PAYMENT_DATABASE_URL` → my two afr DBs: **6/6 pass** ⇒ 0 skipped in effect. Log: `user-integration.log` |
| Not run | payment unit tests (`contract-money`, `auth-header-spoofing`, `admin-routes-auth` — not integration), user-service suites unrelated to money, ai-service/gym-service suites | scoped run, NOT a full-repo regression |

After the suites I dropped and re-created + re-migrated the payment and user DBs so the stack started clean.

### Scripted HTTP pass (REAL HTTP/API through my gateway, real ADMIN JWT) — `t2-results.json`, `api/*.json`

45 checks, 44 pass, 1 finding (F1). Invariant `ESCROW.available = Σ(pending+available+locked+holdback)` of all other wallets checked **15 times** (after every mutating step) both via P3 (`/admin/payments/reconciliation`) and by an independent SQL sum on the payment DB: **15/15 balanced, drift 0**.

* 27 admin endpoints (P1–P5, P7, P13, U1, U2, G2, G4, G5, A1, W1, system-monitor, users, gyms, brands, pt-applications, partners, partners/overview-stats, complaints, listings queues): 200 as ADMIN; **401 without token, 403 for CUSTOMER and for GYM_OWNER** on all of them. Exception (by design, not admin-only): `GET /profile/pts` → 200 for CUSTOMER and GYM_OWNER (public PT discovery list; the admin PT page reuses it).
* Frontend normalizers (`normalizeReconciliation`, `normalizeFinanceOverview` day/month, `normalizeObligationsReport`, `normalizeSessionsReport`, `normalizeQueue`, `normalizeServiceRefunds`, `normalizeGatewayDiscrepancies`, `summarizeDisputes/WithdrawalList/ServiceRefundQueue/Users/Monitor`) run on the real response bodies: **all accepted, none returned null** (`api/_normalizers_pre.json`, `_normalizers_post.json`).
* E-01 / P3: balanced → 200 `drift 0.00`; drift created ONLY in my DB (+1234.56 on ESCROW) → **HTTP 409 with full `data` body** (`drift "1234.56"`, `balanced:false`); dashboard W1 still 200 and carries `balanced:false`; P13 still 200; drift removed → balanced again.
* H-02/E-04: two concurrent `approve` → both 200, exactly 1 `WITHDRAWAL_LOCK:<id>` ledger op, available −50 000, locked +50 000, ESCROW unchanged.
* H-03: `mark-paid` from APPROVED → locked −50 000, ESCROW −50 000, one `PaymentTransaction(purpose=WITHDRAWAL,status=PAID,initiatedBy=admin)`.
* A-04/E-04: `mark-paid` from PENDING, two concurrent → both 200, one WITHDRAWAL transaction, 0 lock ops (shortcut path), available −50 000, locked unchanged, ESCROW −50 000.
* reject: PENDING → no ledger effect; APPROVED → 1 `WITHDRAWAL_UNLOCK`, locked −50 000 / available +50 000; reject without reason 400 `REASON_REQUIRED`; reject PAID 400 `ALREADY_PAID`; approve PAID 400 `INVALID_STATUS`; mark-paid without `bankReference` 400; unknown id 404; CUSTOMER 403 (row unchanged); anonymous 401.
* E-05: approve when the wallet cannot fund it (shortage created in my DB, restored) → **500 INTERNAL_ERROR** as documented (G-13), row stays PENDING, ledger intact.
* Membership refund G1: reason `TRANSACTION_ERROR` → 200, client wallet +499 974.77 (pro-rata), membership CANCELLED; **two concurrent calls → both 200, client credited once** (1 CREDIT entry); sequential repeat → 409 "Cannot refund a membership in CANCELLED status"; invalid reason 400; CUSTOMER 403.
* Service refund A1–A3: customer on A1/A3 → 403; refund 700 000 > ceiling 600 000 → 400 `…_REFUND_INVALID_AMOUNT`, wallet unchanged (E-10); approve 250 000, two concurrent → client wallet +250 000 once, single ledger key `PERSONALIZED_REFUND:<order>:250000.00`.

### Finding F1 (E-03 as written in the plan does not match the backend) — severity P3, no money impact
`POST /admin/payments/withdrawals/:id/mark-paid` on a request that is **already PAID** answers **400 `INVALID_STATUS`** ("Không thể chi trả một yêu cầu ở trạng thái PAID"), not a 200 replay returning the PAID row. Reproduction: pay a request, POST the same mark-paid again (`t2c.mjs`, step "E-03"). Cause: `withdrawal.service.ts markPaid` rejects any status other than PENDING/APPROVED in its pre-check before the in-transaction `current.status === 'PAID'` replay; only a *concurrent* second call (A-04 double-submit) gets 200. Money effect: none (ESCROW unchanged, one WITHDRAWAL transaction, bank reference of the first payment kept). The audit text (02, P10 "replays if already PAID") and plan E-03 ("replay → trả PAID") should be corrected, or the backend changed if a replay is wanted. Not fixed (backend out of scope).

## 3. T3 — REAL BROWSER (isolated stack, test DB) — `t3-results.json`, `shots/` (1440 + 390)

27 recorded checks; 26 pass; the 1 "fail" row is a superseded first run of E-01 whose load-error detector (my regex) matched the page's explanatory copy "không phải lỗi tải"; E-01 was re-run with a correct detector and passes (see below).

| Case | Result | Evidence |
|---|---|---|
| H-01 Tổng quan / Đối soát / Hôm nay, 1440 + 390 | **PASS (6/6)** — every number on screen equals the API body captured from the same page load (escrow, claims, drift + "Cân bằng", all 10 breakdown segments, 100%, P4 income/expense/netRevenue, platformRevenue available/pending; Hôm nay: pending count/sum, approved sum, service-refund count, users, services 4/6) **and** the independent SQL: escrow = claims = 3 100 000, income 3 200 000 = Σ PAID non-REFUND/WITHDRAWAL, expense 100 000 = Σ PAID REFUND/WITHDRAWAL | `h01-*-1440/390.png` |
| H-02 approve in UI | **PASS** — dialog states the money is NOT yet transferred; exactly 1 POST (200); DB APPROVED, available −50 000 / locked +50 000, ESCROW unchanged, 1 lock op; chips "Chờ duyệt 1 / Đã duyệt 2"; ledger balanced | `h02-*`, `dialog-wd-approve-pending-1440/390.png` |
| H-03 mark paid in UI (from APPROVED) | **PASS** — confirm disabled while bank reference empty (0 POST); after entering a reference: 1 POST 200; DB PAID with reference, locked −50 000, ESCROW −50 000, one WITHDRAWAL tx PAID; P3 still balanced | `h03-*`, `dialog-wd-markpaid-approved-1440/390.png` |
| E-03 stale tab | **PASS (functional) with plan deviation** — another payer pays first (API); the UI POST gets 400 and shows the toast "Yêu cầu không còn ở trạng thái này — đã được xử lý ở nơi khác. Danh sách đã được tải lại." and refreshes the list; no second money effect (1 tx, ESCROW delta 0). The plan's wording "Yêu cầu đã được chi lúc … bởi …" is NOT shown (the 400 carries no time/actor; see F1). The "other admin" call used the same admin account | `e03-stale-markpaid-1440.png` |
| H-04 service refund in UI | **PASS** — dialog states "ghi có vào ví khách hàng (số dư khả dụng) — không hoàn về thẻ hay ngân hàng", amount 200 000, ceiling 600 000, the PT/platform clawback order; 1 POST 200; client wallet +200 000 once; ledger key `PERSONALIZED_REFUND:<order>:200000.00`; balanced. 390: dialog opened and cancelled (no mutation) | `h04-*-1440.png`, `h04-refund-dialog-390.png` |
| E-10 (UI) | **PASS** — typing 700 000 > ceiling disables "Duyệt hoàn tiền"; 0 POST; wallet unchanged | `e10-over-ceiling-1440.png` |
| G1 membership refund in UI | **PASS** — confirm dialog, 1 POST 200, client wallet credited once, balanced | `g1-*-1440.png` |
| E-01 drift in UI | **PASS (re-run)** — with +777 ₫ drift in my DB (P3 → 409 + body) Tổng quan, Đối soát and Hôm nay all show 777 ₫, the red "lệch" banner, no load error / no "Thử lại" button, no "Cân bằng" pill, at 1440 and 390; drift removed afterwards, ledger balanced (API + SQL) | `e01-drift-*-1440/390.png` |
| A-02 day→month chip | PASS — URL `?group=month`, request `groupBy=month` (1440 + 390) | `a02-*` |
| A-01 empty period | PASS — custom range with no transactions shows "Không có giao dịch trong kỳ" (1440 + 390) | `a01-*` |
| A-03 (P7 returns 100 rows) | **NOT RUN** (needs 100 withdrawals; T1 case) | — |
| A-04 | API only (T2 above); the UI dialog for a PENDING request states "tự khoá tiền rồi trừ ngay (bỏ qua bước Duyệt)" (`dialog-wd-markpaid-pending-1440/390.png`) | |

Not covered at 390: the mutations themselves (H-02/H-03/E-03/H-04/G1 confirm clicks) were driven at 1440 only; at 390 the dialogs for approve / mark-paid (APPROVED and PENDING) / service refund were opened, screenshotted and cancelled, and the finance pages were captured.

## 4. Other observations (no action taken)
* F2 (P3, copy): the service-refund panel says the PT's money "đã chuyển thẳng vào ví PT, không giữ tạm", while the same order's confirm dialog says the clawback takes from the PT's *held* balance first, and the ledger shows the PT share sitting in `PT.pending` (H-01 screenshot: "PT — đang chờ giải phóng"). One of the two texts is wrong for this order state.
* The monitor tile 4/6 and chat WebSocket console errors are caused by not running fitness/chat in this stack.
* `gymAvailable 251 ₫` and `platformRevenueAvailable 29 ₫` appear after the pro-rata membership refunds (rounding remainders released to gym/platform) — ledger balanced, shown correctly by the UI.
* Worker could not exercise PT/gym-owner withdrawals (only CLIENT withdrawals of refund-sourced credit, owner type CLIENT): the admin endpoints and UI are identical for PT (`ownerType` only changes the label); a PT with AVAILABLE balance would need a full contract/session flow. `POST /me/withdrawals` maps every non-PT role (including GYM_OWNER) to ownerType CLIENT, so a gym owner cannot withdraw gym earnings through it.

## 5. Cleanup
Processes on 43000–43007 and 45173 stopped (by listening PID), redis container removed, worktree `node_modules` junctions removed, the five `_afr_test` databases dropped (final data snapshot kept in `db-final-snapshot.json`). Scripts to reproduce: `scripts/`.
