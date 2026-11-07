/**
 * Dispute Case slice 2 / S2.3 - the provenance of gym check-ins (owner decision 30/10): never SERVER_OBSERVED, and the admin label says the check-in does not
 * prove the PT session took place. Pure logic (no database): runs in both modes of npm test.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { provenanceLabelVi, PROVENANCE_LABEL_VI } from "../services/dispute-case/rules";

test("the two QR provenances exist in the schema and carry the explicit 'does not prove the teaching session' sentence", () => {
  for (const p of ["SELF_REPORTED_SERVER_RECORDED", "STAFF_ATTESTED_SERVER_RECORDED"]) {
    assert.match(provenanceLabelVi(p), /check-in gym không chứng minh buổi dạy PT đã diễn ra/i, p);
    assert.notEqual(provenanceLabelVi(p), provenanceLabelVi("SERVER_OBSERVED"));
  }
  assert.match(provenanceLabelVi("STAFF_ATTESTED_SERVER_RECORDED"), /Nhân viên/);
  assert.match(provenanceLabelVi("SELF_REPORTED_SERVER_RECORDED"), /tự quét/);
});

test("every provenance the Prisma enum knows has a label, and an unknown value falls back to itself (never to 'observed')", async () => {
  const { DisputeCaseProvenance } = await import("../generated/prisma");
  const values = Object.values(DisputeCaseProvenance) as string[];
  assert.ok(values.includes("SELF_REPORTED_SERVER_RECORDED") && values.includes("STAFF_ATTESTED_SERVER_RECORDED"), "the additive migration's values are in the generated client");
  for (const v of values) assert.ok(PROVENANCE_LABEL_VI[v], `label for ${v}`);
  assert.equal(provenanceLabelVi("SOMETHING_NEW"), "SOMETHING_NEW");
});
