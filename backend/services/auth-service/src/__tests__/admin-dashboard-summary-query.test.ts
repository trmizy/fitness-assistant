/**
 * POST /auth/users/dashboard-summary body validation (pure). The SQL itself was run against the real auth database (read-only) when it was written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_SUMMARY_MAX_IDS,
  DASHBOARD_SUMMARY_MAX_RECENT,
  isDashboardSummaryQueryError,
  parseDashboardSummaryBody,
} from "../services/admin-dashboard-summary-query";

const ok = (b: unknown) => {
  const r = parseDashboardSummaryBody(b);
  assert.ok(!isDashboardSummaryQueryError(r), JSON.stringify(r));
  return r as Exclude<typeof r, { code: string }>;
};
const code = (b: unknown) => {
  const r = parseDashboardSummaryBody(b);
  assert.ok(isDashboardSummaryQueryError(r), "expected an error");
  return (r as { status: number; code: string }).code;
};

test("a complete body is accepted and normalised", () => {
  const r = ok({ excludeIds: ["a", "b"], ptUserIds: ["c"], since: "2026-05-31T17:00:00.000Z", recentLimit: 4 });
  assert.deepEqual(r.excludeIds, ["a", "b"]);
  assert.deepEqual(r.ptUserIds, ["c"]);
  assert.equal(r.since.toISOString(), "2026-05-31T17:00:00.000Z");
  assert.equal(r.recentLimit, 4);
});

test("id lists are optional, recentLimit defaults to 4, `since` is mandatory", () => {
  const r = ok({ since: "2026-05-31T17:00:00.000Z" });
  assert.deepEqual([r.excludeIds, r.ptUserIds, r.recentLimit], [[], [], 4]);
  assert.equal(code({}), "INVALID_SINCE");
  assert.equal(code(null), "INVALID_SINCE");
  assert.equal(code("nonsense"), "INVALID_SINCE");
  assert.equal(code({ since: "not a date" }), "INVALID_SINCE");
  assert.equal(code({ since: 12345 }), "INVALID_SINCE");
});

test("malformed id lists are refused, never silently emptied", () => {
  const since = "2026-05-31T17:00:00.000Z";
  assert.equal(code({ since, excludeIds: "a,b" }), "INVALID_EXCLUDE_IDS");
  assert.equal(code({ since, excludeIds: [1] }), "INVALID_EXCLUDE_IDS");
  assert.equal(code({ since, excludeIds: [""] }), "INVALID_EXCLUDE_IDS");
  assert.equal(code({ since, excludeIds: ["x".repeat(65)] }), "INVALID_EXCLUDE_IDS");
  assert.equal(code({ since, ptUserIds: [null] }), "INVALID_PT_IDS");
  assert.equal(code({ since, ptUserIds: new Array(DASHBOARD_SUMMARY_MAX_IDS + 1).fill("a") }), "INVALID_PT_IDS");
  // the size a 37k-account system really sends is fine
  assert.equal(ok({ since, excludeIds: new Array(40_000).fill("0123456789abcdef0123456789abcdef0123") }).excludeIds.length, 40_000);
});

test("recentLimit must be an integer in range", () => {
  const since = "2026-05-31T17:00:00.000Z";
  for (const bad of [0, -1, 1.5, "4", DASHBOARD_SUMMARY_MAX_RECENT + 1, null, NaN]) assert.equal(code({ since, recentLimit: bad }), "INVALID_RECENT_LIMIT", String(bad));
  assert.equal(ok({ since, recentLimit: DASHBOARD_SUMMARY_MAX_RECENT }).recentLimit, DASHBOARD_SUMMARY_MAX_RECENT);
});

test("excludeTestDomains is an optional boolean (default false); anything else is refused", () => {
  const since = "2026-05-31T17:00:00.000Z";
  assert.equal(ok({ since }).excludeTestDomains, false);
  assert.equal(ok({ since, excludeTestDomains: true }).excludeTestDomains, true);
  assert.equal(ok({ since, excludeTestDomains: false }).excludeTestDomains, false);
  for (const bad of ["true", 1, null]) assert.equal(code({ since, excludeTestDomains: bad }), "INVALID_EXCLUDE_TEST_DOMAINS", String(bad));
});

test("body limit: a per-route 4 MB parser registered before the global 1 MB one lets the dashboard body through, other routes stay at 1 MB", async () => {
  const express = (await import("express")).default;
  const app = express();
  app.use("/auth/users/dashboard-summary", express.json({ limit: "4mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.post("/auth/users/dashboard-summary", (req, res) => res.json({ n: req.body.ids.length }));
  app.post("/auth/other", (req, res) => res.json({ n: req.body.ids.length }));
  app.use((err: { status?: number }, _req: unknown, res: { status: (s: number) => { json: (b: unknown) => void } }, _next: unknown) => res.status(err.status ?? 500).json({}));
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const body = JSON.stringify({ ids: new Array(37_000).fill("0123456789abcdef0123456789abcdef0123") }); // ~1.4 MB, what 37k ids weigh
    const post = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    const big = await post("/auth/users/dashboard-summary");
    assert.equal(big.status, 200);
    assert.deepEqual(await big.json(), { n: 37_000 });
    assert.equal((await post("/auth/other")).status, 413);
  } finally {
    server.close();
  }
});
