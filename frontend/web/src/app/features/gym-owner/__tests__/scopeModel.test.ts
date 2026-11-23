/**
 * CODE/UNIT - G0 scope model + role navigation (pure functions).
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/*.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_BRANCHES,
  branchCode,
  branchCodes,
  branchStatusText,
  roleLineParts,
  canOfferAllBranches,
  classifyApiError,
  goKey,
  isOwnerRole,
  makeScopeKey,
  permissionState,
  pickableGyms,
  resolveScope,
  suspensionMode,
  type ScopeGym,
} from "../scope/scopeModel";
import { activeNavIdForPath, flatNavFor, navFor, pageTitleForPath, scopeKindForPath } from "../../../components/layout/gym-owner/gymOwnerNav";
import { canUseFeature, type PartnerRole } from "../../../utils/gymStaffRole";
import { isGymOwnerV2Enabled } from "../flag";

const G = (id: string, name: string, status = "APPROVED"): ScopeGym => ({ id, name, status });
const TWO = [G("a", "Gymini Quận 1"), G("b", "Gymini Quận 7")];
const ONE = [G("a", "Gymini Quận 1")];

describe("navFor (05 section 3, filtered by the existing route guard)", () => {
  const ids = (r: PartnerRole | undefined) => flatNavFor(r).map((i) => i.id);

  it("OWNER sees every entry incl. the new Quay le tan and Tai chinh", () => {
    assert.deepEqual(ids("OWNER"), ["today", "front-desk", "members", "branches", "pt", "finance", "cases", "staff", "profile"]);
  });
  it("MANAGER: Hom nay + Quay le tan + goi + chi nhanh + Doi tac PT (PT check-in) + khieu nai + ho so; no owner-only or finance entries", () => {
    assert.deepEqual(ids("MANAGER"), ["today", "front-desk", "members", "branches", "pt", "cases", "profile"]);
  });
  it("RECEPTIONIST: Quay le tan + ho so only", () => {
    assert.deepEqual(ids("RECEPTIONIST"), ["front-desk", "profile"]);
  });
  it("ACCOUNTANT: Hoi vien & goi (sales view, G3) + Doi tac PT (hoa hong, G4) + Tai chinh + ho so", () => {
    assert.deepEqual(ids("ACCOUNTANT"), ["members", "pt", "finance", "profile"]);
  });
  it("unknown role (loading) gets NO menu - never the owner menu", () => {
    assert.deepEqual(navFor(undefined), []);
  });
  it("every nav entry is reachable by the role it is shown to (no dead link)", () => {
    for (const role of ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as PartnerRole[]) {
      for (const item of flatNavFor(role)) assert.ok(canUseFeature(role, item.feature), `${role} ${item.id}`);
    }
  });
  it("groups with no visible entries are dropped", () => {
    assert.deepEqual(navFor("RECEPTIONIST").map((g) => g.id), ["ops", "account"]);
    assert.deepEqual(navFor("ACCOUNTANT").map((g) => g.id), ["ops", "money", "account"]);
  });
});

describe("path helpers", () => {
  it("scope kind per route", () => {
    assert.equal(scopeKindForPath("/gym-owner/dashboard"), "brand-or-branch");
    assert.equal(scopeKindForPath("/gym-owner/front-desk"), "branch");
    assert.equal(scopeKindForPath("/gym-owner/finance"), "brand-or-branch");
    assert.equal(scopeKindForPath("/gym-owner/plans"), "brand");
    assert.equal(scopeKindForPath("/gym-owner/gyms"), "brand");
    assert.equal(scopeKindForPath("/gym-owner/gyms/abc"), "none");
    assert.equal(scopeKindForPath("/gym-owner/gyms/wizard/xyz"), "none");
    assert.equal(scopeKindForPath("/gym-owner/complaint-cases/c1"), "brand-or-branch");
    assert.equal(scopeKindForPath("/gym-owner/profile"), "none");
  });
  it("titles and active entry", () => {
    assert.equal(pageTitleForPath("/gym-owner/dashboard"), "Hôm nay");
    assert.equal(pageTitleForPath("/gym-owner/gyms/abc"), "Chi nhánh");
    assert.equal(activeNavIdForPath("/gym-owner/gyms/abc"), "branches");
    assert.equal(activeNavIdForPath("/gym-owner/complaint-cases/c1"), "cases");
  });
});

describe("resolveScope (05 section 5)", () => {
  it("brand-or-branch, 2 branches, no gymId -> ALL, nothing written", () => {
    assert.deepEqual(resolveScope({ kind: "brand-or-branch", gyms: TWO, requestedGymId: null }), { kind: "ok", gymId: ALL_BRANCHES, writeUrl: null });
  });
  it("brand-or-branch, 1 branch -> that branch (ALL is not offered)", () => {
    assert.deepEqual(resolveScope({ kind: "brand-or-branch", gyms: ONE, requestedGymId: null }), { kind: "ok", gymId: "a", writeUrl: null });
    assert.equal(canOfferAllBranches("brand-or-branch", 1), false);
    assert.equal(canOfferAllBranches("brand-or-branch", 2), true);
    assert.equal(canOfferAllBranches("branch", 5), false);
  });
  it("branch-required, no gymId -> first branch and written to the URL", () => {
    assert.deepEqual(resolveScope({ kind: "branch", gyms: TWO, requestedGymId: null }), { kind: "ok", gymId: "a", writeUrl: "a" });
  });
  it("branch-required prefers the last used branch of the session when still in scope", () => {
    assert.deepEqual(resolveScope({ kind: "branch", gyms: TWO, requestedGymId: null, lastGymId: "b" }), { kind: "ok", gymId: "b", writeUrl: "b" });
    assert.deepEqual(resolveScope({ kind: "branch", gyms: TWO, requestedGymId: null, lastGymId: "zzz" }), { kind: "ok", gymId: "a", writeUrl: "a" });
  });
  it("explicit in-scope gymId wins and is not rewritten", () => {
    assert.deepEqual(resolveScope({ kind: "branch", gyms: TWO, requestedGymId: "b", lastGymId: "a" }), { kind: "ok", gymId: "b", writeUrl: null });
    assert.deepEqual(resolveScope({ kind: "brand-or-branch", gyms: TWO, requestedGymId: "b" }), { kind: "ok", gymId: "b", writeUrl: null });
  });
  it("gymId outside the scope -> out-of-scope, never silently replaced", () => {
    assert.deepEqual(resolveScope({ kind: "branch", gyms: TWO, requestedGymId: "evil", lastGymId: "a" }), { kind: "out-of-scope", requested: "evil" });
    assert.deepEqual(resolveScope({ kind: "brand-or-branch", gyms: ONE, requestedGymId: "b" }), { kind: "out-of-scope", requested: "b" });
    assert.deepEqual(resolveScope({ kind: "brand", gyms: TWO, requestedGymId: "evil" }), { kind: "out-of-scope", requested: "evil" });
  });
  it("brand-wide and unscoped screens resolve to ALL and write nothing", () => {
    assert.deepEqual(resolveScope({ kind: "brand", gyms: TWO, requestedGymId: null }), { kind: "ok", gymId: ALL_BRANCHES, writeUrl: null });
    assert.deepEqual(resolveScope({ kind: "none", gyms: [], requestedGymId: null }), { kind: "ok", gymId: ALL_BRANCHES, writeUrl: null });
  });
  it("no branches on a branch screen -> no-branch", () => {
    assert.deepEqual(resolveScope({ kind: "branch", gyms: [], requestedGymId: null }), { kind: "no-branch" });
  });
  it("DRAFT rows are not branches", () => {
    const withDraft = [...TWO, G("d", "Nhap", "DRAFT")];
    assert.equal(pickableGyms(withDraft).length, 2);
    assert.deepEqual(resolveScope({ kind: "branch", gyms: withDraft, requestedGymId: "d" }), { kind: "out-of-scope", requested: "d" });
  });
});

describe("scopeKey / goKey (05 section 6.1-6.2)", () => {
  const base = { userId: "u1", role: "MANAGER" as PartnerRole, brandId: "br1", gymId: "a" };
  it("scopeKey changes with user, role, brand and branch", () => {
    const k = makeScopeKey(base);
    assert.notEqual(k, makeScopeKey({ ...base, userId: "u2" }));
    assert.notEqual(k, makeScopeKey({ ...base, role: "OWNER" }));
    assert.notEqual(k, makeScopeKey({ ...base, brandId: "br2" }));
    assert.notEqual(k, makeScopeKey({ ...base, gymId: "b" }));
    assert.equal(k, makeScopeKey({ ...base }));
  });
  it("goKey layout", () => {
    assert.deepEqual(goKey(base, "members", { q: "x" }), ["gym-owner", "u1", "MANAGER", "br1", "a", "members", { q: "x" }]);
    assert.deepEqual(goKey({ ...base, brandId: null, role: undefined, gymId: ALL_BRANCHES }, "wallet"), ["gym-owner", "u1", "?", "-", "ALL", "wallet", null]);
  });
});

describe("branchCode (display only - the backend has no code field)", () => {
  it("derives 2-3 uppercase ASCII chars", () => {
    assert.equal(branchCode("Gymini Quận 1"), "Q1");
    assert.equal(branchCode("Gymini Quận 7"), "Q7");
    assert.equal(branchCode("Fit Zone"), "FZ");
    assert.equal(branchCode("Chi nhánh Thủ Đức"), "TD");
    assert.equal(branchCode("Iron"), "IRO");
    assert.equal(branchCode("Việt Power Gym Cầu Giấy"), "CG");
    assert.equal(branchCode("Việt Power Gym Đống Đa"), "DD");
    assert.equal(branchCode("  "), "--");
    assert.equal(branchCode("Gymini Quận 10"), "Q10");
  });
  it("always 2-3 chars, A-Z0-9 or dash", () => {
    for (const n of ["Đại Ma Vương Fitness Club", "A", "X Y Z W", "Phòng Gym 24h", "123"]) {
      const c = branchCode(n);
      assert.match(c, /^[A-Z0-9-]{2,3}$/, `${n} -> ${c}`);
    }
  });
  it("collisions inside one menu get a numeric suffix", () => {
    const codes = branchCodes([{ id: "1", name: "Fit Zone" }, { id: "2", name: "Fitness Zeal" }, { id: "3", name: "Gymini Quận 1" }]);
    assert.equal(new Set(Object.values(codes)).size, 3);
    assert.equal(codes["3"], "Q1");
  });
});

describe("permission states (05 section 7) - no OWNER fallback", () => {
  it("loading role is neither owner nor allowed", () => {
    assert.equal(isOwnerRole(undefined), false);
    assert.equal(isOwnerRole(null), false);
    assert.equal(isOwnerRole("MANAGER"), false);
    assert.equal(isOwnerRole("OWNER"), true);
    assert.equal(permissionState(undefined, true, ["OWNER"]), "loading");
    assert.equal(permissionState(undefined, false, ["OWNER"]), "forbidden");
    assert.equal(permissionState("MANAGER", false, ["OWNER"]), "forbidden");
    assert.equal(permissionState("OWNER", false, ["OWNER"]), "allowed");
  });
  it("suspension: OWNER/ACCOUNTANT locked, MANAGER/RECEPTIONIST banner", () => {
    assert.equal(suspensionMode("OWNER"), "lock");
    assert.equal(suspensionMode("ACCOUNTANT"), "lock");
    assert.equal(suspensionMode("MANAGER"), "banner");
    assert.equal(suspensionMode("RECEPTIONIST"), "banner");
    assert.equal(suspensionMode(undefined), "none");
  });
  it("classifyApiError maps backend codes to UI states", () => {
    const mk = (status: number, code?: string) => ({ response: { status, data: { error: { code } } } });
    assert.equal(classifyApiError(mk(403, "PARTNER_SUSPENDED")), "suspended");
    assert.equal(classifyApiError(mk(403, "GYM_OUT_OF_SCOPE")), "out-of-scope");
    assert.equal(classifyApiError(mk(403, "PERMISSION_DENIED")), "forbidden");
    assert.equal(classifyApiError(mk(403, "OWNER_ROLE_REQUIRED")), "forbidden");
    assert.equal(classifyApiError(mk(401)), "session");
    assert.equal(classifyApiError(mk(404)), "not-found");
    assert.equal(classifyApiError({ code: "ERR_NETWORK" }), "network");
    assert.equal(classifyApiError(null), "other");
  });
});

describe("strip texts", () => {
  it("branch status is words", () => {
    assert.equal(branchStatusText({ status: "APPROVED", operationalStatus: "OPEN" }).text, "Đang mở cửa");
    assert.equal(branchStatusText({ status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED" }).text, "Tạm đóng");
    assert.equal(branchStatusText({ status: "PENDING_REVIEW" }).text, "Chờ duyệt hồ sơ");
    assert.equal(branchStatusText({ status: "SUSPENDED" }).tone, "risk");
  });
  it("role line parts per role; nothing while the role is unknown", () => {
    assert.deepEqual(roleLineParts("MANAGER", 2), ["Bạn là Quản lý", "2 chi nhánh được giao"]);
    assert.deepEqual(roleLineParts("OWNER", 3), ["Bạn là Chủ phòng tập", "3 chi nhánh"]);
    assert.deepEqual(roleLineParts(undefined, 3), []);
  });
});

describe("flag", () => {
  it("is off by default (no env under node)", () => {
    assert.equal(isGymOwnerV2Enabled(), false);
  });
});
