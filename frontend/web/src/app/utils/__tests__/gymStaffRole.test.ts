/**
 * CODE/UNIT — D15 bảng điều hướng theo vai trò (chỉ UX, phản chiếu partner-permissions.ts của gym-service).
 * Chạy: npx tsx --test src/app/utils/__tests__/gymStaffRole.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canUseFeature, homePathFor, normalizePartnerRole, type PartnerRole, type StaffFeature } from "../gymStaffRole";

const FEATURES: StaffFeature[] = ["dashboard", "gyms", "gymManage", "gymWizard", "plans", "collaborations", "staff", "frontDesk", "finance", "profile"];

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
    for (const f of ["staff", "collaborations", "gymWizard", "finance"] as StaffFeature[]) assert.equal(canUseFeature("MANAGER", f), false, f);
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
