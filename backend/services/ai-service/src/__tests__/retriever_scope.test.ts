import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RETRIEVER_COLLECTION_SCOPES,
  detectHomeOnlyConstraint,
} from "../llm/retriever";

describe("retriever collection scopes", () => {
  it("allows AI coach chat to retrieve Qdrant exercise documents", () => {
    assert.ok(RETRIEVER_COLLECTION_SCOPES.chat.includes("exercises"));
  });

  it("keeps AI Plan generation evidence scope away from Qdrant exercises", () => {
    assert.deepEqual(
      [...RETRIEVER_COLLECTION_SCOPES.planEvidence],
      ["fitness_evidence"],
    );
    assert.equal(
      RETRIEVER_COLLECTION_SCOPES.planEvidence.includes("exercises" as never),
      false,
    );
  });
});

describe("home-only equipment constraint detection", () => {
  it("detects Vietnamese home/no-equipment phrasing", () => {
    assert.equal(
      detectHomeOnlyConstraint("Tôi tập ở nhà không có tạ, nên tập gì?"),
      true,
    );
    assert.equal(
      detectHomeOnlyConstraint("Bài tập nào tốt cho tay sau khi tập tại nhà?"),
      true,
    );
  });

  it("detects English home/no-equipment phrasing", () => {
    assert.equal(
      detectHomeOnlyConstraint("What's a good home workout with no equipment?"),
      true,
    );
  });

  it("does not fire for ordinary gym questions", () => {
    assert.equal(
      detectHomeOnlyConstraint("What is the correct form for bench press?"),
      false,
    );
    assert.equal(
      detectHomeOnlyConstraint("Nên tập ngực mấy hiệp một tuần?"),
      false,
    );
  });
});
