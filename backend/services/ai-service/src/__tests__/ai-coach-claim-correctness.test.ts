import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { createClaimRegistry } from "../knowledge/scientific-claim-map-v3/registry";
import { claimPresentation, textIdentity } from "../knowledge/scientific-claim-map-v3/presentation";
import { CuratedClaimReleaseDraftSchema, prepareCuratedReleaseDraft } from "../knowledge/scientific-claim-map-v3/release";
import { loadConfiguredClaimRegistry } from "../knowledge/scientific-claim-map-v3/load";
import { prepareClaimContext } from "../evaluation/ai-coach-claim-dev/context";
import { buildClaimPrompt, ClaimAnalysisSchema, verifyClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import { claimDevScenarios, scriptedFake } from "../evaluation/ai-coach-claim-dev/fixtures";
import { SETTINGS } from "../evaluation/ai-coach-dev/pipeline";

const fixture = syntheticClaimData(), registry = createClaimRegistry(fixture.input, fixture.map, fixture.pins);
const context = prepareClaimContext(claimDevScenarios[1].request, registry);
const probes = ["Epley sai số 5–10% ở người Việt.", "20 hiệp/tuần luôn tối ưu cho người tập trên 2 năm.", "Cơ ngực bạn đã to thêm 2 cm.", "Bạn tăng sức mạnh thật vì tập đều.", "Chương trình đang hiệu quả.", "e1RM là kết quả đo 1RM trực tiếp."];
function candidate(text: string, field: "claim" | "rationale" | "question") {
  return { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: [{ claimType: "OBSERVATION", text: field === "claim" ? text : "Ghi nhận projection ước tính hiện có.", factIds: ["DEV_F_TRAINING"], evidenceIds: [] }],
    missingInformation: field === "question" ? [{ key: "other", question: text }] : [],
    rationaleSummary: field === "rationale" ? text : "Chưa đủ căn cứ để xác nhận kết quả cá nhân.", proposedAction: null }, claimLinks: [], sourceLinks: [] };
}

for (const text of probes) test("P2-1 unlinked assertion is accounted and never verified: " + text, () => {
  const r = verifyClaimAnalysis(context, candidate(text, "claim"));
  const u = r.support.find(u => u.text === text)!;
  assert.ok(u); assert.equal(u.verifiedSupport, "UNVERIFIED"); assert.equal(u.evidenceIdentity, "NO_EVIDENCE_LINK");
  assert.ok(r.unverifiedClaims.some(u => u.path === "claims.0.text"));
  assert.equal(r.coverage.accountedTextUnits, r.coverage.reviewableTextUnits); assert.equal(r.answerSafetyVerified, false);
});
for (const field of ["rationale", "question"] as const) test("P2-1 substantive assertions are not hidden in " + field, () => {
  const text = "Chương trình đang hiệu quả vì tập đều.";
  const r = verifyClaimAnalysis(context, candidate(text, field));
  assert.ok(r.unverifiedClaims.some(u => u.text === text)); assert.equal(r.verificationDisposition, "REQUIRES_SEMANTIC_REVIEW");
});

test("trusted metric field comparison does not verify unsupported observation prose", () => {
  const raw = ClaimAnalysisSchema.parse(candidate("Chương trình đang hiệu quả.", "claim"));
  raw.analysis.claims[0].metricAssertion = { factId: "DEV_F_TRAINING", measurement: "ESTIMATED_1RM", baselineKg: 60, currentKg: 60.3, changePct: 0.5 };
  const verified = verifyClaimAnalysis(context, raw).support[0];
  assert.equal(verified.structuredVerification.status, "VERIFIED_METRIC_COPY_COMPARISON"); assert.equal(verified.verifiedSupport, "UNVERIFIED");
  raw.analysis.claims[0].metricAssertion.currentKg = 999;
  const contradicted = verifyClaimAnalysis(context, raw);
  assert.equal(contradicted.support[0].structuredVerification.status, "CONTRADICTED"); assert.equal(contradicted.release, "BLOCKED");
});

test("free prose/questions remain reviewable; DEV_REVIEW_ONLY is not an answer safety or scientific pass", () => {
  const r = verifyClaimAnalysis(context, candidate("Chỉ ghi nhận projection ước tính hiện có.", "claim"));
  assert.equal(r.contractValidity, "VALID"); assert.equal(r.release, "DEV_REVIEW_ONLY"); assert.ok(r.candidate);
  assert.ok(r.unverifiedClaims.length); assert.equal(r.scientificPass, null); assert.equal(r.answerSafetyVerified, false);
});

test("canonical owner text is immutable; display projection is reversible and excludes the internal C32 label", () => {
  const c = registry.get("C32a")!, before = c.approvedTextVi, p = claimPresentation(c);
  assert.ok(!p.displayTextVi.startsWith("C32a")); assert.equal(p.representation.prefix + p.displayTextVi, before);
  assert.equal(c.approvedTextVi, before); assert.equal(textIdentity(p.displayTextVi, c), "EXACT_DISPLAY");
  assert.equal(textIdentity(before!, c), "EXACT_CANONICAL");
});

test("display identity is a strong bounded signal; punctuation, introduction and paraphrase are UNKNOWN, not contradicted", async () => {
  const s = claimDevScenarios[2], c = prepareClaimContext(s.request, registry);
  const raw = ClaimAnalysisSchema.parse(await scriptedFake(s).complete({ prompt: buildClaimPrompt(c), settings: SETTINGS }));
  const expected = registry.get("C32a")!.approvedTextVi;
  assert.notEqual(raw.analysis.claims[0].text, expected); assert.equal(verifyClaimAnalysis(c, raw).support[0].textIdentity, "EXACT_DISPLAY");
  for (const text of [raw.analysis.claims[0].text.slice(0, -1), "Theo nguồn, " + raw.analysis.claims[0].text, "Không có một mức volume tối ưu chung cho tất cả người tập."]) {
    const modified = structuredClone(raw); modified.analysis.claims[0].text = text;
    const r = verifyClaimAnalysis(c, modified);
    assert.equal(r.support[0].status, "UNKNOWN_ENTAILMENT"); assert.equal(r.release, "DEV_REVIEW_ONLY");
    assert.ok(r.candidate); assert.equal(r.support[0].verifiedSupport, "UNVERIFIED");
  }
});

test("external configured registry loads with trusted pins and fails closed on missing, changed owner, draft or tampered map", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-claims-test-"));
  const inputBundleFile = path.join(dir, "input.json"), claimMapFile = path.join(dir, "map.json"), currentOwnerDecisionsFile = path.join(dir, "synthetic-owner.json"), file = path.join(dir, "config.json");
  fs.writeFileSync(inputBundleFile, JSON.stringify(fixture.input)); fs.writeFileSync(claimMapFile, JSON.stringify(fixture.map)); fs.writeFileSync(currentOwnerDecisionsFile, fixture.input.files.owner.text);
  fs.writeFileSync(file, JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile, claimMapFile, currentOwnerDecisionsFile, trustedPins: fixture.pins }));
  assert.ok(loadConfiguredClaimRegistry(file).registry.get("C21"));
  fs.writeFileSync(currentOwnerDecisionsFile, "changed synthetic owner"); assert.throws(() => loadConfiguredClaimRegistry(file), /StaleOwnerDecisionsPin/);
  fs.writeFileSync(currentOwnerDecisionsFile, fixture.input.files.owner.text);
  fs.writeFileSync(claimMapFile, JSON.stringify(prepareCuratedReleaseDraft(fixture.input, fixture.map))); assert.throws(() => loadConfiguredClaimRegistry(file));
  fs.unlinkSync(inputBundleFile); assert.throws(() => loadConfiguredClaimRegistry(file), /ENOENT/);
  assert.throws(() => loadConfiguredClaimRegistry("not-configured.json"), /AbsoluteRegistryConfigRequired/);
});

test("release draft exports a strict field allowlist, not owner history/notes, and never grants runtime admission", () => {
  const draft = prepareCuratedReleaseDraft(fixture.input, fixture.map), json = JSON.stringify(draft);
  assert.equal(draft.status, "DRAFT_PENDING_OWNER_RELEASE_APPROVAL"); assert.ok(!draft.claims.some(c => c.id === "C22"));
  assert.ok(!json.includes("SYNTHETIC_TEST_DECISION_NOT_OWNER_HISTORY"));
  for (const key of ["ownerDecision", "aiProposal", "history", "acceptedRevisionVi", "ownerRecordSha256", "note"]) assert.ok(!json.includes('"' + key + '"'));
  assert.throws(() => CuratedClaimReleaseDraftSchema.parse({ ...draft, ownerDecision: {} }));
  const tampered = structuredClone(draft); tampered.claims[0].displayTextVi += "changed"; assert.throws(() => CuratedClaimReleaseDraftSchema.parse(tampered));
});
