/**
 * M8-A4 routing evaluator — OUTCOME input contract (schema "m7-p5a2" datasets). OFFLINE and pure: no I/O, no network, no model.
 *
 * One outcome per dataset case, for ONE system. Reconciliation rejects, with DISTINCT codes:
 *   OUTCOME_MALFORMED_JSON  a JSONL line that is not JSON
 *   OUTCOME_SCHEMA_INVALID  an outcome that does not match the shape below (detail lists every problem)
 *   OUTCOME_DUPLICATE       two or more outcomes for the same case id
 *   OUTCOME_UNKNOWN_ID      an outcome whose id is not a case of the dataset
 *   OUTCOME_MISSING         a dataset case without any outcome
 * Nothing is repaired, defaulted or guessed. EVALUATION IS REFUSED when any error exists.
 */
import { AGENTS, type ObservedStage } from "./annotation-schema";
import type { AgentLabel } from "../m5-benchmark/dataset-v1";

export const OBSERVED_STAGES: readonly ObservedStage[] = Object.freeze(["VALIDATION_REJECTED", "INPUT_SAFETY_BLOCK", "OOS_PREFLIGHT_BLOCK", "REACHED_ROUTING", "NOT_EVALUABLE"]);
export const OUTCOME_ERROR_CODES = Object.freeze(["OUTCOME_MALFORMED_JSON", "OUTCOME_SCHEMA_INVALID", "OUTCOME_DUPLICATE", "OUTCOME_UNKNOWN_ID", "OUTCOME_MISSING"] as const);
export type OutcomeErrorCode = (typeof OUTCOME_ERROR_CODES)[number];
export interface OutcomeError { code: OutcomeErrorCode; id: string | null; index: number | null; detail: string }

export interface OutcomeUsage { modelCalls: number; inputTokens: number; outputTokens: number; costUsd: number }
/**
 * What a system did on one case (codes and agent ids only — never the question, a prompt or raw model output).
 *   stage              the stage that ENDED the pre-routing part (annotation-schema ObservedStage).
 *   selected           agents the routing DECISION selected (supervisor trace decision.agents), in the system's own order. The ORDER carries no
 *                      meaning for G7 / G8 (owner decision F1: membership; selected[0] is not "the primary"). Measured by G7 / G8 (F8).
 *                      Must be [] unless stage is REACHED_ROUTING.
 *   executedAgents     OPTIONAL. The agents actually delegated/run (supervisor trace delegations) — reported SEPARATELY from `selected` and
 *                      NEVER feeding G7 / G8 (owner decision F8); never defaulted from `selected`. A subset of `selected`; [] unless
 *                      stage is REACHED_ROUTING.
 *   deferred           agents the system itself deferred (cap / session).
 *   deferredDisclosed  the subset of `deferred` that the answer named to the user.
 *   usage              optional model usage of the routing call(s), if the system reports it.
 */
export interface EvalOutcome {
  id: string;
  stage: ObservedStage;
  selected: AgentLabel[];
  executedAgents?: AgentLabel[];
  deferred: AgentLabel[];
  deferredDisclosed: AgentLabel[];
  usage?: OutcomeUsage;
}
const OUTCOME_KEYS = ["id", "stage", "selected", "executedAgents", "deferred", "deferredDisclosed", "usage"] as const;
const USAGE_KEYS = ["modelCalls", "inputTokens", "outputTokens", "costUsd"] as const;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isAgent = (x: unknown): x is AgentLabel => typeof x === "string" && (AGENTS as readonly string[]).includes(x);

function agentList(v: unknown, field: string, problems: string[]): AgentLabel[] | null {
  if (!Array.isArray(v)) { problems.push(`${field} must be an array`); return null; }
  let ok = true;
  for (const a of v) if (!isAgent(a)) { problems.push(`${field} contains ${JSON.stringify(a)} which is not one of ${AGENTS.join("|")}`); ok = false; }
  if (new Set(v).size !== v.length) { problems.push(`${field} lists an agent more than once`); ok = false; }
  return ok ? (v as AgentLabel[]) : null;
}

/** Schema problems of ONE raw outcome (empty = valid). Strict: unknown keys are problems. */
export function outcomeProblems(raw: unknown): string[] {
  const p: string[] = [];
  if (!isObj(raw)) return ["outcome is not a JSON object"];
  for (const k of Object.keys(raw)) if (!(OUTCOME_KEYS as readonly string[]).includes(k)) p.push(`unexpected key ${JSON.stringify(k)}`);
  if (typeof raw.id !== "string" || !raw.id.length) p.push("id must be a non-empty string");
  if (!(OBSERVED_STAGES as readonly unknown[]).includes(raw.stage)) p.push(`stage must be one of ${OBSERVED_STAGES.join("|")}`);
  const sel = agentList(raw.selected, "selected", p);
  const def = agentList(raw.deferred, "deferred", p);
  const dis = agentList(raw.deferredDisclosed, "deferredDisclosed", p);
  if (raw.executedAgents !== undefined) {
    const exe = agentList(raw.executedAgents, "executedAgents", p);
    if (exe && raw.stage !== "REACHED_ROUTING" && exe.length) p.push(`executedAgents must be [] when stage is ${String(raw.stage)}`);
    if (exe && sel && exe.some((a) => !sel.includes(a))) p.push("executedAgents must be a subset of selected");
  }
  if (sel && raw.stage !== "REACHED_ROUTING" && sel.length) p.push(`selected must be [] when stage is ${String(raw.stage)} (only a turn that reached routing selects agents)`);
  if (sel && def && def.some((a) => sel.includes(a))) p.push("an agent cannot be both selected and deferred");
  if (def && dis && dis.some((a) => !def.includes(a))) p.push("deferredDisclosed must be a subset of deferred");
  if (raw.usage !== undefined) {
    if (!isObj(raw.usage)) p.push("usage must be an object");
    else {
      for (const k of Object.keys(raw.usage)) if (!(USAGE_KEYS as readonly string[]).includes(k)) p.push(`unexpected usage key ${JSON.stringify(k)}`);
      for (const k of USAGE_KEYS) { const v = (raw.usage as Record<string, unknown>)[k]; if (typeof v !== "number" || !Number.isFinite(v) || v < 0) p.push(`usage.${k} must be a finite number >= 0`); }
    }
  }
  return p;
}

/** Parses JSONL text into raw outcomes. Malformed lines become OUTCOME_MALFORMED_JSON errors (index = 1-based line). */
export function parseOutcomesJsonl(text: string): { raw: unknown[]; errors: OutcomeError[] } {
  const raw: unknown[] = []; const errors: OutcomeError[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try { raw.push(JSON.parse(line)); } catch (e) { errors.push({ code: "OUTCOME_MALFORMED_JSON", id: null, index: i + 1, detail: (e as Error).message }); }
  });
  return { raw, errors };
}

export interface ReconcileResult { ok: boolean; errors: OutcomeError[]; byId: Map<string, EvalOutcome> }
/** Exactly ONE outcome per dataset case id. `caseIds` is the validated dataset's id list. */
export function reconcileOutcomes(caseIds: readonly string[], raw: readonly unknown[], priorErrors: readonly OutcomeError[] = []): ReconcileResult {
  const errors: OutcomeError[] = [...priorErrors];
  const known = new Set(caseIds);
  const seen = new Map<string, number[]>();
  const byId = new Map<string, EvalOutcome>();
  raw.forEach((o, index) => {
    const problems = outcomeProblems(o);
    const id = isObj(o) && typeof o.id === "string" && o.id.length ? o.id : null;
    if (problems.length) errors.push({ code: "OUTCOME_SCHEMA_INVALID", id, index, detail: problems.join("; ") });
    if (id !== null) seen.set(id, [...(seen.get(id) ?? []), index]);
  });
  for (const [id, idxs] of seen) {
    if (!known.has(id)) errors.push({ code: "OUTCOME_UNKNOWN_ID", id, index: idxs[0], detail: `outcome id ${JSON.stringify(id)} is not a case of the dataset` });
    if (idxs.length > 1) errors.push({ code: "OUTCOME_DUPLICATE", id, index: idxs[1], detail: `${idxs.length} outcomes for the same case (indexes ${idxs.join(", ")})` });
  }
  // a case whose only outcome is schema-invalid is already reported (SCHEMA_INVALID) — it is not ALSO reported missing
  for (const id of caseIds) if (!seen.has(id)) errors.push({ code: "OUTCOME_MISSING", id, index: null, detail: "the dataset case has no outcome" });
  if (!errors.length) for (const o of raw as EvalOutcome[]) byId.set(o.id, o);
  return { ok: errors.length === 0, errors, byId };
}

/**
 * ELIGIBILITY (CODE AUDIT vs the contract): EVERY dataset case needs exactly one outcome — not only the routing-scored ones.
 * Grounding: decision sheet §9(c) "đúng một outcome cho mỗi case×cấu hình×lần lặp, từ chối thiếu/trùng/NOT_EVALUABLE trong mẫu số";
 * and the safety / OOS-preflight / validation / long-question groups are scored from the OBSERVED STAGE of their case, so a case that is
 * not routing-scored still needs an outcome (it is reported in its own group). An outcome for any id that is not a dataset case is
 * OUTCOME_UNKNOWN_ID; there is no "ineligible but present" state.
 */
export const ELIGIBILITY_RULE = "every dataset case: exactly one outcome (routing-scored cases feed G7/G8; all others feed their own preflight / validation / long-question group)";
export const eligibleCaseIds = (rows: ReadonlyArray<{ id: string }>): string[] => rows.map((r) => r.id);
