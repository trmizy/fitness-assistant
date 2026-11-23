/**
 * TEST FIXTURE (pure functions) - G2 "Chi nhánh": list grouping, status tags, tab <-> URL map, tab permissions by role,
 * `/gym-owner/listings` redirect, branch-detail scope path, save sentences, close-dialog validation.
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/*.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BRANCH_TAB_IDS,
  addressLine,
  apiMessage,
  approvalTag,
  attentionItems,
  branchHref,
  branchTabsFor,
  closeDialogProblem,
  draftProgress,
  listingsRedirectTarget,
  operationalTag,
  parseBranchTab,
  resolveBranchTab,
  settingsRequested,
  statusActionsFor,
  tabSearch,
  tableBranches,
  tableRow,
  updateSuccessMessage,
  visibleTabs,
  walletAccessFor,
  wizardHref,
  type BranchLike,
} from "../branches/branchesModel";
import { detailGymIdFromPath, resolveScope, ALL_BRANCHES } from "../scope/scopeModel";
import { scopeKindForPath, flatNavFor } from "../../../components/layout/gym-owner/gymOwnerNav";
import type { PartnerRole } from "../../../utils/gymStaffRole";
import { canOf } from "./permFixture";
import { makeCan } from "../../../utils/gymStaffRole";

const B = (id: string, name: string, extra: Partial<BranchLike> = {}): BranchLike => ({ id, name, status: "APPROVED", operationalStatus: "OPEN", address: "1 Lê Lợi", city: "TP.HCM", ...extra });

describe("status tags (words, never colour only)", () => {
  it("approval tag per status, SUSPENDED reads as a platform measure", () => {
    assert.deepEqual(approvalTag("DRAFT"), { text: "Bản nháp", tone: "neutral" });
    assert.deepEqual(approvalTag("PENDING_REVIEW"), { text: "Chờ duyệt", tone: "info" });
    assert.deepEqual(approvalTag("APPROVED"), { text: "Đã duyệt", tone: "ok" });
    assert.deepEqual(approvalTag("REJECTED"), { text: "Bị từ chối", tone: "risk" });
    assert.equal(approvalTag("SUSPENDED").text, "Gymini tạm khoá");
    assert.equal(approvalTag(undefined).text, "Chưa rõ");
  });
  it("operational tag: only an approved/suspended branch has an operational life", () => {
    assert.equal(operationalTag({ status: "APPROVED", operationalStatus: "OPEN" }).text, "Đang mở cửa");
    assert.equal(operationalTag({ status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED" }).tone, "warn");
    assert.equal(operationalTag({ status: "APPROVED", operationalStatus: "PERMANENTLY_CLOSED" }).text, "Đã đóng cửa vĩnh viễn");
    assert.equal(operationalTag({ status: "PENDING_REVIEW", operationalStatus: "OPEN" }).text, "Chưa hoạt động");
    assert.equal(operationalTag({ status: "DRAFT" }).text, "Chưa hoạt động");
    assert.equal(operationalTag({ status: "SUSPENDED", operationalStatus: "OPEN" }).text, "Đang mở cửa");
  });
});

describe("table rows", () => {
  it("members and rating: real numbers for live branches, 'Chưa có đánh giá' when there is no review (never 0,0)", () => {
    const r = tableRow(B("a", "Quận 1", { activeMemberCount: 12, averageRating: 4.6, reviewCount: 8 }));
    assert.equal(r.members, 12);
    assert.match(r.rating ?? "", /4,6/);
    const none = tableRow(B("b", "Quận 7", { activeMemberCount: 0, averageRating: 0, reviewCount: 0 }));
    assert.equal(none.members, 0);
    assert.equal(none.rating, "Chưa có đánh giá");
    assert.ok(!/0,0|0\.0/.test(none.rating ?? ""));
  });
  it("a branch that was never public has no member/rating figures", () => {
    const r = tableRow(B("c", "Mới", { status: "PENDING_REVIEW", activeMemberCount: 0 }));
    assert.equal(r.members, null);
    assert.equal(r.rating, null);
  });
  it("suspension reason is carried only for SUSPENDED", () => {
    assert.equal(tableRow(B("d", "X", { status: "SUSPENDED", adminSuspensionReason: "Khiếu nại" })).suspensionReason, "Khiếu nại");
    assert.equal(tableRow(B("e", "Y", { adminSuspensionReason: "Khiếu nại" })).suspensionReason, null);
  });
  it("address line: no duplicated city, a fallback when empty", () => {
    assert.equal(addressLine({ address: "1 Lê Lợi, TP.HCM", city: "TP.HCM" }), "1 Lê Lợi, TP.HCM");
    assert.equal(addressLine({ address: "1 Lê Lợi", city: "Hà Nội" }), "1 Lê Lợi, Hà Nội");
    assert.equal(addressLine({ address: "", city: "" }), "Chưa có địa chỉ");
  });
  it("long names are kept whole (no truncation in the model)", () => {
    const name = "Việt Power Gym Chi nhánh Thành phố Thủ Đức Khu công nghệ cao";
    assert.equal(tableRow(B("f", name)).name, name);
  });
});

describe("list grouping", () => {
  const gyms: BranchLike[] = [
    B("ok1", "Ổn 1"),
    B("d1", "", { status: "DRAFT", wizardStep: 4 }),
    B("p1", "Chờ", { status: "PENDING_REVIEW" }),
    B("r1", "Từ chối", { status: "REJECTED" }),
    B("c1", "Cần sửa", { pendingNameNote: "Tên chưa rõ" }),
    B("ok2", "Ổn 2"),
  ];
  it("table = every non-draft branch in server order", () => {
    assert.deepEqual(tableBranches(gyms).map((g) => g.id), ["ok1", "p1", "r1", "c1", "ok2"]);
  });
  it("attention group: change request, rejected, draft, pending, in that order", () => {
    assert.deepEqual(attentionItems(gyms, canOf("OWNER")("branch.write")).map((a) => a.kind), ["changes", "rejected", "draft", "pending"]);
  });
  it("drafts are owner-only (the wizard is owner-only); a manager still sees the other items", () => {
    const kinds = attentionItems(gyms, canOf("MANAGER")("branch.write")).map((a) => a.kind);
    assert.ok(!kinds.includes("draft"));
    assert.deepEqual(kinds, ["changes", "rejected", "pending"]);
    assert.deepEqual(attentionItems(gyms, canOf(undefined)("branch.write")).map((a) => a.kind).includes("draft"), false);
  });
  it("a draft continues in the wizard with its own progress; an unnamed draft is 'Chi nhánh mới'", () => {
    const d = attentionItems(gyms, canOf("OWNER")("branch.write")).find((a) => a.kind === "draft")!;
    assert.equal(d.href, "/gym-owner/gyms/wizard/d1");
    assert.equal(d.name, "Chi nhánh mới");
    assert.equal(d.progress, draftProgress({ wizardStep: 4 }));
    assert.equal(draftProgress({ wizardStep: 4 }), 43);
    assert.equal(draftProgress({ wizardStep: undefined }), 0);
    assert.equal(draftProgress({ wizardStep: 99 }), 100);
  });
  it("healthy branches produce no attention rows", () => {
    assert.equal(attentionItems([B("a", "A"), B("b", "B")], true).length, 0);
  });
  it("hrefs", () => {
    assert.equal(branchHref("x"), "/gym-owner/gyms/x");
    assert.equal(branchHref("x", "overview"), "/gym-owner/gyms/x");
    assert.equal(branchHref("x", "listing"), "/gym-owner/gyms/x?tab=listing");
    assert.equal(wizardHref(), "/gym-owner/gyms/wizard");
    assert.equal(wizardHref("d1"), "/gym-owner/gyms/wizard/d1");
  });
});

describe("tab <-> URL map", () => {
  it("parses only the five known ids", () => {
    for (const id of BRANCH_TAB_IDS) assert.equal(parseBranchTab(id), id);
    assert.equal(parseBranchTab("nope"), null);
    assert.equal(parseBranchTab(null), null);
    assert.equal(parseBranchTab(""), null);
  });
  it("overview is the default and is not written to the URL", () => {
    assert.equal(tabSearch("overview"), "");
    assert.equal(tabSearch("listing"), "?tab=listing");
    assert.equal(tabSearch("status"), "?tab=status");
  });
  it("round trip", () => {
    for (const id of BRANCH_TAB_IDS) {
      const q = new URLSearchParams(tabSearch(id)).get("tab");
      assert.equal(resolveBranchTab(q, canOf("OWNER")), id);
    }
  });
  it("?settings=1 is detected, other values are not", () => {
    assert.equal(settingsRequested("?settings=1"), true);
    assert.equal(settingsRequested("?tab=hours&settings=1"), true);
    assert.equal(settingsRequested("?settings=0"), false);
    assert.equal(settingsRequested(""), false);
  });
});

describe("tabs by role (never an owner fallback)", () => {
  const ids = (r: PartnerRole | undefined) => visibleTabs(canOf(r)).map((t) => t.id);
  it("OWNER: five tabs, all editable", () => {
    assert.deepEqual(ids("OWNER"), ["overview", "hours", "listing", "verification", "status"]);
    assert.ok(branchTabsFor(canOf("OWNER")).every((t) => t.access === "edit"));
  });
  it("MANAGER: Tin đăng hidden, Tổng quan + Giờ read-only with a reason, Xác minh locked, Trạng thái usable", () => {
    assert.deepEqual(ids("MANAGER"), ["overview", "hours", "verification", "status"]);
    const m = Object.fromEntries(branchTabsFor(canOf("MANAGER")).map((t) => [t.id, t]));
    assert.equal(m.overview.access, "read");
    assert.ok(m.overview.reason && m.overview.reason.length > 10);
    assert.equal(m.hours.access, "read");
    assert.equal(m.listing.access, "hidden");
    assert.equal(m.verification.access, "locked");
    assert.ok(m.verification.reason);
    assert.equal(m.status.access, "edit");
  });
  it("no permissions (loading / unknown role / old backend) = no tab at all; R and A only hold branch.view, so they get read-only tabs and no status tab (the route guard keeps them off this page)", () => {
    assert.deepEqual(ids(undefined), []);
    assert.equal(resolveBranchTab("overview", canOf(undefined)), null);
    assert.equal(resolveBranchTab("overview", makeCan("OWNER", undefined)), null, "a known role with NO permissions[] is still nothing: no role-name fallback");
    assert.equal(resolveBranchTab("overview", makeCan("OWNER", [])), null);
    for (const r of ["RECEPTIONIST", "ACCOUNTANT"] as const) {
      assert.deepEqual(ids(r), ["overview", "hours", "verification"], r);
      assert.ok(branchTabsFor(canOf(r)).every((t) => t.access !== "edit"), r);
    }
  });
  it("a requested tab the role may not see falls back to the first visible one", () => {
    assert.equal(resolveBranchTab("listing", canOf("MANAGER")), "overview");
    assert.equal(resolveBranchTab("bogus", canOf("MANAGER")), "overview");
    assert.equal(resolveBranchTab(null, canOf("OWNER")), "overview");
    assert.equal(resolveBranchTab("status", canOf("MANAGER")), "status");
  });
});

describe("actions by role", () => {
  it("temporary close/reopen: OWNER + MANAGER; permanent close: OWNER only with a reason for the manager", () => {
    assert.deepEqual(statusActionsFor(canOf("OWNER")), { canTemporary: true, canPermanent: true, permanentReason: null });
    const m = statusActionsFor(canOf("MANAGER"));
    assert.equal(m.canTemporary, true);
    assert.equal(m.canPermanent, false);
    assert.ok(m.permanentReason);
    assert.equal(statusActionsFor(canOf(undefined)).canTemporary, false);
    assert.equal(statusActionsFor(canOf("RECEPTIONIST")).canTemporary, false);
  });
  it("wallet: owner sees and withdraws; manager sees nothing; unknown role nothing", () => {
    assert.deepEqual(walletAccessFor(canOf("OWNER")), { canSee: true, canWithdraw: true });
    assert.deepEqual(walletAccessFor(canOf("MANAGER")), { canSee: false, canWithdraw: false });
    assert.deepEqual(walletAccessFor(canOf("ACCOUNTANT")), { canSee: true, canWithdraw: false });
    assert.deepEqual(walletAccessFor(canOf(undefined)), { canSee: false, canWithdraw: false });
  });
});

describe("/gym-owner/listings redirect (flag on)", () => {
  it("?gymId= goes to the branch's Tin đăng tab", () => {
    assert.equal(listingsRedirectTarget("?gymId=abc", null), "/gym-owner/gyms/abc?tab=listing");
  });
  it("a single-branch scope without ?gymId= goes there too", () => {
    assert.equal(listingsRedirectTarget("", "only"), "/gym-owner/gyms/only?tab=listing");
  });
  it("the URL wins over the scope; no gymId anywhere lists the branches", () => {
    assert.equal(listingsRedirectTarget("?gymId=u", "s"), "/gym-owner/gyms/u?tab=listing");
    assert.equal(listingsRedirectTarget("", null), null);
    assert.equal(listingsRedirectTarget("?gymId=", null), null);
  });
});

describe("branch detail in the scope model", () => {
  it("the id comes from the PATH; list, wizard and deeper paths have none", () => {
    assert.equal(detailGymIdFromPath("/gym-owner/gyms/abc"), "abc");
    assert.equal(detailGymIdFromPath("/gym-owner/gyms/abc/"), "abc");
    assert.equal(detailGymIdFromPath("/gym-owner/gyms/a%20b"), "a b");
    assert.equal(detailGymIdFromPath("/gym-owner/gyms"), null);
    assert.equal(detailGymIdFromPath("/gym-owner/gyms/wizard"), null);
    assert.equal(detailGymIdFromPath("/gym-owner/gyms/wizard/xyz"), null);
    assert.equal(detailGymIdFromPath("/gym-owner/gyms/abc/photos"), null);
    assert.equal(detailGymIdFromPath("/gym-owner/listings"), null);
  });
  it("as a 'branch' screen the id resolves to that branch, a foreign id is out-of-scope (never silently changed)", () => {
    const gyms = [{ id: "a", name: "A", status: "APPROVED" }, { id: "b", name: "B", status: "APPROVED" }];
    assert.deepEqual(resolveScope({ kind: "branch", gyms, requestedGymId: "b" }), { kind: "ok", gymId: "b", writeUrl: null });
    assert.deepEqual(resolveScope({ kind: "branch", gyms, requestedGymId: "zzz" }), { kind: "out-of-scope", requested: "zzz" });
  });
  it("path scope kinds: the list stays brand-wide; Tin đăng is brand-or-branch so it can offer a branch picker", () => {
    assert.equal(scopeKindForPath("/gym-owner/gyms"), "brand");
    assert.equal(scopeKindForPath("/gym-owner/listings"), "brand-or-branch");
    // no gymId and 2+ branches => ALL (the picker); one branch => that branch (redirect)
    const two = [{ id: "a", name: "A", status: "APPROVED" }, { id: "b", name: "B", status: "APPROVED" }];
    assert.deepEqual(resolveScope({ kind: "brand-or-branch", gyms: two, requestedGymId: null }), { kind: "ok", gymId: ALL_BRANCHES, writeUrl: null });
    assert.deepEqual(resolveScope({ kind: "brand-or-branch", gyms: [two[0]], requestedGymId: null }), { kind: "ok", gymId: "a", writeUrl: null });
  });
  it("Tin đăng stays in the OWNER navigation, absent for the manager (guard unchanged)", () => {
    assert.ok(!flatNavFor("OWNER").some((i) => i.id === "listings"), "G3: the sidebar entry is gone, the editor is a branch tab");
    assert.ok(!flatNavFor("MANAGER").some((i) => i.id === "listings"));
  });
});

describe("messages and dialog rules", () => {
  it("a save says what it was; only name/address mention the approval", () => {
    assert.match(updateSuccessMessage({ name: "A", address: "B" }), /Gymini duyệt/);
    assert.match(updateSuccessMessage({ address: "B" }), /Gymini duyệt/);
    assert.equal(updateSuccessMessage({ phone: "1", email: "e" }), "Đã lưu thay đổi");
    assert.equal(updateSuccessMessage({ locationNote: "x", latitude: 1 }), "Đã lưu thay đổi");
    assert.ok(!/admin/i.test(updateSuccessMessage({ name: "A" })));
  });
  it("server sentence first (409/403 arrive in Vietnamese), else ours; never a raw object", () => {
    assert.equal(apiMessage({ response: { data: { error: { message: "Chi nhánh đã đóng cửa" } } } }, "fb"), "Chi nhánh đã đóng cửa");
    assert.equal(apiMessage({ response: { data: { error: { message: "  " } } } }, "fb"), "fb");
    assert.equal(apiMessage({ response: { data: { error: { message: { x: 1 } } } } }, "fb"), "fb");
    assert.equal(apiMessage(new Error("boom"), "fb"), "fb");
    assert.equal(apiMessage(null, "fb"), "fb");
  });
  it("closing needs a reason (as the legacy panel); reopening needs none", () => {
    assert.ok(closeDialogProblem("TEMPORARILY_CLOSED", "  "));
    assert.ok(closeDialogProblem("PERMANENTLY_CLOSED", ""));
    assert.equal(closeDialogProblem("TEMPORARILY_CLOSED", "Sửa chữa"), null);
    assert.equal(closeDialogProblem("OPEN", ""), null);
  });
});
