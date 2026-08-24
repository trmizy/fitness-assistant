import test from "node:test";
import assert from "node:assert/strict";
import contractRoutes from "../routes/contract.routes";

/**
 * Money-flow redesign plan item 2.3 — the four routes with zero real callers
 * (POST /, PUT /:id, PATCH /:id/status, POST /:id/session) must respond 410 Gone rather than
 * running their old handler, WITHOUT the controller/service code behind them being deleted
 * yet (the plan's explicit "khoá, chưa xoá" instruction — deletion is a follow-up pass).
 *
 * Reaches into the Express Router's internal `.stack` to find each route's terminal handler
 * and invoke it directly, bypassing authMiddleware — this is a routing-table assertion, not an
 * authentication one (2.1 already covers who's allowed to call what once a route IS live).
 */

function findHandler(method: string, path: string): (req: any, res: any) => unknown {
  const layer = (contractRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  assert.ok(layer, `no route registered for ${method.toUpperCase()} ${path}`);
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

for (const [method, path] of [
  ["post", "/"],
  ["put", "/:id"],
  ["patch", "/:id/status"],
  ["post", "/:id/session"],
] as const) {
  test(`${method.toUpperCase()} ${path} responds 410 Gone, not its old handler`, () => {
    const handler = findHandler(method, path);
    const res = fakeRes();

    handler({ params: { id: "c1" }, body: {} }, res);

    assert.equal(res.statusCode, 410);
    assert.equal(res.body?.error, "GONE");
    assert.ok(typeof res.body?.message === "string" && res.body.message.length > 0);
  });
}

test("PATCH /:id/cancel is still live — it has a genuine pre-money use, unlike the four above", () => {
  const handler = findHandler("patch", "/:id/cancel");
  // contractController.cancelContract is `async (req, res) => {...}` — an AsyncFunction.
  // `gone(...)`'s returned closure is a plain synchronous arrow function. This distinguishes
  // "still wired to its real controller" from "locked" without needing a live server.
  assert.equal(handler.constructor.name, "AsyncFunction");
});
