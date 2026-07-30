/**
 * Regression test for the P1 vulnerability found and fixed in this pass:
 * several gym-service controller methods (gymController.listPublic,
 * .listOwned, affiliationController.listPublic/.listInvitations/
 * .listAffiliations, ...) were `async` route handlers with NO try/catch.
 * Express 4 only auto-catches SYNCHRONOUS throws — a rejected promise from
 * an unguarded async handler becomes an unhandled promise rejection, which
 * terminates the Node process by default. `gymController.listPublic` in
 * particular backs a PUBLIC, unauthenticated endpoint (GET /gyms), so a
 * single transient DB error there could have taken down the entire service
 * for every user, not just failed that one request.
 *
 * This proves the fix (asyncHandler wrapping every route + a global error
 * middleware in app.ts) turns a rejected promise into a clean 500 response
 * instead of crashing — and, critically, that the server process is still
 * alive and can serve the NEXT request afterward.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { asyncHandler } from "../middleware/asyncHandler";

let server: http.Server;
let baseUrl = "";
let unhandledRejections: unknown[] = [];

test.before(async () => {
  // If asyncHandler ever regresses (e.g. someone removes the .catch(next)),
  // this test's own process would see an unhandledRejection — capture it so
  // the test can fail loudly instead of just crashing this test file too.
  process.on("unhandledRejection", (reason) => {
    unhandledRejections.push(reason);
  });

  const app = express();

  // Mirrors the exact shape of the previously-unguarded controller methods:
  // an async handler with no try/catch that can reject.
  app.get(
    "/flaky",
    asyncHandler(async () => {
      throw new Error("simulated transient DB error");
    }),
  );
  app.get("/ok", asyncHandler(async (_req, res) => {
    res.json({ success: true });
  }));

  // Same global error middleware app.ts now has.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    res.status(err?.status || 500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to start test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("SECURITY: a rejected promise from an async handler returns a clean 500, not a crash", async () => {
  const res = await fetch(`${baseUrl}/flaky`);
  assert.equal(res.status, 500);
  const body = (await res.json()) as { success: boolean; error: { code: string } };
  assert.equal(body.success, false);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("the internal error message/stack is never leaked to the client", async () => {
  const res = await fetch(`${baseUrl}/flaky`);
  const text = await res.text();
  assert.ok(!text.includes("simulated transient DB error"), "internal error detail must not reach the client");
});

test("SECURITY: the server survives a rejected handler and still serves the next request — this is the whole point of the fix", async () => {
  await fetch(`${baseUrl}/flaky`); // trigger the failure
  const res = await fetch(`${baseUrl}/ok`); // must still work afterward
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean };
  assert.equal(body.success, true);
});

test("no unhandledRejection ever escaped asyncHandler during this test run", () => {
  assert.deepEqual(unhandledRejections, []);
});
