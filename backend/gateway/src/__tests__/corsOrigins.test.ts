import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin, trustedWebOrigin } from "../utils/corsOrigins";

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

// ── trustedWebOrigin: the host emailed links (password reset, partner invites) may use ──────────

test("trustedWebOrigin: a missing Origin is NOT trusted, even though CORS lets it through", () => {
  // Native app / curl requests have no web page to link back to; callers fall back to FRONTEND_URL.
  assert.equal(trustedWebOrigin(undefined), null);
  assert.equal(trustedWebOrigin(""), null);
  // Sandboxed iframes and some redirects send the literal string "null".
  assert.equal(trustedWebOrigin("null"), null);
});

test("trustedWebOrigin: the current LAN address, localhost and a dev tunnel are returned as-is", () => {
  assert.equal(trustedWebOrigin("http://192.168.2.100:5173"), "http://192.168.2.100:5173");
  assert.equal(trustedWebOrigin("http://localhost:5173"), "http://localhost:5173");
  assert.equal(
    trustedWebOrigin("https://zldpdbp4-5173.asse.devtunnels.ms"),
    "https://zldpdbp4-5173.asse.devtunnels.ms",
  );
});

test("trustedWebOrigin: an attacker's domain is rejected, so a reset link can never point at it", () => {
  const original = process.env.CORS_ORIGIN;
  try {
    delete process.env.CORS_ORIGIN;
    assert.equal(trustedWebOrigin("https://evil.example"), null);
    assert.equal(trustedWebOrigin("https://devtunnels.ms.evil.com"), null);
    assert.equal(trustedWebOrigin("http://zldpdbp4-5173.asse.devtunnels.ms"), null);
  } finally {
    if (original === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = original;
  }
});

test("trustedWebOrigin: a production origin listed in CORS_ORIGIN is trusted, trailing slash dropped", () => {
  const original = process.env.CORS_ORIGIN;
  try {
    process.env.CORS_ORIGIN = "https://app.example.com/";
    assert.equal(trustedWebOrigin("https://app.example.com/"), "https://app.example.com");
  } finally {
    if (original === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = original;
  }
});
