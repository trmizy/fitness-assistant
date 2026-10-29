// MOCK BROWSER TEST harness — B5. Every /api/** call is answered by page.route; no real backend is touched.
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("D:/fitnessassistant-playwright-e2e/package.json");
export const { chromium } = require("@playwright/test");

export const BASE = process.env.B6A_BASE || "http://127.0.0.1:5406";
export const OUT = "D:/admin-fr/docs/admin-redesign/review/b6a";
export const SCR = "C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b6a";
export const AXE = fs.readFileSync("C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b2/axe.min.js", "utf8");
fs.mkdirSync(OUT, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 36000 })}.sig`;
export const ADMIN = { id: "11111111-1111-4111-8111-111111111111", email: "admin.mock@example.com", firstName: "Huong", lastName: "Pham", role: "ADMIN", isActive: true };

const ID = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = (n) => `bbbbbbbb-${String(n).padStart(4, "0")}-4111-8111-000000000001`;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const M = 60_000, H = 3_600_000, D = 86_400_000;

export const baseRows = () => [
  { id: ID(1), walletId: "w1", ownerType: "PT", ownerId: OWNER(1), amount: "1500000.00", status: "PENDING", payoutInfo: "Vietcombank 0011001234567 - NGUYEN VAN A", createdAt: ago(2 * D) },
  { id: ID(2), walletId: "w2", ownerType: "GYM", ownerId: OWNER(2), amount: "12000000", status: "APPROVED", payoutInfo: "MB Bank 9704 - CONG TY GYM XYZ", createdAt: ago(D + 2 * H) },
  { id: ID(3), walletId: "w3", ownerType: "PT", ownerId: OWNER(3), amount: "700000", status: "PENDING", payoutInfo: "ACB 55001122 - TRAN B\nChi nhánh Quận 1", createdAt: ago(5 * H + 30 * M) },
  { id: ID(4), walletId: "w4", ownerType: "GYM", ownerId: OWNER(4), amount: "3300000", status: "APPROVED", payoutInfo: "Techcombank 1903xx - PHOENIX FITNESS", createdAt: ago(3 * H + 10 * M) },
  { id: ID(5), walletId: "w5", ownerType: "PT", ownerId: OWNER(5), amount: "250000", status: "PENDING", payoutInfo: "BIDV 7700 - LE C", createdAt: ago(40 * M) },
];
export const manyRows = (n, pending) =>
  Array.from({ length: n }, (_, i) => ({
    id: ID(1000 + i), walletId: `w${i}`, ownerType: i % 3 ? "PT" : "GYM", ownerId: OWNER(1000 + i), amount: String(100000 + i * 1000),
    status: i < pending ? "PENDING" : "APPROVED", payoutInfo: `Bank ${i}`, createdAt: ago((n - i) * H),
  }));

const OID = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BUYER = (n) => `eeeeeeee-${String(n).padStart(4, "0")}-4111-8111-000000000001`;
const SELLER = (n) => `dddddddd-${String(n).padStart(4, "0")}-4111-8111-000000000001`;
export const baseOrders = () => [
  { id: OID(2), serviceId: "s2", sellerId: SELLER(2), buyerId: BUYER(2), status: "REFUND_REQUESTED", titleSnapshot: "Giáo án giảm mỡ 12 tuần", priceAtPurchase: 900000, disputeReason: null, purchasedAt: ago(9 * D), refundRequestedAt: ago(6 * H), draftVersion: 0, revisionCount: 0 },
  { id: OID(1), serviceId: "s1", sellerId: SELLER(1), buyerId: BUYER(1), status: "REFUND_REQUESTED", titleSnapshot: "Giáo án tăng cơ 8 tuần", priceAtPurchase: 2000000, disputeReason: "Chưa nhận được bản nháp", purchasedAt: ago(20 * D), refundRequestedAt: ago(3 * D), draftVersion: 0, revisionCount: 0 },
  { id: OID(3), serviceId: "s3", sellerId: SELLER(3), buyerId: BUYER(3), status: "REFUND_REQUESTED", titleSnapshot: "Tư vấn dinh dưỡng", priceAtPurchase: 350000, disputeReason: "Không hợp nhu cầu", purchasedAt: ago(2 * D), refundRequestedAt: ago(40 * M), draftVersion: 0, revisionCount: 0 },
];
export const CALCS = {
  [OID(1)]: { totalPaid: 2000000, alreadyRefunded: 500000, refundableCeiling: 1500000 },
  [OID(2)]: { totalPaid: 900000, alreadyRefunded: 0, refundableCeiling: 900000 },
  [OID(3)]: { totalPaid: 350000, alreadyRefunded: 0, refundableCeiling: 350000 },
};
export const oid = OID;

/** Stateful mock backend of one page. */
export function makeState(rows = baseRows()) {
  return { orders: baseOrders(), rflist: "ok", calc: "ok", resolve: "ok", rcounts: { list: 0, calc: 0, resolve: 0 }, rbody: null, mcount: 0, mbody: null, mem: "ok", wd: rows, list: "ok", approve: "ok", pay: "ok", reject: "ok", counts: { list: 0, approve: 0, pay: 0, reject: 0 }, payBody: null, rejectBody: null, delay: 0 };
}

export async function newPage(browser, { width, height, state, colorScheme = "light", reducedMotion = false, clock = false, clipboard = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: reducedMotion ? "reduce" : "no-preference", permissions: clipboard ? ["clipboard-read", "clipboard-write"] : [] });
  await ctx.addInitScript(({ jwt, USER, dark }) => {
    if (dark) localStorage.setItem("fitness-assistant.theme", "dark");
    localStorage.setItem("CapacitorStorage.accessToken", jwt);
    localStorage.setItem("CapacitorStorage.refreshToken", "refresh-mock");
    localStorage.setItem("CapacitorStorage.user", JSON.stringify(USER));
  }, { jwt, USER: ADMIN, dark: colorScheme === "dark" });
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  const calls = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const err = (route, status, code, message) => json(route, status, { success: false, error: { code, message } });
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api/, "");
    const m = req.method();
    calls.push(`${m} ${p}`);
    if (p === "/auth/verify") return json(route, 200, { user: ADMIN });
    let rr;
    if (state && m === "GET" && p === "/marketplace/orders/refund-requests") {
      state.rcounts.list++;
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      if (state.rflist === "500") return err(route, 500, "INTERNAL_ERROR", "boom");
      if (state.rflist === "403") return err(route, 403, "FORBIDDEN", "Forbidden");
      if (state.rflist === "abort") return route.abort("failed");
      return json(route, 200, { success: true, data: state.orders });
    }
    if (state && m === "GET" && (rr = /^\/marketplace\/orders\/([^/]+)\/refund-calculation$/.exec(p))) {
      state.rcounts.calc++;
      if (state.calc === "500") return err(route, 500, "INTERNAL_ERROR", "boom");
      const c = CALCS[rr[1]] || CALCS[OID(1)];
      return json(route, 200, { success: true, data: { orderId: rr[1], status: "REFUND_REQUESTED", ...c, milestones: { intakeSubmitted: true, draftDelivered: false, latestVersionStatus: null, accepted: false } } });
    }
    if (state && m === "POST" && (rr = /^\/marketplace\/orders\/([^/]+)\/refund-resolve$/.exec(p))) {
      state.rcounts.resolve++;
      state.rbody = req.postData();
      const drop = () => { state.orders = state.orders.filter((x) => x.id !== rr[1]); };
      if (state.resolve === "abort") return route.abort("failed");
      if (state.resolve === "500") return err(route, 500, "INTERNAL_ERROR", "boom");
      if (state.resolve === "409gone") { drop(); return err(route, 409, "PERSONALIZED_SERVICE_REFUND_INVALID_STATE", "Order is not awaiting refund resolution (status ACTIVE)"); }
      if (state.resolve === "409") { return err(route, 409, "PERSONALIZED_SERVICE_REFUND_INVALID_STATE", "Order is not awaiting refund resolution (status ACTIVE)"); }
      if (state.resolve === "400") return err(route, 400, "PERSONALIZED_SERVICE_REFUND_INVALID_AMOUNT", "Refund amount exceeds ceiling");
      if (state.resolve === "slow") await new Promise((r) => setTimeout(r, 1000));
      drop();
      const body = JSON.parse(state.rbody || "{}");
      const full = body.decision === "APPROVE" && Math.abs(body.refundAmount - (CALCS[rr[1]] || CALCS[OID(1)]).refundableCeiling) < 0.01;
      return json(route, 200, { success: true, data: { id: rr[1], status: body.decision === "DENY" ? "ACTIVE" : full ? "REFUNDED" : "ACTIVE" } });
    }
    if (state && m === "POST" && /^\/admin\/gym-memberships\/[^/]+\/refund$/.test(p)) {
      state.mcount++;
      state.mbody = req.postData();
      state.mid = p.split("/")[3];
      if (state.mem === "abort") return route.abort("failed");
      if (state.mem === "500") return err(route, 500, "INTERNAL_ERROR", "boom");
      if (state.mem === "notfound") return err(route, 404, "Membership not found", "Membership not found");
      if (state.mem === "slow") await new Promise((r) => setTimeout(r, 900));
      return json(route, 200, { success: true, data: { refundAmount: 340000 } });
    }
    if (m === "GET" && p === "/admin/dashboard") return json(route, 200, { success: true, data: { stats: {}, recentUsers: [], alerts: [], services: [], userGrowth: [], roleDistribution: [], money: { escrow: "0", platformRevenue: "0" } } });
    if (state && m === "GET" && p === "/admin/payments/withdrawals") {
      state.counts.list++;
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      if (state.list === "500") return err(route, 500, "INTERNAL_ERROR", "boom");
      if (state.list === "403") return err(route, 403, "FORBIDDEN", "Forbidden");
      if (state.list === "abort") return route.abort("failed");
      return json(route, 200, { success: true, data: state.wd });
    }
    let mm;
    if (state && m === "POST" && (mm = /^\/admin\/payments\/withdrawals\/([^/]+)\/approve$/.exec(p))) {
      state.counts.approve++;
      if (state.approve === "slow") await new Promise((r) => setTimeout(r, 1000));
      if (state.approve === "500") return err(route, 500, "INTERNAL_ERROR", "Internal error");
      if (state.approve === "409") { state.wd = state.wd.filter((x) => x.id !== mm[1]); return json(route, 409, { success: false, error: { code: "CONFLICT", message: "Request is not PENDING" } }); }
      state.wd = state.wd.map((x) => (x.id === mm[1] ? { ...x, status: "APPROVED" } : x));
      return json(route, 200, { success: true, data: {} });
    }
    if (state && m === "POST" && (mm = /^\/admin\/payments\/withdrawals\/([^/]+)\/mark-paid$/.exec(p))) {
      state.counts.pay++;
      state.payBody = req.postData();
      if (state.pay === "abort") return route.abort("failed");
      if (state.pay === "500") return err(route, 500, "INTERNAL_ERROR", "boom");
      if (state.pay === "invalid") { state.wd = state.wd.filter((x) => x.id !== mm[1]); return err(route, 400, "INVALID_STATUS", "Request is PAID"); }
      if (state.pay === "409") { state.wd = state.wd.filter((x) => x.id !== mm[1]); return json(route, 409, { success: false, error: { code: "ALREADY_PAID", message: "already paid" } }); }
      if (state.pay === "slow") await new Promise((r) => setTimeout(r, 900));
      state.wd = state.wd.filter((x) => x.id !== mm[1]);
      return json(route, 200, { success: true, data: {} });
    }
    if (state && m === "POST" && (mm = /^\/admin\/payments\/withdrawals\/([^/]+)\/reject$/.exec(p))) {
      state.counts.reject++;
      state.rejectBody = req.postData();
      if (state.reject === "500") return err(route, 500, "INTERNAL_ERROR", "boom");
      state.wd = state.wd.filter((x) => x.id !== mm[1]);
      return json(route, 200, { success: true, data: {} });
    }
    return json(route, 200, { success: true, data: [] });
  });
  return { ctx, page, calls, errors };
}

export const results = [];
export const check = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra: String(extra) });
  console.log(cond ? "PASS" : "FAIL", name, extra);
};
export function save(file) {
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  return { pass, total: results.length };
}

export const ready = (page) => page.getByTestId("admin-withdrawals-page").waitFor({ timeout: 30000 });
export const rready = (page) => page.getByTestId("admin-refunds-page").waitFor({ timeout: 30000 });
export const rrows = (page) => page.getByTestId("refund-request-row");
export const rows = (page) => page.getByTestId("admin-withdrawal-request-card");

export async function axeRun(page, include) {
  await page.evaluate(AXE);
  return page.evaluate(async (inc) => {
    const ser = (r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}(${v.impact},${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
    const ctx = inc ? { include: inc.map((s) => [s]) } : document;
    const res = await axe.run(ctx, { resultTypes: ["violations"] });
    return ser(res);
  }, include || null);
}

export const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
