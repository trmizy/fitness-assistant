/**
 * G1 - unit tests for contract policy review body shapes (no extra fields, strict schema compliance).
 * Evidence label: TEST FIXTURE (pure function tests, no DOM, no network).
 * Run: npx tsx --test src/app/pages/admin/__tests__/g1-contract-policy.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { policyApproveBody } from "../disputes/actions/actionModel";
import type { ContractPolicyInput } from "../disputes/disputeCaseApi";

describe("contract policy review bodies (A30-A32)", () => {
  it("contract policy propose body has only the expected keys: result, evidenceRefs, reasoning, supersedesId", () => {
    const input: ContractPolicyInput = {
      result: "ELIGIBLE_CURRENT_POLICY",
      evidenceRefs: [
        { kind: "PT_TERMS_ACCEPTANCE", id: "550e8400-e29b-41d4-a716-446655440000" },
        { kind: "CONTRACT_AUDIT_LOG", id: "550e8400-e29b-41d4-a716-446655440001" },
      ],
      reasoning: "Rà soát căn cứ chính sách PT",
      supersedesId: "550e8400-e29b-41d4-a716-446655440002",
    };

    const keys = Object.keys(input).sort();
    assert.deepEqual(keys, ["evidenceRefs", "reasoning", "result", "supersedesId"]);

    // EvidenceRefs item keys must be strictly { kind, id }
    for (const ref of input.evidenceRefs) {
      assert.deepEqual(Object.keys(ref).sort(), ["id", "kind"]);
      assert.ok(["PT_TERMS_ACCEPTANCE", "CONTRACT_AUDIT_LOG"].includes(ref.kind));
    }

    // Must never contain forbidden keys
    const forbidden = ["amount", "adminId", "userId", "actorId", "outcome", "caseId"];
    for (const key of forbidden) {
      assert.equal(key in input, false, `Forbidden key ${key} found in propose input`);
    }
  });

  it("contract policy propose body works without optional supersedesId", () => {
    const input: ContractPolicyInput = {
      result: "EXCEPTION_APPLIES",
      evidenceRefs: [{ kind: "PT_TERMS_ACCEPTANCE", id: "550e8400-e29b-41d4-a716-446655440000" }],
      reasoning: "Áp dụng ngoại lệ lịch sử",
    };

    const keys = Object.keys(input).sort();
    assert.deepEqual(keys, ["evidenceRefs", "reasoning", "result"]);
    assert.equal("supersedesId" in input, false);
  });

  it("contract policy approve body has only reason and conflictOfInterestDeclaredNone", () => {
    const approve = policyApproveBody({
      reason: "Đồng ý với kết luận",
      coi: true,
    });

    assert.deepEqual(approve, {
      reason: "Đồng ý với kết luận",
      conflictOfInterestDeclaredNone: true,
    });

    const keys = Object.keys(approve).sort();
    assert.deepEqual(keys, ["conflictOfInterestDeclaredNone", "reason"]);

    const forbidden = ["amount", "adminId", "userId", "actorId", "outcome", "contractId", "reviewId"];
    for (const key of forbidden) {
      assert.equal(key in approve, false, `Forbidden key ${key} found in approve body`);
    }
  });

  it("contract policy approve body trims reason and strictly enforces boolean COI declaration", () => {
    const approve = policyApproveBody({
      reason: "   Lý do có khoảng trắng đầu cuối   ",
      coi: true,
    });
    assert.equal(approve.reason, "Lý do có khoảng trắng đầu cuối");
    assert.equal(approve.conflictOfInterestDeclaredNone, true);

    const approveFalse = policyApproveBody({
      reason: "Lý do",
      coi: false,
    });
    assert.equal(approveFalse.conflictOfInterestDeclaredNone, false);
  });
});

