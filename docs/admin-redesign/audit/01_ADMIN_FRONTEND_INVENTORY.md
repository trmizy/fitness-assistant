# 01 — Admin Web Frontend Inventory (READ-ONLY audit)

Scope: `frontend/web/src/app` admin workspace. Evidence label for EVERY row: **CODE AUDIT** (source read only; no browser, no HTTP, no DB). Date 2026-10-26. `PartnerApply*.tsx` ignored (other session).
Paths are relative to `frontend/web/src/app/`. Line numbers approximate.

## 1. Shell + navigation

### 1.1 Route guard and shell
- `routes.tsx:111-129` lazy-imports 15 admin pages. `routes.tsx:335-363`: `path:"admin"` -> `<RequireRole allow={["admin"]}><AppShell/></RequireRole>`.
- `components/RequireRole.tsx`: unauthenticated -> `<Navigate /login state.from>`; wrong role -> inline hardcoded-dark "403 — Không có quyền truy cập" card (`bg-zinc-950`, amber; not themed, no home/back link). UX guard only (backend RBAC not audited here).
- Route entries: 1 index redirect (`/admin` -> `/admin/dashboard`), 15 page routes, 2 legacy redirects (`pt-service-refunds` -> `finance?tab=refunds`, `withdrawals` -> `finance?tab=withdrawals`). **Single role `admin`: no sub-roles/permissions, every admin sees and can do everything.**
- Shell = `components/layout/AppShell.tsx` (shared by all roles): `Sidebar` (desktop `aside w-64`, **no collapse/mini mode**) + `Topbar` + `<main>` (framer-motion 180ms fade, `Suspense` -> `PageSkeleton`). Photo background `/bg-gym.webp` + `.app-theme-overlay`. Also mounts `CallOverlay`, `AICoachFloatingButton/Panel` (irrelevant to admin).
- Mobile (<lg): sidebar hidden; hamburger in Topbar opens `w-72` overlay drawer with backdrop, closes on nav click. Topbar: hamburger, workspace badge "Quản trị viên" (violet), `LanguageSwitcher`, `ThemeToggle`, notifications bell (`notificationService`, realtime), user menu ("Trang Admin" link; profile link hidden for admin). Global search removed.
- Sidebar header pill "Cổng quản trị" (violet-600). Footer: user info + logout. Source: `components/layout/Sidebar.tsx:127-165` (`adminNav`), `:278` selection, `:289` pill.

### 1.2 Sidebar items (flat list, NO grouping, NO badges/counters, in order)
| # | Label | Route | Icon | Page component |
|---|---|---|---|---|
| 1 | Tổng quan | /admin/dashboard | GyminiDashboardIcon | AdminDashboard |
| 2 | Người dùng | /admin/users | GyminiUsersIcon | UserManagement |
| 3 | Quản lý PT | /admin/pts | GyminiAdminIcon | PTManagement |
| 4 | Chợ kế hoạch | /admin/marketplace | GyminiMarketplaceIcon | MarketplaceModeration |
| 5 | Duyệt bài tập trùng lặp | /admin/exercise-review | GyminiCompareIcon | AdminExerciseReview |
| 6 | Ma trận chất lượng catalog | /admin/catalog-quality | GyminiCatalogIcon | AdminCatalogQuality |
| 7 | Tài chính | /admin/finance | GyminiMoneyIcon | AdminFinancePage |
| 8 | Giám sát hệ thống | /admin/system | GyminiSystemIcon | SystemMonitoring |
| 9 | Khiếu nại buổi tập | /admin/disputes | GyminiDisputeIcon | AdminDisputes |
| 10 | Tổng quan Gym | /admin/gym-management | GyminiDashboardIcon (dup of #1) | AdminGymManagementOverview |
| 11 | Chi nhánh | /admin/gyms | GyminiGymIcon | AdminGymModeration |
| 12 | Đối tác | /admin/partners | GyminiContractIcon | AdminPartnersPage |
| 13 | Tin đăng & tiện ích | /admin/listings | GyminiCatalogIcon (dup of #6) | AdminListingsPage |
| 14 | Khiếu nại | /admin/complaints | GyminiDisputeIcon (dup of #9) | AdminComplaintsPage |
| 15 | Giám sát AI | /admin/ai-observability | GyminiSystemIcon (dup of #8) | AdminAIObservability |

Observations: two different "Khiếu nại" items (#9 session disputes = money, #14 gym-partner complaints) with the same icon; 3 icons reused; no pending-count badges although every queue has a count (nav gives no "needs attention" signal); people / catalog+AI / money / gym-partner domains interleaved with no section headers.

## 2. Feature table

Legend. Status: IMPL = IMPLEMENTED, PART = PARTIAL, UI = UI ONLY, DIS = DISABLED, BRK = BROKEN, NV = NOT VERIFIED. Evidence = CODE AUDIT for all rows. Perm = `RequireRole admin` for every row (no finer check). Guard = double-submit guard (`disabled={isPending}`). Err = what user sees on failure. A = `services/api.ts adminService`; PL = `services/ptListingApi.ts`; PA = `services/partnerApplication.ts`.

### 2.1 Overview / users / PT / catalog

| ID | Capability | Route | Component (file:line) | API | Status | Risk | Notes |
|---|---|---|---|---|---|---|---|
| ADM-01 | Dashboard KPIs (6 cards, user-growth line, role pie, OCR stats, system alerts, recent users, health score) | /admin/dashboard | pages/admin/AdminDashboard.tsx:54 | GET /admin/dashboard (raw `api.get`, key `["admin-dashboard"]`) | PART | P1 | KPI sub-text hardcoded: `"+0 tháng này"`, `"Toàn hệ thống"`, `"Hoạt động hôm nay"` (UI ONLY text). Missing field -> `|| 0` (error looks like zero). Page-level error + retry exist. Hex chart colors. |
| ADM-02 | Dashboard money strip (escrow, platform revenue, balanced) | /admin/dashboard | AdminDashboard.tsx:~200 | same GET, `data.money.*` | IMPL | P2 | Rendered only if `data.money` exists; silently absent otherwise. |
| ADM-03 | **Exceptional gym-membership refund** (paste membership UUID + reason select) | /admin/dashboard (bottom card) | AdminDashboard.tsx:75, :485 | POST /admin/gym-memberships/:id/refund {reason} (A.refundGymMembership) | IMPL | **P0** | **No confirm**, no preview of member/gym/amount, free-text UUID, only `isPending` guard. Moves real money. Err: `error.message \|\| error.code \|\| "Hoàn tiền thất bại"`. |
| ADM-04 | Dashboard link to users | /admin/dashboard | AdminDashboard.tsx:~425 | navigate | IMPL | - | |
| ADM-05 | User list (search, role filter, status filter, refresh) | /admin/users | UserManagement.tsx:62 | GET /admin/users; GET /admin/partner-accounts/roles?userIds= (chunks of 200) | PART | P1 | `useState/useEffect`, NOT react-query; **full list fetched, filtered client-side, no pagination**. Page error + retry exist; partner sub-role lookup failure silently swallowed. |
| ADM-06 | Change user role (CUSTOMER/PT/GYM_OWNER; ADMIN not assignable) | /admin/users (detail -> dialog) | UserManagement.tsx:84 | PATCH /admin/users/:id/role (adminUsersApi) | IMPL | P1 | ConfirmDialog yes; `isSelf` protection. Err: server message else fallback (good). No explicit pending guard in handler. |
| ADM-07 | Lock / unlock account | /admin/users | UserManagement.tsx:98 | PATCH /admin/users/:id/{disable\|enable} | IMPL | P1 | ConfirmDialog yes; isSelf guard; same Err as ADM-06. |
| ADM-08 | PT application list (status filter, search) | /admin/pts | PTManagement.tsx:983 | GET /pt-applications/admin?status= (key `["admin-pt-applications",filter]`, keepPreviousData) | PART | P1 | Search client-side only on loaded rows; no pagination. 1,145-line file. |
| ADM-09 | PT application detail + document viewer | /admin/pts (in-page state) | PTManagement.tsx:408 | GET /pt-applications/admin/:id | IMPL | P2 | Detail is `useState`, not a route: no deep link, Back leaves admin. Falls back to list row silently if detail fails. |
| ADM-10 | PT application review: Approve / Reject / Request info / Under review | /admin/pts | PTManagement.tsx:415 (buttons ~555-600) | POST /pt-applications/admin/:id/review/{APPROVE\|REJECT\|REQUEST_INFO\|UNDER_REVIEW} | IMPL | **P1** | Native **`alert()`** for success and error; no confirm on APPROVE/REJECT (grants/denies PT role); Reject reuses "message to user" field as rejectionReason. Err `alert(err.response.data.error)` may print `[object Object]`. |
| ADM-11 | Marketplace plan moderation list | /admin/marketplace | MarketplaceModeration.tsx:30 | GET /admin/ai/marketplace/plans?status= (key `["admin","marketplace",filter]`) | IMPL | P2 | Expandable cards, validation-warning labels. |
| ADM-12 | Marketplace approve / reject (reject needs note) | /admin/marketplace | MarketplaceModeration.tsx:45 | POST /admin/ai/marketplace/plans/:id/review/{APPROVE\|REJECT} {note} | IMPL | P1 | Approve no confirm; reject inline required note; guard yes. Err `error.message ?? "Không thể cập nhật"`. |
| ADM-13 | Duplicate-exercise review: summary, list (status/tier/search), detail, history | /admin/exercise-review | AdminExerciseReview.tsx | GET /exercises/admin/review/summary; GET /exercises/admin/review?…; GET …/:ref; GET …/:ref/history | IMPL | P2 | Title exposes jargon "(Gate 7)". Master/detail. |
| ADM-14 | Exercise review decision (some need target id; risky needs note) | /admin/exercise-review | AdminExerciseReview.tsx:94 | POST /exercises/admin/review/:ref/decision | IMPL | P1 | Inline confirm panel (`pendingDecision`), idempotent message. Err `data.error` raw (object risk). Guard yes. |
| ADM-15 | Catalog quality matrix (filters, summary, 25/page) | /admin/catalog-quality | AdminCatalogQuality.tsx:45 | GET /exercises/admin/catalog-quality-matrix?loggingMode&status&search&page&limit (key `["admin","catalog-quality",…,page]`) | IMPL | P2 | Read-only; server-side pagination. `overflow-x-auto` table. |

### 2.2 Money (detail in section 3)

| ID | Capability | Route | Component | API | Status | Risk | Notes |
|---|---|---|---|---|---|---|---|
| ADM-20 | Finance shell, 4 tabs (Tổng quan / Đối soát / Rút tiền / Hoàn tiền) | /admin/finance (`?tab=`) | AdminFinancePage.tsx:22 | - | PART | P2 | `?tab=` read only on first render; clicking a tab sets state, **URL not updated**. Hand-rolled buttons, not `ui/tabs`. `max-w-5xl`. |
| ADM-21 | Finance overview: KPIs + area chart + table by day/week/month/quarter + date range | /admin/finance?tab=overview | AdminFinanceOverviewTab.tsx:46 | GET /admin/payments/finance-overview?groupBy&from&to | IMPL | P1 | See 3.1. Error -> one grey line, no retry. |
| ADM-22 | Reconciliation card (escrow vs claims, drift, balanced, breakdown, negative wallets), 30s poll | …?tab=reconciliation | AdminReconciliationPanel.tsx:32 | GET /admin/payments/reconciliation | IMPL | P1 | `useEffect+setInterval`, not react-query. 409 body treated as data (intentional). Other failure -> "Không tải được". |
| ADM-23 | Stuck-money / obligations blocks (~22 read-only blocks), 60s poll | same tab | AdminReconciliationBlocks.tsx:738 | GET /admin/payments/obligations; GET /admin/sessions/reconciliation | IMPL | P1 | Read-only by design. Per-source error + retry (`LoadError`). Dense. Util file tested (41 cases). |
| ADM-24 | Pending withdrawals list | …?tab=withdrawals | AdminWithdrawals.tsx:38 | GET /admin/payments/withdrawals (key `["admin","pending-withdrawals"]`) | PART | **P1** | `isLoading` only: **fetch error renders as "Không có yêu cầu rút tiền nào đang chờ xử lý"**. No pagination; shows `ownerId.slice(0,8)…`, no requester name. |
| ADM-25 | Approve withdrawal (optional reserve) | same | AdminWithdrawals.tsx:56 | POST /admin/payments/withdrawals/:id/approve | IMPL | P1 | No confirm. `approveMutation.isPending` shared by all cards. Err `error.message \|\| "Không thể duyệt"`. |
| ADM-26 | Reject withdrawal (reason required) | same | AdminWithdrawals.tsx:65 | POST …/:id/reject {reason} | IMPL | P1 | Inline reason box acts as confirm. Guard yes. |
| ADM-27 | **Mark withdrawal paid** (bank reference) | same | AdminWithdrawals.tsx:78 | POST …/:id/mark-paid {bankReference} | IMPL | P1 | Inline confirm box shows amount; no format validation of reference; guard yes. Only step that debits wallet. 409 (already paid/rejected) = generic message, list not force-refetched. |
| ADM-28 | PT personalized-service refund requests list | …?tab=refunds | PTServiceRefunds.tsx:147 | GET /marketplace/orders/refund-requests (key `["refund-requests"]`) | PART | P1 | No error state (blank on failure). Copy has English/dev jargon: "Personalized Service", "payment-service", "Intake". |
| ADM-29 | Refund calculation (total paid / already refunded / ceiling / milestones) | same (expand card) | PTServiceRefunds.tsx:34 | GET /marketplace/orders/:id/refund-calculation (key `["refund-calculation",id]`, lazy) | IMPL | P2 | Money via `toLocaleString("vi-VN")+"đ"`, not `formatVND`. calc error silently shows nothing. |
| ADM-30 | **Approve refund** (amount, note) | same | PTServiceRefunds.tsx:40 | POST /marketplace/orders/:id/refund-resolve {decision:APPROVE,refundAmount,note} | IMPL | **P0** | Moves real money. **No confirm**; button enabled for any `amount>0` — **no client check `amount ≤ refundableCeiling`** (only `max` attr). Guard yes. Err `error.message ?? "Không thể xử lý hoàn tiền."`. |
| ADM-31 | Deny refund (note required) | same | PTServiceRefunds.tsx:47 | POST …/refund-resolve {decision:DENY,note} | IMPL | P1 | No confirm. |
| ADM-32 | Disputed sessions list | /admin/disputes | AdminDisputes.tsx:37 | GET /admin/sessions/disputed (key `["admin","disputed-sessions"]`) | PART | P1 | `isLoading` only -> error == "Không có khiếu nại". Truncated user ids, no names, **no money amount shown**. |
| ADM-33 | Resolve dispute: COMPLETED / PT_NO_SHOW_CONFIRMED / CANCELLED (note required) | /admin/disputes | AdminDisputes.tsx:46 | POST /admin/sessions/:id/resolve {resolution,note} | IMPL | P1 | Inline ruling panel states money consequence (good); guard shared across cards. Err toast prints `data.error` (may be object). 409 not special-cased. |

### 2.3 System / AI

| ID | Capability | Route | Component | API | Status | Risk | Notes |
|---|---|---|---|---|---|---|---|
| ADM-40 | System monitoring (service probes, latency chart, uptime, recent errors), 30s poll | /admin/system | SystemMonitoring.tsx:75 | GET /admin/system-monitor | IMPL | P2 | `useState`+setInterval (not react-query). Error + retry. Hex chart colors. |
| ADM-41 | AI observability: overview + 4 tabs (requests / queue / errors / knowledge) | /admin/ai-observability | AdminAIObservability.tsx (1,877 lines) | GET /admin/ai/overview, /requests?…(paged), /queue, /errors, /knowledge, /requests/:id | IMPL | P2 | `Promise.all` + 30s poll, no react-query; tab state local (no `?tab=`). Header claims no mock data. Largest file. |
| ADM-42 | Knowledge pipeline: enqueue job | same | AdminAIObservability.tsx:1622 | POST /admin/ai/knowledge/jobs/:kind | IMPL | P1 | Guard via shared `knowledgeBusy`; no confirm seen. |
| ADM-43 | Knowledge pipeline: schedule / clear schedule | same | :1645 / :1661 | POST /admin/ai/knowledge/schedule ; DELETE same | IMPL | P2 | |
| ADM-44 | Knowledge review: approve / reject item | same | :1819 / :1837 | POST /admin/ai/knowledge/review/:id/{approve\|reject} | IMPL | P1 | No confirm seen. |

### 2.4 Gym / partner / listings

| ID | Capability | Route | Component | API | Status | Risk | Notes |
|---|---|---|---|---|---|---|---|
| ADM-50 | Gym-management overview (needs-attention cards + 7 KPI) | /admin/gym-management | AdminGymManagementOverview.tsx:25 | GET /admin/partners/overview-stats (key `["admin-gym-management-overview"]`) | IMPL | P2 | Uses shared `KpiCard`. |
| ADM-51 | Branch moderation tabs: pending / gym-renames / brand-renames / closed / all (counts in labels) | /admin/gyms | AdminGymModeration.tsx:40 | GET /admin/gyms ; GET /admin/brands ; GET /admin/gyms/permanently-closed | PART | P1 | Tab local (no `?tab=`). 3 queries `isLoading` only; client-side status filter. |
| ADM-52 | Approve / reject / suspend branch | /admin/gyms | AdminGymModeration.tsx:68, buttons :229, :244 | PATCH /admin/gyms/:id/status {status} | IMPL | **P1** | **No confirm, no reason** for REJECTED/SUSPENDED (suspend hits live members). Err `error.message \|\| "Không thể cập nhật"`. |
| ADM-53 | Approve gym rename / brand rename | /admin/gyms | :78 / :123 | PATCH /admin/gyms/:id/approve-rename ; PATCH /admin/brands/:id/approve-rename | IMPL | P2 | |
| ADM-54 | Request gym changes (notes) / request branch changes (issue list) | /admin/gyms | :92 / :112 | POST /admin/gyms/:id/request-changes ; POST /admin/gyms/:id/branch-review-issues | IMPL | P2 | Detail in `components/gym-management/BranchReviewDetail.tsx` (GET …/hours, /photos, /branch-documents, /branch-review-issues; blob /admin/branch-documents/:token). |
| ADM-55 | Edit gym details (admin) | /admin/gyms | :135 | PATCH /admin/gyms/:id | IMPL | P2 | |
| ADM-56 | Partner applications list + detail | /admin/partners (view "Hồ sơ đăng ký") | AdminApplicationsPanel.tsx:68 | GET /admin/partners/applications?verificationStatus ; GET /admin/partners/:id/application ; GET …/documents/:type/file | IMPL | P2 | List + counts = two identical calls (`staleTime:0`). |
| ADM-57 | Application: accept document | same | :381 | POST /admin/partners/:id/application/documents/:type/accept | IMPL | P2 | |
| ADM-58 | Application: request changes (issues + docs) | same | :605 | POST …/application/request-changes | IMPL | P2 | |
| ADM-59 | Application: resolve / reopen issue | same | :477 / :489 | POST …/issues/:id/{resolve\|reopen} | IMPL | P2 | |
| ADM-60 | Application: **approve** | same | :562 | POST …/application/approve | IMPL | P1 | Native `window.confirm`; `canApprove` from server. |
| ADM-61 | Application: reject (reason+note) / reopen | same | :620 / :539 | POST …/application/{reject\|reopen} | IMPL | P1 | reopen `window.confirm`; reject form. Errors via `friendlyError()` (good). |
| ADM-62 | Partner list (status filter) + queue | /admin/partners (view "Đối tác") | AdminPartnersPage.tsx:122 | GET /admin/partners?status ; GET /admin/partners/queue | PART | P2 | View + selected partner are `useState` (no URL). |
| ADM-63 | Partner detail tabs: Tổng quan / Tài khoản / Chi nhánh / Giấy tờ / Tiền / Nhật ký / Ghi chú nội bộ / Khiếu nại | /admin/partners (state) | AdminPartnersPage.tsx:248 | GET /admin/partners/:id, /audit-log, /documents, /contact-log, /internal-notes, /complaints, /termination-impact; GET /admin/commission-rate | IMPL | P2 | Dense, 8 tabs. |
| ADM-64 | Edit partner profile incl. commission override % | detail -> Tổng quan | EditPartnerForm :421 | PATCH /admin/partners/:id | IMPL | **P1** | Money-affecting (commission) with no confirm; UI validates 0-100. |
| ADM-65 | Owner rename; reset-password link; force logout; **revoke account**; transfer ownership; resend/revoke invitation | detail -> Tài khoản | AccountsTab :482 | PATCH /admin/users/:id/name ; POST /admin/partner-accounts/:id/{reset-password\|force-logout} ; DELETE /admin/partner-accounts/:id ; POST /admin/partners/:id/transfer-ownership ; POST …/invitations/:iid/{resend\|revoke} | IMPL | **P1** | Transfer has inline "Xác nhận"; **revoke account (DELETE) and force-logout fire immediately, no confirm, no pending guard**. |
| ADM-66 | Documents: record file URL, verify/reject | detail -> Giấy tờ | DocumentsTab :673 | PUT /admin/partners/:id/documents/:type ; POST …/:type/verify | IMPL | P2 | Admin pastes a free-text `fileUrl`. |
| ADM-67 | Contact log, internal notes, verification status, partner complaints tab | detail | :748, :860, :921, :967 | POST contact-log ; PATCH verification-status ; POST internal-notes | IMPL | P2 | |
| ADM-68 | Suspend / unsuspend partner | detail menu -> hand-rolled modal | SuspendDialog :1016 / UnsuspendDialog :1062 | POST /admin/partners/:id/{suspend\|unsuspend} | IMPL | P1 | Reason required; guard yes. Modals are `fixed inset-0` divs, not `ui/dialog` (no focus trap/Esc/aria). |
| ADM-69 | **Terminate partner** (impact preview, member policy, reason) | detail menu | TerminateDialog :1081 | GET …/termination-impact ; POST …/terminate | IMPL | P1 | Good: impact preview, policy required, irreversible warning. Partial refund failure toast "N hội viên hoàn tiền thất bại — cần xử lý tay" does not list which. |
| ADM-70 | "View as partner" modal | detail menu | ViewAsPartnerModal :1148 | GET /admin/partners/:id/view-as | IMPL | P2 | |
| ADM-71 | Listings hub, 4 tabs (PT queue, Gym queue, Amenity catalogue, Amenity proposals + pending badge) | /admin/listings (`?tab=`, `?rid`) | AdminListingsPage.tsx:25 | GET /admin/amenities/proposals?status=PENDING (badge) | IMPL | - | **Best-practice module**: URL-synced tabs, shared `handleAdminError` (409 -> VI message + auto-refetch), centralized query keys (`listings/adminListingShared.ts`). |
| ADM-72 | Revision queue (PT/Gym) with filters | listings pts/gyms | listings/RevisionQueue.tsx:61 | GET /admin/listings/pts ; GET /admin/listings/gyms (params) | IMPL | P2 | Server-side filtered. |
| ADM-73 | Revision detail + preview + history | listings `?rid=` | RevisionDetail.tsx:50, RevisionHistory.tsx | GET …/revisions/:rid ; …/preview ; GET /admin/listings/{pts\|gyms}/:id/history?page | IMPL | P2 | |
| ADM-74 | Revision approve / reject / request-changes | listings | RevisionDetail.tsx:~100-150 | POST /admin/listings/{pts\|gyms}/revisions/:rid/{approve\|reject\|request-changes} | IMPL | P1 | Reject/changes need note; typed 409 handling. |
| ADM-75 | Direct edit PT/Gym listing; retire/purge photo; upload gym photo (presign+confirm) | listings (DirectEditDialog, TargetPicker) | DirectEditDialog.tsx:136-320 | POST /admin/listings/{pts\|gyms}/:id/direct-edit ; …/photos/:pid/retire ; POST /admin/listings/gyms/:id/photos/{presign\|confirm} ; GET /admin/listings/{pts\|gyms}/:id ; GET /pt-applications/admin?status=APPROVED (picker) | IMPL | P1 | Retire needs reason; purge destructive. TargetPicker loads all approved PTs client-side. |
| ADM-76 | Amenity catalogue list/create/update/toggle/history | listings catalog | AmenityCatalogTab.tsx | GET/POST /admin/amenities ; PATCH /admin/amenities/:id ; GET …/:id/history | IMPL | P2 | |
| ADM-77 | Amenity proposals approve / reject / merge | listings proposals | AmenityProposalsTab.tsx:70 | POST /admin/amenities/proposals/{approve\|reject\|merge} | IMPL | P2 | Reject reason validated. |
| ADM-78 | Gym-partner complaints list (status tabs), detail dialog, set IN_PROGRESS/RESOLVED + response | /admin/complaints | AdminComplaintsPage.tsx:62 | GET /admin/complaints?status ; GET /admin/gyms ; PATCH /admin/complaints/:id/status ; GET /admin/complaint-photos/:token (blob) | IMPL | P2 | RESOLVED requires response text. |

### 2.5 API wrappers with NO UI caller (grep `.method(` in `.tsx`) — status NV
`A.setCommissionRate` (POST /admin/commission-rate), `A.getCommissionRateHistory` (GET /admin/commission-rate/history), `A.createComplaintAsAdmin` (POST /admin/complaints), `A.assignComplaintAdmin`, `A.assignPartnerAdmin` (PATCH …/assigned-admin), `A.setGymOwnerActive`, `A.setPTStatus` (PATCH /profile/admin/users/:id/pt-status), `A.updateUserRole` (PATCH /auth/users/:id/role; superseded by adminUsersApi), `A.listPTProfiles` (GET /profile/pts), `A.listUsers` (GET /auth/users). **Gap: platform commission rate can be read (partner Money tab) but not changed or audited from the UI.**

## 3. Finance detail

Formatting: `utils/currency.ts formatVND(value)` = `Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:0})`; **returns the string "Liên hệ" for null/undefined/NaN** (a customer-pricing fallback reused for admin money): a missing/NaN number can show "Liên hệ" instead of "—". Reconciliation blocks wrap it in local `money()` (null -> "—", better). PTServiceRefunds uses `toLocaleString("vi-VN")+"đ"` (different symbol). Amounts arrive as **strings** and are `Number()`-cast client-side; only `adminReconciliation.utils.ts toAmount` is null-safe.

### 3.1 AdminFinanceOverviewTab
Key `["admin","finance-overview",groupBy,from,to]`; `GET /admin/payments/finance-overview?groupBy&from&to` — **server-side aggregated and date-filtered**; no pagination (daily buckets over a long manual range can be hundreds of rows). Default span 30d/12w/12m/8q.
| UI number | Response field | Notes |
|---|---|---|
| Tổng thu | `totals.income` | |
| Tổng chi | `totals.expense` | refunds + paid withdrawals |
| Doanh thu ròng trong kỳ | `totals.netRevenue` | commission, period-based |
| Doanh thu nền tảng (+ "Đang chờ") | `platformRevenue.available` / `.pending` | **not period-based**, placed beside period KPIs with near-identical label -> mixed money states |
| Chart Thu/Chi/Doanh thu ròng | `buckets[].income/expense/netRevenue` | recharts, hardcoded hex, Y axis compact "tr/k" |
| Table | `buckets[]` period, income, expense, netRevenue, transactionCount | `overflow-x-auto` |
Errors: spinner on load; `!report` -> grey "Không tải được dữ liệu tài chính." (no retry, 403/500 identical). No export. Date inputs -> `toISOString()` (UTC) while labels are vi-VN local: possible off-by-one-day buckets (NV).

### 3.2 AdminReconciliationPanel — not react-query
`useEffect` + `setInterval(30s)`; `GET /admin/payments/reconciliation`; 409 body used as data, other errors -> null -> "Không tải được dữ liệu đối soát."
| UI number | Field |
|---|---|
| ESCROW (giữ hộ) | `escrow` |
| Tổng các bên nhận quyền lợi | `claims` |
| Chênh lệch (green 0 / red) | `drift` |
| Doanh thu nền tảng | `breakdown.platformRevenueAvailable` |
| Số dư khách hàng | `breakdown.clientBalances` |
| PT chờ / khả dụng | `breakdown.ptPending` / `ptAvailable` |
| Gym chờ / khả dụng | `breakdown.gymPending` / `gymAvailable` |
| Nền tảng chờ / khả dụng | `breakdown.platformRevenuePending` / `platformRevenueAvailable` |
| Negative wallets | `negativeWallets[]` {ownerType, ownerId (full uuid), pending, available} |
| Cân bằng / Phát hiện lệch | `balanced` |
Whole report at once, no filters. "ESCROW" English jargon.

### 3.3 AdminReconciliationBlocks (813 lines + utils 694)
Keys `["admin","finance","obligations-report"]` (`GET /admin/payments/obligations`) and `["admin","finance","sessions-reconciliation"]` (`GET /admin/sessions/reconciliation`), `refetchInterval 60_000`, normalized by `normalizeObligationsReport/normalizeSessionsReport`. Banner `countAttention()`: "N mục cần xem ngay, M mục cần theo dõi". ~22 `Block`s (title -> `summary.*.count`, tone, `truncated`): negative sub-ledgers, negative wallets, ledger-drift wallets, PT held money per contract, partner receivables (open / review / approved / awaiting proof / verified / legacy unverified / waived / resolved other / legacy closed), paid-not-activated, cancelled-but-paid, cancelled refunds, unverified status, settlement needs action, termination unconfirmed, contract ended unsettled, pending disputes. Server-limited (`truncated` flag shown); **no client pagination, search, filter or CSV**. Money via `money()`; ids `shortId`; ages `formatAge`; times `formatDateTimeVi`. Per-source `LoadError` + retry.

### 3.4 AdminWithdrawals (ADM-24..27)
Fields `id, ownerType (PT|GYM|CLIENT), ownerId, amount (string), status (PENDING|APPROVED), payoutInfo (free text), createdAt`. `formatVND(Number(amount))`. Processed (paid/rejected) requests disappear: **no history view**.
### 3.5 PTServiceRefunds (ADM-28..31)
Fields: order `titleSnapshot, id, priceAtPurchase, disputeReason`; calc `totalPaid, alreadyRefunded, refundableCeiling, milestones{intakeSubmitted,draftDelivered,accepted}`. Per-card lazy query; no history of resolved refunds.
### 3.6 AdminDisputes (ADM-32..33)
Fields: `scheduledStartAt, contract.packageName, clientUserId, ptUserId, disputeType (DELIVERY_DISPUTE|PT_NO_SHOW_CLAIM|CLIENT_NO_SHOW_CLAIM), ptNotes, disputeReason`. No money amount displayed though the ruling moves money; no attachments.
### 3.7 Other money surfaces outside Finance
Dashboard money strip (ADM-02) and membership refund (ADM-03); partner Money tab (commission read, termination impact). "Doanh thu nền tảng" appears in 3 places (dashboard, overview, reconciliation) with possibly different scope.

## 4. UX findings (top ~16)

| # | Sev | Finding | Where |
|---|---|---|---|
| 1 | P0 | Real-money actions without confirm or amount preview: membership refund by pasted UUID; PT-service refund approve with no `≤ ceiling` client validation; withdrawal approve / mark-paid. Only UserManagement (`ConfirmDialog`) and partner-application approve/reopen (`window.confirm`) confirm anything; ~12 of ~45 mutations have any confirm. | ADM-03, 30, 25, 27 |
| 2 | P1 | Fetch error == empty state on decision queues (Withdrawals, Disputes, Refunds, Gym moderation): a 500/403 reads "Không có yêu cầu nào đang chờ", admin may think queue is clear. `ui/ErrorState` exists but unused here. | ADM-24/28/32/51 |
| 3 | P1 | High-impact actions fire immediately: revoke partner account, force-logout, branch REJECT/SUSPEND (no reason), PT application APPROVE/REJECT, knowledge-review approve. | ADM-52, 65, 10, 44 |
| 4 | P1 | Native `alert()` (PT review), `window.confirm` (partner approve), hand-rolled `fixed inset-0` modals (partners) instead of `ui/dialog` / `ConfirmDialog` / `ImpactDialog` (no focus trap/Esc/aria). | ADM-10, 60, 68 |
| 5 | P1 | Generic/unsafe error toasts: many `toast.error(e?.response?.data?.error)` where `error` can be an object; `.message` vs `.error` inconsistent; 403/409/500 never distinguished. Only `listings/` (handleAdminError) and applications (`friendlyError`) do it properly. | all |
| 6 | P1 | Lists loaded whole + filtered client-side, no pagination: users, PT applications, withdrawals, disputes, partners, gyms, TargetPicker. Server-paginated only: catalog-quality, listings queue, AI requests. | ADM-05/08/24 |
| 7 | P1 | Mixed money concepts/formatters: "Doanh thu nền tảng" in 3 places with different scope; period vs all-time vs pending side by side; three formatters (`formatVND`->"Liên hệ" on NaN, `money()`->"—", `toLocaleString+"đ"`). | Finance |
| 8 | P1 | Raw/short IDs instead of people: withdrawals `ownerId.slice(0,8)…`, disputes client/PT ids, negative wallets full uuid, membership refund uuid. Admin cannot tell whom they pay/refund. | ADM-24/32/22/03 |
| 9 | P1 | Dashboard static text ("+0 tháng này") and `|| 0` fallbacks make missing data look like zero. | ADM-01 |
| 10 | P2 | Navigation: 15 flat items, no groups/badges, duplicate icons, two "Khiếu nại", no counters, no desktop collapse; gym domain spread over 5 items while Finance consolidated into 1. | Sidebar |
| 11 | P2 | State not in URL: Finance tab after first render, Gym moderation tabs, AI tabs, Partners view + selected partner, PT application detail, user detail. No deep link; refresh loses context. (`/admin/listings` does it right.) | ADM-20/51/62/09 |
| 12 | P2 | Theme: ~975 hardcoded `bg-zinc-*/text-zinc-*` utilities (work in light mode only because `theme.css` remaps the zinc scale) + ~40 hex colors (AdminAIObservability 15, Dashboard 12, FinanceOverview 7, SystemMonitoring 6) in recharts/inline styles that do not follow light theme; hardcoded violet/green/amber/red palettes; 403 card hardcoded dark. | many |
| 13 | P2 | Mobile (NV, no browser run): 9 pages rely on `overflow-x-auto` tables instead of `ui/DataTable` card mode; 4-col reconciliation grids, 8-tab partner detail; many `text-[10px]/[11px]` buttons (tap target < 44px). | Reconciliation, Partners |
| 14 | P2 | English/dev jargon: "ESCROW", "Gate 7", "Personalized Service", "payment-service", "Intake", "UUID". Gateway returns English values ("Active", "Oct 24", "2 hours ago") that `utils/adminLabels.ts` string-parses on the client. | Finance, Exercise review, Users |
| 15 | P2 | Structure: huge files (1,877 / 1,174 / 1,145 / 813 / 694 lines); mixed fetching (`useState+useEffect+setInterval` in users/system/reconciliation/AI vs react-query); no shared polling/last-updated/refresh component. Tests: only `pages/admin/__tests__/adminReconciliation.utils.test.ts` (41 cases) + `utils/__tests__/adminListing.test.ts`; zero component/e2e tests for admin pages in this tree. | structure |
| 16 | P2 | No history for completed money actions (processed withdrawals, resolved refunds/disputes vanish); no global admin audit log (only per-partner `audit-log`). Commission-rate change/history has API but no UI. | Finance, Partners |

## 5. Reusable components and theme

### 5.1 `components/ui/` (65 files; shadcn base + Gymini additions)
| Need | File(s) | Used in admin today? |
|---|---|---|
| Table primitives | `ui/table.tsx` | no (hand-written `<table>`) |
| Responsive data table (table desktop / cards mobile) | `ui/DataTable.tsx` (`DataTableColumn{key,header,render,numeric,hideOnMobileCard}`, `use-mobile`) | gym-management components only |
| Pagination | `ui/pagination.tsx` | no |
| Badge / status chip | `ui/badge.tsx`, `ui/StatusBadge.tsx` (tones success/warning/danger/info/neutral) | StatusBadge x5 |
| KPI card | `ui/KpiCard.tsx` | AdminGymManagementOverview only |
| Dialogs | `ui/dialog.tsx`, `ui/alert-dialog.tsx`, `ui/ConfirmDialog.tsx`, `ui/ImpactDialog.tsx` (impact rows before destructive action) | ConfirmDialog in UserManagement only; ImpactDialog unused |
| Drawer / sheet | `ui/drawer.tsx`, `ui/sheet.tsx`, `ui/FilterSheet.tsx` | not in admin |
| Tabs | `ui/tabs.tsx`, `components/TabbedPage.tsx` | not used (hand-rolled buttons) |
| Chart | `ui/chart.tsx` (shadcn recharts wrapper, CSS-var colors) | raw recharts instead |
| Skeleton / loading | `ui/skeleton.tsx`, `ui/PageSkeleton.tsx`, `layout/PageSkeleton.tsx` | PageSkeleton x7; many bare spinners |
| Empty / error | `ui/EmptyState.tsx`, `ui/ErrorState.tsx` (kinds network/forbidden/not-found/server + onRetry) | x7 each |
| Layout helpers | `ui/PageHeader.tsx`, `DetailSection.tsx`, `FormSection.tsx`, `Timeline.tsx`, `EntityCard.tsx`, `StickyActionBar.tsx`, `SearchBar.tsx` | partial |
| Forms | `ui/form.tsx`, `input`, `textarea`, `select`, `checkbox`, `switch`, `radio-group`, `calendar`, `popover`, `command` | partial |
| Toast | `ui/sonner.tsx` (`toast` from sonner) | yes (except `alert()` in PTManagement) |
| Sidebar primitive | `ui/sidebar.tsx` (shadcn) — not used by custom `layout/Sidebar.tsx` | no |
| Helpers | `utils/currency.ts`, `utils/adminLabels.ts`, `pages/admin/adminReconciliation.utils.ts`, `utils/listingErrors.ts`, `pages/admin/listings/adminListingShared.ts`, `friendlyError` (partnerApplication) | |

### 5.2 Theme tokens
- `styles/theme.css` (549 lines): dark defaults in `:root`/`.dark` (~lines 1-60 and ~140-175), light in `.light, :root[data-theme="light"]` (line 61+). Tokens: `--background #0a0a0a / #f8fafc`, `--foreground #f4f4f5 / #111827`, `--card #111 / #fff`, `--card-foreground`, `--primary #22c55e / #059669`, `--primary-foreground`, `--accent #1f1f1f / #e2e8f0`, `--accent-foreground`, `--destructive #ef4444`, `--destructive-foreground`, legacy `--card-bg`, `--primary-color`, `--primary-text` (plus other shadcn tokens not enumerated).
- Lines ~110-137: **light mode works by remapping Tailwind `--color-zinc-50…950` to a mirrored scale**; zinc utilities flip automatically, hex literals and `bg-green/red/amber-500` do not.
- Other style files: `styles/tailwind.css`, `styles/index.css`, `styles/fonts.css`. Toggle: `components/settings/ThemeToggle.tsx`. `.app-theme-overlay` sits over the background photo.
- No semantic status/money tokens (`--success/--warning/--danger`) exist; each admin component picks Tailwind palette colors by hand.

## 6. Counts
- Routes: 15 pages + 1 index redirect + 2 legacy redirects; 15 sidebar items.
- Feature rows: 66 (ADM-01..78 with gaps). Status: IMPL 57, PART 9 (ADM-01, 05, 08, 20, 24, 28, 32, 51, 62), UI ONLY 0 whole features (hardcoded KPI text inside ADM-01), DISABLED 0, BROKEN 0 (none provable without runtime), NV 1 group (10 unused API wrappers, 2.5).
- Mutating actions: ~45 distinct; money-moving 5 (membership refund, refund approve, withdrawal mark-paid, dispute ruling, partner terminate PRORATED_REFUND) plus withdrawal approve/reject, refund deny. ~12 of ~45 have any confirm.
- All evidence is CODE AUDIT. No REAL BROWSER / REAL HTTP / BACKEND INTEGRATION evidence in this document.
