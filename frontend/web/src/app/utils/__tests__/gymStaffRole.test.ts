/**
 * CODE/UNIT — D15 bảng điều hướng theo vai trò (chỉ UX, phản chiếu partner-permissions.ts của gym-service).
 * Chạy: npx tsx --test src/app/utils/__tests__/gymStaffRole.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canUseFeature, canViewBrands, canViewCollaborations, canViewWallet, homePathFor, normalizePartnerRole, type PartnerRole, type StaffFeature } from "../gymStaffRole";

const FEATURES: StaffFeature[] = ["dashboard", "gyms", "gymManage", "gymWizard", "listings", "plans", "collaborations", "staff", "frontDesk", "finance", "complaintCases", "profile"];

describe("gymStaffRole", () => {
  it("receptionist: front desk + profile only", () => {
    const allowed = FEATURES.filter((f) => canUseFeature("RECEPTIONIST", f));
    assert.deepEqual(allowed.sort(), ["frontDesk", "profile"]);
  });

  it("accountant: finance + profile only (read-only role, no management pages)", () => {
    const allowed = FEATURES.filter((f) => canUseFeature("ACCOUNTANT", f));
    assert.deepEqual(allowed.sort(), ["finance", "profile"]);
  });

  it("manager never reaches owner-only pages (staff, collaborations, branch wizard, finance)", () => {
    for (const f of ["staff", "collaborations", "gymWizard", "listings", "finance"] as StaffFeature[]) assert.equal(canUseFeature("MANAGER", f), false, f);
    for (const f of ["dashboard", "gyms", "gymManage", "plans", "frontDesk", "profile"] as StaffFeature[]) assert.equal(canUseFeature("MANAGER", f), true, f);
  });

  it("owner reaches everything; unknown / missing role reaches nothing (fail-closed)", () => {
    for (const f of FEATURES) assert.equal(canUseFeature("OWNER", f), true, f);
    for (const f of FEATURES) assert.equal(canUseFeature(undefined, f), false, f);
    assert.equal(normalizePartnerRole("FACILITY_STAFF"), undefined);
    assert.equal(normalizePartnerRole("ACCOUNTANT"), "ACCOUNTANT");
  });

  it("every role's home page is a page that role may use (no redirect loop)", () => {
    const featureOf: Record<string, StaffFeature> = { "/gym-owner/dashboard": "dashboard", "/gym-owner/front-desk": "frontDesk", "/gym-owner/finance": "finance" };
    for (const r of ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as PartnerRole[]) {
      assert.equal(canUseFeature(r, featureOf[homePathFor(r)]), true, r);
    }
  });
});

describe("gymStaffRole read-permission helpers (ND-01 / ND-02)", () => {
  it("manager never fires wallet or collaborations reads; receptionist never fires brands", () => {
    assert.equal(canViewWallet("MANAGER"), false);
    assert.equal(canViewCollaborations("MANAGER"), false);
    assert.equal(canViewBrands("RECEPTIONIST"), false);
    assert.equal(canViewWallet("OWNER"), true);
    assert.equal(canViewWallet("ACCOUNTANT"), true);
    assert.equal(canViewCollaborations("OWNER"), true);
    assert.equal(canViewBrands("MANAGER"), true);
    assert.equal(canViewBrands("ACCOUNTANT"), true);
  });

  it("unknown role is fail-closed", () => {
    assert.equal(canViewWallet(undefined), false);
    assert.equal(canViewCollaborations(undefined), false);
    assert.equal(canViewBrands(undefined), false);
  });

  it("complaint cases: owner and manager only", () => {
    const allowed = (["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as PartnerRole[]).filter((r) => canUseFeature(r, "complaintCases"));
    assert.deepEqual(allowed, ["OWNER", "MANAGER"]);
  });
});
