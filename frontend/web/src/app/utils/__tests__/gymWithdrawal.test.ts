/**
 * CODE/UNIT — gym "Có thể rút" + registered payout text. Run: npx tsx --test src/app/utils/__tests__/gymWithdrawal.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskAccountNumber, registeredPayoutText, reservedPendingOf, withdrawableOf } from "../gymWithdrawal";

describe("withdrawableOf", () => {
  it("shows the server's `withdrawable`, not availableBalance, when both exist", () => {
    assert.equal(withdrawableOf({ availableBalance: "1000000.00", withdrawable: "700000.00", reservedPending: "300000.00" }), 700000);
  });
  it("0 is a real value (all reserved / in debt), not a reason to fall back", () => {
    assert.equal(withdrawableOf({ availableBalance: "1000000", withdrawable: "0.00" }), 0);
  });
  it("falls back to availableBalance only when the field is absent (old server)", () => {
    assert.equal(withdrawableOf({ availableBalance: "250000" }), 250000);
    assert.equal(withdrawableOf({ availableBalance: "250000", withdrawable: null }), 250000);
    assert.equal(withdrawableOf(undefined), 0);
  });
  it("never negative, never NaN", () => {
    assert.equal(withdrawableOf({ withdrawable: "-5" }), 0);
    assert.equal(withdrawableOf({ availableBalance: "abc" }), 0);
  });
});

describe("reservedPendingOf", () => {
  it("is the held amount, 0 when absent", () => {
    assert.equal(reservedPendingOf({ reservedPending: "300000.00" }), 300000);
    assert.equal(reservedPendingOf({}), 0);
    assert.equal(reservedPendingOf(null), 0);
  });
});

describe("registeredPayoutText", () => {
  it("joins a complete account", () => {
    assert.equal(registeredPayoutText({ bankName: "Vietcombank", accountNumber: "0123456789", accountHolder: "NGUYEN VAN A" }), "Vietcombank — 0123456789 — NGUYEN VAN A");
  });
  it("is empty when anything is missing, so the form stays closed and points to the partner profile", () => {
    assert.equal(registeredPayoutText({ bankName: "VCB", accountNumber: "1", accountHolder: null }), "");
    assert.equal(registeredPayoutText({ bankName: null, accountNumber: null, accountHolder: null }), "");
    assert.equal(registeredPayoutText(null), "");
    assert.equal(registeredPayoutText(undefined), "");
  });
});

describe("maskAccountNumber", () => {
  it("keeps the last 4", () => {
    assert.equal(maskAccountNumber("0123456789"), "•••••• 6789");
    assert.equal(maskAccountNumber("123"), "123");
  });
});
