import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFrontendUrlForProduction,
  frontendUrlProblem,
  resolveFrontendUrl,
} from "../config/frontend-url";

/**
 * FRONTEND_URL fail-fast: in production a missing / localhost / loopback / private-LAN value must
 * stop the service instead of silently falling back to http://localhost:5173. Dev is unchanged.
 */

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

test("production refuses a missing, blank, malformed or non-http FRONTEND_URL", () => {
  for (const bad of [undefined, "", "   ", "not a url", "ftp://app.example.com", "app.example.com"]) {
    assert.throws(
      () => assertFrontendUrlForProduction(env({ NODE_ENV: "production", FRONTEND_URL: bad })),
      /FRONTEND_URL/,
      String(bad),
    );
  }
});

test("production refuses localhost, loopback, 0.0.0.0, link-local and private LAN hosts", () => {
  for (const bad of [
    "http://localhost:5173",
    "http://LOCALHOST",
    "http://127.0.0.1",
    "http://127.8.9.10:3000",
    "http://0.0.0.0",
    "http://10.1.2.3",
    "http://172.16.0.5",
    "http://172.31.255.1",
    "http://192.168.1.50:5173",
    "http://169.254.1.1",
    "http://[::1]:5173",
    "http://box.local",
  ]) {
    assert.ok(frontendUrlProblem(bad), bad);
    assert.throws(() => assertFrontendUrlForProduction(env({ NODE_ENV: "production", FRONTEND_URL: bad })), /local\/private/, bad);
  }
});

test("production accepts a public host (including 172.x outside the private range and domains starting like IPv6 prefixes)", () => {
  for (const good of ["https://app.example.com", "http://203.0.113.10", "http://172.32.0.1", "https://fdic.example.com", "https://fc.example.com/"]) {
    assert.equal(frontendUrlProblem(good), null, good);
    assert.doesNotThrow(() => assertFrontendUrlForProduction(env({ NODE_ENV: "production", FRONTEND_URL: good })));
  }
});

test("resolveFrontendUrl: production never falls back to localhost; dev keeps the old fallback", () => {
  assert.throws(() => resolveFrontendUrl(env({ NODE_ENV: "production" })), /FRONTEND_URL/);
  assert.equal(resolveFrontendUrl(env({ NODE_ENV: "production", FRONTEND_URL: "https://app.example.com" })), "https://app.example.com");
  assert.equal(resolveFrontendUrl(env({ NODE_ENV: "development" })), "http://localhost:5173");
  assert.equal(resolveFrontendUrl(env({})), "http://localhost:5173");
  assert.equal(resolveFrontendUrl(env({ NODE_ENV: "development", FRONTEND_URL: "http://192.168.1.5:5173" })), "http://192.168.1.5:5173");
});

test("outside production the assertion never throws (dev behaviour unchanged)", () => {
  assert.doesNotThrow(() => assertFrontendUrlForProduction(env({ NODE_ENV: "development" })));
  assert.doesNotThrow(() => assertFrontendUrlForProduction(env({})));
});
