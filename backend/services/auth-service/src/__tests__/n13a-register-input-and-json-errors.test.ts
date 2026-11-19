import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../app";
import { authService } from "../services/auth.service";
import { registerStartSchema } from "../models/auth.models";

/**
 * N13A-06 / N13A-14 - TEST FIXTURE (authService.register stubbed, no database).
 *  - register: firstName / lastName capped at 100 chars -> 400 NAME_TOO_LONG (Vietnamese)
 *  - register: a last name that is empty or only dots (older web builds send "." for a one-word name) is dropped, never stored
 *  - a malformed JSON body answers a JSON 400 (INVALID_JSON), not Express's HTML page with the stack trace
 */

const VALID = { email: "n13a.reg@example.test", password: "Abcdef12!" };

test("schema: names over 100 chars are refused; a '.'-only last name is dropped; a real last name is kept (trimmed)", () => {
  assert.equal(registerStartSchema.safeParse({ ...VALID, firstName: "A".repeat(100) }).success, true);
  assert.equal(registerStartSchema.safeParse({ ...VALID, firstName: "A".repeat(101) }).success, false);
  assert.equal(registerStartSchema.safeParse({ ...VALID, lastName: "B".repeat(101) }).success, false);
  for (const dots of [".", "..", "  .  ", ""]) {
    const r = registerStartSchema.parse({ ...VALID, firstName: "Huy", lastName: dots });
    assert.equal(r.lastName, undefined, JSON.stringify(dots));
  }
  const kept = registerStartSchema.parse({ ...VALID, firstName: " Huy ", lastName: " Nguyễn Văn " });
  assert.deepEqual([kept.firstName, kept.lastName], ["Huy", "Nguyễn Văn"]);
  assert.equal(registerStartSchema.parse({ ...VALID, firstName: "Huy" }).lastName, undefined);
});

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

test("POST /auth/register: 500-char first name -> 400 NAME_TOO_LONG in Vietnamese, the service is never called", async () => {
  const original = authService.register;
  let called = 0;
  authService.register = (async () => {
    called++;
    return { message: "ok" };
  }) as unknown as typeof authService.register;
  try {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...VALID, firstName: "A".repeat(500), lastName: "B" }),
    });
    const body: any = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.code, "NAME_TOO_LONG");
    assert.match(body.error, /Họ và tên không hợp lệ/);
    assert.equal(called, 0);

    const ok = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...VALID, firstName: "Huy", lastName: "." }),
    });
    assert.equal(ok.status, 202);
    assert.equal(called, 1);
  } finally {
    authService.register = original;
  }
});

test("malformed JSON body -> JSON 400 INVALID_JSON (no HTML, no stack trace, no server paths)", async () => {
  const res = await fetch(`${baseUrl}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"email": "a@b.c", ' });
  const text = await res.text();
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = JSON.parse(text);
  assert.equal(body.code, "INVALID_JSON");
  assert.match(body.error, /JSON không hợp lệ/);
  assert.doesNotMatch(text, /node_modules|SyntaxError|<html|at /i);
});
