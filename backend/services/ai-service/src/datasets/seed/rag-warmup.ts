/**
 * OpenSearch Serverless (NextGen) pre-warm check for the AWS DEV demo (M9.6-T8). Pure logic with an INJECTED store / embedder, tested offline and run inside the temporary VPC runner Lambda.
 *
 * Why: an idle NextGen collection answers its first requests slowly, and V1's OpenSearch client gives up after 5 s with no retry (`OPENSEARCH_TIMEOUT_MS`), so the first chat turns after an idle
 * period get NO retrieval context (T7: RAG COLD = FAIL, RAG WARM = PASS). This module reproduces what V1 does per collection — `getMapping` then a knn `search`, all collections in parallel — with the
 * SAME 5 s per-call limit, and polls (bounded, never endless) until several consecutive rounds pass.
 *
 * Evidence rules:
 *   - a round that times out or errors is NEVER evidence of readiness; only `requiredConsecutivePasses` consecutive passing rounds are;
 *   - the final verification is a real vector query (one `search_query` embedding, made once and reused) that must return documents from every non-empty index;
 *   - nothing is written, no LLM is called, only one Cohere embedding (a few tokens).
 * Results carry ids, counts, timings and short metadata only — no vectors, no secrets.
 */
import { toProbeHit, type SearchProbeHit } from "./rag-probe";

export interface WarmupStore {
  describeIndex(index: string): Promise<{ ok: boolean; dimension: number | null; error?: { status?: number; type?: string } }>;
  search(index: string, args: { vector: number[]; limit: number }): Promise<Array<{ id: string; similarity: number; payload?: Record<string, unknown> }>>;
}
export interface WarmupOptions {
  indexes: string[];
  /** Indexes that are expected to answer but to hold no documents (V1 queries fitness_faq on every turn). */
  emptyOkIndexes?: string[];
  query: string;
  /** Per-call limit, the same as V1's OpenSearch client. Default 5000. */
  attemptTimeoutMs?: number;
  /** Pause between rounds. Default 2000. */
  pollIntervalMs?: number;
  /** Hard bound for the whole check. Default 300000 (5 min), never more than 600000. */
  maxWaitMs?: number;
  /** Consecutive fully-passing rounds required before the collection is called ready. Default 2. */
  requiredConsecutivePasses?: number;
  /** Hits requested per index. Default 3. */
  k?: number;
}
export interface WarmupDeps { store: WarmupStore; embedQuery: (q: string) => Promise<number[]>; now?: () => number; sleep?: (ms: number) => Promise<void> }
export type CallOutcome = "ok" | "timeout" | "error";
export interface IndexRound { index: string; mappingMs: number; mapping: CallOutcome; searchMs: number; search: CallOutcome; hits: number; pass: boolean; error?: { status?: number; type?: string } }
export interface WarmupRound { n: number; atMs: number; durationMs: number; pass: boolean; indexes: IndexRound[] }
export interface WarmupVerification { index: string; hits: SearchProbeHit[]; ok: boolean }
export interface WarmupResult {
  ok: boolean;
  /** true when at least one round failed before the first passing one (the collection really was cold / slow). */
  wasCold: boolean;
  reason: "ready" | "max_wait_exceeded" | "embedding_failed";
  query: string;
  embedMs: number;
  attemptTimeoutMs: number;
  maxWaitMs: number;
  requiredConsecutivePasses: number;
  rounds: WarmupRound[];
  failedRounds: number;
  /** Elapsed ms (since the first round started) when the first fully-passing round STARTED. null if none. */
  firstPassAtMs: number | null;
  /** Elapsed ms when the required number of consecutive passing rounds was complete = real warm-up time. null if never ready. */
  readyAtMs: number | null;
  totalMs: number;
  verification: WarmupVerification[];
  embeddingError?: { type: string };
}

const DEFAULT_ATTEMPT_MS = 5000, DEFAULT_POLL_MS = 2000, DEFAULT_MAX_WAIT_MS = 300_000, HARD_MAX_WAIT_MS = 600_000, HARD_MIN_POLL_MS = 250;

/** Runs `fn` but gives up after `ms` (the underlying request may continue; its late answer is ignored). Never throws. */
async function bounded<T>(fn: () => Promise<T>, ms: number, now: () => number): Promise<{ outcome: CallOutcome; ms: number; value?: T; error?: { status?: number; type?: string } }> {
  const t0 = now(); let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); });
  try {
    const r = await Promise.race([fn(), timeout]);
    if (r === "timeout") return { outcome: "timeout", ms: now() - t0 };
    return { outcome: "ok", ms: now() - t0, value: r as T };
  } catch (err) {
    const e = err as { statusCode?: number; meta?: { statusCode?: number }; message?: string };
    return { outcome: "error", ms: now() - t0, error: { status: e?.statusCode ?? e?.meta?.statusCode, type: String(e?.message ?? "error").split(":")[0].slice(0, 60) } };
  } finally { if (timer) clearTimeout(timer); }
}

export async function runWarmup(opts: WarmupOptions, deps: WarmupDeps): Promise<WarmupResult> {
  const now = deps.now ?? Date.now; const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attemptTimeoutMs = Math.max(10, opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_MS);
  const pollIntervalMs = Math.max(HARD_MIN_POLL_MS, opts.pollIntervalMs ?? DEFAULT_POLL_MS);
  const maxWaitMs = Math.min(HARD_MAX_WAIT_MS, Math.max(attemptTimeoutMs, opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS));
  const required = Math.max(1, Math.min(10, opts.requiredConsecutivePasses ?? 2)); const k = Math.max(1, Math.min(10, opts.k ?? 3));
  const emptyOk = new Set(opts.emptyOkIndexes ?? []);
  const base = { query: opts.query, attemptTimeoutMs, maxWaitMs, requiredConsecutivePasses: required };
  const start = now();

  // ONE embedding, reused by every round (polling never pays for an embedding per attempt).
  const e0 = now(); let vector: number[];
  try { vector = await deps.embedQuery(opts.query); } catch (err) {
    return { ...base, ok: false, wasCold: false, reason: "embedding_failed", embedMs: now() - e0, rounds: [], failedRounds: 0, firstPassAtMs: null, readyAtMs: null, totalMs: now() - start, verification: [], embeddingError: { type: String((err as Error)?.message ?? "error").split(":")[0].slice(0, 60) } };
  }
  const embedMs = now() - e0;

  const rounds: WarmupRound[] = []; let consecutive = 0; let firstPassAtMs: number | null = null; let readyAtMs: number | null = null; let finalHits = new Map<string, SearchProbeHit[]>();
  const loopStart = now();
  for (let n = 1; ; n++) {
    const roundStart = now();
    // V1 runs every collection in parallel; each does getMapping and then a knn search.
    const perIndex = await Promise.all(opts.indexes.map(async (index): Promise<{ row: IndexRound; hits: SearchProbeHit[] }> => {
      const m = await bounded(() => deps.store.describeIndex(index), attemptTimeoutMs, now);
      const mappingOk = m.outcome === "ok" && !!m.value?.ok;
      if (!mappingOk) return { row: { index, mappingMs: m.ms, mapping: m.outcome === "ok" ? "error" : m.outcome, searchMs: 0, search: "error", hits: 0, pass: false, error: m.error ?? m.value?.error }, hits: [] };
      const s = await bounded(() => deps.store.search(index, { vector, limit: k }), attemptTimeoutMs, now);
      const hits = s.outcome === "ok" ? (s.value ?? []).map((h, i) => toProbeHit(i + 1, h)) : [];
      const pass = s.outcome === "ok" && (hits.length > 0 || emptyOk.has(index));
      return { row: { index, mappingMs: m.ms, mapping: "ok", searchMs: s.ms, search: s.outcome, hits: hits.length, pass, error: s.error }, hits };
    }));
    const pass = perIndex.every((p) => p.row.pass);
    rounds.push({ n, atMs: roundStart - loopStart, durationMs: now() - roundStart, pass, indexes: perIndex.map((p) => p.row) });
    if (pass) {
      consecutive++; if (firstPassAtMs === null) firstPassAtMs = roundStart - loopStart; finalHits = new Map(perIndex.map((p) => [p.row.index, p.hits]));
      if (consecutive >= required) { readyAtMs = now() - loopStart; break; }
    } else consecutive = 0;
    if (now() - loopStart + pollIntervalMs >= maxWaitMs) break;
    await sleep(pollIntervalMs);
  }

  const ok = readyAtMs !== null; const failedRounds = rounds.filter((r) => !r.pass).length;
  const verification = ok ? opts.indexes.map((index) => { const hits = finalHits.get(index) ?? []; return { index, hits, ok: hits.length > 0 || emptyOk.has(index) }; }) : [];
  return { ...base, ok, wasCold: ok ? rounds.findIndex((r) => r.pass) > 0 : failedRounds > 0, reason: ok ? "ready" : "max_wait_exceeded", embedMs, rounds, failedRounds, firstPassAtMs, readyAtMs, totalMs: now() - start, verification };
}
