/**
 * N15M-07/08/09/10 — what each partner role gets in the gym workspace.
 * Runs with: npx tsx --test src/features/__tests__/staffRoles.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_STAFF_TABS,
  WALLET_ROUTE,
  canOpenWalletDrilldown,
  walletRouteRedirect,
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
    assert.equal(staffRoleLabel({}), "Nhân sự phòng gym"); // no role = NOT the owner (fail-closed)
    assert.equal(staffRoleLabel(undefined), "Nhân sự phòng gym");
    assert.equal(staffRoleLabel(s("SOMETHING_NEW")), "Nhân sự phòng gym");
  });

  it("tab bar per role", () => {
    // 23/11/2026: "Ví" merged into "Tài chính" -> five tabs for the owner, no "wallet" tab for anyone.
    assert.deepEqual(staffTabsFor(s("OWNER")), ["dashboard", "gyms", "front-desk", "finance", "profile"]);
    assert.deepEqual(staffTabsFor(s("MANAGER")), ["dashboard", "gyms", "front-desk", "profile"]);
    assert.deepEqual(staffTabsFor(s("RECEPTIONIST")), ["front-desk", "profile"]);
    assert.deepEqual(staffTabsFor(s("ACCOUNTANT")), ["finance", "profile"]);
    // role not known yet (loading / error / unknown value): only Hồ sơ — never the owner bar (fail-closed)
    assert.deepEqual(staffTabsFor(undefined), ["profile"]);
    assert.deepEqual(staffTabsFor(s("SOMETHING_NEW")), ["profile"]);
  });

  it("N15M-07: receptionist and accountant never get the memberships dashboard", () => {
    assert.equal(canUseOperationsDashboard(s("RECEPTIONIST")), false);
    assert.equal(canUseOperationsDashboard(s("ACCOUNTANT")), false);
    assert.equal(canUseOperationsDashboard(s("MANAGER")), true);
    assert.equal(canUseOperationsDashboard(s("OWNER")), true);
    assert.equal(canUseOperationsDashboard(undefined), false); // unreadable role is not the owner
    assert.equal(staffHomeRoute(s("RECEPTIONIST")), "/gym-owner/front-desk");
    assert.equal(staffHomeRoute(s("ACCOUNTANT")), "/gym-owner/finance");
    assert.equal(staffHomeRoute(s("MANAGER")), "/gym-owner/dashboard");
  });

  it("N15M-08: receptionist is not asked for brands, and uses the today list of trainers", () => {
    assert.equal(canReadBrands(s("RECEPTIONIST")), false);
    assert.equal(canReadBrands(s("ACCOUNTANT")), true);
    assert.equal(canReadBrands(undefined), false);
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

describe("Ví gộp vào Tài chính (5 tab)", () => {
  const withPerms = (role: string, permissions: unknown) => ({ role, permissions });
  const OWNER_PERMS = ["finance.wallet.view", "finance.withdrawals.view", "finance.withdraw", "finance.export"];
  const ACCOUNTANT_PERMS = ["finance.wallet.view", "finance.withdrawals.view", "finance.export"];

  it("no role has a wallet tab any more, and the owner bar has exactly five tabs", () => {
    assert.equal((ALL_STAFF_TABS as string[]).includes("wallet"), false);
    for (const role of ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT", undefined, "SOMETHING_NEW"]) {
      assert.equal((staffTabsFor(s(role)) as string[]).includes("wallet"), false, String(role));
    }
    assert.equal(staffTabsFor(s("OWNER")).length, 5);
  });

  it("the old route is kept as a drill-down target", () => {
    assert.equal(WALLET_ROUTE, "/gym-owner/wallet");
  });

  it("the Tài chính -> Ví entry needs finance.wallet.view AND finance.withdraw (owner only), fail-closed", () => {
    assert.equal(canOpenWalletDrilldown(withPerms("OWNER", OWNER_PERMS)), true);
    assert.equal(canOpenWalletDrilldown(withPerms("ACCOUNTANT", ACCOUNTANT_PERMS)), false);
    assert.equal(canOpenWalletDrilldown(withPerms("MANAGER", ["checkin.exception.approve"])), false);
    assert.equal(canOpenWalletDrilldown(withPerms("RECEPTIONIST", [])), false);
    // old server without permissions[] / role unknown / still loading -> no entry, even for an owner
    assert.equal(canOpenWalletDrilldown(s("OWNER")), false);
    assert.equal(canOpenWalletDrilldown(withPerms("OWNER", "finance.withdraw")), false);
    assert.equal(canOpenWalletDrilldown(withPerms("SOMETHING_NEW", OWNER_PERMS)), false);
    assert.equal(canOpenWalletDrilldown(undefined), false);
    assert.equal(canOpenWalletDrilldown(null), false);
  });

  it("the old /gym-owner/wallet route: the owner stays, a role that may not read the wallet goes home, no answer yet stays closed", () => {
    assert.equal(walletRouteRedirect(withPerms("OWNER", OWNER_PERMS)), null);
    assert.equal(walletRouteRedirect(withPerms("ACCOUNTANT", ACCOUNTANT_PERMS)), null); // unchanged: the accountant already read wallet numbers
    assert.equal(walletRouteRedirect(withPerms("MANAGER", ["checkin.exception.approve"])), "/gym-owner/dashboard");
    assert.equal(walletRouteRedirect(withPerms("RECEPTIONIST", ["checkin.qr"])), "/gym-owner/front-desk");
    assert.equal(walletRouteRedirect(s("OWNER")), "/gym-owner/dashboard"); // permissions[] missing -> fail-closed, not "owner by default"
    assert.equal(walletRouteRedirect(undefined), null); // status not loaded: the screen shows its own loading / closed state
  });
});
