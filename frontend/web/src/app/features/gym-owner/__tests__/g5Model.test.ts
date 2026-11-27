/**
 * TEST FIXTURE (pure functions) + CODE AUDIT (source text) - G5 "Đồng bộ hợp đồng mới + Tài chính": permissions[] drive the nav and every
 * write control (fail-closed), the stats line of a branch never turns an error into 0, the bell deep links, the Tài chính model (tabs, wallet
 * view, timeline, amount check, withdrawal refusals, sales), and the source audits (no total of wallets, no free-text payout, no role-name test).
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/*.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { canOf, GRANTS, permsFor } from "./permFixture";
import { makeCan, normalizePermissions, type PartnerRole } from "../../../utils/gymStaffRole";
import { NAV_PERMISSIONS, flatNavFor, navFor } from "../../../components/layout/gym-owner/gymOwnerNav";
import { bellTarget } from "../../../components/layout/gym-owner/bellModel";
import { byStatusOf, gymStatsKey, invalidateGymStats, statsLineOf, statsLineText, type StatsState } from "../stats/gymStats";
import { branchRows, type BranchRow, type TodayGym, type TodayModel } from "../today/todayModel";
import {
  APPROVED_NOT_PAID_NOTE,
  FIN_TAB_PERMISSION,
  NO_REASON_TEXT,
  NO_TOTAL_NOTE,
  PAYOUT_REQUIRED_TEXT,
  SALES_MEANING_NOTE,
  checkAmountInput,
  coverageLine,
  finTabsFor,
  financeHref,
  financeSearch,
  isOpenWithdrawal,
  normalizeSales,
  normalizeWithdrawals,
  parseFinTab,
  payoutSourceNote,
  resolveFinTab,
  sortWithdrawals,
  walletView,
  WALLET_COLUMNS,
  walletRowState,
  withdrawFailure,
  withdrawalTimeline,
  wdStatusTag,
} from "../finance/financeModel";
import { withdrawalsCsv } from "../../../utils/financeExport";
import type { Wallet } from "../../../types";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");
const app = (rel: string) => readFileSync(resolve(here, "../../..", rel), "utf8");
const ROLES: PartnerRole[] = ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"];

describe("permissions parity with the backend (CODE AUDIT of partner-permissions.ts)", () => {
  const file = readFileSync(resolve(here, "../../../../../../../backend/services/gym-service/src/services/partner-permissions.ts"), "utf8");
  const listOf = (name: string): string[] => {
    const m = new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(file);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  };
  const grantBlock = (role: string): string[] => {
    const m = new RegExp(`${role}: new Set<PartnerPermission>\\(([\\s\\S]*?)\\)(?:,\\n|;)`).exec(file);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  };
  it("the test table equals the server table for every role", () => {
    const all = [...listOf("OWNER_ONLY_PERMISSIONS"), ...listOf("SHARED_PERMISSIONS")];
    assert.ok(all.length >= 27);
    assert.deepEqual([...GRANTS.OWNER].sort(), [...all].sort());
    for (const r of ["MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as const) assert.deepEqual([...GRANTS[r]].sort(), grantBlock(r).sort(), r);
  });
});

describe("nav follows the server's permissions[] (fail-closed)", () => {
  const ids = (role: PartnerRole | undefined, perms?: readonly string[]) => flatNavFor(role, perms).map((i) => i.id);
  it("with the real permission sets the nav is what 05 section 3 says", () => {
    assert.deepEqual(ids("OWNER", permsFor("OWNER")), ["today", "front-desk", "members", "branches", "pt", "finance", "cases", "staff", "profile"]);
    assert.deepEqual(ids("MANAGER", permsFor("MANAGER")), ["today", "front-desk", "members", "branches", "pt", "cases", "profile"]);
    assert.deepEqual(ids("RECEPTIONIST", permsFor("RECEPTIONIST")), ["front-desk", "profile"]);
    assert.deepEqual(ids("ACCOUNTANT", permsFor("ACCOUNTANT")), ["members", "pt", "finance", "profile"]);
  });
  it("a known role with NO permissions[] (old backend, loading) lists only the entries that have no permission row; never the owner menu", () => {
    for (const perms of [[], ["not-a-permission"]]) assert.deepEqual(ids("OWNER", perms), ["cases", "profile"], JSON.stringify(perms));
    assert.deepEqual(ids("OWNER", normalizePermissions("garbage") as string[]), ["cases", "profile"]);
    assert.deepEqual(navFor(undefined, permsFor("OWNER")), []);
  });
  it("an entry needs the permission AND the route guard: a permission the role table does not allow never opens an entry", () => {
    assert.ok(!ids("RECEPTIONIST", permsFor("OWNER")).includes("finance"), "a receptionist with owner permissions still bounces off Tài chính (role table)");
    assert.ok(ids("OWNER", ["finance.wallet.view"]).includes("finance"));
    assert.ok(!ids("OWNER", ["branch.view"]).includes("finance"));
  });
  it("every nav item with a permission row names real permissions", () => {
    const known = new Set(permsFor("OWNER"));
    for (const [id, need] of Object.entries(NAV_PERMISSIONS)) for (const p of need) assert.ok(known.has(p), `${id} ${p}`);
  });
});

describe("write controls come from permissions, not role names (CODE AUDIT of the G0-G5 sources)", () => {
  const files = [
    "branches/branchesModel.ts", "branches/BranchesPage.tsx", "branches/BranchDetailPage.tsx", "branches/OverviewTab.tsx", "branches/StatusTab.tsx",
    "members/membersModel.ts", "members/MembersPage.tsx", "members/MembersTab.tsx", "members/PlansTab.tsx", "members/MemberDrawer.tsx",
    "front-desk/frontDeskModel.ts", "front-desk/FrontDeskPage.tsx", "front-desk/ExceptionDrawer.tsx",
    "partners/partnersModel.ts", "partners/PartnersPage.tsx", "partners/AgreementsView.tsx", "partners/CheckinsView.tsx", "partners/CommissionView.tsx",
    "finance/FinancePage.tsx", "finance/WalletsTab.tsx", "finance/WithdrawDialog.tsx", "finance/WithdrawalsTab.tsx", "finance/SalesTab.tsx", "finance/financeModel.ts",
  ];
  it("no `role === \"OWNER\"|\"MANAGER\"|\"ACCOUNTANT\"|\"RECEPTIONIST\"` decision is left in these files", () => {
    for (const f of files) {
      const text = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(text, /\brole\s*[!=]==\s*"(OWNER|MANAGER|ACCOUNTANT|RECEPTIONIST)"/, f);
    }
  });
  it("the scope provider exposes permissions + can, built with makeCan (no role fallback)", () => {
    const t = src("scope/GymOwnerScopeProvider.tsx");
    assert.match(t, /makeCan\(role, staff\.permissions\)/);
    assert.match(t, /permissions: staff\.permissions/);
    assert.match(app("hooks/useStaffRole.ts"), /permissions: normalizePermissions\(rawPermissions\)/);
  });
  it("makeCan is false without a known role or without the listed permission", () => {
    assert.equal(makeCan(undefined, ["finance.withdraw"])("finance.withdraw"), false);
    assert.equal(makeCan("OWNER", undefined)("finance.withdraw"), false);
    assert.equal(makeCan("OWNER", ["finance.withdraw"])("finance.withdraw"), true);
    assert.equal(makeCan("OWNER", ["finance.withdraw"])("branch.write"), false);
    for (const r of ROLES) assert.equal(canOf(r)("finance.withdraw"), r === "OWNER", r);
  });
});

describe("stats line of a branch (GET /owner/gyms/:id/stats)", () => {
  const stats = (over: object = {}) => ({
    gymId: "g1", timeZone: "Asia/Ho_Chi_Minh", from: "2026-11-17", to: "2026-11-23", today: "2026-11-23",
    checkins: { today: 12, total: 80, daily: [] }, memberships: { active: 40, expiringSoon: 3, expiringSoonDays: 7, byStatus: { ACTIVE: 41, EXPIRED: 9 } }, ...over,
  });
  it("ok: check-ins today, running and expiring come from the server's numbers", () => {
    const l = statsLineOf({ state: "ok", stats: stats() });
    assert.deepEqual([l.checkinsToday, l.runningMemberships, l.expiringSoon, l.expiringSoonDays], [12, 40, 3, 7]);
    assert.deepEqual(statsLineText(l), ["12 lượt check-in hôm nay", "3 thẻ sắp hết hạn trong 7 ngày"]);
  });
  it("a null block (role has no permission) is unknown, not 0", () => {
    const l = statsLineOf({ state: "ok", stats: stats({ checkins: null }) });
    assert.equal(l.checkinsToday, null);
    assert.deepEqual(statsLineText(l), ["3 thẻ sắp hết hạn trong 7 ngày"]);
    assert.deepEqual(statsLineText(statsLineOf({ state: "ok", stats: stats({ checkins: null, memberships: null }) })), []);
  });
  it("an error or a pending request is words, never zeros", () => {
    assert.deepEqual(statsLineText(statsLineOf({ state: "error" })), ["Chưa tải được số liệu hôm nay"]);
    assert.deepEqual(statsLineText(statsLineOf({ state: "loading" })), ["Đang tải số liệu hôm nay"]);
    const l = statsLineOf({ state: "error" });
    assert.deepEqual([l.checkinsToday, l.runningMemberships, l.expiringSoon], [null, null, null]);
  });
  it("a real zero stays a zero (a quiet day is a number the server counted)", () => {
    const l = statsLineOf({ state: "ok", stats: stats({ checkins: { today: 0, total: 0, daily: [] } }) });
    assert.equal(l.checkinsToday, 0);
    assert.equal(statsLineText(l)[0], "0 lượt check-in hôm nay");
  });
  it("byStatusOf: only the server's counts; missing block or error = null", () => {
    assert.deepEqual(byStatusOf({ state: "ok", stats: stats() }), { ACTIVE: 41, EXPIRED: 9 });
    assert.equal(byStatusOf({ state: "ok", stats: stats({ memberships: null }) }), null);
    assert.equal(byStatusOf({ state: "error" }), null);
    assert.equal(byStatusOf({ state: "loading" }), null);
  });
  it("branchRows: stats per branch, no branch total; a failed branch says so on its own row", () => {
    const gyms: TodayGym[] = [{ id: "g1", name: "Q1", status: "APPROVED", activeMemberCount: 9 }, { id: "g2", name: "Q7", status: "APPROVED", activeMemberCount: 4 }];
    const model = { failedGymIds: [], failedBrandSources: [], loading: false, tasks: [] } as unknown as TodayModel;
    const by: Record<string, StatsState> = { g1: { state: "ok", stats: stats() }, g2: { state: "error" } };
    const rows: BranchRow[] = branchRows(gyms, model, { g1: "Q1", g2: "Q7" }, () => "Đang mở cửa", by);
    assert.equal(rows[0].running, 40);
    assert.deepEqual(rows[0].statsLines, ["12 lượt check-in hôm nay", "3 thẻ sắp hết hạn trong 7 ngày"]);
    assert.equal(rows[1].running, null);
    assert.deepEqual(rows[1].statsLines, ["Chưa tải được số liệu hôm nay"]);
    assert.equal(rows[1].members, 4, "the list's own count stays as the fallback line");
    assert.equal(branchRows(gyms, model, {}, () => "", {}).every((r) => r.statsLines.length === 0 && r.running === null), true);
  });
  it("stats query keys are per user + branch; the assisted check-in invalidates exactly that key (CODE AUDIT)", () => {
    assert.deepEqual(gymStatsKey("u1", "g1"), ["gym-owner-stats", "u1", "g1"]);
    const calls: unknown[] = [];
    void invalidateGymStats({ invalidateQueries: (a: unknown) => (calls.push(a), Promise.resolve()) } as never, "u1", "g1");
    void invalidateGymStats({ invalidateQueries: (a: unknown) => (calls.push(a), Promise.resolve()) } as never, "u1");
    assert.deepEqual(calls, [{ queryKey: ["gym-owner-stats", "u1", "g1"] }, { queryKey: ["gym-owner-stats", "u1"] }]);
    assert.match(app("components/gym/AssistedCheckinPanel.tsx"), /invalidateGymStats\(qc, uid, gymId\)/);
    assert.match(src("today/TodayPage.tsx"), /gymStatsKey\(scope\.userId, g\.id\)/);
    assert.match(src("members/MembersTab.tsx"), /gymStatsKey\(scope\.userId, gymId\)/);
  });
  it("Hôm nay never adds the branches' numbers together (CODE AUDIT)", () => {
    const t = src("today/TodayPage.tsx") + src("today/todayModel.ts") + src("stats/gymStats.ts");
    assert.doesNotMatch(t, /\.reduce\(/);
  });
});

describe("members list is paged by the server (CODE AUDIT of MembersTab)", () => {
  const t = src("members/MembersTab.tsx");
  it("uses the paged API with the status filter (+ the server name search) and 'Xem thêm', and offers no client-side filter / plan filter / sort", () => {
    assert.match(t, /listOwnedMembershipsPage\(gymId, \{ limit: MEMBERS_PAGE_SIZE, cursor: pageParam, status: statusParamOf\(status\), q: term \|\| undefined \}, signal\)/);
    assert.match(t, /fetchNextPage/);
    assert.match(t, /getNextPageParam: \(last\) => \(last\.hasMore \? last\.nextCursor : undefined\)/);
    assert.doesNotMatch(t, /applyMemberView|filterMembers|MEMBER_SORTS|go-members-plan|go-members-sort/);
    assert.doesNotMatch(t, /chưa phân trang/);
  });
  it("status counts are drawn only from the stats answer (serverSegments(byStatusOf(...)))", () => {
    assert.match(t, /serverSegments\(byStatusOf\(statsState\)\)/);
    assert.doesNotMatch(t, /statusSegments\(/);
  });
});

describe("bell deep links (bellModel)", () => {
  it("a branch withdrawal decision opens Tài chính > Lệnh rút of that branch with the request's drawer", () => {
    for (const eventType of ["WITHDRAWAL_APPROVED", "WITHDRAWAL_PAID", "WITHDRAWAL_REJECTED"]) {
      assert.equal(
        bellTarget({ eventType, entityType: "WITHDRAWAL_REQUEST", entityId: "wd-1", link: "/gym-owner/gyms/gym-9" }),
        "/gym-owner/finance?gymId=gym-9&tab=withdrawals&withdrawal=wd-1",
        eventType,
      );
    }
  });
  it("a PT / client withdrawal notice keeps its own link", () => {
    assert.equal(bellTarget({ eventType: "WITHDRAWAL_PAID", entityId: "w", link: "/pt/wallet" }), "/pt/wallet");
    assert.equal(bellTarget({ eventType: "WITHDRAWAL_PAID", entityId: "w", link: "/client/wallet" }), "/client/wallet");
  });
  it("a check-in exception request opens the Ngoại lệ tab of the branch", () => {
    assert.equal(bellTarget({ eventType: "GYM_CHECKIN_EXCEPTION_REQUESTED", link: "/gym-owner/front-desk?gymId=gym-9" }), "/gym-owner/front-desk?gymId=gym-9&tab=exceptions");
    assert.equal(bellTarget({ eventType: "GYM_CHECKIN_EXCEPTION_REQUESTED", link: "/gym-owner/front-desk?gymId=g&tab=pt" }), "/gym-owner/front-desk?gymId=g&tab=pt", "an explicit tab is kept");
  });
  it("complaint cases and plain links are unchanged; no link = null", () => {
    assert.equal(bellTarget({ entityType: "GYM_COMPLAINT_CASE", entityId: "c 1" }), "/gym-owner/complaint-cases/c%201");
    assert.equal(bellTarget({ eventType: "X", link: "/gym-owner/gyms/g" }), "/gym-owner/gyms/g");
    assert.equal(bellTarget({ eventType: "WITHDRAWAL_PAID" }), null);
  });
  it("the bell uses it (CODE AUDIT)", () => {
    assert.match(app("components/layout/gym-owner/GymOwnerBell.tsx"), /bellTarget\(n\)/);
  });
});

describe("sidebar badge (CODE AUDIT)", () => {
  const t = app("components/layout/gym-owner/GymOwnerSidebar.tsx");
  it("the pending-exception count is the existing hook, enabled by checkin.exception.approve, drawn only when > 0 on Quầy lễ tân", () => {
    assert.match(t, /usePendingCheckinExceptionCount\(can\("checkin\.exception\.approve"\)\)/);
    assert.match(t, /item\.id === "front-desk" && pendingExceptions > 0/);
    assert.match(t, /navFor\(role, permissions\)/);
  });
});

describe("Tài chính: tabs and URL", () => {
  it("each tab needs its own permission; no permission = no tab", () => {
    assert.deepEqual(finTabsFor(canOf("OWNER")).map((t) => t.id), ["wallets", "withdrawals", "commission", "sales"]);
    assert.deepEqual(finTabsFor(canOf("ACCOUNTANT")).map((t) => t.id), ["wallets", "withdrawals", "commission", "sales"]);
    assert.deepEqual(finTabsFor(canOf("MANAGER")), []);
    assert.deepEqual(finTabsFor(canOf("RECEPTIONIST")), []);
    assert.deepEqual(finTabsFor(canOf(undefined)), []);
    assert.deepEqual(finTabsFor(makeCan("OWNER", undefined)), []);
    assert.deepEqual(finTabsFor(makeCan("ACCOUNTANT", ["finance.wallet.view"])).map((t) => t.id), ["wallets"]);
    assert.equal(FIN_TAB_PERMISSION.sales, "membership.sales");
  });
  it("resolveFinTab never returns a tab the account may not read", () => {
    assert.equal(resolveFinTab("sales", canOf("OWNER")), "sales");
    assert.equal(resolveFinTab("nonsense", canOf("OWNER")), "wallets");
    assert.equal(resolveFinTab("commission", makeCan("ACCOUNTANT", ["finance.wallet.view"])), "wallets");
    assert.equal(resolveFinTab("wallets", canOf("MANAGER")), null);
    assert.equal(parseFinTab("withdrawals"), "withdrawals");
    assert.equal(parseFinTab(null), null);
  });
  it("URL: ?gymId=&tab=&withdrawal= (wallets is the default tab and is not written; ALL writes no gymId)", () => {
    assert.equal(financeSearch({ gymId: "g1", tab: "wallets" }), "?gymId=g1");
    assert.equal(financeSearch({ gymId: "ALL", tab: "wallets" }), "");
    assert.equal(financeSearch({ gymId: "g1", tab: "withdrawals", withdrawalId: "w9" }), "?gymId=g1&tab=withdrawals&withdrawal=w9");
    assert.equal(financeSearch({ tab: "sales" }), "?tab=sales");
    assert.equal(financeSearch({ gymId: "g1", tab: "sales", withdrawalId: "w9" }), "?gymId=g1&tab=sales", "the drawer id only rides on the withdrawals tab");
    assert.equal(financeHref("g1"), "/gym-owner/finance?gymId=g1");
    assert.equal(financeHref(null), "/gym-owner/finance");
  });
});

describe("Tài chính: wallet view (server numbers only)", () => {
  const wallet = (over: Partial<Wallet> = {}): Wallet =>
    ({ id: "w", ownerType: "GYM", ownerId: "g1", availableBalance: "5000000.00", pendingBalance: "1200000.00", lockedBalance: "300000.00", status: "ACTIVE", createdAt: "", updatedAt: "", withdrawable: "3500000.00", reservedPending: "1000000.00", gymDebt: { openUnpaid: "500000.00", recoveredTotal: "250000.00", recent: [{ at: "2026-11-20T03:00:00Z", amount: "100000.00", unpaidAfter: "500000.00" }] }, ...over }) as Wallet;
  it("'Có thể rút' is the server's withdrawable, not available minus anything of ours", () => {
    const v = walletView(wallet());
    assert.equal(v.withdrawable, 3500000);
    assert.equal(v.withdrawableFromServer, true);
    assert.deepEqual([v.available, v.pending, v.locked, v.reservedPending], [5000000, 1200000, 300000, 1000000]);
    assert.deepEqual([v.debtOpen, v.debtRecovered], [500000, 250000]);
    assert.equal(v.debtRecent.length, 1);
  });
  it("an old server without withdrawable falls back to availableBalance and says so (flag)", () => {
    const v = walletView(wallet({ withdrawable: undefined, reservedPending: undefined }));
    assert.equal(v.withdrawable, 5000000);
    assert.equal(v.withdrawableFromServer, false);
    assert.equal(v.reservedPending, 0);
  });
  it("a debt that never existed is absent, a FROZEN wallet is flagged inactive", () => {
    const v = walletView(wallet({ gymDebt: undefined, status: "FROZEN" }));
    assert.deepEqual([v.debtOpen, v.debtRecovered, v.debtRecent.length], [0, 0, 0]);
    assert.equal(v.active, false);
  });
  it("wallets are never summed: no reduce over wallets, a no-total note, no total row (CODE AUDIT)", () => {
    const t = src("finance/WalletsTab.tsx") + src("finance/financeModel.ts");
    assert.doesNotMatch(t, /\.reduce\(/);
    assert.doesNotMatch(src("finance/WalletsTab.tsx"), /recognizedSales|withdrawableOf\([^)]*\)\s*\+/);
    assert.match(NO_TOTAL_NOTE, /không cộng tổng/);
    assert.match(src("finance/WalletsTab.tsx"), /data-testid="go-fin-nototal"/);
  });
  it("all-branches wallets are ONE table with a row per branch, no tfoot / total row, a focusable labelled scroll region (CODE AUDIT)", () => {
    const t = src("finance/WalletsTab.tsx");
    assert.match(t, /<table className="go-wt"/);
    assert.doesNotMatch(t, /<tfoot|go-wallet-total|Tổng/);
    assert.match(t, /role="region" aria-label="Bảng ví các chi nhánh, có thể cuộn ngang" tabIndex=\{0\}/);
    assert.match(t, /className="go-wt-first"/);
    assert.match(t, /Không có<\/span>/, "no debt = the words Không có");
    assert.doesNotMatch(t, /go-slot-num|go-wcard/);
  });
  it("R2: no coloured stripes and no card-in-card classes left in the CSS", () => {
    const css = readFileSync(resolve(here, "../../../../styles/gym-owner.css"), "utf8");
    assert.doesNotMatch(css, /border-left-color: var\(--go-money/);
    assert.doesNotMatch(css, /\.go-wcard|\.go-slot\b/);
    assert.match(css, /\.go-wgrid-cell \+ \.go-wgrid-cell \{ border-left: 1px solid var\(--go-line\)/);
  });
  it("wallet columns carry their meaning once (tooltip + legend); row state: failed = error row, unapproved = no wallet, never 0", () => {
    assert.deepEqual(WALLET_COLUMNS.map((c) => c.label), ["Có thể rút", "Khả dụng", "Đang chờ", "Đang khoá", "Giữ cho lệnh chờ", "Nợ nền tảng"]);
    assert.ok(WALLET_COLUMNS.every((c) => c.help.length > 20));
    assert.equal(walletRowState({ loading: true, failed: false, approved: true }), "loading");
    assert.equal(walletRowState({ loading: false, failed: true, approved: true }), "failed");
    assert.equal(walletRowState({ loading: false, failed: true, approved: false }), "no-wallet");
    assert.equal(walletRowState({ loading: false, failed: false, approved: true }), "ready");
  });
  it("R3: Hiệu lực keeps a fixed minimum width so the members table does not jump; the only <input> is the server-side name search (GoSearch)", () => {
    const t = src("members/MembersTab.tsx");
    assert.match(t, /minmax\(236px, 1\.3fr\)/);
    assert.match(t, /go-validity-main/);
    assert.doesNotMatch(t, /<input/);
  });
});

describe("Tài chính: withdrawal requests", () => {
  const raw = (id: string, status: string, over: object = {}) => ({ id, amount: "1500000.00", status, payoutInfo: "VCB — 0123456789 — NGUYEN VAN A", createdAt: "2026-11-20T03:00:00Z", ...over });
  const gym = { id: "g1", name: "Q1" };
  it("normalize keeps the server's fields, drops rows without an id, sorts newest first with a stable tie-break", () => {
    const rows = normalizeWithdrawals([raw("b", "PENDING", { createdAt: "2026-11-21T00:00:00Z" }), raw("a", "PAID", { createdAt: "2026-11-21T00:00:00Z" }), raw("c", "REJECTED"), { amount: 1 }, null], gym);
    assert.deepEqual(sortWithdrawals(rows).map((r) => r.id), ["a", "b", "c"]);
    assert.equal(rows[0].gymName, "Q1");
    assert.equal(rows[0].amount, 1500000);
    assert.deepEqual(normalizeWithdrawals("nope", gym), []);
  });
  it("status words: Đã duyệt is not Đã chi; only PENDING and APPROVED are open", () => {
    assert.equal(wdStatusTag("PENDING").text, "Chờ duyệt");
    assert.equal(wdStatusTag("APPROVED").text, "Đã duyệt, chưa chuyển tiền");
    assert.equal(wdStatusTag("PAID").text, "Đã chi");
    assert.equal(wdStatusTag("REJECTED").text, "Bị từ chối");
    assert.notEqual(wdStatusTag("APPROVED").text, wdStatusTag("PAID").text);
    assert.deepEqual(["PENDING", "APPROVED", "PAID", "REJECTED", "X"].map(isOpenWithdrawal), [true, true, false, false, false]);
    assert.match(APPROVED_NOT_PAID_NOTE, /Đã duyệt khác Đã chi/);
  });
  it("timeline: PENDING, APPROVED, PAID (with reference) and REJECTED (with / without a reason)", () => {
    const t = (status: string, over: object = {}) => withdrawalTimeline(normalizeWithdrawals([raw("x", status, over)], gym)[0]);
    const pending = t("PENDING");
    assert.deepEqual(pending.map((s) => [s.key, s.done]), [["created", true], ["approved", false], ["paid", false]]);
    assert.equal(pending[2].text, "Chưa chi, tiền chưa rời Gymini.");
    const approved = t("APPROVED", { reviewedAt: "2026-11-21T04:00:00Z" });
    assert.deepEqual(approved.map((s) => s.done), [true, true, false]);
    assert.match(approved[1].text, /2026|21/);
    const paid = t("PAID", { reviewedAt: "2026-11-21T04:00:00Z", paidAt: "2026-11-22T04:00:00Z", bankReference: "FT123" });
    assert.deepEqual(paid.map((s) => s.done), [true, true, true]);
    assert.match(paid[2].text, /Mã tham chiếu FT123/);
    const rej = t("REJECTED", { rejectionReason: "Sai tên chủ tài khoản" });
    assert.deepEqual(rej.map((s) => [s.key, s.tone]), [["created", "ok"], ["rejected", "risk"]]);
    assert.match(rej[1].text, /Lý do: Sai tên chủ tài khoản/);
    assert.match(t("REJECTED")[1].text, new RegExp(NO_REASON_TEXT.replace(".", "\\.")));
  });
  it("a missing time is said in words (the accountant's rows carry no reviewedAt), never invented", () => {
    const a = withdrawalTimeline(normalizeWithdrawals([raw("x", "APPROVED")], gym)[0]);
    assert.equal(a[1].text, "Đã duyệt.");
    const none = withdrawalTimeline(normalizeWithdrawals([raw("y", "PENDING", { createdAt: undefined })], gym)[0]);
    assert.equal(none[0].text, "Máy chủ không ghi giờ tạo.");
  });
  it("the account line follows the role: masked for the accountant, 'đã đăng ký' for the new owner requests, honest for old ones", () => {
    assert.match(payoutSourceNote({ payoutSource: "REGISTERED_ACCOUNT" }, false), /đã đăng ký/);
    assert.match(payoutSourceNote({ payoutSource: null }, false), /người tạo lệnh nhập/);
    assert.match(payoutSourceNote({ payoutSource: "REGISTERED_ACCOUNT" }, true), /che số tài khoản/);
  });
  it("CSV: the owner's account column is not called masked; the accountant's is", () => {
    const rows = [{ id: "1", amount: "5", status: "PAID", gymName: "Q1" }];
    assert.match(withdrawalsCsv(rows).split("\r\n")[0], /đã che/);
    assert.match(withdrawalsCsv(rows, { masked: true }).split("\r\n")[0], /đã che/);
    assert.doesNotMatch(withdrawalsCsv(rows, { masked: false }).split("\r\n")[0], /đã che/);
  });
  it("coverage: names the branches that failed", () => {
    assert.equal(coverageLine(3, []), null);
    assert.equal(coverageLine(3, ["Q7"]), "Đã tải 2/3 chi nhánh. Chưa tải được: Q7.");
  });
});

describe("Tài chính: amount typed by the owner", () => {
  it("digits only, dots / spaces as thousand separators, whole dong; the minimum and ceiling are the server's", () => {
    assert.deepEqual(checkAmountInput("500000"), { ok: true, value: "500000" });
    assert.deepEqual(checkAmountInput(" 1.500.000 "), { ok: true, value: "1500000" });
    assert.deepEqual(checkAmountInput("0500"), { ok: true, value: "500" });
    assert.deepEqual(checkAmountInput(""), { ok: false, error: null });
    assert.equal(checkAmountInput("abc").ok, false);
    assert.equal(checkAmountInput("12,5").ok, false);
    assert.equal(checkAmountInput("-5").ok, false);
    assert.match((checkAmountInput("0") as { error: string }).error, /lớn hơn 0/);
    assert.equal(checkAmountInput("1".repeat(13)).ok, false);
    // a small number is NOT refused here: "tối thiểu" is the server's rule and its sentence is shown
    assert.deepEqual(checkAmountInput("5000"), { ok: true, value: "5000" });
  });
});

describe("Tài chính: every way a withdrawal can be refused is one Vietnamese sentence", () => {
  const err = (status: number | undefined, code?: string, message?: string) => ({ response: status ? { status, data: { error: { code, message } } } : undefined });
  it("409 PAYOUT_ACCOUNT_REQUIRED", () => {
    const f = withdrawFailure(err(409, "PAYOUT_ACCOUNT_REQUIRED", "Chưa có tài khoản nhận tiền đã đăng ký."));
    assert.equal(f.kind, "payout");
    assert.equal(f.text, PAYOUT_REQUIRED_TEXT);
    assert.equal(f.ambiguous, false);
  });
  it("400 amount refusals: the server's Vietnamese sentence (with its figures) wins, a fallback exists, English never shows", () => {
    assert.equal(withdrawFailure(err(400, "WITHDRAWAL_BELOW_MINIMUM", "Số tiền rút tối thiểu là 10.000đ")).text, "Số tiền rút tối thiểu là 10.000đ");
    assert.equal(withdrawFailure(err(400, "EXCEEDS_WITHDRAWABLE_BALANCE", "Số tiền vượt quá số dư khả dụng (đã trừ các yêu cầu đang chờ)")).kind, "amount");
    assert.match(withdrawFailure(err(400, "WITHDRAWAL_BELOW_MINIMUM", "Amount too small")).text, /thấp hơn mức rút tối thiểu/);
    assert.match(withdrawFailure(err(400, "INVALID_AMOUNT", "Số tiền rút không hợp lệ")).text, /số đồng nguyên/);
    assert.equal(withdrawFailure(err(400, "VALIDATION_ERROR")).kind, "amount");
    for (const code of ["WITHDRAWAL_BELOW_MINIMUM", "EXCEEDS_WITHDRAWABLE_BALANCE", "INVALID_AMOUNT"]) assert.doesNotMatch(withdrawFailure(err(400, code, "English only")).text, /English|^[A-Z_]+$/);
  });
  it("403 / suspended / wallet / synthetic", () => {
    assert.equal(withdrawFailure(err(403, "PERMISSION_DENIED", "Forbidden")).kind, "forbidden");
    assert.equal(withdrawFailure(err(403, "OWNER_ROLE_REQUIRED")).text, "Chỉ chủ phòng tập được tạo lệnh rút tiền.");
    assert.equal(withdrawFailure(err(403, "PARTNER_SUSPENDED", "Đối tác đang bị tạm khoá")).kind, "suspended");
    assert.equal(withdrawFailure(err(409, "WALLET_NOT_ACTIVE", "Ví hiện không hoạt động")).kind, "wallet");
    assert.match(withdrawFailure(err(409, "SYNTHETIC_RECORD_NOT_TRANSACTABLE", "Dữ liệu mẫu (SYNTHETIC)")).text, /dữ liệu mẫu/);
  });
  it("5xx / no answer is ambiguous: the request may exist, so no blind retry", () => {
    for (const e of [err(500), err(502, "X"), err(undefined)]) {
      const f = withdrawFailure(e);
      assert.equal(f.ambiguous, true);
      assert.equal(f.kind, "ambiguous");
      assert.match(f.text, /Lệnh rút/);
    }
    assert.equal(withdrawFailure(err(400, "SOMETHING_ELSE")).ambiguous, false);
  });
});

describe("Tài chính: sales", () => {
  it("normalize + the meaning note says a gross selling price, not the gym's income", () => {
    const rows = normalizeSales([{ id: "s1", gymId: "g1", planId: "p1", status: "ACTIVE", priceAtPurchase: "300000.00", createdAt: "2026-11-01T00:00:00Z" }, { nope: 1 }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].priceAtPurchase, 300000);
    assert.match(SALES_MEANING_NOTE, /không phải thu nhập của phòng tập/);
    assert.match(SALES_MEANING_NOTE, /chưa trừ phần của nền tảng/);
  });
  it("the total is hidden when a branch failed (CODE AUDIT)", () => {
    const t = src("finance/SalesTab.tsx");
    assert.match(t, /!loading && failedNames\.length === 0 && \(\s*<div className="go-cm-totals go-sales-totals"/);
    assert.match(t, /recognizedSales\(rows\)/);
  });
});

describe("Tài chính: the withdrawal goes to the registered account only (CODE AUDIT)", () => {
  const dlg = src("finance/WithdrawDialog.tsx");
  it("sends only the amount: no payout field, no free-text account input", () => {
    assert.match(dlg, /gymService\.requestGymWithdrawal\(gym\.id, amount\)/);
    assert.doesNotMatch(dlg, /payoutInfo/);
    assert.doesNotMatch(dlg, /placeholder="[^"]*(Ngân hàng|tài khoản)/i);
    assert.match(dlg, /registeredPayoutText\(payout\)/);
    assert.match(dlg, /PAYOUT_ACCOUNT_REQUIRED|payoutMissing/);
  });
  it("two steps; the confirmation names the branch, the amount and the account; the button locks during and after an ambiguous failure", () => {
    assert.match(dlg, /go-withdraw-confirm-amount/);
    assert.match(dlg, /go-withdraw-confirm-payout/);
    assert.match(dlg, /<dt>Chi nhánh<\/dt>/);
    assert.match(dlg, /lock\.current/);
    assert.match(dlg, /setBlocked\(true\)/);
    assert.match(dlg, /disabled=\{confirmDisabled \|\| sending \|\| phase === "done" \|\| ambiguous\}/);
  });
  it("the success check and the success toast only run after the awaited 2xx; a refusal shakes", () => {
    const i = dlg.indexOf("await withdraw.mutateAsync");
    assert.ok(i > 0);
    assert.ok(dlg.indexOf('setPhase("done")') > i);
    assert.ok(dlg.indexOf('toast.success("Đã gửi yêu cầu rút tiền")') > i);
    assert.match(dlg, /shake\.shake\(\)/);
  });
  it("only the owner (finance.withdraw) gets the button; on 'all branches' a branch must be chosen first", () => {
    const t = src("finance/WalletsTab.tsx");
    assert.match(t, /const canWithdraw = scope\.can\("finance\.withdraw"\)/);
    assert.match(t, /\{canWithdraw && \(\s*<button[\s\S]{0,160}go-withdraw-open/);
    assert.match(t, /\{canWithdraw && <WithdrawDialog/);
    assert.doesNotMatch(t, /go-withdraw-pick/, "the all-branches table has no withdraw button: a row opens the branch first");
    assert.match(src("finance/FinancePage.tsx"), /\?gymId=\$\{encodeURIComponent\(id\)\}&tab=wallets/);
  });
  it("the branch wallet block is a summary + link now: no withdrawal request left in it", () => {
    const t = src("branches/WalletBlock.tsx");
    assert.doesNotMatch(t, /requestGymWithdrawal|useRequestWithdrawal|gym-withdraw-amount-input|gym-withdraw-submit-button/);
    assert.match(t, /\/gym-owner\/finance\?gymId=/);
    assert.doesNotMatch(src("branches/useBranchMutations.ts"), /useRequestWithdrawal/);
  });
  it("routes: flag on renders FinancePage, flag off the old page", () => {
    const r = app("routes.tsx");
    assert.match(r, /feature="finance">\{isGymOwnerV2Enabled\(\) \? <FinancePage \/> : <GymFinancePage \/>\}/);
  });
});
