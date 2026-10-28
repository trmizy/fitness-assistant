// MOCK BROWSER TEST harness — B3. All /api/** is mocked with page.route; no real backend is touched.
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("D:/fitnessassistant-playwright-e2e/package.json");
export const { chromium } = require("@playwright/test");

export const BASE = process.env.B3_BASE || "http://127.0.0.1:5403";
export const OUT = "D:/admin-fr/docs/admin-redesign/review/b3";
export const SCR = "C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b3";
export const AXE_FILE = "C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b2/axe.min.js";
fs.mkdirSync(OUT, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const jwt = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 36000 })}.sig`;
export const ADMIN = { id: "11111111-1111-4111-8111-111111111111", email: "admin.mock@example.com", firstName: "Huong", lastName: "Pham", role: "ADMIN", isActive: true };

// ── DTO fixtures, shaped from audit 02 (P3/P4/P7/A1/P13/U2) ──────────────────────────────────────────
export const BREAKDOWN = {
  clientBalances: "184250000.00",
  ptPending: "96400000.00",
  ptAvailable: "41300000.00",
  ptLocked: "12500000.00",
  ptHoldback: "0.00",
  gymPending: "128700000.00",
  gymAvailable: "57900000.00",
  gymLocked: "8000000.00",
  platformRevenuePending: "34600000.00",
  platformRevenueAvailable: "27150000.00",
};
export const P3_BALANCED = { success: true, data: { escrow: "590800000.00", claims: "590800000.00", drift: "0.00", balanced: true, breakdown: BREAKDOWN, negativeWallets: [] } };
export const P3_DRIFT = {
  success: false,
  data: {
    escrow: "590800000.00",
    claims: "592050000.00",
    drift: "-1250000.00",
    balanced: false,
    breakdown: { ...BREAKDOWN, ptAvailable: "42550000.00" },
    negativeWallets: [{ id: "w-neg-1", ownerType: "PT", ownerId: "bbbbbbbb-1111-4111-8111-000000000001", available: "-1250000", pending: "0", locked: "0", holdback: "0" }],
  },
};

const day = (n) => new Date(Date.UTC(2026, 9, 27) - n * 86400000).toISOString();
// deterministic daily series (income > expense), a few zero days
export function p4(groupBy = "day", { empty = false } = {}) {
  if (empty) return { success: true, data: { groupBy, from: day(30), to: day(0), buckets: [], totals: { income: "0.00", expense: "0.00", netRevenue: "0.00", transactionCount: 0 }, platformRevenue: { available: "27150000.00", pending: "34600000.00", asOf: "2026-10-26T07:32:00.000Z" } } };
  const n = groupBy === "day" ? 30 : groupBy === "week" ? 12 : groupBy === "month" ? 12 : 8;
  const buckets = [];
  let ti = 0n, te = 0n, tn = 0n;
  for (let i = n - 1; i >= 0; i--) {
    const inc = i % 7 === 3 ? 0n : BigInt(8_000_000 + ((i * 7919) % 27) * 1_000_000);
    const exp = i % 7 === 3 ? 0n : BigInt(1_000_000 + ((i * 104729) % 9) * 1_000_000);
    const net = inc / 10n;
    ti += inc; te += exp; tn += net;
    const period = groupBy === "day" ? day(i) : groupBy === "week" ? day(i * 7) : groupBy === "month" ? new Date(Date.UTC(2026, 9 - i, 1)).toISOString() : new Date(Date.UTC(2026, 9 - i * 3, 1)).toISOString();
    buckets.push({ period, income: `${inc}.00`, expense: `${exp}.00`, netRevenue: `${net}.00`, transactionCount: 3 });
  }
  return { success: true, data: { groupBy, from: day(30), to: day(0), buckets, totals: { income: `${ti}.00`, expense: `${te}.00`, netRevenue: `${tn}.00`, transactionCount: 99 }, platformRevenue: { available: "27150000.00", pending: "34600000.00", asOf: "2026-10-26T07:32:00.000Z" } } };
}
export const WITHDRAWALS = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", walletId: "w1", ownerType: "PT", ownerId: "b1", amount: "1500000.00", status: "PENDING", payoutInfo: "VCB", createdAt: "2026-10-25T03:00:00Z", reviewedAt: null },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", walletId: "w3", ownerType: "PT", ownerId: "b3", amount: "700000", status: "PENDING", payoutInfo: "ACB", createdAt: "2026-10-23T03:00:00Z", reviewedAt: null },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", walletId: "w2", ownerType: "GYM", ownerId: "b2", amount: "12000000.00", status: "APPROVED", payoutInfo: "MB", createdAt: "2026-10-20T03:00:00Z", reviewedAt: "2026-10-22T03:00:00Z" },
];
export const REFUNDS = [
  { id: "cccccccc-0000-4000-8000-000000000001", status: "REFUND_REQUESTED", titleSnapshot: "Giáo án 8 tuần", priceAtPurchase: 2000000 },
  { id: "cccccccc-0000-4000-8000-000000000002", status: "REFUND_REQUESTED", titleSnapshot: "Giáo án 4 tuần", priceAtPurchase: 1000000 },
];
const OBLIG = { generatedAt: "2026-10-27T00:00:00Z", summary: { negativeWallets: 3 } };
const SESS = { generatedAt: "2026-10-27T00:00:00Z", needsAttention: { items: [{ id: "s1" }, { id: "s2" }] }, endingsUnconfirmed: { items: [] }, endedWithoutSettledEnding: { items: [] }, disputes: { items: [{ id: "d1" }] } };

const j = (status, body) => ({ status, body });
const E = (status, code = "INTERNAL_ERROR") => j(status, { success: false, error: { code, message: "boom" } });

/** state: { p3, p4, queues } — p3: balanced|drift|500|403|hang|oops; p4: ok|empty|500|403|hang|400; queues: ok|500 */
export function mockFor(p, method, query, state) {
  if (p === "/auth/verify") return j(200, { user: ADMIN });
  if (p === "/admin/payments/reconciliation") {
    if (state.p3 === "balanced") return j(200, P3_BALANCED);
    if (state.p3 === "drift") return j(409, P3_DRIFT);
    if (state.p3 === "403") return E(403, "FORBIDDEN");
    if (state.p3 === "oops") return j(200, { success: true, data: { escrow: "x" } });
    return E(500);
  }
  if (p === "/admin/payments/finance-overview") {
    if (state.p4 === "ok") return j(200, p4(query.get("groupBy") || "day"));
    if (state.p4 === "empty") return j(200, p4("day", { empty: true }));
    if (state.p4 === "403") return E(403, "FORBIDDEN");
    if (state.p4 === "400") return E(400, "INVALID_RANGE");
    return E(500);
  }
  const q500 = state.queues === "500";
  if (p === "/admin/payments/withdrawals") return q500 ? E(500) : j(200, { success: true, data: state.wd || WITHDRAWALS });
  if (p === "/marketplace/orders/refund-requests") return q500 ? E(500) : j(200, { success: true, data: REFUNDS });
  if (p === "/admin/payments/obligations") return q500 ? E(500) : j(200, { success: true, data: OBLIG });
  if (p === "/admin/sessions/reconciliation") return q500 ? E(500) : j(200, SESS);
  if (p === "/admin/sessions/disputed") return j(200, []);
  if (p === "/pt-applications/admin") return j(200, []);
  if (p === "/admin/partners/applications") return j(200, { success: true, data: { items: [], counts: {} } });
  if (p === "/admin/gyms") return j(200, { success: true, data: [] });
  if (p === "/notifications") return j(200, { notifications: [] });
  if (/\/notifications\/unread/.test(p)) return j(200, { count: 0 });
  if (p === "/owner/onboarding/status") return j(200, { success: true, data: { completed: true, role: "OWNER" } });
  return j(200, { success: true, data: [] });
}

/** `hang` = P3/P4 never answer until `release()` — to capture the loading state. */
export async function newPage(browser, { width, height, state, theme, clock } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "no-preference", colorScheme: "light" });
  await ctx.addInitScript(({ jwt, USER, theme }) => {
    localStorage.setItem("CapacitorStorage.accessToken", jwt);
    localStorage.setItem("CapacitorStorage.refreshToken", "refresh-mock");
    localStorage.setItem("CapacitorStorage.user", JSON.stringify(USER));
    if (theme) localStorage.setItem("fitness-assistant.theme", theme);
  }, { jwt, USER: ADMIN, theme });
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  const calls = [];
  const errors = [];
  const held = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api/, "");
    calls.push(`${req.method()} ${p}${url.search}`);
    const hang = (p === "/admin/payments/reconciliation" && state.p3 === "hang") || (p === "/admin/payments/finance-overview" && state.p4 === "hang");
    if (hang) { held.push({ route, p, q: url.searchParams }); return; }
    const r = mockFor(p, req.method(), url.searchParams, state);
    return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  return { ctx, page, calls, errors, state, release: async () => { for (const h of held.splice(0)) { const r = mockFor(h.p, "GET", h.q, state); await h.route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) }); } } };
}

export const results = [];
export const check = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(cond ? "PASS" : "FAIL", name, extra);
};
export function save(file) {
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
}
