import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../utils/corsOrigins";

test("isAllowedOrigin: no Origin header (native app / curl / server-to-server) is allowed", () => {
  assert.equal(isAllowedOrigin(undefined), true);
});

test("isAllowedOrigin: localhost and 127.0.0.1 at any port are allowed", () => {
  assert.equal(isAllowedOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isAllowedOrigin("https://localhost:5173"), true);
});

test("isAllowedOrigin: a real VS Code Dev Tunnels hostname (tunnel-id.region.devtunnels.ms) is allowed", () => {
  assert.equal(isAllowedOrigin("https://zldpdbp4-5173.asse.devtunnels.ms"), true);
  assert.equal(isAllowedOrigin("https://abc123.devtunnels.ms"), true);
});

test("isAllowedOrigin: a devtunnels.ms origin over plain http (not https) is rejected", () => {
  assert.equal(isAllowedOrigin("http://zldpdbp4-5173.asse.devtunnels.ms"), false);
});

test("isAllowedOrigin: domain-squatting variants of devtunnels.ms are rejected", () => {
  assert.equal(isAllowedOrigin("https://evildevtunnels.ms"), false);
  assert.equal(isAllowedOrigin("https://devtunnels.ms.evil.com"), false);
});

test("isAllowedOrigin: an arbitrary unrelated origin is rejected unless listed in CORS_ORIGIN", () => {
  const original = process.env.CORS_ORIGIN;
  try {
    delete process.env.CORS_ORIGIN;
    assert.equal(isAllowedOrigin("https://example.com"), false);
    process.env.CORS_ORIGIN = "https://example.com,https://other.com";
    assert.equal(isAllowedOrigin("https://example.com"), true);
    assert.equal(isAllowedOrigin("https://not-listed.com"), false);
  } finally {
    if (original === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = original;
  }
});
