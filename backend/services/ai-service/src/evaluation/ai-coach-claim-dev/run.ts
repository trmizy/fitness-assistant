import path from "node:path";
import { digest } from "../../knowledge/scientific-claim-map-v3/builder";
import { loadClaimDev, E1_PINS } from "./load";
import { claimDevScenarios, scriptedFake } from "./fixtures";
import { retrieveClaims } from "./retrieval";
import { runClaimSlice } from "./pipeline";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--mock") throw new Error("FAKE_ONLY: use --mock; live providers, embeddings and vector DB are unavailable");
  const { registry, mapHash } = loadClaimDev(path.resolve(__dirname, "../../../../../.."));
  const results: Array<{ id: string } & Awaited<ReturnType<typeof runClaimSlice>>> = [];
  for (const scenario of claimDevScenarios) {
    const retrieve = scenario.id === "G" ? (question: string) => {
      const result = retrieveClaims(registry, question);
      if (result.matches.length) {
        const altered = result.matches[0];
        altered.claim.evidenceReferences[0] = registry.get("C13")!.evidenceReferences[0];
        altered.claimHash = digest(altered.claim); // Even an attacker-rehashed wrong passage fails the pinned binding.
      }
      return result;
    } : undefined;
    const result = await runClaimSlice(scenario.request, registry, scriptedFake(scenario), { restrictTo: "restrictTo" in scenario ? scenario.restrictTo : undefined, retrieve });
    results.push({ id: scenario.id, ...result });
  }
  const targets = claimDevScenarios.flatMap(s => s.targetIds.map(id => ({ scenario: s.id, claimId: id })));
  const supplied = results.flatMap(r => r.context.payload.approvedScientificKnowledge);
  const exactScope = supplied.filter(c => {
    const pinned = registry.get(c.id)!;
    return digest([c.population, c.applicability, c.evidenceLimitations, c.unsupportedInferences]) === digest([pinned.population, pinned.applicability, pinned.evidenceLimitations, pinned.unsupportedInferences]);
  }).length;
  const references = results.flatMap(r => r.context.payload.evidenceProvenance);
  const exactReferences = references.filter(e => registry.get(e.knowledgeClaimId)!.evidenceReferences.some(ref =>
    ref.sourceId === e.sourceId && ref.capturedQuote === e.capturedQuote && ref.sourceSha256 === e.sourceSha256 && ref.locator === e.locator && ref.url === e.url)).length;
  console.log(JSON.stringify({ mode: "FAKE_ONLY", evidence: "TEST FIXTURE", pins: E1_PINS, mapHash,
    metrics: { approvedClaimTargetCoverage: { authority: "IMPLEMENTER_DEV_TARGETS_NOT_INDEPENDENT_RECALL", found: targets.filter(t => results.find(r => r.id === t.scenario)!.context.retrieval.matches.some(m => m.claim.id === t.claimId)).length, expected: targets.length },
      heldC22SuppliedToGeneration: supplied.filter(c => c.id === "C22").length,
      heldC22ExplicitlyExcluded: results.find(r => r.id === "F")!.context.retrieval.excludedIds.includes("C22"),
      provenancePreservation: { exact: exactReferences, supplied: references.length },
      applicabilityPreservation: { exact: exactScope, supplied: supplied.length },
      wrongExcerptControl: { attempts: 1, quarantined: results.find(r => r.id === "G")!.context.issues.length, finalDisposition: results.find(r => r.id === "G")!.release },
      structuredContextCases: results.length, existingV3GateCalls: results.filter(r => r.result).length,
      personalApplicability: "UNKNOWN", independentScientificValidation: false, realModelQuality: "NOT_MEASURED" },
    fakeTransportCalls: results.reduce((n, r) => n + r.generationCalls, 0), modelCalls: 0, embeddingCalls: 0, vectorDbCalls: 0, results }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
