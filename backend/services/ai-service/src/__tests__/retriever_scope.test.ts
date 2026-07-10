import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RETRIEVER_COLLECTION_SCOPES } from "../llm/retriever";

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
