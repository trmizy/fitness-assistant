/**
 * TEST FIXTURE (pure functions) - G3 "Hội viên & gói" and "Quầy lễ tân": member filter / sort / count, SALES mapping, role access
 * of tabs and actions, check-in slice, plan form rules and payloads, exception tab <-> URL / deep link, decision rules, refusal
 * sentences, leave-guard, nav and scope kind of the new pages.
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/*.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEMBER_FILTERS,
  PLANS_REDIRECT,
  applyMemberView,
  canOpenFrontDesk,
  checkinsOfMember,
  checkinsOfMembership,
  createPlanPayload,
  filterMembers,
  fold,
  formatStamp,
  isCurrentScopeData,
  listSummary,
  memberDisplayName,
  membersHref,
  membersModeFor,
  membersTabsFor,
  normalizeMemberships,
  normalizePlans,
  planFormDirty,
  planNameOf,
  plansAccessFor,
  resolveMembersTab,
  saleWindowLabel,
  sortMembers,
  statusSegments,
  validatePlanForm,
  validityText,
  EMPTY_PLAN_FORM,
} from "../members/membersModel";
import {
  canDecide,
  confirmTitle,
  decisionRefusal,
  exceptionDeepLink,
  expiryText,
  fdSearch,
  filterExceptions,
  frontDeskHref,
  isOpenPending,
  parseFdTab,
  pendingCount,
  reasonCounter,
  reasonProblem,
  shouldAskBeforeLeaving,
} from "../front-desk/frontDeskModel";
import { assistedInputDirty, type ExceptionRow } from "../../../utils/assistedCheckin";
import { canUseFeature } from "../../../utils/gymStaffRole";
import { flatNavFor, navFor, scopeKindForLocation, scopeKindForPath, activeNavIdForPath } from "../../../components/layout/gym-owner/gymOwnerNav";

const NOW = Date.parse("2026-11-22T05:00:00Z");
const full = (id: string, o: Record<string, unknown> = {}) => ({ id, planId: "p1", status: "ACTIVE", clientId: `c-${id}`, clientName: `Hội viên ${id}`, memberCode: "AB12CD34", priceAtPurchase: "500000", durationDaysSnapshot: 30, totalVisits: 12, usedVisits: 3, startDate: "2026-11-01T00:00:00Z", endDate: "2026-12-01T00:00:00Z", createdAt: "2026-11-01T00:00:00Z", ...o });

describe("roles", () => {
  it("members mode: O,M full; A sales; R none", () => {
    assert.equal(membersModeFor("OWNER"), "full");
    assert.equal(membersModeFor("MANAGER"), "full");
    assert.equal(membersModeFor("ACCOUNTANT"), "sales");
    assert.equal(membersModeFor("RECEPTIONIST"), "none");
    assert.equal(membersModeFor(undefined), "none");
  });
  it("plans access: only the owner edits; M, A read; R none; unknown none (fail closed)", () => {
    assert.equal(plansAccessFor("OWNER"), "edit");
    assert.equal(plansAccessFor("MANAGER"), "read");
    assert.equal(plansAccessFor("ACCOUNTANT"), "read");
    assert.equal(plansAccessFor("RECEPTIONIST"), "none");
    assert.equal(plansAccessFor(undefined), "none");
  });
  it("desk link only for owner and manager, never the accountant", () => {
    assert.equal(canOpenFrontDesk("OWNER"), true);
    assert.equal(canOpenFrontDesk("MANAGER"), true);
    assert.equal(canOpenFrontDesk("ACCOUNTANT"), false);
    assert.equal(canOpenFrontDesk(undefined), false);
  });
  it("tabs per role; the accountant's first tab is called Giao dịch", () => {
    assert.deepEqual(membersTabsFor("OWNER").map((t) => [t.id, t.access]), [["members", "read"], ["plans", "edit"]]);
    assert.deepEqual(membersTabsFor("ACCOUNTANT").map((t) => t.label), ["Giao dịch", "Gói"]);
    assert.deepEqual(membersTabsFor("RECEPTIONIST"), []);
  });
  it("route guard: members O,M,A (plan.view O,M,A); not R", () => {
    for (const r of ["OWNER", "MANAGER", "ACCOUNTANT"] as const) assert.equal(canUseFeature(r, "members"), true, r);
    assert.equal(canUseFeature("RECEPTIONIST", "members"), false);
    assert.equal(canUseFeature(undefined, "members"), false);
  });
  it("resolveMembersTab never returns a tab the role lacks", () => {
    assert.equal(resolveMembersTab("plans", "OWNER"), "plans");
    assert.equal(resolveMembersTab("nonsense", "OWNER"), "members");
    assert.equal(resolveMembersTab("plans", "RECEPTIONIST"), null);
  });
  it("URL helpers", () => {
    assert.equal(membersHref("plans", "g1"), "/gym-owner/members?gymId=g1&tab=plans");
    assert.equal(membersHref("members"), "/gym-owner/members?tab=members");
    assert.equal(PLANS_REDIRECT, "/gym-owner/members?tab=plans");
  });
  it("render guard: data for another scope is never drawn", () => {
    assert.equal(isCurrentScopeData("u:OWNER:b:g1", "u:OWNER:b:g1"), true);
    assert.equal(isCurrentScopeData("u:OWNER:b:g1", "u:OWNER:b:g2"), false);
    assert.equal(isCurrentScopeData(undefined, "x"), false);
  });
});

describe("SALES view has no identity", () => {
  const raw = [full("a", { paymentTxnId: "TX-1", payoutReleasedAt: "2026-11-10T00:00:00Z" })];
  it("drops name, client id, member code and visits even if the server sent them", () => {
    const [r] = normalizeMemberships(raw, "sales");
    assert.equal(r.clientName, null);
    assert.equal(r.clientId, null);
    assert.equal(r.memberCode, null);
    assert.equal(r.totalVisits, null);
    assert.equal(r.paymentTxnId, "TX-1");
    assert.equal(r.payoutReleasedAt, "2026-11-10T00:00:00Z");
  });
  it("search in sales mode matches the transaction reference, not a name", () => {
    const rows = normalizeMemberships([full("a", { paymentTxnId: "TX-77" }), full("b", { paymentTxnId: "TX-88" })], "sales");
    assert.deepEqual(filterMembers(rows, { ...DEFAULT_MEMBER_FILTERS, q: "tx-77" }, "sales").map((r) => r.id), ["a"]);
    assert.deepEqual(filterMembers(rows, { ...DEFAULT_MEMBER_FILTERS, q: "Hội viên" }, "sales"), []);
  });
  it("no role without a view gets rows", () => {
    assert.deepEqual(normalizeMemberships(raw, "none"), []);
    assert.deepEqual(normalizeMemberships("nope", "full"), []);
  });
  it("a row without a name never falls back to an internal id", () => {
    const [r] = normalizeMemberships([full("a", { clientName: undefined })], "full");
    assert.equal(memberDisplayName(r), "Hội viên chưa có tên");
    assert.ok(!/c-a|01193e57/.test(memberDisplayName(r)));
  });
});

describe("filter, sort, count", () => {
  const rows = normalizeMemberships(
    [
      full("1", { clientName: "Nguyễn An", status: "ACTIVE", planId: "p1", priceAtPurchase: "300000", endDate: "2026-12-05T00:00:00Z", createdAt: "2026-11-05T00:00:00Z" }),
      full("2", { clientName: "Đặng Bình", status: "EXPIRED", planId: "p2", priceAtPurchase: "900000", endDate: "2026-10-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }),
      full("3", { clientName: "Lê Chi", status: "ACTIVE", planId: "p2", priceAtPurchase: "100000", endDate: null, createdAt: "2026-11-20T00:00:00Z" }),
      full("4", { clientName: "Trần Dũng", status: "PENDING_PAYMENT", planId: "p1", priceAtPurchase: "300000", endDate: "2026-11-30T00:00:00Z", createdAt: "2026-11-21T00:00:00Z" }),
    ],
    "full",
  );
  it("folds diacritics and đ in search", () => {
    assert.equal(fold("Đặng Nguyễn"), "dang nguyen");
    assert.deepEqual(filterMembers(rows, { ...DEFAULT_MEMBER_FILTERS, q: "dang" }, "full").map((r) => r.id), ["2"]);
    assert.deepEqual(filterMembers(rows, { ...DEFAULT_MEMBER_FILTERS, q: "NGUYEN an" }, "full").map((r) => r.id), ["1"]);
  });
  it("status and plan filters combine; unknown status falls under Khác", () => {
    assert.deepEqual(filterMembers(rows, { ...DEFAULT_MEMBER_FILTERS, status: "ACTIVE", planId: "p2" }, "full").map((r) => r.id), ["3"]);
    const odd = normalizeMemberships([full("9", { status: "WEIRD" })], "full");
    assert.deepEqual(filterMembers(odd, { ...DEFAULT_MEMBER_FILTERS, status: "other" }, "full").map((r) => r.id), ["9"]);
  });
  it("segments count the loaded list and skip statuses that do not occur", () => {
    assert.deepEqual(statusSegments(rows).map((s) => [s.id, s.count]), [["all", 4], ["ACTIVE", 2], ["PENDING_PAYMENT", 1], ["EXPIRED", 1]]);
    assert.deepEqual(statusSegments([]).map((s) => [s.id, s.count]), [["all", 0]]);
  });
  it("sorts a copy: price, end date (unknown last in both directions), newest", () => {
    const before = rows.map((r) => r.id);
    assert.deepEqual(sortMembers(rows, "price-desc").map((r) => r.id), ["2", "1", "4", "3"]);
    assert.deepEqual(sortMembers(rows, "price-asc").map((r) => r.id)[0], "3");
    assert.deepEqual(sortMembers(rows, "end-asc").map((r) => r.id), ["2", "4", "1", "3"]);
    assert.deepEqual(sortMembers(rows, "end-desc").map((r) => r.id), ["1", "4", "2", "3"]);
    assert.deepEqual(sortMembers(rows, "newest").map((r) => r.id), ["4", "3", "1", "2"]);
    assert.deepEqual(rows.map((r) => r.id), before, "input untouched");
  });
  it("applyMemberView = filter then sort; summary says the list is whole and unpaged", () => {
    const v = applyMemberView(rows, { ...DEFAULT_MEMBER_FILTERS, status: "ACTIVE", sort: "price-asc" }, "full");
    assert.deepEqual(v.map((r) => r.id), ["3", "1"]);
    const s = listSummary(2, 4, "full");
    assert.match(s, /Hiển thị 2 trên 4 hội viên/);
    assert.match(s, /chưa phân trang/);
    assert.match(listSummary(1, 1, "sales"), /giao dịch/);
  });
  it("validity sentence is a state, not a bare date", () => {
    assert.deepEqual(validityText({ status: "ACTIVE", startDate: "2026-11-01T00:00:00Z", endDate: "2026-11-30T00:00:00Z" }, NOW), { main: "Đến 30/11/2026", sub: "còn 8 ngày" });
    assert.equal(validityText({ status: "ACTIVE", startDate: "2026-10-01T00:00:00Z", endDate: "2026-11-01T00:00:00Z" }, NOW).sub, "đã quá hạn");
    assert.equal(validityText({ status: "PENDING_PAYMENT", startDate: null, endDate: null }, NOW).main, "Chưa kích hoạt");
  });
});

describe("stamp", () => {
  it("Vietnam time dd/MM hh:mm, empty for junk", () => {
    assert.equal(formatStamp("2026-11-22T18:10:00Z"), "23/11 01:10");
    assert.equal(formatStamp("2026-11-22T17:00:00Z"), "23/11 00:00");
    assert.equal(formatStamp("nope"), "");
    assert.equal(formatStamp(null), "");
  });
});

describe("check-ins of a member from the latest 50 of the branch", () => {
  const raw = [
    { id: "k1", createdAt: "2026-11-20T01:00:00Z", clientId: "c-1", membershipId: "m-1", source: "QR" },
    { id: "k2", createdAt: "2026-11-21T01:00:00Z", clientId: "c-1", membershipId: "m-1", source: "ASSISTED" },
    { id: "k3", createdAt: "2026-11-21T02:00:00Z", clientId: "c-2", membershipId: "m-2" },
    { id: "", createdAt: "2026-11-21T02:00:00Z", clientId: "c-1" },
  ];
  it("filters by client, newest first, ignores broken rows", () => {
    assert.deepEqual(checkinsOfMember(raw, { clientId: "c-1" }).map((c) => [c.id, c.source]), [["k2", "ASSISTED"], ["k1", "QR"]]);
  });
  it("no client id (sales view) gives nothing; by membership works for the exception drawer", () => {
    assert.deepEqual(checkinsOfMember(raw, { clientId: null }), []);
    assert.deepEqual(checkinsOfMembership(raw, "m-2").map((c) => c.id), ["k3"]);
    assert.deepEqual(checkinsOfMembership(raw, null), []);
    assert.deepEqual(checkinsOfMember("x", { clientId: "c-1" }), []);
  });
});

describe("plans", () => {
  const plans = normalizePlans([{ id: "p1", name: "Gói tháng", price: "500000", durationDays: 30, visitLimit: null, status: "ACTIVE" }, { id: "p2", name: "Gói 12 buổi", price: 600000, durationDays: 60, visitLimit: 12, status: "INACTIVE", saleEndAt: "2026-11-01T00:00:00Z" }]);
  it("normalises and names; unknown plan is said, never an id", () => {
    assert.equal(plans[0].price, 500000);
    assert.equal(plans[0].visitLimit, null);
    assert.equal(planNameOf("p2", plans), "Gói 12 buổi");
    assert.equal(planNameOf("zzz", plans), "Gói không còn trong danh sách");
  });
  it("sale window label follows the legacy rule", () => {
    assert.equal(saleWindowLabel(plans[0], new Date(NOW)), null);
    assert.equal(saleWindowLabel(plans[1], new Date(NOW))?.text, "Đã hết hạn bán");
    assert.equal(saleWindowLabel({ saleStartAt: "2026-12-01T00:00:00Z", saleEndAt: null }, new Date(NOW))?.tone, "info");
  });
  it("validation mirrors gym-service plan.schemas", () => {
    const ok = { ...EMPTY_PLAN_FORM, name: "Gói tháng", price: "500000" };
    assert.equal(validatePlanForm(ok).ok, true);
    assert.ok(validatePlanForm({ ...ok, name: "A" }).errors.name);
    assert.ok(validatePlanForm({ ...ok, price: "0" }).errors.price);
    assert.ok(validatePlanForm({ ...ok, price: "" }).errors.price);
    assert.ok(validatePlanForm({ ...ok, price: "1000000001" }).errors.price);
    assert.ok(validatePlanForm({ ...ok, durationDays: "0" }).errors.durationDays);
    assert.ok(validatePlanForm({ ...ok, durationDays: "3651" }).errors.durationDays);
    assert.ok(validatePlanForm({ ...ok, durationDays: "7.5" }).errors.durationDays);
    assert.ok(validatePlanForm({ ...ok, visitLimit: "-1" }).errors.visitLimit);
    assert.equal(validatePlanForm({ ...ok, visitLimit: "" }).ok, true);
    assert.ok(validatePlanForm({ ...ok, saleStartAt: "2026-12-02", saleEndAt: "2026-12-01" }).errors.saleEndAt);
  });
  it("create payload keeps the legacy shape; empty limit / dates are omitted", () => {
    assert.deepEqual(createPlanPayload({ ...EMPTY_PLAN_FORM, name: " Gói tháng ", price: "500000" }), { name: "Gói tháng", price: 500000, durationDays: 30, visitLimit: undefined, saleStartAt: undefined, saleEndAt: undefined });
    assert.equal(createPlanPayload({ ...EMPTY_PLAN_FORM, name: "x", price: "1", visitLimit: "12" }).visitLimit, 12);
  });
  it("plans are create-only: the dirty guard watches the create form (edit was removed, the legacy page has none)", () => {
    assert.equal(planFormDirty(EMPTY_PLAN_FORM), false);
    assert.equal(planFormDirty({ ...EMPTY_PLAN_FORM, name: "x" }), true);
    assert.equal(planFormDirty({ ...EMPTY_PLAN_FORM, name: "   " }), false);
    assert.equal(planFormDirty({ ...EMPTY_PLAN_FORM, durationDays: "60" }), true);
  });
});

const ex = (id: string, o: Partial<ExceptionRow> = {}): ExceptionRow => ({ id, membershipId: `m-${id}`, status: "PENDING", displayName: "Trần Bảo Ngọc", memberCode: "AB12-CD34", planName: "Gói tháng", requestReason: "Quên điện thoại", requestedByName: "Mai Anh", createdAt: "2026-11-22T02:00:00Z", expiresAt: "2026-11-22T16:59:59Z", decisionReason: null, decidedByName: null, mine: false, ...o });

describe("front desk URL and deep link", () => {
  it("an exception id with no tab opens the Ngoại lệ tab; a known tab wins; junk falls back", () => {
    assert.equal(parseFdTab(null, "e1"), "exceptions");
    assert.equal(parseFdTab("pt", "e1"), "pt");
    assert.equal(parseFdTab("zzz", null), "checkin");
    assert.equal(parseFdTab(undefined), "checkin");
  });
  it("deep link from Hôm nay", () => {
    assert.equal(exceptionDeepLink("g1", "e1"), "/gym-owner/front-desk?gymId=g1&tab=exceptions&exception=e1");
    assert.equal(fdSearch({ gymId: "g1", tab: "pt", exceptionId: "e1" }), "?gymId=g1&tab=pt");
    assert.equal(frontDeskHref("g1", "checkin", "AB12CD34"), "/gym-owner/front-desk?gymId=g1&tab=checkin&code=AB12CD34");
    assert.equal(frontDeskHref("g1"), "/gym-owner/front-desk?gymId=g1&tab=checkin");
  });
});

describe("exceptions list and decision rules", () => {
  it("a PENDING request past its end-of-day expiry is not waiting", () => {
    assert.equal(isOpenPending(ex("a"), NOW), true);
    assert.equal(isOpenPending(ex("b", { expiresAt: "2026-11-21T16:59:59Z" }), NOW), false);
    assert.equal(isOpenPending(ex("c", { status: "APPROVED" }), NOW), false);
    assert.equal(pendingCount([ex("a"), ex("b", { expiresAt: "2026-11-21T16:59:59Z" }), ex("c", { status: "REJECTED" })], NOW), 1);
  });
  it("pending filter keeps the longest-waiting first; all filter newest first", () => {
    const rows = [ex("new", { createdAt: "2026-11-22T04:00:00Z" }), ex("old", { createdAt: "2026-11-22T01:00:00Z" }), ex("done", { status: "REJECTED", createdAt: "2026-11-22T03:00:00Z" })];
    assert.deepEqual(filterExceptions(rows, "pending", NOW).map((r) => r.id), ["old", "new"]);
    assert.deepEqual(filterExceptions(rows, "all", NOW).map((r) => r.id), ["new", "done", "old"]);
  });
  it("expiry sentence", () => {
    assert.equal(expiryText(ex("a"), NOW), "Cuối ngày hôm nay");
    assert.equal(expiryText(ex("a", { expiresAt: "2026-11-21T16:59:59Z" }), NOW), "Đã hết hạn");
    assert.equal(expiryText(ex("a", { status: "USED" }), NOW), "Đã dùng, hết hiệu lực");
  });
  it("only owner / manager with the server's canApprove may decide; a receptionist never", () => {
    assert.equal(canDecide("OWNER", true), true);
    assert.equal(canDecide("MANAGER", true), true);
    assert.equal(canDecide("MANAGER", false), false);
    assert.equal(canDecide("RECEPTIONIST", true), false);
    assert.equal(canDecide("ACCOUNTANT", true), false);
    assert.equal(canDecide(undefined, true), false);
  });
  it("reason 5-300, counted raw, trimmed for the minimum", () => {
    assert.ok(reasonProblem(""));
    assert.ok(reasonProblem("abcd"));
    assert.ok(reasonProblem("    abc  "));
    assert.equal(reasonProblem("abcde"), null);
    assert.equal(reasonProblem("x".repeat(300)), null);
    assert.ok(reasonProblem("x".repeat(301)));
    assert.equal(reasonCounter("hello"), "5/300");
  });
  it("confirmation names the member and the branch", () => {
    assert.equal(confirmTitle("approve", "Nguyễn An", "Q1"), "Duyệt ngoại lệ check-in cho Nguyễn An tại Q1");
    assert.equal(confirmTitle("reject", "Nguyễn An", "Q1"), "Từ chối ngoại lệ check-in cho Nguyễn An tại Q1");
  });
});

describe("refusal sentences (no code ever shown)", () => {
  const e = (status: number, code?: string) => ({ response: { status, data: { error: { code } } } });
  it("403 self-approval", () => {
    const r = decisionRefusal(e(403, "EXCEPTION_SELF_APPROVAL"));
    assert.match(r.text, /không thể tự duyệt/);
    assert.equal(r.reload, false);
    assert.equal(r.retry, false);
  });
  it("409 already decided reloads the list", () => {
    const r = decisionRefusal(e(409, "EXCEPTION_ALREADY_DECIDED"));
    assert.match(r.text, /vừa được người khác xử lý/);
    assert.equal(r.reload, true);
  });
  it("410 expired", () => {
    const r = decisionRefusal(e(410, "EXCEPTION_EXPIRED"));
    assert.match(r.text, /hết hạn/);
    assert.equal(r.reload, true);
  });
  it("by status when the code is missing, plain fallbacks otherwise", () => {
    assert.equal(decisionRefusal(e(410)).reload, true);
    assert.equal(decisionRefusal(e(409)).reload, true);
    assert.match(decisionRefusal(e(403)).text, /không có quyền/);
    assert.match(decisionRefusal(new Error("network")).text, /Không kết nối/);
    assert.equal(decisionRefusal(e(500)).retry, true);
  });
  it("no sentence contains an uppercase error code", () => {
    for (const c of ["EXCEPTION_SELF_APPROVAL", "EXCEPTION_ALREADY_DECIDED", "EXCEPTION_EXPIRED", "EXCEPTION_NOT_FOUND", "REASON_REQUIRED", "PERMISSION_DENIED", "GYM_OUT_OF_SCOPE", "PARTNER_SUSPENDED"]) {
      assert.ok(!/[A-Z]{3,}_[A-Z]/.test(decisionRefusal(e(400, c)).text), c);
    }
  });
});

describe("leaving with unsent input", () => {
  const at = (pathname: string, search = "") => ({ pathname, search });
  it("asks on a branch switch and on leaving the page, not on a tab move in the same branch", () => {
    assert.equal(shouldAskBeforeLeaving({ dirty: true, from: at("/gym-owner/front-desk", "?gymId=a&tab=checkin"), to: at("/gym-owner/front-desk", "?gymId=b&tab=checkin") }), true);
    assert.equal(shouldAskBeforeLeaving({ dirty: true, from: at("/gym-owner/front-desk", "?gymId=a&tab=checkin"), to: at("/gym-owner/finance") }), true);
    assert.equal(shouldAskBeforeLeaving({ dirty: true, from: at("/gym-owner/front-desk", "?gymId=a&tab=checkin"), to: at("/gym-owner/front-desk", "?gymId=a&tab=exceptions&exception=e1") }), false);
    assert.equal(shouldAskBeforeLeaving({ dirty: false, from: at("/gym-owner/front-desk", "?gymId=a"), to: at("/gym-owner/front-desk", "?gymId=b") }), false);
  });
  it("G4: a typed decision reason also asks when the exception param changes or is dropped (Back to the same branch included)", () => {
    const drawer = at("/gym-owner/front-desk", "?gymId=a&tab=exceptions&exception=e1");
    const list = at("/gym-owner/front-desk", "?gymId=a&tab=exceptions");
    assert.equal(shouldAskBeforeLeaving({ dirty: true, decisionDirty: true, from: drawer, to: list }), true);
    assert.equal(shouldAskBeforeLeaving({ dirty: true, decisionDirty: true, from: drawer, to: at("/gym-owner/front-desk", "?gymId=a&tab=exceptions&exception=e2") }), true);
    assert.equal(shouldAskBeforeLeaving({ dirty: true, decisionDirty: true, from: drawer, to: at("/gym-owner/front-desk", "?gymId=b&tab=exceptions") }), true);
    assert.equal(shouldAskBeforeLeaving({ dirty: true, decisionDirty: true, from: drawer, to: at("/gym-owner/finance") }), true);
    // same drawer, same branch: nothing changes
    assert.equal(shouldAskBeforeLeaving({ dirty: true, decisionDirty: true, from: drawer, to: at("/gym-owner/front-desk", "?gymId=a&exception=e1&tab=exceptions") }), false);
    // an unsent check-in (not a decision) still lets the drawer open and close inside the same branch
    assert.equal(shouldAskBeforeLeaving({ dirty: true, decisionDirty: false, from: list, to: drawer }), false);
    assert.equal(shouldAskBeforeLeaving({ dirty: false, decisionDirty: false, from: drawer, to: list }), false);
  });
  it("the assisted panel is dirty once a member is picked, a reason typed or a code sent", () => {
    assert.equal(assistedInputDirty({ selected: false, excReason: "", challengeSent: false }), false);
    assert.equal(assistedInputDirty({ selected: true, excReason: "", challengeSent: false }), true);
    assert.equal(assistedInputDirty({ selected: false, excReason: "  ", challengeSent: false }), false);
    assert.equal(assistedInputDirty({ selected: false, excReason: "abc", challengeSent: false }), true);
    assert.equal(assistedInputDirty({ selected: false, excReason: "", challengeSent: true }), true);
  });
});

describe("navigation and scope of the new pages", () => {
  const ids = (r: Parameters<typeof flatNavFor>[0]) => flatNavFor(r).map((i) => i.id);
  it("sidebar: Hội viên & gói replaces Gói hội viên; Tin đăng & tiện ích is gone", () => {
    assert.ok(ids("OWNER").includes("members"));
    assert.ok(!ids("OWNER").includes("plans"));
    assert.ok(!ids("OWNER").includes("listings"));
    assert.equal(flatNavFor("OWNER").find((i) => i.id === "members")?.label, "Hội viên & gói");
  });
  it("owner and manager reach the desk from the sidebar; the accountant gets Hội viên & gói but not the desk; R only the desk", () => {
    for (const r of ["OWNER", "MANAGER"] as const) assert.ok(ids(r).includes("front-desk"), r);
    assert.ok(ids("ACCOUNTANT").includes("members"));
    assert.ok(!ids("ACCOUNTANT").includes("front-desk"));
    assert.deepEqual(ids("RECEPTIONIST"), ["front-desk", "profile"]);
    assert.deepEqual(navFor(undefined), []);
  });
  it("scope kind: Hội viên tab is a branch screen, Gói tab brand-wide", () => {
    assert.equal(scopeKindForLocation("/gym-owner/members", null), "branch");
    assert.equal(scopeKindForLocation("/gym-owner/members", "members"), "branch");
    assert.equal(scopeKindForLocation("/gym-owner/members", "plans"), "brand");
    assert.equal(scopeKindForLocation("/gym-owner/front-desk", null), "branch");
    assert.equal(scopeKindForLocation("/gym-owner/finance", "plans"), "brand-or-branch");
    assert.equal(scopeKindForPath("/gym-owner/listings"), "brand-or-branch");
  });
  it("old URLs keep a sensible active entry", () => {
    assert.equal(activeNavIdForPath("/gym-owner/plans"), "members");
    assert.equal(activeNavIdForPath("/gym-owner/listings"), "branches");
    assert.equal(activeNavIdForPath("/gym-owner/members"), "members");
  });
});
