/**
 * FH-3 helpers (pure, no database, no HTTP): the payment-service refusals that park a row CONFLICT and the validation of the
 * owed / paid / unpaid figures. Evidence label: unit test (TEST FIXTURE answers).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { invalidMoneyFigures, ledgerRefusalOf, settlingD65bEnabled } from "../services/session-settlement-answers";

const axiosErr = (status: number, code: string, message = "m") => Object.assign(new Error("Request failed"), { response: { status, data: { success: false, error: { code, message } } } });

test("ledgerRefusalOf: 409 IDEMPOTENCY_KEY_CONFLICT and 422 REQUEST_DOES_NOT_MATCH_TRANSACTION are refusals; nothing else is", () => {
  assert.equal(ledgerRefusalOf(axiosErr(409, "IDEMPOTENCY_KEY_CONFLICT"))?.code, "IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(ledgerRefusalOf(axiosErr(422, "REQUEST_DOES_NOT_MATCH_TRANSACTION", "price differs"))?.message, "price differs");
  assert.equal(ledgerRefusalOf(axiosErr(409, "NO_UNRESOLVED_HELD")), null);
  assert.equal(ledgerRefusalOf(axiosErr(500, "IDEMPOTENCY_KEY_CONFLICT")), null, "the status must match the code");
  assert.equal(ledgerRefusalOf(axiosErr(422, "IDEMPOTENCY_KEY_CONFLICT")), null);
  assert.equal(ledgerRefusalOf(new Error("timeout of 15000ms exceeded")), null);
  assert.equal(ledgerRefusalOf(null), null);
  // a client-wrapped error (checkout style)
  assert.equal(ledgerRefusalOf(Object.assign(new Error("x"), { status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" }))?.code, "IDEMPOTENCY_KEY_CONFLICT");
});

test("invalidMoneyFigures: coherent figures and pre-FH-1 answers pass", () => {
  assert.equal(invalidMoneyFigures({ compensation: "500000", shortfall: "0" }), null, "no figures = a pre-FH-1 answer, accepted as before");
  assert.equal(invalidMoneyFigures({ compensation: "250000.00", owed: "250000.00", paid: "250000.00", unpaid: "0.00" }), null);
  assert.equal(invalidMoneyFigures({ compensation: "150000.00", owed: "250000.00", paid: "150000.00", unpaid: "100000.00", obligationId: "o1" }), null);
  assert.equal(invalidMoneyFigures({ refund: "3000000.00", owed: "3000000.00", paid: "3000000.00", unpaid: "0.00", overReleased: [{ party: "PT", amount: "10.00", obligationId: "o" }] }), null);
  assert.equal(invalidMoneyFigures({ owed: 250000, paid: 0, unpaid: 250000 }), null, "numbers are accepted too");
});

test("invalidMoneyFigures: paid > owed, unpaid != owed - paid, negatives, junk, missing paid, compensation != paid, refund > paid, bad overReleased", () => {
  assert.match(invalidMoneyFigures({ owed: "100", paid: "150", unpaid: "0" })!, /paid 150 greater than owed 100/);
  assert.match(invalidMoneyFigures({ owed: "100", paid: "40", unpaid: "30" })!, /unpaid 30 but owed 100 - paid 40 = 60/);
  assert.match(invalidMoneyFigures({ owed: "100", paid: "-1", unpaid: "101" })!, /invalid paid/);
  assert.match(invalidMoneyFigures({ owed: "100", paid: "abc", unpaid: "0" })!, /invalid paid/);
  assert.match(invalidMoneyFigures({ owed: "100", unpaid: "100" })!, /without the paid figure/);
  assert.match(invalidMoneyFigures({ compensation: "100", owed: "250", paid: "150", unpaid: "100" })!, /compensation/);
  assert.match(invalidMoneyFigures({ refund: "200", owed: "250", paid: "150", unpaid: "100" })!, /refund/);
  assert.match(invalidMoneyFigures({ owed: "1", paid: "1", unpaid: "0", overReleased: "x" })!, /overReleased/);
  assert.match(invalidMoneyFigures({ owed: "1", paid: "1", unpaid: "0", overReleased: [{ party: "PT", amount: "-5" }] })!, /overReleased/);
  assert.match(invalidMoneyFigures(null)!, /did not answer/);
});

test("SETTLING_D65B defaults ON; only false / 0 / off / no turn it off", () => {
  const was = process.env.SETTLING_D65B;
  try {
    delete process.env.SETTLING_D65B;
    assert.equal(settlingD65bEnabled(), true);
    for (const v of ["false", "FALSE", " 0 ", "off", "no"]) {
      process.env.SETTLING_D65B = v;
      assert.equal(settlingD65bEnabled(), false, v);
    }
    for (const v of ["true", "1", "", "yes"]) {
      process.env.SETTLING_D65B = v;
      assert.equal(settlingD65bEnabled(), true, v);
    }
  } finally {
    if (was === undefined) delete process.env.SETTLING_D65B;
    else process.env.SETTLING_D65B = was;
  }
});
