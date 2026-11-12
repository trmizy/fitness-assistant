/**
 * Gymini V2 (EXPERIMENTAL) — P3 per-turn trace + offline metrics for the Training Agent.
 *
 * One TurnTrace per agent turn, emitted for EVERY outcome (including early exits such as DISABLED / SAFETY_BLOCKED). The
 * registry's per-tool trace events carry the same turnId, so a turn can be joined with its tool calls.
 * Privacy: no question text, answer text, tool arguments or tool data — only lengths, random ids, counts, timings and outcomes.
 * (A truncated unkeyed SHA-256 of the question was removed 2026-11-12: short, frequent questions are recoverable by hashing a
 * dictionary of candidates; turnId already correlates a turn with its tool calls.)
 */

export interface ModelRoundTrace {
  round: number;
  latencyMs: number;
  /** Normalised stop reason, or "error:<kind>" / "deadline" when the round produced no response. */
  outcome: string;
  inputTokens: number;
  outputTokens: number;
  usageEstimated: boolean;
  toolUseCount: number;
}

export interface ToolCallTrace {
  toolId: string;
  outcome: string;
  /** 0 when the call was refused by the controller before reaching the registry. */
  durationMs: number;
  round: number;
}

export interface TurnTrace {
  turnId: string;
  agentId: string;
  policyTools: number;
  modelId: string;
  startedAt: string;
  durationMs: number;
  status: string;
  stopDetail: string | null;
  question: { length: number };
  answerLength: number;
  rounds: ModelRoundTrace[];
  tools: ToolCallTrace[];
  totals: {
    modelRounds: number; providerAttempts: number; retries: number; toolInvocations: number; toolRefusals: number;
    inputTokens: number; outputTokens: number; usageEstimated: boolean; estimatedCostUsd: number;
    deadlineHit: boolean; inFlightAtEnd: number;
  };
  guardActions: string[];
  /** Gate 1 (minor safety) verdict + decision. Never the age value. null when the turn ended before the gate ran. */
  ageGate?: { status: string; minorBy: string[]; conflict: boolean; profileRead: string; decision: string | null } | null;
}


function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface TurnMetrics {
  turns: number;
  byStatus: Record<string, number>;
  answeredRate: number;
  latencyMs: { p50: number | null; p95: number | null; max: number | null };
  modelRounds: { mean: number; max: number };
  toolCalls: { mean: number; max: number; byTool: Record<string, number>; refusedByOutcome: Record<string, number> };
  tokens: { input: number; output: number; estimatedTurns: number };
  estimatedCostUsd: { total: number; perTurn: number; max: number };
  budgetExhaustedRate: number;
  deadlineRate: number;
  ungroundedRate: number;
  safetyBlockedRate: number;
  guardActionCounts: Record<string, number>;
  inFlightAtEndTurns: number;
}

/** Pure aggregation for an offline dashboard / report. Never reads anything but the traces it is given. */
export function summarizeTurnTraces(traces: readonly TurnTrace[]): TurnMetrics {
  const n = traces.length;
  const rate = (k: number) => (n ? Number((k / n).toFixed(4)) : 0);
  const count = (pred: (t: TurnTrace) => boolean) => traces.filter(pred).length;
  const byStatus: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  const refused: Record<string, number> = {};
  const guards: Record<string, number> = {};
  for (const t of traces) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    for (const c of t.tools) {
      if (c.outcome === "ok") byTool[c.toolId] = (byTool[c.toolId] ?? 0) + 1;
      else refused[c.outcome] = (refused[c.outcome] ?? 0) + 1;
    }
    for (const g of t.guardActions) { const key = g.split(":")[0]; guards[key] = (guards[key] ?? 0) + 1; }
  }
  const lat = traces.map((t) => t.durationMs).sort((a, b) => a - b);
  const rounds = traces.map((t) => t.totals.modelRounds);
  const calls = traces.map((t) => t.totals.toolInvocations);
  const costs = traces.map((t) => t.totals.estimatedCostUsd);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const mean = (a: number[]) => (a.length ? Number((sum(a) / a.length).toFixed(3)) : 0);
  return {
    turns: n,
    byStatus,
    answeredRate: rate(byStatus.ANSWERED ?? 0),
    latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), max: lat.length ? lat[lat.length - 1] : null },
    modelRounds: { mean: mean(rounds), max: rounds.length ? Math.max(...rounds) : 0 },
    toolCalls: { mean: mean(calls), max: calls.length ? Math.max(...calls) : 0, byTool, refusedByOutcome: refused },
    tokens: { input: sum(traces.map((t) => t.totals.inputTokens)), output: sum(traces.map((t) => t.totals.outputTokens)), estimatedTurns: count((t) => t.totals.usageEstimated) },
    estimatedCostUsd: { total: Number(sum(costs).toFixed(6)), perTurn: n ? Number((sum(costs) / n).toFixed(6)) : 0, max: costs.length ? Math.max(...costs) : 0 },
    budgetExhaustedRate: rate(byStatus.BUDGET_EXHAUSTED ?? 0),
    deadlineRate: rate(byStatus.DEADLINE_EXCEEDED ?? 0),
    ungroundedRate: rate(byStatus.UNGROUNDED ?? 0),
    safetyBlockedRate: rate(byStatus.SAFETY_BLOCKED ?? 0),
    guardActionCounts: guards,
    inFlightAtEndTurns: count((t) => t.totals.inFlightAtEnd > 0),
  };
}
