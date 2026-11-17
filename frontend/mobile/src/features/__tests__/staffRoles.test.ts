/**
 * N15M-07/08/09/10 — what each partner role gets in the gym workspace.
 * Runs with: npx tsx --test src/features/__tests__/staffRoles.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ptCheckinListMode,
  canReadBrands,
  canUseFrontDesk,
  canUseOperationsDashboard,
  staffHomeRoute,
  staffRoleLabel,
  staffTabsFor,
} from "../gymOwner/staffRoles";
import { partnerAccessError } from "../gymOwner/gymOwner";

const s = (role?: string) => ({ role });

describe("staffRoles", () => {
  it("N15M-09: the badge names the REAL role", () => {
    assert.equal(staffRoleLabel(s("OWNER")), "Chủ phòng gym");
    assert.equal(staffRoleLabel(s("MANAGER")), "Quản lý chi nhánh");
    assert.equal(staffRoleLabel(s("RECEPTIONIST")), "Lễ tân");
    assert.equal(staffRoleLabel(s("ACCOUNTANT")), "Kế toán");
    assert.equal(staffRoleLabel({}), "Chủ phòng gym"); // legacy owner row: no role = owner (same rule as isBrandOwner)
    assert.equal(staffRoleLabel(s("SOMETHING_NEW")), "Nhân sự phòng gym");
  });

  it("tab bar per role", () => {
    assert.deepEqual(staffTabsFor(s("OWNER")), ["dashboard", "gyms", "wallet", "profile"]);
    assert.deepEqual(staffTabsFor(s("MANAGER")), ["dashboard", "gyms", "profile"]);
    assert.deepEqual(staffTabsFor(s("RECEPTIONIST")), ["front-desk", "profile"]);
    assert.deepEqual(staffTabsFor(s("ACCOUNTANT")), ["finance", "profile"]);
    assert.deepEqual(staffTabsFor(undefined), ["dashboard", "gyms", "wallet", "profile"]); // role not known yet
  });

  it("N15M-07: receptionist and accountant never get the memberships dashboard", () => {
    assert.equal(canUseOperationsDashboard(s("RECEPTIONIST")), false);
    assert.equal(canUseOperationsDashboard(s("ACCOUNTANT")), false);
    assert.equal(canUseOperationsDashboard(s("MANAGER")), true);
    assert.equal(canUseOperationsDashboard(s("OWNER")), true);
    assert.equal(staffHomeRoute(s("RECEPTIONIST")), "/gym-owner/front-desk");
    assert.equal(staffHomeRoute(s("ACCOUNTANT")), "/gym-owner/finance");
    assert.equal(staffHomeRoute(s("MANAGER")), "/gym-owner/dashboard");
  });

  it("N15M-08: receptionist is not asked for brands, and uses the today list of trainers", () => {
    assert.equal(canReadBrands(s("RECEPTIONIST")), false);
    assert.equal(canReadBrands(s("ACCOUNTANT")), true);
    assert.equal(canUseFrontDesk(s("RECEPTIONIST")), true);
    assert.equal(canUseFrontDesk(s("ACCOUNTANT")), false);
    assert.equal(ptCheckinListMode(s("RECEPTIONIST")), "today");
    assert.equal(ptCheckinListMode(s("MANAGER")), "all");
  });

  it("N15M-09: the revoked/forbidden text does not tell the person to contact the owner (the screen already does)", () => {
    const mk = (code: string) => partnerAccessError({ response: { status: 403, data: { error: { code } } } });
    for (const code of ["PARTNER_ACCESS_REVOKED", "STAFF_SCOPE"]) {
      const e = mk(code)!;
      assert.equal(/liên hệ chủ phòng gym/i.test(e.body), false, code);
    }
  });
});
