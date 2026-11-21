/**
 * Return-to-PT after a membership checkout: the path sanitiser (no open redirect) and the stored-record rules.
 * Runs with: npx tsx --test src/features/__tests__/paymentReturn.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PAYMENT_RETURN_TTL_MS,
  buildPtRequestReturnPath,
  resumablePaymentReturn,
  sanitizeReturnTo,
} from "../payments/paymentReturn";

const BS = String.fromCharCode(92);

describe("sanitizeReturnTo", () => {
  it("accepts in-app client paths", () => {
    assert.equal(sanitizeReturnTo("/client/services/pt/abc?packageId=p&gymId=g"), "/client/services/pt/abc?packageId=p&gymId=g");
  });
  it("rejects open-redirect and non-client shapes", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/" + BS + "evil", "/client/.." + BS + "x", "javascript:alert(1)", "", "/pt/dashboard", "/login", "/client/a\nb", null, undefined, 7, "/client/" + "a".repeat(600)]) {
      assert.equal(sanitizeReturnTo(bad), null, String(bad));
    }
  });
});

describe("buildPtRequestReturnPath", () => {
  it("encodes ids and always passes the sanitiser; branch is optional", () => {
    const p = buildPtRequestReturnPath({ ptUserId: "pt 1", packageId: "pk&2", gymId: "g3" });
    assert.equal(p, "/client/services/pt/pt%201?packageId=pk%262&gymId=g3");
    assert.equal(sanitizeReturnTo(p), p);
    assert.equal(buildPtRequestReturnPath({ ptUserId: "a", packageId: "b" }), "/client/services/pt/a?packageId=b");
  });
});

describe("resumablePaymentReturn", () => {
  const now = 1_000_000_000_000;
  const rec = (o: object = {}) => JSON.stringify({ transactionId: "t1", userId: "u1", path: "/client/services/pt/a?packageId=b", at: now - 1000, ...o });
  it("returns the path only for the same transaction and user while fresh", () => {
    assert.equal(resumablePaymentReturn(rec(), "t1", "u1", now), "/client/services/pt/a?packageId=b");
    assert.equal(resumablePaymentReturn(rec(), "t2", "u1", now), null);
    assert.equal(resumablePaymentReturn(rec(), "t1", "u2", now), null);
    assert.equal(resumablePaymentReturn(rec({ at: now - PAYMENT_RETURN_TTL_MS - 1 }), "t1", "u1", now), null);
  });
  it("re-validates the stored path and survives garbage", () => {
    assert.equal(resumablePaymentReturn(rec({ path: "https://evil.com" }), "t1", "u1", now), null);
    assert.equal(resumablePaymentReturn("{nope", "t1", "u1", now), null);
    assert.equal(resumablePaymentReturn(null, "t1", "u1", now), null);
  });
});
