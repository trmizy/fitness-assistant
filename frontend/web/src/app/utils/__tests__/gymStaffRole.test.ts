/**
 * CODE/UNIT — D15 bảng điều hướng theo vai trò (chỉ UX, phản chiếu partner-permissions.ts của gym-service).
 * Chạy: npx tsx --test src/app/utils/__tests__/gymStaffRole.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canUseFeature, canViewBrands, canViewCollaborations, canViewWallet, hasPartnerPermission, homePathFor, normalizePartnerRole, normalizePermissions, type PartnerRole, type StaffFeature } from "../gymStaffRole";

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

describe("hasPartnerPermission — item 5/2 fail-closed helper (server permissions[] is the single source of truth)", () => {
  const MANAGER_PERMS = ["branch.view", "brand.view", "plan.view", "membership.full", "checkin.exception.approve", "branch.status.temporary"];
  const OWNER_PERMS = [...MANAGER_PERMS, "branch.write", "plan.write", "branch.status.permanent", "brand.write", "listing.manage", "collaboration.manage"];

  it("grants exactly what the server listed, for a known role", () => {
    assert.equal(hasPartnerPermission("OWNER", OWNER_PERMS, "branch.write"), true);
    assert.equal(hasPartnerPermission("MANAGER", MANAGER_PERMS, "branch.status.temporary"), true);
    // MANAGER sees pages read-only: no write permission in the list -> every write control is hidden
    for (const w of ["branch.write", "plan.write", "branch.status.permanent", "brand.write", "listing.manage", "collaboration.manage"] as const) {
      assert.equal(hasPartnerPermission("MANAGER", MANAGER_PERMS, w), false, w);
    }
  });

  it("unknown / missing role -> no, even when a permissions list is present (no more `role ?? OWNER`)", () => {
    for (const role of [undefined, null, "", "FACILITY_STAFF", "owner", 7]) assert.equal(hasPartnerPermission(role, OWNER_PERMS, "branch.write"), false, String(role));
  });

  it("unknown / missing / wrong-type permissions -> no (an older backend that does not return permissions yet hides write controls)", () => {
    for (const perms of [undefined, null, "branch.write", {}, 42, [], [1, null, {}]]) assert.equal(hasPartnerPermission("OWNER", perms, "branch.write"), false, JSON.stringify(perms));
  });

  it("normalizePermissions keeps only strings and never throws", () => {
    assert.deepEqual(normalizePermissions(["a", 1, null, "b"]), ["a", "b"]);
    assert.deepEqual(normalizePermissions(undefined), []);
    assert.deepEqual(normalizePermissions("a"), []);
  });
});

describe("item 2/5/6 wiring (CODE AUDIT of the page sources)", () => {
  const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

  it("no page falls back to OWNER while the role is unknown", () => {
    for (const f of ["pages/gym-owner/MyGymsPage.tsx", "pages/gym-owner/GymOwnerProfilePage.tsx"]) {
      assert.doesNotMatch(read(f), /\?\?\s*"OWNER"\)\s*===\s*"OWNER"/, f);
      assert.doesNotMatch(read(f), /role\s*\?\?\s*"OWNER"/, f);
    }
  });

  it("GymManagePage + GymPlansPage gate every write control on a permission (no isManagerAccount role sniffing left)", () => {
    const manage = read("pages/gym-owner/GymManagePage.tsx");
    assert.doesNotMatch(manage, /isManagerAccount/);
    for (const k of ["branch.write", "branch.status.permanent", "branch.status.temporary", "listing.manage", "collaboration.manage"]) assert.match(manage, new RegExp(`can\\("${k.replace(/\./g, "\\.")}"\\)`), k);
    assert.match(read("pages/gym-owner/GymPlansPage.tsx"), /can\("plan\.write"\)/);
  });

  it("the sidebar lists Quầy lễ tân + Tài chính behind the same feature table RequireStaffFeature uses, and the owner/manager roles reach the right ones", () => {
    const side = read("components/layout/Sidebar.tsx");
    assert.match(side, /to: "\/gym-owner\/front-desk", feature: "frontDesk"/);
    assert.match(side, /to: "\/gym-owner\/finance", feature: "finance"/);
    assert.equal(canUseFeature("OWNER", "frontDesk") && canUseFeature("OWNER", "finance"), true);
    assert.equal(canUseFeature("MANAGER", "frontDesk"), true);
    assert.equal(canUseFeature("MANAGER", "finance"), false, "a manager is never shown a page the route would bounce");
  });
});
