/**
 * B2 — legacy admin URL → new route mapping (Master Plan §2.3). No old URL may 404; every
 * redirect keeps the other query params and the hash.
 *
 * Chạy: npx tsx --test src/app/components/layout/admin/__tests__/adminRedirects.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ADMIN_FINANCE_TABS } from "../adminNav";
import { LEGACY_ADMIN_PATHS, LEGACY_FINANCE_TAB_PATHS, resolveLegacyAdminRedirect as r } from "../adminRedirects";

describe("?tab= on /admin/finance", () => {
  it("maps each old tab key to its route", () => {
    assert.equal(r("/admin/finance", "?tab=overview"), "/admin/finance");
    assert.equal(r("/admin/finance", "?tab=reconciliation"), "/admin/finance/reconciliation");
    assert.equal(r("/admin/finance", "?tab=withdrawals"), "/admin/finance/withdrawals");
    assert.equal(r("/admin/finance", "?tab=refunds"), "/admin/finance/refunds");
  });

  it("keeps the other query params and the hash, drops only tab", () => {
    assert.equal(r("/admin/finance", "?tab=withdrawals&status=APPROVED&x=1", "#row-3"), "/admin/finance/withdrawals?status=APPROVED&x=1#row-3");
    assert.equal(r("/admin/finance", "?foo=1&tab=refunds"), "/admin/finance/refunds?foo=1");
  });

  it("tolerates a trailing slash", () => {
    assert.equal(r("/admin/finance/", "?tab=reconciliation"), "/admin/finance/reconciliation");
  });

  it("does not redirect a plain finance URL, an unknown tab, or an inherited-property tab", () => {
    assert.equal(r("/admin/finance", ""), null);
    assert.equal(r("/admin/finance", "?tab=nope"), null);
    assert.equal(r("/admin/finance", "?tab=constructor"), null);
    assert.equal(r("/admin/finance", "?tab=__proto__"), null);
    assert.equal(r("/admin/finance", "?other=1"), null);
  });

  it("does not touch the new finance sub-routes (no redirect loop)", () => {
    for (const t of ADMIN_FINANCE_TABS) assert.equal(r(t.to, ""), null, t.to);
    assert.equal(r("/admin/finance/withdrawals", "?tab=refunds"), null);
  });
});

describe("legacy standalone pages", () => {
  it("/admin/withdrawals and /admin/pt-service-refunds go to the finance tab routes", () => {
    assert.equal(r("/admin/withdrawals", ""), "/admin/finance/withdrawals");
    assert.equal(r("/admin/pt-service-refunds", ""), "/admin/finance/refunds");
  });

  it("keep query + hash", () => {
    assert.equal(r("/admin/withdrawals", "?status=PENDING", "#a"), "/admin/finance/withdrawals?status=PENDING#a");
    assert.equal(r("/admin/pt-service-refunds/", "?id=9"), "/admin/finance/refunds?id=9");
  });

  it("every redirect target is a real finance tab route (never a 404)", () => {
    const tabPaths = new Set(ADMIN_FINANCE_TABS.map((t) => t.to));
    for (const target of [...Object.values(LEGACY_ADMIN_PATHS), ...Object.values(LEGACY_FINANCE_TAB_PATHS)]) {
      assert.ok(tabPaths.has(target), `${target} is not a finance tab route`);
    }
    // "transactions" (B7) and "wallets" (G-09) are new: there was never an old `?tab=` URL for them, so no legacy entry.
    assert.deepEqual(Object.keys(LEGACY_FINANCE_TAB_PATHS).sort(), ADMIN_FINANCE_TABS.map((t) => t.key).filter((k) => k !== "transactions" && k !== "wallets").sort());
  });

  it("other admin URLs are never redirected", () => {
    for (const p of ["/admin", "/admin/dashboard", "/admin/users", "/admin/pts", "/admin/partners", "/admin/listings", "/admin/disputes"]) {
      assert.equal(r(p, "?tab=refunds"), null, p);
    }
  });
});
