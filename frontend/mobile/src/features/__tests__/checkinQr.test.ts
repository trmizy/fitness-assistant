/**
 * E1 — mã QR check-in phía chủ gym.
 *
 * Chạy: npx tsx --test src/features/__tests__/checkinQr.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";

import { checkinTimeLabel, qrExpiryLabel, qrMatrixPath, shortMemberId } from "../gymOwner/checkinQr";

describe("qrMatrixPath", () => {
  it("draws exactly the dark modules qrcode computes for the token", () => {
    const token = "eyJneW1JZCI6ImFiYyIsImV4cCI6MX0.c2lnbmF0dXJlLXRlc3QtdmFsdWU";
    const { size, path } = qrMatrixPath(token);
    const expected = QRCode.create(token, { errorCorrectionLevel: "M" }).modules;
    assert.equal(size, expected.size);
    const dark = Array.from(expected.data).filter(Boolean).length;
    assert.equal((path.match(/M/g) ?? []).length, dark);
    // Finder pattern: the top-left module is always dark.
    assert.ok(path.startsWith("M0 0h1v1h-1z"));
  });
});

describe("qrExpiryLabel", () => {
  it("formats the server's epoch-ms expiry as a date", () => {
    const at = new Date(2027, 9, 1, 12).getTime();
    assert.equal(qrExpiryLabel(at), "Mã dùng được đến 01/10/2027");
    assert.equal(qrExpiryLabel(String(at)), "Mã dùng được đến 01/10/2027");
  });
  it("says nothing rather than something wrong", () => {
    assert.equal(qrExpiryLabel(undefined), null);
    assert.equal(qrExpiryLabel("not a date"), null);
  });
});

describe("check-in list labels", () => {
  it("matches web's short id and time format", () => {
    assert.equal(shortMemberId("c4a33d8c-ca61-4e30-872c-fc057581ec13"), "c4a33d8c…");
    assert.equal(shortMemberId(null), "—");
    const iso = new Date(2026, 9, 1, 14, 5).toISOString();
    assert.equal(checkinTimeLabel(iso), "14:05 · 01/10");
    assert.equal(checkinTimeLabel("x"), "");
  });
});
