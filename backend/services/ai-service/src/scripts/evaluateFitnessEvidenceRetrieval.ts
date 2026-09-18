/**
 * RAG citation-support evaluation for the `fitness_evidence` collection —
 * ADV-004 follow-up (docs/ai-agent-adversarial-findings.md: "Suggested
 * correction: ... add separate fitness_evidence citation-support eval").
 *
 * Deliberately a DIFFERENT, coarser metric than the existing
 * `exercises` Hit@5/Recall@5/MRR eval (evaluateRetrieval.ts) — that eval
 * proves exercise retrieval quality only, never fitness_evidence citation
 * grounding, and this script must never be conflated with it (per this
 * hardening task's own instruction: "Never merge them into one misleading
 * number").
 *
 * This measures TOPIC-LEVEL retrieval relevance: for a real query on a
 * known fitness-science topic, does the top-K retrieval from
 * `fitness_evidence` include at least one document actually tagged with
 * that topic in its real, stored metadata? This is a real, reproducible
 * measurement against the live Qdrant collection's actual content — not a
 * fabricated number — but it is explicitly NOT a semantic "does this
 * specific claim get supported by this specific document" judgment (that
 * would require either human annotation or an LLM-as-judge pass over real
 * retrieved content, out of scope for this pass — see the hardening
 * report's "RAG citation" section for what remains unmeasured).
 *
 * Run: npx tsx src/scripts/evaluateFitnessEvidenceRetrieval.ts
 */
import "dotenv/config";
import { retriever } from "../llm/retriever";

type Case = { query: string; expectedTopics: string[] };

// Topics/queries chosen from real, observed payload `topic` values in the
// live fitness_evidence collection (sampled via a direct Qdrant scroll
// before writing this file — TRAINING, NUTRITION, BODY_COMPOSITION,
// RECOVERY were all confirmed present with real documents, e.g. WHO
// Guidelines on Physical Activity (2020), ACSM Position Stand on
// Resistance Training, ISSN Position Stand: Protein and Exercise (2017)).
const CASES: Case[] = [
  { query: "resistance training progressive overload for muscle hypertrophy", expectedTopics: ["TRAINING", "BODY_COMPOSITION"] },
  { query: "protein intake recommendations for exercise and muscle growth", expectedTopics: ["NUTRITION", "BODY_COMPOSITION"] },
  { query: "WHO physical activity guidelines for adults", expectedTopics: ["TRAINING"] },
  { query: "training frequency and volume for resistance training", expectedTopics: ["TRAINING"] },
  { query: "body composition changes during weight loss", expectedTopics: ["BODY_COMPOSITION"] },
  { query: "recovery and rest intervals between resistance training sets", expectedTopics: ["RECOVERY"] },
  { query: "nutrient timing around exercise for performance", expectedTopics: ["NUTRITION"] },
  { query: "resting energy expenditure and metabolism", expectedTopics: ["NUTRITION"] },
  { query: "unilateral versus bilateral resistance training", expectedTopics: ["TRAINING", "BODY_COMPOSITION"] },
  { query: "bioelectrical impedance analysis body composition guidelines", expectedTopics: ["BODY_COMPOSITION"] },
];

async function main() {
  const results: Array<{ query: string; hit: boolean; topTopics: string[]; docCount: number }> = [];
  for (const c of CASES) {
    const docs = await retriever.retrieveEvidence([c.query]);
    const topTopics = docs.map((d) => (d.metadata as Record<string, unknown> | undefined)?.topic).filter((t): t is string => typeof t === "string");
    const hit = topTopics.some((t) => c.expectedTopics.includes(t));
    results.push({ query: c.query, hit, topTopics, docCount: docs.length });
  }
  const hits = results.filter((r) => r.hit).length;
  const zeroDocResults = results.filter((r) => r.docCount === 0);
  console.log(JSON.stringify({
    collection: "fitness_evidence",
    metric: "topic-level Hit@K (NOT the same metric as the exercises Hit@5/Recall@5/MRR eval)",
    cases: CASES.length,
    hits,
    hitRate: hits / CASES.length,
    zeroResultQueries: zeroDocResults.length,
    details: results,
  }, null, 2));
}

main().catch((err) => { console.error("evaluateFitnessEvidenceRetrieval failed:", err); process.exitCode = 1; });
