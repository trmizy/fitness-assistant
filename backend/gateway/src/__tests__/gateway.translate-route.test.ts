/**
 * N14T-10: POST /translate is the canonical gateway path (the web baseURL already adds "/api"); the literal
 * "/api/translate" stays as an alias for mobile builds already in the field. Empty text is rejected by the
 * route itself (400 INVALID_TEXT), so no translation provider is contacted.
 * Evidence label: BACKEND INTEGRATION (real gateway app; no downstream service involved).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-translate-route-test";

let server: http.Server;
let base = "";

test.before(async () => {
  const { default: app } = await import("../app");
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

test("POST /translate reaches the translate route", async () => {
  const res = await post("/translate", { text: "", targetLang: "vi" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "INVALID_TEXT");
});

test("POST /api/translate (legacy alias) still reaches the translate route", async () => {
  const res = await post("/api/translate", { text: "", targetLang: "vi" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "INVALID_TEXT");
});

test("a doubled /api/api/translate is not a route", async () => {
  const res = await post("/api/api/translate", { text: "x", targetLang: "vi" });
  assert.equal(res.status, 404);
});
