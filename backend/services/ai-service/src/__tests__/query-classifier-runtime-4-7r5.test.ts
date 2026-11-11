import { test } from "node:test";
import assert from "node:assert/strict";
import { foldQuery, tfidfFeatures, validateArtifact, scoreRouter, loadRouter, bucketOf, type LoadedRouter, type RouterArtifact } from "../llm/query-classifiers/classifier-runtime";

const tfidfArtifact = (over: Partial<RouterArtifact> = {}): RouterArtifact => ({
  version: "test-v1", task: "personal-safety-router", featureType: "tfidf", classes: { positive: "SAFETY_HANDLING_REQUIRED", negative: "NORMAL_QUERY" },
  dimensions: 2, bias: -1, weights: [4, -4], calibration: { type: "platt", a: 1, c: 0 }, threshold: 0.5, datasetHash: "d", splitManifestHash: "s", trainConfigHash: "t",
  vocab: { "w:tim": 0, "w:nhanh": 1 }, idf: [1, 1], ...over,
});
const loaded = (a: RouterArtifact): LoadedRouter => ({ artifact: a, fileHash: "x", needsEmbedding: a.featureType === "embedding" });

test("4.7R5 runtime: accented and unaccented typing fold to identical features", () => {
  assert.equal(foldQuery("Tim đập loạn, chóng mặt!"), foldQuery("tim dap loan chong mat"));
  assert.deepEqual([...tfidfFeatures("Chóng mặt", null).keys()], [...tfidfFeatures("chong mat", null).keys()]);
});

test("4.7R5 runtime: artifact validation rejects wrong task, bad threshold, dimension mismatch", () => {
  assert.ok(validateArtifact(tfidfArtifact(), "personal-safety-router"));
  assert.ok(!validateArtifact(tfidfArtifact(), "programming-domain-router"));
  assert.ok(!validateArtifact(tfidfArtifact({ threshold: 1.2 }), "personal-safety-router"));
  assert.ok(!validateArtifact(tfidfArtifact({ dimensions: 5 }), "personal-safety-router"));
  assert.ok(!validateArtifact({ nope: true }, "personal-safety-router"));
});

test("4.7R5 runtime: tf-idf scoring is deterministic, calibrated and thresholded", () => {
  const r = loaded(tfidfArtifact());
  const s1 = scoreRouter(r, "tim", null)!;
  const s2 = scoreRouter(r, "tim", null)!;
  assert.equal(s1.probability, s2.probability);
  assert.ok(s1.probability > 0 && s1.probability < 1);
  assert.equal(s1.positive, s1.probability >= 0.5);
  assert.equal(scoreRouter(r, "zzz qqq", null)!.positive, false);
});

test("4.7R5 runtime: embedding artifact with a missing / wrong-sized embedding returns null (caller falls back)", () => {
  const a = tfidfArtifact({ featureType: "embedding", embeddingModel: "nomic-embed-text", vocab: undefined, idf: undefined, dimensions: 3, weights: [1, 0, 0] });
  const r = loaded(a);
  assert.equal(scoreRouter(r, "x", null), null);
  assert.equal(scoreRouter(r, "x", [1, 2]), null);
  assert.ok(scoreRouter(r, "x", [1, 0, 0]) !== null);
});

test("4.7R5 runtime: missing artifact file loads as null (no throw)", () => {
  assert.equal(loadRouter("personal-safety-router", "does-not-exist.json"), null);
});

test("4.7R5 runtime: score buckets are coarse and never expose the raw probability", () => {
  assert.equal(bucketOf(0.02), "very_low");
  assert.equal(bucketOf(0.5), "mid");
  assert.equal(bucketOf(0.97), "very_high");
});
