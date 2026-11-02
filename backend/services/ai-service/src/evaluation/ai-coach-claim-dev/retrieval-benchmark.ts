/** Small DEV diagnostic, no model/embedding/vector calls and no scientific-quality metric. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { retrieveClaims, type ClaimRegistry } from "./retrieval";
import { prepareClaimContext } from "./context";
import { buildClaimPrompt } from "./pipeline";
import { loadClaimDev } from "./load";
import type { DevRequest } from "../ai-coach-dev/context";

export const QueryBenchmarkSchema = z.object({ version: z.literal("dev-claim-retrieval-30-v1"),
  authority: z.literal("IMPLEMENTER_AI_AUTHORED_DRAFT_LABELS_NOT_INDEPENDENT_GOLD"), originalClaudeBenchmark: z.string(),
  cases: z.array(z.object({ id: z.string(), topic: z.string(), question: z.string(), expectedClaimIds: z.array(z.string()), relevantClaimIds: z.array(z.string()) }).strict()).length(30),
}).strict().superRefine((b, ctx) => {
  if (new Set(b.cases.map(q => q.id)).size !== b.cases.length || b.cases.some(q => q.expectedClaimIds.some(id => !q.relevantClaimIds.includes(id)))) ctx.addIssue({ code: "custom", message: "InvalidDraftRetrievalLabels" });
});

export function benchmarkClaimRetrieval(registry: ClaimRegistry, value: unknown, implementation = { retrieveClaims, prepareClaimContext, buildClaimPrompt }) {
  const benchmark = QueryBenchmarkSchema.parse(value);
  const rows = benchmark.cases.map(q => {
    const request: DevRequest = { dataClass: "SYNTHETIC_DEV", caseId: "dev-benchmark-" + q.id.toLowerCase(), subjectId: "synthetic-benchmark", question: q.question, profile: { owner: "user-service", goal: null }, snapshots: [], conversation: [] };
    const retrieved = implementation.retrieveClaims(registry, q.question), context = implementation.prepareClaimContext(request, registry, { retrieve: () => retrieved });
    const prompt = implementation.buildClaimPrompt(context), ids = context.retrieval.matches.map(m => m.claim.id);
    return { ...q, retrievedClaimIds: ids, expectedHits: q.expectedClaimIds.filter(id => ids.includes(id)).length,
      relevantRetrieved: ids.filter(id => q.relevantClaimIds.includes(id)).length, suppliedClaimCount: ids.length,
      retrievalStatus: context.retrieval.status, contextUtf8Bytes: Buffer.byteLength(prompt.user, "utf8"),
      estimatedContextTokens: Math.ceil(Buffer.byteLength(prompt.user, "utf8") / 4), tokenAuthority: "UTF8_BYTES_DIV4_HEURISTIC_NOT_MODEL_TOKENS" };
  });
  const ratio = (a: number, b: number) => b ? a / b : null;
  const summarize = (r: typeof rows) => {
    const expected = r.reduce((n, q) => n + q.expectedClaimIds.length, 0), found = r.reduce((n, q) => n + q.expectedHits, 0);
    const returned = r.reduce((n, q) => n + q.suppliedClaimCount, 0), relevant = r.reduce((n, q) => n + q.relevantRetrieved, 0);
    return { queries: r.length, expectedHits: found, expectedClaims: expected, expectedClaimRecall: ratio(found, expected),
      precision: ratio(relevant, returned), irrelevantClaimRate: ratio(returned - relevant, returned),
      emptyQueries: r.filter(q => !q.suppliedClaimCount).length, emptyRate: ratio(r.filter(q => !q.suppliedClaimCount).length, r.length),
      queriesWithMatches: r.filter(q => q.suppliedClaimCount).length, suppliedClaimOccurrences: returned, maxClaims: Math.max(0, ...r.map(q => q.suppliedClaimCount)),
      meanEstimatedContextTokens: ratio(r.reduce((n, q) => n + q.estimatedContextTokens, 0), r.length), maxEstimatedContextTokens: Math.max(0, ...r.map(q => q.estimatedContextTokens)) };
  };
  return { authority: benchmark.authority, originalClaudeBenchmark: benchmark.originalClaudeBenchmark, summary: summarize(rows),
    byTopic: Object.fromEntries([...new Set(rows.map(q => q.topic))].map(topic => [topic, summarize(rows.filter(q => q.topic === topic))])), rows,
    scientificSupport: "NOT_MEASURED", modelCalls: 0, embeddingCalls: 0, vectorDbCalls: 0 };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 4 && args.length !== 6 || args[0] !== "--registry-config" || args[2] !== "--questions" || args.length === 6 && args[4] !== "--baseline-root") throw new Error("--registry-config ABS --questions FILE [--baseline-root CHECKOUT] required");
  const { registry } = loadClaimDev(args[1]), data = JSON.parse(fs.readFileSync(args[3], "utf8"));
  const before = args.length === 6 ? benchmarkClaimRetrieval(registry, data, {
    retrieveClaims: require(path.join(args[5], "backend/services/ai-service/src/evaluation/ai-coach-claim-dev/retrieval.ts")).retrieveClaims,
    prepareClaimContext: require(path.join(args[5], "backend/services/ai-service/src/evaluation/ai-coach-claim-dev/context.ts")).prepareClaimContext,
    buildClaimPrompt: require(path.join(args[5], "backend/services/ai-service/src/evaluation/ai-coach-claim-dev/pipeline.ts")).buildClaimPrompt,
  }) : null;
  console.log(JSON.stringify({ before, after: benchmarkClaimRetrieval(registry, data), retrievalAlgorithmChanged: false }, null, 2));
}
