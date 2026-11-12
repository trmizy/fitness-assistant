/**
 * FROZEN BASELINE (M5.1): byte-for-byte copy of agent-v2/routing-planner.ts at fdc92198 (the M5 "intent-v1"), kept only so
 * the benchmark can compare the M5.1 candidate against the exact router M5 measured. Never edit; not used in production.
 */
/**
 * Gymini V2 (EXPERIMENTAL) — intent-aware routing plan (M4, deterministic, no model call).
 *
 * Replaces "cap by fixed execution order" with a bounded, explainable selection:
 *   1. intent candidates: business needs matched in the folded question (a table of rules — adding a need = adding a row);
 *   2. the PRIMARY need: the need asked for in the request clause (the last clause carrying a question / request marker);
 *   3. relevance per agent = Σ need weights + domain-signal weight + PRIMARY bonus (+ evidence-support bonus for agents the
 *      primary need declares as supporting evidence);
 *   4. top `maxAgents` by relevance (ties: the primary need's evidence preference, then a fixed alphabetical order — never
 *      the execution order); the rest are DEFERRED with the needs they would have covered;
 *   5. coverage FULL / PARTIAL / NONE and an uncertainty level, all as codes.
 * The planner only NAMES agents (a SupervisorDecision); it cannot grant tools, budgets or identity, and it never selects an
 * agent that is not registered/allowed (the supervisor re-validates). Execution ORDER (data producers first) is a separate
 * concern applied by the supervisor after selection.
 */
import type { AgentId, DecisionInput, DecisionProvider, SupervisorDecision } from "../../agent-v2/multi-agent-contracts";

export type IntentNeed =
  | "TODAY_TRAINING" | "PROGRAM_ADJUSTMENT" | "EXERCISE_INFO"
  | "NUTRITION_INTAKE" | "NUTRITION_TARGET"
  | "RECOVERY_FATIGUE" | "RECOVERY_REST" | "RECOVERY_HISTORY"
  | "PROGRESS_STRENGTH" | "PROGRESS_BODY" | "PROGRESS_GOAL" | "PROGRESS_GENERAL" | "PROGRESS_FORECAST";

export interface IntentRule {
  need: IntentNeed;
  agentId: AgentId;
  /** Folded text. */
  pattern: RegExp;
  weight: number;
  /** Agents whose evidence this need benefits from, in order of preference (tie-break for the second slot). */
  supportedBy?: readonly AgentId[];
}

export interface IntentCandidate { need: IntentNeed; agentId: AgentId; weight: number; inRequestClause: boolean; position: number }

export interface RoutingPlan {
  strategy: string;
  intents: IntentCandidate[];
  primaryNeed: IntentNeed | null;
  relevance: Partial<Record<AgentId, number>>;
  selectionReasons: Partial<Record<AgentId, string[]>>;
  selected: AgentId[];
  deferred: Array<{ agentId: AgentId; needs: IntentNeed[]; reason: "MAX_AGENTS" | "SATISFIED_FROM_SESSION" }>;
  coverage: "FULL" | "PARTIAL" | "NONE";
  uncertainty: "LOW" | "MEDIUM" | "HIGH";
}

/** First-person marker (folded). */
const FIRST_PERSON = /\b(toi|minh|em)\b/;

export const INTENT_RULES: readonly IntentRule[] = Object.freeze([
  { need: "TODAY_TRAINING", agentId: "training", weight: 2, pattern: /\b(hom nay|ngay mai|buoi toi)\b.{0,25}\b(?<!tai )tap\b|\btap (gi|bai gi|nhu the nao)\b/, supportedBy: ["recovery", "progress", "nutrition"] },
  { need: "PROGRAM_ADJUSTMENT", agentId: "training", weight: 2, pattern: /\b(thay doi|dieu chinh|sua|doi|giam|tang)\b.{0,20}\b(lich tap|chuong trinh|cach tap|bai tap|khoi luong tap)\b|\bcach tap\b/, supportedBy: ["recovery", "progress", "nutrition"] },
  { need: "EXERCISE_INFO", agentId: "training", weight: 1, pattern: /\b(bai tap|nhom co|ky thuat)\b/ },
  { need: "NUTRITION_INTAKE", agentId: "nutrition", weight: 2, pattern: /\b(an|uong)\b.{0,20}\b(gi|the nao|nhu the nao|bao nhieu|truoc|sau|de)\b|\b(dinh duong|thuc don|che do an|protein|calo|kcal|macro|bua an)\b/, supportedBy: ["training", "recovery", "progress"] },
  { need: "NUTRITION_TARGET", agentId: "nutrition", weight: 1, pattern: /\bmuc tieu (calo|dinh duong|macro|protein)\b/ },
  { need: "RECOVERY_FATIGUE", agentId: "recovery", weight: 2, pattern: /\b(met|qua met|kiet suc|uong co|nhuc moi|dau moi|qua tai|doms)\b/, supportedBy: ["training", "progress"] },
  // "phục hồi" counts as a recovery need only when it is about the user (personal), or an explicit rest/recovery question
  { need: "RECOVERY_REST", agentId: "recovery", weight: 1, pattern: /\b(nghi ngoi|ngay nghi|nghi (bao lau|may ngay|giua))\b|\b(toi|minh|em)\b.{0,40}\b(phuc hoi|hoi phuc)\b/ },
  { need: "RECOVERY_HISTORY", agentId: "recovery", weight: 1, pattern: /\btap\b.{0,25}\bhom qua\b|\bhom qua\b.{0,25}\btap\b|\b(tai tap|khoi luong tap)\b/ },
  { need: "PROGRESS_STRENGTH", agentId: "progress", weight: 2, pattern: /\b(suc manh|1 ?rm|manh hon|yeu di|khoe hon)\b/, supportedBy: ["training", "recovery"] },
  { need: "PROGRESS_BODY", agentId: "progress", weight: 2, pattern: /\b(can nang|body fat|mo co the|ti le mo|inbody|giam duoc|tang duoc)\b/, supportedBy: ["nutrition", "training"] },
  { need: "PROGRESS_GOAL", agentId: "progress", weight: 1, pattern: /\b(muc tieu (can|giam|tang|cua)|dat muc tieu|phu hop muc tieu)\b/, supportedBy: ["nutrition", "training"] },
  { need: "PROGRESS_GENERAL", agentId: "progress", weight: 2, pattern: /\b(tien bo|tien do|tien trien|xu huong|hieu suat)\b/, supportedBy: ["recovery", "training", "nutrition"] },
  { need: "PROGRESS_FORECAST", agentId: "progress", weight: 2, pattern: /\bdu bao\b/ },
]);

/** Clause split (folded text). The request clause is the LAST clause carrying a question / request marker. */
const REQUEST_MARKER = /\b(gi|nao|the nao|bao nhieu|bao lau|khong|chua|nen|can|co nen|phai khong|duoc khong|tai sao|vi sao|lam sao)\b|\?/;
function requestClauseSpan(folded: string): [number, number] {
  const clauses: Array<[number, number]> = [];
  let start = 0;
  for (const m of folded.matchAll(/[,.;!?]|\b(va|nhung|con|vay)\b/g)) { clauses.push([start, m.index! + m[0].length]); start = m.index! + m[0].length; }
  clauses.push([start, folded.length]);
  const marked = (i: number) => REQUEST_MARKER.test(folded.slice(clauses[i][0], clauses[i][1]));
  for (let i = clauses.length - 1; i >= 0; i--) {
    if (!marked(i)) continue;
    // a compound ask ("nên tập gì và ăn gì?") is ONE request span: extend back over adjacent request clauses
    let first = i;
    while (first > 0 && marked(first - 1)) first--;
    return [clauses[first][0], clauses[i][1]];
  }
  return [0, folded.length];
}

const ALPHA: readonly AgentId[] = ["nutrition", "progress", "recovery", "training"];

export interface PlanOptions {
  maxAgents: number;
  /** Per-agent domain signals (the M1–M3 keyword table) — each matching agent gets +1. */
  domainSignals: Readonly<Partial<Record<AgentId, RegExp>>>;
  /** Agents whose only role this turn is satisfied by FRESH session evidence (they are deferred, not run). */
  satisfiedFromSession?: ReadonlySet<AgentId>;
  rules?: readonly IntentRule[];
}

export function planRouting(folded: string, available: readonly AgentId[], opts: PlanOptions): RoutingPlan {
  const rules = opts.rules ?? INTENT_RULES;
  const [rs, re] = requestClauseSpan(folded);
  const intents: IntentCandidate[] = [];
  for (const r of rules) {
    if (!available.includes(r.agentId)) continue;
    const m = r.pattern.exec(folded);
    if (m) intents.push({ need: r.need, agentId: r.agentId, weight: r.weight, inRequestClause: m.index >= rs && m.index < re, position: m.index });
  }
  const relevance: Partial<Record<AgentId, number>> = {};
  const reasons: Partial<Record<AgentId, string[]>> = {};
  const add = (a: AgentId, w: number, why: string) => { relevance[a] = (relevance[a] ?? 0) + w; (reasons[a] ??= []).push(why); };
  for (const a of available) if (opts.domainSignals[a]?.test(folded)) add(a, 1, "domain_signal");
  for (const c of intents) add(c.agentId, c.weight, `need:${c.need}`);

  // the primary need: in the request clause, highest weight, earliest position
  const inClause = intents.filter((c) => c.inRequestClause).sort((a, b) => b.weight - a.weight || a.position - b.position);
  const primary = inClause[0] ?? [...intents].sort((a, b) => b.weight - a.weight || a.position - b.position)[0] ?? null;
  if (primary) add(primary.agentId, 3, `primary:${primary.need}`);
  const supportOrder = primary ? (rules.find((r) => r.need === primary.need)?.supportedBy ?? []) : [];
  for (const a of supportOrder) if (relevance[a] !== undefined) add(a, 0.5, `supports:${primary!.need}`);

  // session-satisfied agents with no need of their own are not run (their facts come from the session)
  const ownNeeds = (a: AgentId) => intents.filter((c) => c.agentId === a).map((c) => c.need);
  const sessionDeferred = (Object.keys(relevance) as AgentId[]).filter((a) => opts.satisfiedFromSession?.has(a) && ownNeeds(a).length === 0);
  const ranked = (Object.keys(relevance) as AgentId[]).filter((a) => !sessionDeferred.includes(a)).sort((a, b) =>
    (relevance[b]! - relevance[a]!) || (rank(supportOrder, a) - rank(supportOrder, b)) || (ALPHA.indexOf(a) - ALPHA.indexOf(b)));
  const selected = ranked.slice(0, Math.max(0, opts.maxAgents));
  const deferred: RoutingPlan["deferred"] = [
    ...ranked.slice(selected.length).map((a) => ({ agentId: a, needs: ownNeeds(a), reason: "MAX_AGENTS" as const })),
    ...sessionDeferred.map((a) => ({ agentId: a, needs: ownNeeds(a), reason: "SATISFIED_FROM_SESSION" as const })),
  ];

  // uncertainty: a tie at the cut decided by preference / alphabet, or no primary need
  let uncertainty: RoutingPlan["uncertainty"] = "LOW";
  if (!primary) uncertainty = selected.length ? "MEDIUM" : "HIGH";
  const cut = selected.length && ranked.length > selected.length ? [relevance[selected[selected.length - 1]]!, relevance[ranked[selected.length]]!] : null;
  if (cut && cut[0] === cut[1]) uncertainty = rank(supportOrder, selected[selected.length - 1]) < 99 ? (uncertainty === "LOW" ? "MEDIUM" : uncertainty) : "HIGH";
  const coverage: RoutingPlan["coverage"] = !selected.length ? "NONE" : deferred.some((d) => d.reason === "MAX_AGENTS") ? "PARTIAL" : "FULL";
  return { strategy: "intent-v1", intents, primaryNeed: primary?.need ?? null, relevance, selectionReasons: reasons, selected, deferred, coverage, uncertainty };
}
function rank(order: readonly AgentId[], a: AgentId): number { const i = order.indexOf(a); return i < 0 ? 99 : i; }

/** DecisionProvider over planRouting. The plan travels with the decision (codes only) for the supervisor and its trace. */
export function createIntentDecisionProvider(opts: Omit<PlanOptions, "satisfiedFromSession">): DecisionProvider & { plan(input: DecisionInput, satisfied?: ReadonlySet<AgentId>): RoutingPlan } {
  const plan = (input: DecisionInput, satisfied?: ReadonlySet<AgentId>) => planRouting(input.folded, input.available, { ...opts, satisfiedFromSession: satisfied });
  return {
    name: "intent-v1",
    plan,
    decide(input: DecisionInput): SupervisorDecision {
      const p = plan(input, input.satisfiedFromSession);
      return { strategy: p.strategy, agents: p.selected, reasonCodes: p.primaryNeed ? [`primary:${p.primaryNeed}`] : ["no_primary_need"], plan: p };
    },
  };
}

/** True when the question is about the user (first person) — used by callers that need it. */
export const isFirstPerson = (folded: string) => FIRST_PERSON.test(folded);
