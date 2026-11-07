# B2 — Functional parity (AdminShell + nav + routes)

Evidence: CODE AUDIT (git diff: no page component except the finance layout was edited) + MOCK BROWSER TEST
(Playwright + `page.route` mocks, vite dev, no real backend; 439 + 96 checks, all pass). Not REAL BROWSER against a live
stack, not E2E. Baseline = audit `01_ADMIN_FRONTEND_INVENTORY.md` §1.2.

Guard: `routes.tsx` still wraps the whole `/admin` subtree in `<RequireRole allow={["admin"]}>` (only the child element changed
`AppShell` -> `AdminShell`). No auth change. Backend RBAC untouched.

## 1. Old sidebar entries (15) -> new

| # | Old label | Old URL | New sidebar entry (group) | Click path | Same page component | Result (mock test) |
|---|---|---|---|---|---|---|
| 1 | Tổng quan | /admin/dashboard | Hôm nay | 1 click | AdminDashboard | opens 1440/768/390 |
| 2 | Người dùng | /admin/users | Người dùng (Đối tác & người dùng) | 1 | UserManagement | OK |
| 3 | Quản lý PT | /admin/pts | Hồ sơ PT (+badge) | 1 | PTManagement | OK |
| 4 | Chợ kế hoạch | /admin/marketplace | Chợ kế hoạch (Xử lý vụ việc) | 1 | MarketplaceModeration | OK |
| 5 | Duyệt bài tập trùng lặp | /admin/exercise-review | Bài tập trùng lặp (Xử lý vụ việc) | 1 | AdminExerciseReview | OK |
| 6 | Ma trận chất lượng catalog | /admin/catalog-quality | Chất lượng bài tập (Xử lý vụ việc) | 1 | AdminCatalogQuality | OK |
| 7 | Tài chính | /admin/finance | Tổng quan tài chính / Đối soát / Rút tiền / Hoàn tiền (Tài chính) | 1 (tab strip also in page) | AdminFinancePage (now a layout) + the 4 existing tab components | OK |
| 8 | Giám sát hệ thống | /admin/system | Giám sát hệ thống (Hệ thống) | 1 | SystemMonitoring | OK |
| 9 | Khiếu nại buổi tập | /admin/disputes | Tranh chấp buổi tập (Xử lý vụ việc) — plain link, no badge | 1 | AdminDisputes (not touched) | OK |
| 10 | Tổng quan Gym | /admin/gym-management | Tổng quan phòng gym (Đối tác & người dùng) | 1 | AdminGymManagementOverview | OK |
| 11 | Chi nhánh | /admin/gyms | Chi nhánh (+badge) | 1 | AdminGymModeration | OK |
| 12 | Đối tác | /admin/partners | Đối tác phòng gym (+badge) | 1 | AdminPartnersPage | OK |
| 13 | Tin đăng & tiện ích | /admin/listings | Tin đăng & tiện ích (+badge) | 1 | AdminListingsPage | OK |
| 14 | Khiếu nại | /admin/complaints | Khiếu nại phòng gym (Xử lý vụ việc) | 1 | AdminComplaintsPage | OK |
| 15 | Giám sát AI | /admin/ai-observability | Giám sát AI (Hệ thống) | 1 | AdminAIObservability | OK |

Renamed only: labels per Master Plan §2.2/2.3. Unit test `adminNav.test.ts` asserts all 15 old paths are still sidebar targets.

## 2. Routes / redirects

| Old URL | Now | Mechanism | Query/hash kept | Result |
|---|---|---|---|---|
| /admin | /admin/dashboard | unchanged index redirect | – | OK |
| /admin/finance | /admin/finance (overview) | route index = AdminFinanceOverviewTab | – | OK |
| /admin/finance?tab=overview | /admin/finance | AdminFinancePage `<Navigate replace>` | other params | OK |
| /admin/finance?tab=reconciliation | /admin/finance/reconciliation | same | other params | OK |
| /admin/finance?tab=withdrawals | /admin/finance/withdrawals | same | other params (`&foo=bar` kept) | OK |
| /admin/finance?tab=refunds | /admin/finance/refunds | same | other params | OK |
| /admin/finance?tab=bogus | renders overview, no redirect | – | – | OK |
| /admin/withdrawals[?x][#h] | /admin/finance/withdrawals[?x] | LegacyAdminRedirect `<Navigate replace>` | yes | OK |
| /admin/pt-service-refunds[?x] | /admin/finance/refunds[?x] | same | yes | OK |
| /admin/finance/<unknown> (e.g. transactions) | /admin/finance | `*` child -> Navigate | – | OK (no 404; Giao dịch NOT added — needs backend) |
| every other old URL | unchanged | – | – | OK |

Bug found and fixed during the test: the legacy redirect element re-rendered once with the new URL and fell back to
`/admin/finance` (tab lost). Fixed (`LegacyAdminRedirect` now renders nothing when the location is no longer legacy). Re-run: 439/439.

## 3. P0/P1 actions (audit ADM-03/25/27/30 etc.) and page content

No admin page file changed except `AdminFinancePage.tsx` (header kept verbatim; tab buttons -> route links, same `data-testid`s
`admin-finance-tabs`, `admin-finance-tab-{overview|reconciliation|withdrawals|refunds}`). The finance tab components
(AdminFinanceOverviewTab, AdminReconciliationPanel, AdminWithdrawals, PTServiceRefunds) are rendered unchanged via `<Outlet>`, so the B1
money dialogs/guards (withdraw approve/mark-paid, service refund, membership refund on Dashboard, dispute ruling, partner
terminate/revoke etc.) are the same code. Withdrawals and refunds tabs mount with data in the mock test (cards visible).
Same React Query keys on the finance tabs -> invalidations after money actions still refresh the sidebar badges.

## 4. Deep links, back/forward (1440 and 390)

dashboard -> users -> finance -> (tab click) withdrawals -> refunds; Back x3 returns withdrawals, finance, users with the right
tab `aria-current` + breadcrumb; Forward x2 returns finance, withdrawals; reload on `/admin/finance/withdrawals` keeps page + tab.
A redirected legacy URL is replaced in history (Back does not return to it). All PASS.

## 5. Regressions / differences to know

- Finance tab strip: green pill buttons -> underlined route links (presentation; B3 redesigns the finance content).
- Tabs are routes now, so a finance tab switch adds a history entry (it did not before — it was state only). Intended by plan §2.3.
- "Hôm nay" is the new label of the Dashboard entry; the page content is still the old "Tổng quan quản trị" until B3.
- Notification bell + language switcher + user menu functions kept (user menu now = sidebar user card: name/email/Đăng xuất; the old
  menu's "Trang Admin" link is dropped — it only linked to the page you are already in). Realtime status dot and the AI-tasks pill of the
  old topbar are not shown on admin (AI coach/call overlay are intentionally absent).
- Badge for "Đối soát" = number of CRITICAL items (countAttention.critical) only when both reports loaded; watch-level items are not badged.
- Sidebar mounts 8 existing list queries (same keys/fns as the pages) on every admin page, incl. the two reconciliation reports.

No regression found. Any admin URL that worked before still works.
