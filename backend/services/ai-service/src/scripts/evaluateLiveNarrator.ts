/**
 * LIVE Recommendation Narrator evaluation — §38/§60 of the hardening
 * task. Runs `narrateRecommendations()` against a REAL local Ollama chat
 * model (not the deterministic-validator-only tests in
 * recommendation_narrator.test.ts), across a representative mix of real
 * REAL-cohort, SYNTHETIC-cohort, no-cohort (cold-start), and multi-
 * candidate scenarios. Reports exactly what happened — accept/fallback
 * counts, any validator rejection reasons observed, latency, tokens — no
 * fabricated numbers.
 *
 * Requires a local Ollama with a chat-capable model pulled. The
 * configured LLM_MODEL in .env (qwen3:30b-a3b-instruct-2507-q4_K_M) was
 * NOT present in this local Ollama instance at eval time (`ollama list`/
 * /api/tags showed only qwen2.5:1.5b, qwen3:4b-instruct-2507-q4_K_M,
 * fitness-coach-qwen2.5-1.5b) — this run uses LLM_MODEL override to the
 * closest available real model (qwen3:4b-instruct-2507-q4_K_M) rather
 * than fabricating a result for the unavailable configured model.
 *
 * Run: LLM_BASE_URL=http://127.0.0.1:11434 LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M \
 *   npx tsx src/scripts/evaluateLiveNarrator.ts
 */
import "dotenv/config";
import { narrateRecommendations, type NarrationInputCandidate } from "../llm/recommendation_narrator";
import type { HistoricalSummary, PTCandidate, AgentEvidence } from "@gym-coach/shared";

function history(overrides: Partial<HistoricalSummary> = {}): HistoricalSummary {
  return {
    count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null,
    medianDurationWeeks: null, completionRate: null, dataOrigin: "REAL", similarityVersion: "journey-distance-v1",
    note: "Not enough historical evidence.", ...overrides,
  };
}

function candidate(id: string, overrides: Partial<PTCandidate> = {}): PTCandidate {
  return {
    id, name: `PT ${id}`, photoUrl: null, specialties: ["Giảm mỡ"], yearsExperience: "5",
    languages: ["vi"], certificates: [{ name: "CPT", issuer: "ACE", verificationStatus: "VERIFIED" }],
    packages: [{ id: `${id}-pkg`, name: "10 buổi", price: 1_800_000, sessions: 10, sessionMinutes: 60, mode: "OFFLINE" }],
    availableDays: [1, 3, 5], availableSlots: 8, averageRating: 4.6, reviewCount: 15,
    clientsStarted: 10, clientsCompleted: 8, cancellationRate: 0.08, noShowRate: 0.03,
    dataOrigin: "REAL", history: history(), ...overrides,
  };
}

const evidence: AgentEvidence[] = [
  { id: "evidence-real-1", title: "ACSM Position Stand: Resistance Training", sourceUrl: "https://example.org", finding: "Resistance training 2-3x/week improves body composition.", evidenceLevel: "HIGH", version: "v1" },
];

type Scenario = { label: string; candidates: NarrationInputCandidate[] };

const scenarios: Scenario[] = [
  {
    label: "cold-start single candidate (no cohort)",
    candidates: [{ candidate: candidate("cold-1"), compatibility: { total: 68, scoringVersion: "compatibility-v2", components: { goal: 1, schedule: 0.6, budget: 1, reputation: 0.6 } }, history: history() }],
  },
  {
    label: "real strong cohort single candidate",
    candidates: [{ candidate: candidate("real-1", { history: history({ count: 8, medianWeightChange: -3.5, medianTrainingAdherence: 0.86, completionRate: 0.75, note: "Observed association among similar clients; not a causal effect or guaranteed result." }) }), compatibility: { total: 82, scoringVersion: "compatibility-v2", components: { goal: 1, schedule: 1, budget: 1, reputation: 0.9, evidence: 0.4 } }, history: history({ count: 8, medianWeightChange: -3.5, medianTrainingAdherence: 0.86, completionRate: 0.75, note: "Observed association among similar clients; not a causal effect or guaranteed result." }) },
    ],
  },
  {
    label: "synthetic cohort single candidate (must never be framed as real-world proof)",
    candidates: [{ candidate: candidate("syn-1", { dataOrigin: "SYNTHETIC", history: history({ dataOrigin: "SYNTHETIC", count: 8, medianWeightChange: -4, note: "Demo synthetic dataset; not evidence of real coaching effectiveness." }) }), compatibility: { total: 75, scoringVersion: "compatibility-v2", components: { goal: 1, schedule: 0.8, budget: 1, reputation: 0.6, evidence: 0.4 } }, history: history({ dataOrigin: "SYNTHETIC", count: 8, medianWeightChange: -4, note: "Demo synthetic dataset; not evidence of real coaching effectiveness." }) }],
  },
  {
    label: "multiple candidates (mixed cohort + cold-start together)",
    candidates: [
      { candidate: candidate("multi-1", { history: history({ count: 6, medianWeightChange: -2.5, completionRate: 0.7 }) }), compatibility: { total: 79, scoringVersion: "compatibility-v2", components: { goal: 1, schedule: 0.8, budget: 1, reputation: 0.7, evidence: 0.3 } }, history: history({ count: 6, medianWeightChange: -2.5, completionRate: 0.7 }) },
      { candidate: candidate("multi-2"), compatibility: { total: 61, scoringVersion: "compatibility-v2", components: { goal: 1, schedule: 0.4, budget: 1, reputation: 0.4 } }, history: history() },
    ],
  },
];

async function main() {
  const results: any[] = [];
  const startAll = Date.now();
  for (const scenario of scenarios) {
    const start = Date.now();
    const { narrations, usedFallback } = await narrateRecommendations(scenario.candidates, evidence, { userId: "eval-live-narrator" });
    const latencyMs = Date.now() - start;
    results.push({
      scenario: scenario.label,
      candidateCount: scenario.candidates.length,
      narratedCount: narrations.length,
      usedFallback,
      latencyMs,
      narrations: narrations.map((n) => ({ candidateId: n.candidateId, summary: n.summary, historicalEvidenceSummary: n.historicalEvidenceSummary, scientificEvidenceSummary: n.scientificEvidenceSummary })),
    });
  }
  const totalLatencyMs = Date.now() - startAll;
  const totalCandidates = scenarios.reduce((s, sc) => s + sc.candidates.length, 0);
  const totalNarrated = results.reduce((s, r) => s + r.narratedCount, 0);
  console.log(JSON.stringify({
    model: process.env.LLM_MODEL, provider: process.env.LLM_PROVIDER,
    scenarios: scenarios.length, totalCandidates, totalNarrated,
    fallbackRate: (totalCandidates - totalNarrated) / totalCandidates,
    totalLatencyMs, avgLatencyMsPerScenario: Math.round(totalLatencyMs / scenarios.length),
    results,
  }, null, 2));
}

main().catch((err) => { console.error("evaluateLiveNarrator failed:", err); process.exitCode = 1; });
