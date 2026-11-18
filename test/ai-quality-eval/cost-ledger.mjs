// Shared model-cost ledger for the isolated test stack (V1 RC1, 2026-11-12).
//
// Why: the runner's --budget used to count only the promptTokens/completionTokens that /ai/ask returned — background plan
// generation (BullMQ worker), its parse-retries, auxiliary calls and Cohere embeddings were invisible (rc-verify-v1b: runner
// $0.139 vs $0.151 from the ai-service log). The ledger reads the ai-service's OWN per-call telemetry instead:
//   llm_call        (llm.service.ts)   — every chat/auxiliary/background call, with reported token usage and, when the call
//                                        ran inside an HTTP request, the request's clientRequestId
//   embedding_call  (bedrock.client.ts) — every Cohere call, with text count + characters (Cohere bills tokens; estimated)
// The test stack is exclusive to one run, so "every line since the run's start offset" = everything this run caused,
// including background work.
//
// LIMITS (stated, not hidden): this is an APPLICATION-LEVEL guard. It cannot stop a job that was already queued before the
// cap was reached, a provider-side retry, or a difference between reported usage and AWS Billing. It is not a billing cap.

export const PRICES = {
  // USD per 1K tokens — list prices; confirm in AWS Billing
  llm: { "apac.amazon.nova-pro-v1:0": { in: 0.0008, out: 0.0032 }, default: { in: 0.0008, out: 0.0032 } },
  embedding: { "cohere.embed-multilingual-v3": 0.0001, default: 0.0001 },
  // Cohere tokenises Vietnamese at roughly 1 token / 3 characters — deliberately conservative (overestimates)
  charsPerEmbeddingToken: 3,
};

export function parseLedger(logText) {
  const out = [];
  for (const raw of String(logText ?? "").split("\n")) {
    if (!raw.includes('"llm_call"') && !raw.includes('"embedding_call"')) continue;
    let j; try { j = JSON.parse(raw); } catch { continue; }
    if (j.msg === "llm_call") {
      out.push({ kind: "llm", time: j.time, purpose: j.callPurpose ?? "OTHER", model: j.model ?? null, outcome: j.outcome ?? "ok",
        promptTokens: Number(j.promptTokens) || 0, completionTokens: Number(j.completionTokens) || 0, hasUsage: j.promptTokens != null,
        clientRequestId: j.clientRequestId ?? null, latencyMs: Number(j.latencyMs) || 0 });
    } else if (j.msg === "embedding_call") {
      out.push({ kind: "embedding", time: j.time, model: j.model ?? null, outcome: j.outcome ?? "ok", texts: Number(j.texts) || 0,
        inputChars: Number(j.inputChars) || 0, clientRequestId: j.clientRequestId ?? null, latencyMs: Number(j.latencyMs) || 0 });
    }
  }
  return out;
}

export function summarize(entries, prices = PRICES) {
  const s = {
    calls: { llm: 0, embedding: 0, provider: 0, background: 0, failedWithoutUsage: 0 },
    tokens: { in: 0, out: 0, embeddingEstimated: 0 },
    usd: { llmFromUsage: 0, embeddingEstimated: 0, backgroundFromUsage: 0, total: 0 },
    byRequest: {},
  };
  for (const e of entries) {
    const key = e.clientRequestId ?? "(background / no request)";
    const r = (s.byRequest[key] ??= { llmCalls: 0, embeddingCalls: 0, usd: 0 });
    if (e.kind === "llm") {
      const p = prices.llm[e.model] ?? prices.llm.default;
      const usd = (e.promptTokens / 1000) * p.in + (e.completionTokens / 1000) * p.out;
      s.calls.llm++; r.llmCalls++; r.usd += usd;
      s.tokens.in += e.promptTokens; s.tokens.out += e.completionTokens; s.usd.llmFromUsage += usd;
      if (!e.hasUsage) s.calls.failedWithoutUsage++;
      if (!e.clientRequestId) { s.calls.background++; s.usd.backgroundFromUsage += usd; }
    } else {
      const tokens = Math.ceil(e.inputChars / prices.charsPerEmbeddingToken);
      const usd = (tokens / 1000) * (prices.embedding[e.model] ?? prices.embedding.default);
      s.calls.embedding++; r.embeddingCalls++; r.usd += usd;
      s.tokens.embeddingEstimated += tokens; s.usd.embeddingEstimated += usd;
    }
  }
  s.calls.provider = s.calls.llm + s.calls.embedding;
  s.usd.total = s.usd.llmFromUsage + s.usd.embeddingEstimated;
  return s;
}

/**
 * How long the log must stay quiet before the run's ledger is final. A call is logged only when it FINISHES, so a call that
 * started right after the last logged one is invisible until it ends: the window must outlast the slowest call seen.
 * rc-verify-v2: a fixed 15 s window settled while a 17.7 s background plan-generation call was still running.
 */
export function settleQuietMs(entries, { floorMs = 60_000, capMs = 120_000 } = {}) {
  const slowest = entries.reduce((m, e) => Math.max(m, e.latencyMs || 0), 0);
  return Math.min(capMs, Math.max(floorMs, 2 * slowest));
}

export class BudgetGate {
  /** maxCalls caps PROVIDER calls (LLM + embedding) — "N model/provider calls" as authorised; maxLlmCalls is the old name. */
  constructor({ maxUsd, maxCalls, maxLlmCalls, defaultCaseUsd = 0.02 }) {
    this.maxUsd = maxUsd; this.maxCalls = maxCalls ?? maxLlmCalls; this.defaultCaseUsd = defaultCaseUsd;
    this.guarantee = "Application-level stop-before-start guard: not a billing cap — work already queued may still finish, and reported usage can differ from AWS Billing.";
  }
  /** Average real cost of the cases run so far, or a conservative default before the first one. */
  projectNextCase(summary, casesDone) {
    return casesDone > 0 ? summary.usd.total / casesDone : this.defaultCaseUsd;
  }
  canStart(summary, projectedNextUsd) {
    const provider = summary.calls.llm + summary.calls.embedding;
    if (provider >= this.maxCalls) return { ok: false, reason: `CALL_LIMIT: ${provider} provider calls (${summary.calls.llm} LLM + ${summary.calls.embedding} embedding) >= ${this.maxCalls}` };
    if (summary.usd.total + projectedNextUsd > this.maxUsd) return { ok: false, reason: `BUDGET: spent $${summary.usd.total.toFixed(4)} + projected $${projectedNextUsd.toFixed(4)} > $${this.maxUsd}` };
    return { ok: true };
  }
}
