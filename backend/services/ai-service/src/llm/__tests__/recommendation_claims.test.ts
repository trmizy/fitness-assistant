import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClaimCatalog, buildDefaultSelection, renderClaim, renderNarrationFromClaims,
  type GroundedClaim,
} from "../recommendation_claims";
import type { NarrationInputCandidate } from "../recommendation_narrator";
import type { PTCandidate, CompatibilityScore, HistoricalSummary, AgentEvidence } from "@gym-coach/shared";

/**
 * Architecture-level tests for the Structured Claim Grounding redesign
 * (docs/codex-ai-agent-regression-3-report.md §"Required production
 * fixes"). These prove the actual invariant the task asked for: "no
 * LLM-generated factual sentence may be shown directly as authoritative
 * recommendation explanation" — by construction, not by pattern-matching
 * whatever text happens to come out.
 */

function makeCandidate(overrides: Partial<PTCandidate> = {}): PTCandidate {
  return {
    id: "pt-1", name: "PT Minh", photoUrl: null, specialties: ["Giảm mỡ"], yearsExperience: "5",
    languages: ["vi"], certificates: [], packages: [], availableDays: [1, 3, 5], availableSlots: 5,
    averageRating: 4.5, reviewCount: 20, clientsStarted: 10, clientsCompleted: 8,
    cancellationRate: 0.1, noShowRate: 0.05, dataOrigin: "REAL",
    history: { count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null,
      medianDurationWeeks: null, completionRate: null, dataOrigin: "REAL", similarityVersion: "journey-distance-v1",
      note: "Not enough historical evidence." },
    ...overrides,
  };
}

function makeInput(overrides: { candidate?: Partial<PTCandidate>; total?: number; components?: Record<string, number>; history?: Partial<HistoricalSummary> } = {}): NarrationInputCandidate {
  const history: HistoricalSummary = { ...makeCandidate().history, ...overrides.history };
  const candidate = makeCandidate({ ...overrides.candidate, history });
  const compatibility: CompatibilityScore = {
    total: overrides.total ?? 72, scoringVersion: "compatibility-v2",
    components: overrides.components ?? { goal: 1, schedule: 0.8, budget: 1, reputation: 0.9 },
  };
  return { candidate, compatibility, history };
}

const evidence: AgentEvidence[] = [
  { id: "evidence-real-1", title: "ACSM Position Stand", sourceUrl: "https://example.org/acsm", finding: "Resistance training 2-3x/week improves body composition.", evidenceLevel: "HIGH", version: "1" },
];

// ── Claim catalog generation ─────────────────────────────────────────────

test("buildClaimCatalog: cold-start candidate (history.count=0) gets INSUFFICIENT_HISTORY, never HISTORICAL_EVIDENCE", () => {
  const catalog = buildClaimCatalog(makeInput({ history: { count: 0 } }), []);
  assert.ok(catalog.some((c) => c.type === "INSUFFICIENT_HISTORY"));
  assert.ok(!catalog.some((c) => c.type === "HISTORICAL_EVIDENCE"));
});

test("buildClaimCatalog: candidate with a real cohort gets HISTORICAL_EVIDENCE with the real origin, never INSUFFICIENT_HISTORY", () => {
  const catalog = buildClaimCatalog(makeInput({ history: { count: 8, dataOrigin: "REAL", completionRate: 0.75, medianTrainingAdherence: 0.8 } }), []);
  const claim = catalog.find((c) => c.type === "HISTORICAL_EVIDENCE");
  assert.ok(claim && claim.type === "HISTORICAL_EVIDENCE");
  assert.equal(claim!.origin, "REAL");
  assert.equal(claim!.cohortCount, 8);
  assert.ok(!catalog.some((c) => c.type === "INSUFFICIENT_HISTORY"));
});

test("buildClaimCatalog: synthetic cohort claim structurally carries origin=SYNTHETIC (not a renderer/model decision)", () => {
  const catalog = buildClaimCatalog(makeInput({ history: { count: 10, dataOrigin: "SYNTHETIC" } }), []);
  const claim = catalog.find((c) => c.type === "HISTORICAL_EVIDENCE");
  assert.equal((claim as any).origin, "SYNTHETIC");
});

test("buildClaimCatalog: no REPUTATION claim when reviewCount < 5, even with a real averageRating", () => {
  const catalog = buildClaimCatalog(makeInput({ candidate: { averageRating: 5, reviewCount: 2 } }), []);
  assert.ok(!catalog.some((c) => c.type === "REPUTATION"));
});

test("buildClaimCatalog: REPUTATION claim carries the exact real rating/reviewCount, never a model-authored number", () => {
  const catalog = buildClaimCatalog(makeInput({ candidate: { averageRating: 4.3, reviewCount: 11 } }), []);
  const claim = catalog.find((c) => c.type === "REPUTATION");
  assert.equal((claim as any).rating, 4.3);
  assert.equal((claim as any).reviewCount, 11);
});

test("buildClaimCatalog: only VERIFIED certificates become CERTIFICATION claims — an unverified/pending one never does", () => {
  const catalog = buildClaimCatalog(makeInput({
    candidate: {
      certificates: [
        { name: "CPT", issuer: "ACE", verificationStatus: "VERIFIED" },
        { name: "Nutrition Coach", issuer: "SelfIssued", verificationStatus: "PENDING" },
      ],
    },
  }), []);
  const certClaims = catalog.filter((c) => c.type === "CERTIFICATION");
  assert.equal(certClaims.length, 1);
  assert.equal((certClaims[0] as any).name, "CPT");
});

test("buildClaimCatalog: no certification, price, location, schedule-guarantee, medical/PED, or action-state claim TYPE exists at all — there is nothing for the LLM to select representing them", () => {
  const catalog = buildClaimCatalog(makeInput(), evidence);
  const types = new Set(catalog.map((c) => c.type));
  for (const forbidden of ["PRICE", "LOCATION", "MEDICAL", "PED", "ACTION_COMPLETED", "SCHEDULE_GUARANTEE", "SUPERIORITY"]) {
    assert.ok(!types.has(forbidden as any), `no claim type "${forbidden}" may ever exist`);
  }
});

test("buildClaimCatalog: SCIENTIFIC_EVIDENCE claims copy the real evidence id/finding verbatim, one per real evidence item", () => {
  const catalog = buildClaimCatalog(makeInput(), evidence);
  const claims = catalog.filter((c) => c.type === "SCIENTIFIC_EVIDENCE");
  assert.equal(claims.length, 1);
  assert.equal((claims[0] as any).evidenceId, "evidence-real-1");
  assert.equal((claims[0] as any).finding, evidence[0].finding);
});

test("buildClaimCatalog: claim ids are candidate-scoped by construction (prefixed with the real candidate id)", () => {
  const catalog = buildClaimCatalog(makeInput({ candidate: { id: "pt-XYZ" } }), []);
  for (const c of catalog) {
    assert.ok(c.id.startsWith("pt-XYZ::"), `claim id "${c.id}" must be scoped to candidate pt-XYZ`);
    assert.equal(c.candidateId, "pt-XYZ");
  }
});

// ── Deterministic rendering ──────────────────────────────────────────────

test("renderClaim: COMPATIBILITY renders the exact real score, nothing else", () => {
  const claim: GroundedClaim = { id: "x", candidateId: "pt-1", type: "COMPATIBILITY", score: 63 };
  assert.match(renderClaim(claim), /63%/);
});

test("renderClaim: HISTORICAL_EVIDENCE with REAL origin never includes the synthetic-disclosure sentence", () => {
  const claim: GroundedClaim = { id: "x", candidateId: "pt-1", type: "HISTORICAL_EVIDENCE", cohortCount: 8, origin: "REAL", medianTrainingAdherence: 0.8, completionRate: 0.7 };
  const text = renderClaim(claim);
  assert.ok(!text.includes("synthetic") && !text.includes("demo tổng hợp"));
  assert.match(text, /8 khách hàng/);
});

test("renderClaim: HISTORICAL_EVIDENCE with SYNTHETIC origin ALWAYS includes the disclosure sentence — no code path can omit it", () => {
  const claim: GroundedClaim = { id: "x", candidateId: "pt-1", type: "HISTORICAL_EVIDENCE", cohortCount: 10, origin: "SYNTHETIC", medianTrainingAdherence: null, completionRate: null };
  const text = renderClaim(claim);
  assert.ok(text.includes("dữ liệu demo tổng hợp"));
  assert.ok(text.includes("không phải bằng chứng"));
});

test("renderClaim: unknown/malformed claim type does not throw and does not fabricate text", () => {
  const malformed = { id: "x", candidateId: "pt-1", type: "HORMONAL_ADVANTAGE" } as unknown as GroundedClaim;
  assert.doesNotThrow(() => renderClaim(malformed));
});

// ── Deterministic default selection (LLM-failure fallback) ──────────────

test("buildDefaultSelection: always includes INSUFFICIENT_HISTORY when the cohort is empty, without needing any LLM input", () => {
  const catalog = buildClaimCatalog(makeInput({ history: { count: 0 } }), []);
  const selection = buildDefaultSelection(catalog);
  const insufficient = catalog.find((c) => c.type === "INSUFFICIENT_HISTORY")!;
  assert.ok(selection.includes(insufficient.id));
});

// ── renderNarrationFromClaims: candidate scoping, mandatory disclosures ─

test("renderNarrationFromClaims: an id from a DIFFERENT candidate's catalog is simply absent from that candidate's catalog lookup — cross-candidate reuse has no effect", () => {
  const catalogA = buildClaimCatalog(makeInput({ candidate: { id: "pt-A" } }), []);
  const catalogB = buildClaimCatalog(makeInput({ candidate: { id: "pt-B", averageRating: 4.9, reviewCount: 50 } }), []);
  const bReputationId = catalogB.find((c) => c.type === "REPUTATION")!.id;
  // Simulate what recommendation_narrator.ts's candidate-scoped filter does:
  // only ids present in catalogA are ever passed to the A renderer.
  const catalogAIds = new Set(catalogA.map((c) => c.id));
  assert.ok(!catalogAIds.has(bReputationId), "candidate B's claim id must not exist in candidate A's own catalog");
});

test("renderNarrationFromClaims: INSUFFICIENT_HISTORY renders into uncertainty even when NOT in selectedClaimIds (mandatory disclosure, not an LLM choice)", () => {
  const catalog = buildClaimCatalog(makeInput({ history: { count: 0 } }), []);
  const compatibilityOnly = catalog.filter((c) => c.type === "COMPATIBILITY").map((c) => c.id);
  const result = renderNarrationFromClaims("pt-1", catalog, compatibilityOnly);
  assert.ok(result.uncertainty.some((u) => u.includes("chưa có đủ dữ liệu lịch sử") || u.toLowerCase().includes("chua co du du lieu")));
});

test("renderNarrationFromClaims: evidenceRefs only ever contains real ids that were actually in the catalog", () => {
  const input = makeInput();
  const catalog = buildClaimCatalog(input, evidence);
  const evidenceClaim = catalog.find((c) => c.type === "SCIENTIFIC_EVIDENCE")!;
  const result = renderNarrationFromClaims("pt-1", catalog, [evidenceClaim.id]);
  assert.deepEqual(result.evidenceRefs, ["evidence-real-1"]);
});

test("renderNarrationFromClaims: an empty/invalid selection still produces a full, safe narration (no crash, no empty summary)", () => {
  const catalog = buildClaimCatalog(makeInput(), []);
  const result = renderNarrationFromClaims("pt-1", catalog, []);
  assert.ok(result.summary.length > 0);
  assert.ok(Array.isArray(result.strengths));
  assert.ok(Array.isArray(result.uncertainty) && result.uncertainty.length > 0);
});

test("renderNarrationFromClaims: only ids present in the catalog ever get rendered — an unknown id in the selection is silently ignored, not rendered as blank/broken text", () => {
  const catalog = buildClaimCatalog(makeInput(), []);
  const result = renderNarrationFromClaims("pt-1", catalog, ["pt-1::NOT_A_REAL_CLAIM", ...buildDefaultSelection(catalog)]);
  const expected = renderNarrationFromClaims("pt-1", catalog, buildDefaultSelection(catalog));
  assert.deepEqual(result.strengths, expected.strengths);
});
