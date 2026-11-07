/**
 * G1 - unit tests for the shortenRef pure function and isReferenceValue guard in CompactReference.
 * Evidence label: TEST FIXTURE (pure function tests, no DOM, no network).
 * Run: npx tsx --test src/app/pages/admin/__tests__/g1-compact-reference.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shortenRef, isReferenceValue } from "../disputes/shared/CompactReference";

describe("shortenRef", () => {
  it("returns the first 8 chars + ellipsis for a long plain identifier", () => {
    const id = "abcdefgh1234567890ab";
    assert.equal(shortenRef(id), "abcdefgh…");
  });

  it("returns value as-is when shorter than or equal to 8 chars", () => {
    assert.equal(shortenRef("abc"), "abc");
    assert.equal(shortenRef("abcdefgh"), "abcdefgh");
  });

  it("extracts the identifier part from an EVIDENCE: prefix before shortening", () => {
    const ref = "EVIDENCE:abcdefgh1234567890";
    assert.equal(shortenRef(ref), "abcdefgh…");
  });

  it("extracts the identifier part from a LEDGER_OP: prefix before shortening", () => {
    const ref = "LEDGER_OP:key1234567890";
    assert.equal(shortenRef(ref), "key12345…");
  });

  it("returns short EVIDENCE identifier as-is", () => {
    assert.equal(shortenRef("EVIDENCE:abc"), "abc");
  });

  it("returns a 9-char plain identifier shortened to 8+ellipsis", () => {
    assert.equal(shortenRef("abcdefghi"), "abcdefgh…");
  });
});

describe("isReferenceValue", () => {
  it("accepts a 32+ hex string", () => {
    assert.ok(isReferenceValue("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"));
  });

  it("accepts an EVIDENCE: prefixed string", () => {
    assert.ok(isReferenceValue("EVIDENCE:someId"));
  });

  it("accepts a LEDGER_OP: prefixed string", () => {
    assert.ok(isReferenceValue("LEDGER_OP:someKey"));
  });

  it("rejects a plain short string", () => {
    assert.equal(isReferenceValue("hello"), false);
  });

  it("rejects a number", () => {
    assert.equal(isReferenceValue(42), false);
  });

  it("rejects null", () => {
    assert.equal(isReferenceValue(null), false);
  });

  it("rejects an object", () => {
    assert.equal(isReferenceValue({ type: "EVIDENCE", id: "abc" }), false);
  });
});

