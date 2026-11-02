import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimMap, digest, matchQuote, sha256, validateClaimMap, verifyInputBundle } from "../knowledge/scientific-claim-map-v3/builder";
import { createClaimRegistry } from "../knowledge/scientific-claim-map-v3/registry";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { InputBundle } from "../knowledge/scientific-claim-map-v3/schema";

const fixture = syntheticClaimData();
const input: InputBundle = fixture.input;
const pins = (b: InputBundle) => ({ inputBundleSha256: digest(b), ownerDecisionsSha256: b.files.owner.sha256 });
function edit(b: InputBundle, id: string, change: (data: any) => void): void {
  const data = JSON.parse(b.files[id].text); change(data);
  b.files[id].text = JSON.stringify(data); b.files[id].sha256 = sha256(b.files[id].text);
}

test("E1 pinned output is reproducible: 33 owner decisions become 35 atomic rows, one evidence hold", () => {
  const m = buildClaimMap(input);
  validateClaimMap(input, fixture.map);
  assert.deepEqual(m.counts, { total: 35, admitted: 34, heldEvidence: 1, pendingOwner: 0, rejected: 0 });
  assert.equal(m.independentScientificValidation, false);
  for (const c of m.claims.filter(c => c.admission === "ADMITTED_DEV_OFFLINE")) {
    assert.equal(c.approval, "OWNER_ACCEPTED"); assert.ok(c.evidenceReferences.length);
    assert.ok(c.evidenceReferences.every(e => e.capturedQuote && e.textMatch !== "NOT_FOUND"));
    assert.ok(c.applicability.length && c.evidenceLimitations.length && c.unsupportedInferences.length);
  }
});

test("C21 uses the owner's own revision, preserves follow-up scope and separates AI observations", () => {
  const m = buildClaimMap(input), c = m.claims.find(c => c.id === "C21")!;
  const d = JSON.parse(input.files.owner.text).decisions.C21;
  assert.equal(c.approvedTextVi, d.acceptedRevisionVi);
  assert.notEqual(c.approvedTextVi, (c.aiProposal.followup as any).aiRevisionVi);
  assert.deepEqual(c.ownerDecision, d);
  assert.ok(c.evidenceReferences.some(e => e.sourceId === "SYNTH_C21"));
  assert.ok(c.evidenceLimitations.some(l => l.includes("không phải kết quả systematic search")));
  assert.ok(c.unsupportedInferences.some(l => l.includes("Người Việt cần công thức khác")));
});

test("C32 segments exactly reconstruct the approved parent; revised sources replace old narrative evidence", () => {
  const m = buildClaimMap(input), parts = m.claims.filter(c => c.parentDecisionId === "C32");
  assert.deepEqual(parts.map(p => p.id), ["C32a", "C32b", "C32c"]);
  const parent = JSON.parse(input.files.owner.text).decisions.C32.acceptedRevisionVi;
  assert.equal(parts.map(p => p.approvedTextVi).join("\n"), parent);
  for (const p of parts) {
    assert.equal(parent.slice(p.provenance.segment!.start, p.provenance.segment!.end), p.approvedTextVi);
    assert.ok(!p.evidenceReferences.some(e => e.sourceId === "PMID_42099260"));
    assert.ok(p.scopeProvenance.supersededScope);
    assert.ok(!p.evidenceLimitations.some(l => l.startsWith("Narrative review;")));
  }
  assert.ok(parts[1].applicability.some(l => l.includes("toàn bộ repetition")));
});

test("AI APPROVE cannot admit rejected, undecided or evidence-pending owner claims", () => {
  for (const decision of ["REJECT", "NEED_MORE_EVIDENCE", "UNKNOWN"]) {
    const b = structuredClone(input); edit(b, "owner", d => { d.decisions.C02.decision = decision; });
    const m = buildClaimMap(b), registry = createClaimRegistry(b, m, pins(b));
    assert.equal(registry.get("C02"), null);
    assert.throws(() => registry.resolveForGrounding(["C02"]), /ClaimNotAdmitted:C02/);
  }
  const b = structuredClone(input); edit(b, "owner", d => { delete d.decisions.C02; });
  assert.equal(buildClaimMap(b).claims.find(c => c.id === "C02")!.approval, "NOT_DECIDED");
});

test("REVISE without accepted owner text cannot fall back to original text or the AI proposal", () => {
  for (const text of [null, "", " \n "]) {
    const b = structuredClone(input); edit(b, "owner", d => { d.decisions.C21.acceptedRevisionVi = text; });
    const c = buildClaimMap(b).claims.find(c => c.id === "C21")!;
    assert.equal(c.approvedTextVi, null); assert.equal(c.admission, "PENDING_OWNER");
  }
});

test("C22 is owner-accepted but held: no invented excerpt or automatic inference-chain approval", () => {
  const m = buildClaimMap(input), registry = createClaimRegistry(input, m, pins(input));
  const c = m.claims.find(c => c.id === "C22")!;
  assert.equal(c.approval, "OWNER_ACCEPTED"); assert.equal(c.admission, "HELD_EVIDENCE");
  assert.equal(registry.get("C22"), null); assert.ok(c.admissionReasons.includes("NO_SUPPORTING_EXCERPT"));
});

test("a missing excerpt, unknown source or unmatched quote cannot enter the registry", () => {
  for (const mode of ["empty", "wrong-quote", "unknown-source"]) {
    const b = structuredClone(input); edit(b, "bindings", d => {
      if (mode === "empty") d.claims.C02.excerpts = [];
      else if (mode === "wrong-quote") d.claims.C02.excerpts[0].quote = "There is no individual variation whatsoever.";
      else d.claims.C02.excerpts[0].sourceId = "INVENTED";
    });
    if (mode === "unknown-source") { assert.throws(() => buildClaimMap(b), /UnknownSupportingSource:C02:INVENTED/); continue; }
    const m = buildClaimMap(b); assert.equal(createClaimRegistry(b, m, pins(b)).get("C02"), null);
  }
});

test("scientific claims cannot use code-only references; product policy remains distinctly typed", () => {
  const b = structuredClone(input); edit(b, "bindings", d => { d.claims.C02.excerpts = d.claims.C23.excerpts; });
  const m = buildClaimMap(b);
  assert.ok(m.claims.find(c => c.id === "C02")!.admissionReasons.includes("NO_PRIMARY_SCIENTIFIC_EXCERPT"));
  const registry = createClaimRegistry(b, m, pins(b));
  assert.equal(registry.get("C23")!.kind, "PRODUCT_POLICY");
  assert.ok(!registry.listForRag().some(c => ["C20", "C23", "C24", "C18"].includes(c.id)));
});

test("captured input bytes and individual source text hashes fail explicitly", () => {
  const b = structuredClone(input); b.files.sources.text += " ";
  assert.throws(() => verifyInputBundle(b), /SourceHashMismatch:sources/);
  const c = structuredClone(input); edit(c, "sources", d => { d.records[0].bodyText += " changed"; });
  assert.throws(() => buildClaimMap(c), /SourceHashMismatch:SYNTH_/);
});

test("owner's recorded source hash is checked even when an edited review is rehashed", () => {
  const b = structuredClone(input); edit(b, "review", d => { d.claims[0].textVi += "changed"; });
  assert.throws(() => buildClaimMap(b), /OwnerSourceHashMismatch:C01:reviewJson/);
});

test("tampering approvedTextVi, applicability, limitations, citations or AI/owner authority fails output validation", () => {
  const original = buildClaimMap(input);
  for (const field of ["approvedTextVi", "applicability", "evidenceLimitations", "sourceHashes", "ownerDecision", "aiProposal"]) {
    const m = structuredClone(original), c = m.claims.find(c => c.id === "C06")!;
    if (field === "approvedTextVi") c.approvedTextVi += " AI rewrite";
    else if (field === "applicability") c.applicability = [];
    else if (field === "evidenceLimitations") c.evidenceLimitations = [];
    else if (field === "sourceHashes") c.sourceHashes.SYNTH_C06 = "0".repeat(64);
    else if (field === "ownerDecision") c.ownerDecision = { decision: "APPROVE", via: "AI" };
    else c.aiProposal = { ownerApproved: true };
    assert.throws(() => validateClaimMap(input, m), field === "sourceHashes" ? /SourceHashMismatch:C06:SYNTH_C06/ : /ClaimMapMismatch/);
  }
});

test("registry requires caller-owned bundle and current owner pins and returns isolated full records", () => {
  const m = buildClaimMap(input);
  assert.throws(() => createClaimRegistry(input, m, { ...pins(input), ownerDecisionsSha256: "0".repeat(64) }), /StaleOwnerDecisionsPin/);
  assert.throws(() => createClaimRegistry(input, m, { ...pins(input), inputBundleSha256: "0".repeat(64) }), /UntrustedInputBundlePin/);
  const registry = createClaimRegistry(input, m, pins(input)), c = registry.get("C07")!;
  assert.ok(c.applicability.some(l => l.includes("≥ 6 tuần")));
  c.applicability.length = 0; assert.ok(registry.get("C07")!.applicability.length);
});

test("article decisions never confer claim approval; A13 remains unresolved without A13-1/2/3 claims", () => {
  const m = buildClaimMap(input);
  assert.equal(m.articleDecisions.length, 17);
  assert.equal(m.articleDecisions.find(d => d.itemId === "A13")!.decision, "REVISE_OR_VERIFY_ORIGINAL");
  assert.ok(m.articleDecisions.every(d => d.claimApprovalConferred === false));
  assert.ok(!m.claims.some(c => c.id.startsWith("A13")));
  const b = structuredClone(input); edit(b, "owner", d => { d.decisions.A13.decision = "APPROVE"; });
  assert.ok(!buildClaimMap(b).claims.some(c => c.id.startsWith("A13")));
});

test("CAL02 REVISE and CAL03 ACCEPT remain exact owner decisions, not inferred independent gold", () => {
  const m = buildClaimMap(input), cal2 = m.calibrationDecisions.find(d => d.itemId === "CAL02")!, cal3 = m.calibrationDecisions.find(d => d.itemId === "CAL03")!;
  assert.equal(cal2.decision, "REVISE"); assert.equal(cal2.acceptedRevisionVi, null);
  assert.equal(cal3.decision, "ACCEPT"); assert.equal(cal3.ownerAssessment, null);
  assert.equal(cal3.inferredAssessment, null); assert.equal(cal3.useAsIndependentGold, false);
});

test("quote matching preserves exact captured text and does not forgive changed numbers", () => {
  const match = matchQuote("near–failure  2–3 RIR", "near-failure 2-3 RIR");
  assert.equal(match.textMatch, "NORMALIZED_TYPOGRAPHY_WHITESPACE_CASE");
  assert.equal(match.capturedQuote, "near–failure  2–3 RIR");
  assert.equal(matchQuote("2–3 RIR", "0-2 RIR").textMatch, "NOT_FOUND");
});
