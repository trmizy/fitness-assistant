/**
 * Tests for the JWT helpers, with particular attention to the mobile-specific part: web decoded
 * the payload with the browser's `atob`, which Hermes does not have, so token.ts decodes base64url
 * and UTF-8 by hand. That decoder is the thing most worth testing — a silent failure in it would
 * make every token look unreadable, which `isAccessTokenExpiringSoon` reports as "expired", which
 * would send the app into a refresh on every single request.
 *
 * Runs with: npx tsx --test src/services/__tests__/token.test.ts
 * No npm dependencies beyond Node built-ins.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXPIRY_SKEW_SECONDS,
  decodeJwtPayload,
  hasUsableToken,
  isAccessTokenExpiringSoon,
} from "../token";

/** Builds a JWT whose payload is the given object. Signature is nonsense on purpose — nothing
 *  client-side verifies it, and these helpers must not care. */
function makeToken(payload: Record<string, unknown>): string {
  const base64url = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${base64url}.signature`;
}

describe("hasUsableToken", () => {
  it("rejects the string forms of absent values that storage hands back", () => {
    assert.equal(hasUsableToken(null), false);
    assert.equal(hasUsableToken(undefined), false);
    assert.equal(hasUsableToken(""), false);
    // These two are the real reason this helper exists: JSON/preference round-trips turn a
    // missing token into the literal text "null"/"undefined", which is truthy.
    assert.equal(hasUsableToken("null"), false);
    assert.equal(hasUsableToken("undefined"), false);
  });

  it("accepts a real token", () => {
    assert.equal(hasUsableToken(makeToken({ sub: "u1" })), true);
  });
});

describe("decodeJwtPayload", () => {
  it("decodes a plain ASCII payload", () => {
    const payload = { sub: "user-123", role: "ADMIN", exp: 1893456000 };
    assert.deepEqual(decodeJwtPayload(makeToken(payload)), payload);
  });

  it("decodes multi-byte UTF-8 — a Vietnamese name must survive the hand-rolled decoder", () => {
    const payload = { firstName: "Nguyễn", lastName: "Đặng Hữu", emoji: "💪" };
    assert.deepEqual(decodeJwtPayload(makeToken(payload)), payload);
  });

  it("decodes payloads of every base64 padding length", () => {
    // 0, 1 and 2 padding characters all have to come out identical — an off-by-one in the
    // padding maths would corrupt only some tokens, which is the worst kind of bug to chase.
    for (const filler of ["a", "aa", "aaa", "aaaa"]) {
      const payload = { sub: filler };
      assert.deepEqual(decodeJwtPayload(makeToken(payload)), payload);
    }
  });

  it("returns null for anything malformed rather than throwing", () => {
    assert.equal(decodeJwtPayload("not-a-jwt"), null);
    assert.equal(decodeJwtPayload("only.two"), null);
    assert.equal(decodeJwtPayload("a.!!!not-base64!!!.c"), null);
    assert.equal(decodeJwtPayload("a..c"), null);
    // Valid base64, but not JSON.
    assert.equal(decodeJwtPayload("a.bm90LWpzb24.c"), null);
  });

  it("returns null for a JSON payload that is not an object", () => {
    const scalar = Buffer.from("42", "utf8").toString("base64").replace(/=+$/, "");
    assert.equal(decodeJwtPayload(`a.${scalar}.c`), null);
  });
});

describe("isAccessTokenExpiringSoon", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it("is false for a token with plenty of life left", () => {
    assert.equal(
      isAccessTokenExpiringSoon(makeToken({ exp: nowSeconds() + 3600 })),
      false,
    );
  });

  it("is true for an already-expired token", () => {
    assert.equal(
      isAccessTokenExpiringSoon(makeToken({ exp: nowSeconds() - 10 })),
      true,
    );
  });

  it("is true inside the skew window — a request must never leave with a token that dies mid-flight", () => {
    const justInsideSkew = nowSeconds() + EXPIRY_SKEW_SECONDS - 5;
    assert.equal(isAccessTokenExpiringSoon(makeToken({ exp: justInsideSkew })), true);

    const justOutsideSkew = nowSeconds() + EXPIRY_SKEW_SECONDS + 30;
    assert.equal(isAccessTokenExpiringSoon(makeToken({ exp: justOutsideSkew })), false);
  });

  it("honours a caller-supplied skew", () => {
    const exp = nowSeconds() + 120;
    assert.equal(isAccessTokenExpiringSoon(makeToken({ exp }), 300), true);
    assert.equal(isAccessTokenExpiringSoon(makeToken({ exp }), 30), false);
  });

  it("treats missing, unreadable and exp-less tokens as expiring — every one takes the refresh path", () => {
    assert.equal(isAccessTokenExpiringSoon(null), true);
    assert.equal(isAccessTokenExpiringSoon("null"), true);
    assert.equal(isAccessTokenExpiringSoon("garbage"), true);
    assert.equal(isAccessTokenExpiringSoon(makeToken({ sub: "no-exp" })), true);
    assert.equal(isAccessTokenExpiringSoon(makeToken({ exp: "soon" })), true);
    assert.equal(isAccessTokenExpiringSoon(makeToken({ exp: Number.NaN })), true);
  });
});
