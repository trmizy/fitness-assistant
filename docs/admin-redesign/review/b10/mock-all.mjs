// MOCK BROWSER TEST — B10 combined mock backend (reuses b3b + b9a + b9b + b6a fixtures). Every /api/** call is answered by page.route.
import { createRequire } from "module";
import fs from "fs";
import { mockFor as m3b, defaults as d3b, ADMIN } from "../b3b/harness.mjs";
import { mockFor as m9a } from "../b9a/mock.mjs";
import { mockFor as m9b } from "../b9b/mock.mjs";
import { baseRows, baseOrders, CALCS, oid } from "../b6a/harness.mjs";
const require = createRequire("D:/fitnessassistant-playwright-e2e/package.json");
export const { chromium } = require("@playwright/test");
export { ADMIN };
export const BASE = process.env.B10_BASE || "http://127.0.0.1:5940";
export const OUT = "D:/admin-fr/docs/admin-redesign/review/b10";
export const SCR = "C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b10";
export const AXE = fs.readFileSync("C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b2/axe.min.js", "utf8");
fs.mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 36000 })}.sig`;
const ok = (d) => ({ status: 200, body: { success: true, data: d } });

function route(p, method, q, st) {
  if (/^\/admin\/(users|ai\/|dashboard$|system-monitor)/.test(p) || p === "/admin/partner-accounts/roles") return m9b(p, method, q, st9b);
  if (/^\/(pt-applications\/admin|admin\/(gyms|brands|partners|commission-rate|listings|amenities))/.test(p) && !(p === "/admin/amenities/proposals")) return m9a(p, method, q, st9a);
  if (p === "/exercises/admin/review") return { status: 200, body: { candidates: [1, 2].map((n) => ({ externalRef: `ex-${n}`, nameEn: `Bench Press ${n}`, nameVi: `Đẩy ngực ${n}`, duplicateDecision: "LIKELY_DUPLICATE", reviewStatus: "PENDING", confidence: 0.9, bestMatchExercise: null })), summary: { total: 2 }, total: 2 } };
  if (p.endsWith("/history") && p.startsWith("/exercises/admin/review/")) return { status: 200, body: { history: [] } };
  if (p.startsWith("/exercises/admin/review/ex-")) return { status: 200, body: { externalRef: "ex-1", nameEn: "Bench Press 1", nameVi: "Đẩy ngực 1", catalogRow: { movementPattern: "push", equipment: [], primaryMuscles: [], difficulty: "beginner" }, bestMatchExerciseDetail: null, matchedFields: ["equipment"], conflictingFields: ["difficulty"], duplicateDecision: "LIKELY_DUPLICATE", reviewStatus: "PENDING", confidence: 0.9, bestMatchExercise: null } };
  if (p === "/admin/sessions/disputed") return { status: 200, body: [{ id: "d1111111-aaaa-4000-8000-000000000001", status: "DISPUTED", disputedAt: new Date().toISOString(), disputeType: "PT_NO_SHOW_CLAIM", clientUserId: "c1111111-aaaa-4000-8000-000000000001", ptUserId: "p1111111-aaaa-4000-8000-000000000001", contractId: "c0111111-aaaa-4000-8000-000000000001", contract: { packageName: "Gói 12 buổi" } }] };
  if (p === "/admin/payments/withdrawals" && method === "GET") return ok(baseRows());
  if (p === "/marketplace/orders/refund-requests") return ok(baseOrders());
  const rc = /^\/marketplace\/orders\/([^/]+)\/refund-calculation$/.exec(p);
  if (rc) return ok({ orderId: rc[1], status: "REFUND_REQUESTED", ...(CALCS[rc[1]] || CALCS[oid(1)]), milestones: {} });
  return m3b(p, method, q, st3b);
}
const st9a = { pt: "ok", gyms: "ok", partners: "ok", partner: "ok", apps: "ok" };
const st9b = {};
const st3b = d3b();

export async function newPage(browser, { width, height, theme = "light", reduced = false, delay = 0, hang = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: theme === "dark" ? "dark" : "light" });
  await ctx.addInitScript(({ jwt, USER, theme }) => {
    localStorage.setItem("CapacitorStorage.accessToken", jwt);
    localStorage.setItem("CapacitorStorage.refreshToken", "refresh-mock");
    localStorage.setItem("CapacitorStorage.user", JSON.stringify(USER));
    localStorage.setItem("fitness-assistant.theme", theme);
  }, { jwt, USER: ADMIN, theme });
  const page = await ctx.newPage();
  const calls = [], errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.route(/\/api\//, async (r) => {
    const req = r.request(); const url = new URL(req.url()); const p = url.pathname.replace(/^\/api/, "");
    calls.push(`${req.method()} ${p}`);
    if (hang && !p.startsWith("/auth/") && !/notifications/.test(p)) return;
    if (delay && !p.startsWith("/auth/")) await new Promise((r) => setTimeout(r, delay));
    let out; try { out = route(p, req.method(), url.searchParams, {}); } catch (e) { out = { status: 200, body: { success: true, data: [] } }; }
    return r.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
  });
  return { ctx, page, calls, errors };
}
export const ROUTES = [
  ["today", "/admin/dashboard"], ["fin-overview", "/admin/finance"], ["fin-recon", "/admin/finance/reconciliation"], ["fin-recon-exc", "/admin/finance/reconciliation?view=exceptions"],
  ["fin-withdrawals", "/admin/finance/withdrawals"], ["fin-refunds", "/admin/finance/refunds"], ["users", "/admin/users"], ["pts", "/admin/pts"],
  ["gym-mgmt", "/admin/gym-management"], ["partners", "/admin/partners"], ["gyms", "/admin/gyms"], ["listings", "/admin/listings"],
  ["disputes", "/admin/disputes"], ["complaints", "/admin/complaints"], ["marketplace", "/admin/marketplace"], ["exercise-review", "/admin/exercise-review"],
  ["catalog-quality", "/admin/catalog-quality"], ["system", "/admin/system"], ["ai", "/admin/ai-observability"],
];
export async function axeRun(page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + " :: " + (n.any[0]?.message || n.all[0]?.message || n.none[0]?.message || "").slice(0, 120)) }));
  });
}
