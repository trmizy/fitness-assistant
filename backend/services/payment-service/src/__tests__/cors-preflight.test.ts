/**
 * Regression (2026-11-10, user screenshot on gymini.vn: "Không tải được danh sách cổng thanh toán"):
 * on AWS every API Gateway route is ANY, so the browser's CORS preflight `OPTIONS` reaches this Lambda. The routers behind
 * `/me/payments`, `/me` and `/admin/payments` answer 401 to anything unauthenticated, and a non-2xx preflight makes the browser drop
 * the whole request ("Network Error"). The OPTIONS answer must therefore be a 2xx that comes BEFORE any auth.
 * The fix lived only in the working tree, never reached the deployed Lambda — this test keeps it from silently disappearing again.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import app from "../app";

let server: http.Server;
let base = "";
test.before(async () => { server = http.createServer(app); await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
test.after(async () => { await new Promise<void>((r) => server.close(() => r())); });

const preflight = (path: string) => fetch(base + path, { method: "OPTIONS", headers: { Origin: "https://gymini.vn", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-type" } });

for (const path of ["/me/payments/methods", "/me/payments/abc/sync", "/me/wallet", "/admin/payments", "/admin/payments/finance-overview", "/payments/vnpay/return", "/internal/payments/checkout"]) {
  test(`OPTIONS ${path} answers 2xx without any authentication`, async () => {
    const res = await preflight(path);
    assert.equal(res.status, 204);
  });
}

test("the same route without OPTIONS is still protected (the preflight shortcut does not weaken auth)", async () => {
  const res = await fetch(base + "/me/payments/methods", { method: "GET" });
  assert.equal(res.status, 401);
});
