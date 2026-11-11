/**
 * B2 — admin navigation config: every route has a group + breadcrumb, paths are unique, the
 * 15 pre-redesign pages are all still reachable from the sidebar, badge helpers never turn an
 * error/unknown into "0".
 *
 * Chạy: npx tsx --test src/app/components/layout/admin/__tests__/adminNav.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADMIN_FINANCE_TABS,
  ADMIN_NAV,
  ADMIN_NAV_ITEMS,
  badgeFromApplicationCounts,
  badgeFromAttention,
  badgeFromLength,
  badgeFromNumber,
  badgeFromPendingGyms,
  findActiveNavItem,
  formatBadge,
  getAdminBreadcrumb,
  getAdminPageTitle,
} from "../adminNav";

const here = dirname(fileURLToPath(import.meta.url));

/** The 15 admin pages of the pre-redesign sidebar (audit 01 §1.2). */
const LEGACY_SIDEBAR_PATHS = [
  "/admin/dashboard",
  "/admin/users",
  "/admin/pts",
  "/admin/marketplace",
  "/admin/exercise-review",
  "/admin/catalog-quality",
  "/admin/finance",
  "/admin/system",
  "/admin/disputes",
  "/admin/gym-management",
  "/admin/gyms",
  "/admin/partners",
  "/admin/listings",
  "/admin/complaints",
  "/admin/ai-observability",
];

describe("ADMIN_NAV structure", () => {
  it("has exactly 5 groups, the first unlabeled", () => {
    assert.equal(ADMIN_NAV.length, 5);
    assert.equal(ADMIN_NAV[0].title, null);
    assert.deepEqual(
      ADMIN_NAV.slice(1).map((g) => g.title),
      ["Tài chính", "Đối tác & người dùng", "Xử lý vụ việc", "Hệ thống"],
    );
  });

  it("every group has at least one item and every item has label, path, icon", () => {
    for (const g of ADMIN_NAV) {
      assert.ok(g.items.length > 0, `group ${g.id} empty`);
      for (const it of g.items) {
        assert.ok(it.label.trim(), `item ${it.id} has no label`);
        assert.match(it.to, /^\/admin\//, `item ${it.id} path`);
        assert.ok(it.iconKey, `item ${it.id} has no icon`);
      }
    }
  });

  it("item ids and paths are unique", () => {
    const ids = ADMIN_NAV_ITEMS.map((i) => i.id);
    const paths = ADMIN_NAV_ITEMS.map((i) => i.to);
    assert.equal(new Set(ids).size, ids.length, "duplicate id");
    assert.equal(new Set(paths).size, paths.length, "duplicate path");
  });

  it("every one of the 15 legacy sidebar pages is still reachable from the sidebar", () => {
    const paths = new Set(ADMIN_NAV_ITEMS.map((i) => i.to));
    for (const p of LEGACY_SIDEBAR_PATHS) assert.ok(paths.has(p), `missing sidebar entry for ${p}`);
  });

  it("has the read-only Transactions entry (B7: backend G-04/G-05) in the Tài chính group, between Đối soát and Rút tiền", () => {
    const fin = ADMIN_NAV.find((g) => g.id === "finance")!;
    assert.deepEqual(fin.items.map((i) => i.to.split("/").pop()), ["finance", "reconciliation", "transactions", "withdrawals", "refunds"]);
    assert.equal(fin.items.find((i) => i.id === "finance-transactions")?.label, "Giao dịch");
    assert.ok(ADMIN_FINANCE_TABS.some((t) => t.key === "transactions" && t.to === "/admin/finance/transactions"));
  });

  it("the disputes item is a plain link (no badge — owned by another workstream)", () => {
    const d = ADMIN_NAV_ITEMS.find((i) => i.to === "/admin/disputes");
    assert.ok(d);
    assert.equal(d.badge, undefined);
  });
});

describe("routes.tsx admin block ↔ nav", () => {
  const src = readFileSync(resolve(here, "../../../../routes.tsx"), "utf8");
  const start = src.indexOf('path: "admin"');
  assert.ok(start > 0, "admin block not found in routes.tsx");
  const block = src.slice(start);

  it("every nav path is declared as a route inside the admin block", () => {
    for (const it of ADMIN_NAV_ITEMS) {
      const rel = it.to.replace(/^\/admin\//, "");
      const first = rel.split("/")[0];
      assert.ok(block.includes(`path: "${first}"`), `route "${first}" missing for nav item ${it.id}`);
      if (rel.includes("/")) {
        const leaf = rel.split("/").slice(1).join("/");
        assert.ok(block.includes(`path: "${leaf}"`), `child route "${leaf}" missing for nav item ${it.id}`);
      }
    }
  });

  it("every concrete route in the admin block resolves to a nav item or a documented redirect", () => {
    const declared = [...block.matchAll(/path: "([a-z0-9-]+)"/g)].map((m) => m[1]);
    const navTop = new Set(ADMIN_NAV_ITEMS.map((i) => i.to.replace(/^\/admin\//, "").split("/")[0]));
    const financeChildren = new Set(ADMIN_FINANCE_TABS.map((t) => t.to.split("/").pop()));
    const redirects = new Set(["pt-service-refunds", "withdrawals"]);
    for (const p of declared) {
      if (p === "admin") continue;
      assert.ok(
        navTop.has(p) || financeChildren.has(p) || redirects.has(p),
        `route "${p}" is neither in the nav nor a documented redirect`,
      );
    }
  });
});

describe("findActiveNavItem / breadcrumb", () => {
  it("every nav item resolves to itself and has a 2–3 part breadcrumb", () => {
    for (const g of ADMIN_NAV) {
      for (const it of g.items) {
        const found = findActiveNavItem(it.to);
        assert.equal(found?.item.id, it.id, `active item for ${it.to}`);
        const crumbs = getAdminBreadcrumb(it.to);
        assert.equal(crumbs[0].label, "Quản trị");
        assert.equal(crumbs.length, g.title ? 3 : 2);
        assert.equal(crumbs[crumbs.length - 1].to, undefined, "last crumb is not a link");
        assert.ok(getAdminPageTitle(it.to).length > 0);
      }
    }
  });

  it("picks the most specific item for nested finance paths", () => {
    assert.equal(findActiveNavItem("/admin/finance")?.item.id, "finance-overview");
    assert.equal(findActiveNavItem("/admin/finance/withdrawals")?.item.id, "finance-withdrawals");
    assert.equal(findActiveNavItem("/admin/finance/refunds/")?.item.id, "finance-refunds");
    assert.deepEqual(
      getAdminBreadcrumb("/admin/finance/reconciliation").map((c) => c.label),
      ["Quản trị", "Tài chính", "Đối soát"],
    );
  });

  it("unknown paths fall back to the root crumb only", () => {
    assert.equal(findActiveNavItem("/admin/nope"), null);
    assert.deepEqual(getAdminBreadcrumb("/admin/nope"), [{ label: "Quản trị" }]);
    assert.equal(getAdminPageTitle("/client/dashboard"), "Quản trị");
  });

  it("does not highlight a sibling that merely shares a prefix", () => {
    assert.equal(findActiveNavItem("/admin/gym-management")?.item.id, "gym-management");
    assert.equal(findActiveNavItem("/admin/gyms")?.item.id, "gyms");
  });
});

describe("finance tabs", () => {
  it("five tabs whose keys are the legacy ?tab= values and paths are unique", () => {
    assert.deepEqual(ADMIN_FINANCE_TABS.map((t) => t.key), ["overview", "reconciliation", "transactions", "withdrawals", "refunds"]);
    assert.equal(new Set(ADMIN_FINANCE_TABS.map((t) => t.to)).size, 5);
    assert.equal(ADMIN_FINANCE_TABS.filter((t) => t.end).length, 1);
  });

  it("each finance tab path is also a sidebar item", () => {
    const sidebar = new Set(ADMIN_NAV_ITEMS.map((i) => i.to));
    for (const t of ADMIN_FINANCE_TABS) assert.ok(sidebar.has(t.to), t.to);
  });
});

describe("badge helpers — error/unknown never becomes a badge", () => {
  it("lists: null/undefined/object/error shapes → no badge; empty → no badge; n → n", () => {
    assert.equal(badgeFromLength(undefined), null);
    assert.equal(badgeFromLength(null), null);
    assert.equal(badgeFromLength({ items: [1] }), null);
    assert.equal(badgeFromLength([]), null);
    assert.equal(badgeFromLength([1, 2, 3]), 3);
  });

  it("numbers: NaN/negative/zero/string → no badge", () => {
    for (const v of [NaN, -1, 0, "3", undefined, null, Infinity]) assert.equal(badgeFromNumber(v), null, String(v));
    assert.equal(badgeFromNumber(7), 7);
  });

  it("pending gyms counts only PENDING_REVIEW", () => {
    assert.equal(badgeFromPendingGyms(undefined), null);
    assert.equal(badgeFromPendingGyms([{ status: "APPROVED" }]), null);
    assert.equal(badgeFromPendingGyms([{ status: "PENDING_REVIEW" }, { status: "APPROVED" }, null, { status: "PENDING_REVIEW" }]), 2);
  });

  it("partner applications reads counts.IN_REVIEW only", () => {
    assert.equal(badgeFromApplicationCounts(undefined), null);
    assert.equal(badgeFromApplicationCounts({}), null);
    assert.equal(badgeFromApplicationCounts({ counts: { IN_REVIEW: 0 } }), null);
    assert.equal(badgeFromApplicationCounts({ counts: { IN_REVIEW: 4, APPROVED: 9 } }), 4);
  });

  it("reconciliation needs both reports loaded", () => {
    assert.equal(badgeFromAttention(5, false), null);
    assert.equal(badgeFromAttention(undefined, true), null);
    assert.equal(badgeFromAttention(0, true), null);
    assert.equal(badgeFromAttention(5, true), 5);
  });

  it("formatBadge caps at 99+", () => {
    assert.equal(formatBadge(1), "1");
    assert.equal(formatBadge(99), "99");
    assert.equal(formatBadge(100), "99+");
  });
});
