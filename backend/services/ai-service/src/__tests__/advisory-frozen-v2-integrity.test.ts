import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { FrozenV2PinSchema, loadFrozenV2, verifyFrozenV2Buffers, reviewFrozenV2Content } from "../evaluation/advisory-progress/frozen-v2-integrity";
import { readDev, repoRoot } from "./advisory-content-v3.fixtures";

const pin = FrozenV2PinSchema.parse(readDev("reviews/frozen-v2-integrity.json"));
const dir = process.env.ADVISORY_V2_ARTIFACT_DIR;
const optionalRuntime = { skip: dir ? false : "ARTIFACT_UNAVAILABLE: set ADVISORY_V2_ARTIFACT_DIR to the preserved local V2 run" };

test("V2 frozen pin records 24 historical candidates and the original results digest, not a quality score", () => {
  assert.equal(pin.rows.length, 24); assert.equal(new Set(pin.rows.map((r) => `${r.id}:${r.variant}`)).size, 24);
  assert.equal(pin.files.find((f) => f.name === "results.jsonl")!.sha256, "4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a");
  assert.ok(pin.rows.every((r) => r.contractPass));
});
test("V2 missing runtime artifacts report ARTIFACT_UNAVAILABLE with no fabricated rows", () => {
  const missing = path.join(repoRoot, "artifacts/nonexistent-content-v3-fixture");
  const loaded = loadFrozenV2(repoRoot, missing);
  assert.equal(loaded.integrity.status, "ARTIFACT_UNAVAILABLE"); assert.equal(loaded.data, null);
  const reviewed = reviewFrozenV2Content(repoRoot, missing);
  assert.equal(reviewed.integrity.status, "ARTIFACT_UNAVAILABLE"); assert.equal(reviewed.rows.length, 0);
});
test("V2 invalid integrity metadata never produces an integrity success", () => {
  assert.equal(verifyFrozenV2Buffers({}, { files: {}, code: {}, pack: Buffer.from("") }).status, "INTEGRITY_MISMATCH");
});
test("V2 REAL LOCAL ARTIFACT BYTES: results/requests/source/code/candidates/history still match", optionalRuntime, () => {
  const loaded = loadFrozenV2(repoRoot, dir);
  assert.equal(loaded.integrity.status, "INTEGRITY_CONFIRMED", JSON.stringify(loaded.integrity));
  assert.equal(loaded.integrity.modelCalls, 0);
});
test("V2 fixture tampering of artifact/source/code is detected without modifying actual files", optionalRuntime, () => {
  const loaded = loadFrozenV2(repoRoot, dir);
  assert.equal(loaded.integrity.status, "INTEGRITY_CONFIRMED"); const data = loaded.data!;
  for (const name of Object.keys(data.files)) {
    const mutated = { ...data, files: { ...data.files, [name]: Buffer.concat([data.files[name], Buffer.from(" ")]) } };
    assert.equal(verifyFrozenV2Buffers(pin, mutated).status, "INTEGRITY_MISMATCH", name);
  }
  assert.equal(verifyFrozenV2Buffers(pin, { ...data, pack: Buffer.concat([data.pack, Buffer.from(" ")]) }).status, "INTEGRITY_MISMATCH");
  assert.equal(verifyFrozenV2Buffers(pin, { ...data, code: { ...data.code, "guarded.ts": Buffer.from("altered") } }).status, "INTEGRITY_MISMATCH");
  assert.equal(loadFrozenV2(repoRoot, dir).integrity.status, "INTEGRITY_CONFIRMED");
});
test("V2 frozen retrospective: known advice is BLOCKED while historical contractPass remains true", optionalRuntime, () => {
  const review = reviewFrozenV2Content(repoRoot, dir);
  assert.equal(review.integrity.status, "INTEGRITY_CONFIRMED"); assert.equal(review.rows.length, 24);
  const row = review.rows.find((r) => r.id === "no-external-evidence" && r.variant === "D")!;
  assert.equal(row.originalContractPass, true); assert.equal(row.contentGate, "BLOCKED");
  assert.ok(!("contentPass" in row)); assert.equal(review.modelCalls, 0);
});
