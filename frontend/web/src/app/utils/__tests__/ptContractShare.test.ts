/**
 * "Bạn nhận X (Y%)" - pure view-model, node:test like the sibling tests.
 * Run: npx tsx --test src/app/utils/__tests__/ptContractShare.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ptContractShare } from "../ptContractShare";

// Intl may use a no-break space or a plain dot depending on ICU; normalise for the assertion.
const norm = (s: string) => s.replace(/\s/g, " ");

describe("ptContractShare", () => {
  it("applies the contract's own frozen ptRate to the contract's own price (Decimal strings from the API)", () => {
    const s = ptContractShare({ price: "4000000.00", ptRate: "0.5500" })!;
    assert.equal(s.amount, 2200000);
    assert.equal(s.percentText, "55");
    assert.equal(norm(s.text), "Bạn nhận 2.200.000đ (55%)");
  });

  it("independent contract: 90%", () => {
    const s = ptContractShare({ price: 1000000, ptRate: "0.9000" })!;
    assert.equal(s.amount, 900000);
    assert.equal(norm(s.text), "Bạn nhận 900.000đ (90%)");
  });

  it("fractional percentages keep their decimals", () => {
    const s = ptContractShare({ price: "1000000", ptRate: "0.875" })!;
    assert.equal(s.percentText, "87,5");
    assert.equal(s.amount, 875000);
  });

  it("no ptRate (client viewer / older server) or no price -> nothing to show", () => {
    assert.equal(ptContractShare({ price: "4000000.00" }), null);
    assert.equal(ptContractShare({ price: "4000000.00", ptRate: null }), null);
    assert.equal(ptContractShare({ ptRate: "0.55" }), null);
    assert.equal(ptContractShare(null), null);
    assert.equal(ptContractShare(undefined), null);
  });

  it("garbage or out-of-range values are not shown", () => {
    assert.equal(ptContractShare({ price: "abc", ptRate: "0.5" }), null);
    assert.equal(ptContractShare({ price: "100", ptRate: "1.5" }), null);
    assert.equal(ptContractShare({ price: "100", ptRate: "-0.1" }), null);
  });
});
