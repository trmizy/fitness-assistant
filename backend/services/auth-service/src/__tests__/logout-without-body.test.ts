import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../app";
import { authService } from "../services/auth.service";

/**
 * N13A-07 - POST /auth/logout with no body (or no refreshToken) used to answer 500; it is a client error (400).
 * A real refresh token still logs out as before. TEST FIXTURE: authService.logout is stubbed, no database.
 */

let server: http.Server;
let baseUrl = "";
test.before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("logout without a body is 400 REFRESH_TOKEN_REQUIRED, not 500", async () => {
  const original = authService.logout;
  let called = 0;
  authService.logout = (async () => {
    called++;
    return undefined;
  }) as typeof authService.logout;
  try {
    for (const body of [undefined, "{}", '{"refreshToken":123}']) {
      const res = await fetch(`${baseUrl}/auth/logout`, {
        method: "POST",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body,
      });
      assert.equal(res.status, 400, String(body));
      const json: any = await res.json();
      assert.equal(json.code, "REFRESH_TOKEN_REQUIRED");
    }
    assert.equal(called, 0, "nothing was logged out");
  } finally {
    authService.logout = original;
  }
});

test("logout with a refresh token still answers 200", async () => {
  const original = authService.logout;
  authService.logout = (async () => undefined) as typeof authService.logout;
  try {
    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: "x".repeat(20) }),
    });
    assert.equal(res.status, 200);
  } finally {
    authService.logout = original;
  }
});
