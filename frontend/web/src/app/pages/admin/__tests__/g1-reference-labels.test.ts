/**
 * G1 - unit tests for reference labels and display formatting (FIX-1 / rule B4).
 * Evidence label: TEST FIXTURE (pure function tests, no DOM, no network).
 * Run: npx tsx --test src/app/pages/admin/__tests__/g1-reference-labels.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatReferenceParts, shortenRef } from "../disputes/shared/CompactReference";
import {
  CONTRACT_POLICY_REF_KIND_LABEL,
  D65B_REF_TYPE_LABEL,
  REFERENCE_KIND_LABEL,
} from "../disputes/disputeCaseLabels";

const UPPER_ENUM_TOKEN = /^[A-Z0-9_]{3,}(?::|…|$)/;

describe("G1 reference labels & display formatting (FIX-1)", () => {
  it("all reference kind labels in disputeCaseLabels are Vietnamese, never raw enums", () => {
    assert.equal(CONTRACT_POLICY_REF_KIND_LABEL.PT_TERMS_ACCEPTANCE, "Bản ghi PT chấp nhận điều khoản");
    assert.equal(CONTRACT_POLICY_REF_KIND_LABEL.CONTRACT_AUDIT_LOG, "Nhật ký gắn điều khoản với hợp đồng");
    assert.equal(D65B_REF_TYPE_LABEL.EVIDENCE, "Bằng chứng");
    assert.equal(D65B_REF_TYPE_LABEL.LEDGER_OP, "Bút toán sổ cái");

    for (const [key, label] of Object.entries(REFERENCE_KIND_LABEL)) {
      assert.notEqual(key, label);
      assert.match(label, /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i);
    }
  });

  it("shortenRef never starts with an uppercase enum token", () => {
    const samples = [
      "PT_TERMS_ACCEPTANCE:550e8400-e29b-41d4-a716-446655440000:hash123",
      "CONTRACT_AUDIT_LOG:550e8400-e29b-41d4-a716-446655440001:hash456",
      "EVIDENCE:550e8400-e29b-41d4-a716-446655440002:hash789",
      "LEDGER_OP:ledger-op-key-long-identifier",
      "550e8400-e29b-41d4-a716-446655440000",
    ];

    for (const s of samples) {
      const short = shortenRef(s);
      assert.doesNotMatch(short, UPPER_ENUM_TOKEN, `shortenRef("${s}") started with uppercase enum: ${short}`);
    }
  });

  it("formatReferenceParts decomposes contract policy refs with Vietnamese label and clean id", () => {
    const raw = "PT_TERMS_ACCEPTANCE:550e8400-e29b-41d4-a716-446655440000:abcdef0123456789";
    const parts = formatReferenceParts(raw);

    assert.equal(parts.kindLabel, "Bản ghi PT chấp nhận điều khoản");
    assert.equal(parts.id, "550e8400-e29b-41d4-a716-446655440000");
    assert.equal(parts.shortId, "550e8400…");
    assert.equal(parts.hash, "abcdef0123456789");
    assert.equal(parts.shortHash, "abcdef01…");
    assert.doesNotMatch(parts.shortId, UPPER_ENUM_TOKEN);
    assert.doesNotMatch(parts.displayLabel, UPPER_ENUM_TOKEN);
  });

  it("formatReferenceParts handles structured contract policy object", () => {
    const obj = {
      kind: "CONTRACT_AUDIT_LOG",
      id: "550e8400-e29b-41d4-a716-446655440001",
      hash: "1234567890abcdef",
    };
    const parts = formatReferenceParts(obj);

    assert.equal(parts.kindLabel, "Nhật ký gắn điều khoản với hợp đồng");
    assert.equal(parts.id, "550e8400-e29b-41d4-a716-446655440001");
    assert.equal(parts.shortId, "550e8400…");
    assert.equal(parts.hash, "1234567890abcdef");
    assert.doesNotMatch(parts.shortId, UPPER_ENUM_TOKEN);
  });

  it("formatReferenceParts handles D65-B EVIDENCE canonical string", () => {
    const raw = "EVIDENCE:evid-1234567890:hash-abcdef0123";
    const parts = formatReferenceParts(raw);

    assert.equal(parts.kindLabel, "Bằng chứng");
    assert.equal(parts.id, "evid-1234567890");
    assert.equal(parts.shortId, "evid-123…");
    assert.equal(parts.hash, "hash-abcdef0123");
    assert.doesNotMatch(parts.shortId, UPPER_ENUM_TOKEN);
  });

  it("formatReferenceParts handles D65-B LEDGER_OP canonical string", () => {
    const raw = "LEDGER_OP:ledger-settlement-key-9999";
    const parts = formatReferenceParts(raw);

    assert.equal(parts.kindLabel, "Bút toán sổ cái");
    assert.equal(parts.id, "ledger-settlement-key-9999");
    assert.equal(parts.shortId, "ledger-s…");
    assert.equal(parts.hash, undefined);
    assert.doesNotMatch(parts.shortId, UPPER_ENUM_TOKEN);
  });

  it("formatReferenceParts handles D65-B structured object inputs", () => {
    const evObj = { type: "EVIDENCE", id: "550e8400-e29b", contentHash: "sha256hash" };
    const p1 = formatReferenceParts(evObj);
    assert.equal(p1.kindLabel, "Bằng chứng");
    assert.equal(p1.id, "550e8400-e29b");
    assert.equal(p1.hash, "sha256hash");
    assert.doesNotMatch(p1.shortId, UPPER_ENUM_TOKEN);

    const opObj = { type: "LEDGER_OP", key: "op-key-123" };
    const p2 = formatReferenceParts(opObj);
    assert.equal(p2.kindLabel, "Bút toán sổ cái");
    assert.equal(p2.id, "op-key-123");
    assert.doesNotMatch(p2.shortId, UPPER_ENUM_TOKEN);
  });

  it("plain hex hash or identifier has no kindLabel and retains plain id", () => {
    const plain = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    const parts = formatReferenceParts(plain);
    assert.equal(parts.kindLabel, undefined);
    assert.equal(parts.id, plain);
    assert.equal(parts.shortId, "a1b2c3d4…");
    assert.doesNotMatch(parts.shortId, UPPER_ENUM_TOKEN);
  });

  it("unknown reference kind falls back to 'Tham chiếu', never raw enum (CF-1 / rule B4)", () => {
    const raw = "UNKNOWN_CUSTOM_ENUM:550e8400-e29b-41d4-a716-446655440000";
    const parts = formatReferenceParts(raw);
    assert.equal(parts.kindLabel, "Tham chiếu");
    assert.equal(parts.shortId, "550e8400…");
    assert.doesNotMatch(parts.kindLabel, UPPER_ENUM_TOKEN);
    assert.doesNotMatch(parts.displayLabel, UPPER_ENUM_TOKEN);

    const obj = { kind: "SOME_FUTURE_KIND", id: "550e8400-e29b-41d4-a716-446655440001" };
    const partsObj = formatReferenceParts(obj);
    assert.equal(partsObj.kindLabel, "Tham chiếu");
    assert.doesNotMatch(partsObj.kindLabel, UPPER_ENUM_TOKEN);
  });
});


import { parseAdminOptions } from "../disputes/actions/actionModel";
import { parseAdminDirectory } from "../reconciliation/moneyExceptions/adminDirectory";

describe("INT-01 admin list: GET /admin/dispute-cases/admins answers [{ id, displayName }]", () => {
  const rows = [
    { id: "e2e00000-0000-4000-8000-000000000001", displayName: "Admin 1" },
    { id: "e2e00000-0000-4000-8000-000000000002", displayName: "Admin 2" },
    { id: "e2e00000-0000-4000-8000-000000000003", displayName: "  " },
  ];
  it("assign options take the display name, drop the caller, never show an id as the name", () => {
    const opts = parseAdminOptions(rows, "e2e00000-0000-4000-8000-000000000001");
    assert.deepEqual(opts.map((o) => o.label), ["Admin 2", "Quản trị viên"]);
  });
  it("the money-exception directory reads the same shape, bare or under items", () => {
    assert.equal(parseAdminDirectory(rows).length, 3);
    assert.equal(parseAdminDirectory({ items: rows })[0].name, "Admin 1");
  });
});
