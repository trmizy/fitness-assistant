import { interpretDeterministic } from "./interpreter";

/**
 * Corpus evaluation for the semantic layer (used by the CI test and by test/conversational-intelligence/run-corpus.ts).
 * Reports each capability separately — never one vague "accuracy" — and counts the safety-critical errors on their own.
 */

export type CorpusCase = { id: string; cat: string; text: string; exp: Record<string, any>; ctx: Record<string, any> };
type Tally = { n: number; ok: number };

export interface CorpusEvaluation {
  totalCases: number;
  categories: number;
  metrics: Record<string, Tally>;
  unitMistakes: number;
  crossFieldContamination: number;
  confirmationBypasses: number;
  failures: string[];
  perCase: Array<{ id: string; ents: string[] }>;
}

const has = (list: Array<{ type: string; value: unknown; negated?: boolean }>, spec: string, negated = false) => {
  const [t, v] = spec.split("=");
  return list.some((e) => e.type === t && String(e.value) === v && Boolean(e.negated) === negated);
};

export function evaluateCorpus(cases: CorpusCase[]): CorpusEvaluation {
  const metrics: Record<string, Tally> = {};
  for (const k of ["intent", "entity", "goal", "correction", "recommendation", "reference", "ambiguity", "negation", "why", "workflow", "noEntity"]) metrics[k] = { n: 0, ok: 0 };
  const failures: string[] = [];
  const perCase: CorpusEvaluation["perCase"] = [];
  let unitMistakes = 0, crossFieldContamination = 0, confirmationBypasses = 0;
  const bump = (k: string, ok: boolean, id: string, why: string) => { metrics[k].n += 1; if (ok) metrics[k].ok += 1; else failures.push(`${id} [${k}] ${why}`); };

  for (const c of cases) {
    const i = interpretDeterministic(c.text, { expectedSlot: c.ctx.slot ?? null, persisted: c.ctx.cw ? { currentWeightKg: c.ctx.cw } : {}, proposal: c.ctx.proposal ?? null });
    const e = c.exp;
    perCase.push({ id: c.id, ents: i.entities.map((x) => `${x.type}=${x.value}`) });
    if (i.requestedAction === "EXECUTE_AFTER_CONFIRM") confirmationBypasses += 1;
    if (e.intent) bump("intent", i.primaryIntent === e.intent, c.id, `${c.text} → ${i.primaryIntent}, expected ${e.intent}`);
    for (const spec of e.ents ?? []) bump("entity", has(i.entities, spec), c.id, `${c.text} → missing ${spec}; got ${i.entities.map((x) => `${x.type}=${x.value}${x.negated ? "(neg)" : ""}`).join(",")}`);
    for (const spec of e.forbid ?? []) {
      if (i.entities.some((x) => !x.negated && `${x.type}=${x.value}` === spec)) {
        crossFieldContamination += 1;
        if (/^(WEIGHT_KG|TARGET_WEIGHT_KG|WEIGHT_UNLABELED)=/.test(spec)) unitMistakes += 1;
        failures.push(`${c.id} [FORBIDDEN] ${c.text} → produced ${spec}`);
      }
    }
    if (e.noEnt) bump("noEntity", i.entities.filter((x) => !x.negated).length === 0, c.id, `${c.text} → entities ${i.entities.map((x) => `${x.type}=${x.value}`).join(",")}`);
    for (const spec of e.corr ?? []) {
      const [f, nv] = spec.split(">");
      bump("correction", i.corrections.some((x) => x.field === f && String(x.newValue) === nv), c.id, `${c.text} → corrections ${JSON.stringify(i.corrections.map((x) => `${x.field}>${x.newValue}`))}`);
    }
    for (const spec of e.goal ?? []) {
      const neg = spec.endsWith("-");
      const [g, s] = neg ? [spec.slice(0, -1), ""] : spec.split(":");
      bump("goal", i.goalSignals.some((x) => x.goal === g && Boolean(x.negatesGoal) === neg && (neg || !s || x.strength[0] === s)), c.id, `${c.text} → goals ${JSON.stringify(i.goalSignals.map((x) => `${x.goal}${x.negatesGoal ? "-" : ""}:${x.strength[0]}`))}`);
    }
    if (e.rec) bump("recommendation", i.requestedAction === "SUGGEST", c.id, `${c.text} → ${i.primaryIntent}/${i.requestedAction}`);
    if (e.ref) bump("reference", i.references.some((r) => r.kind === e.ref), c.id, `${c.text} → refs ${JSON.stringify(i.references.map((r) => r.kind))}`);
    if (e.amb !== undefined) bump("ambiguity", (i.ambiguities.length > 0) === e.amb, c.id, `${c.text} → ambiguities ${i.ambiguities.length}, expected ${e.amb}`);
    for (const spec of e.neg ?? []) {
      const [t, v] = spec.split("=");
      const ok = v !== undefined ? i.negations.some((n) => n.target === t && String(n.value) === v) : i.negations.some((n) => n.target === t);
      bump("negation", ok, c.id, `${c.text} → negations ${JSON.stringify(i.negations.map((n) => `${n.target}=${n.value ?? ""}`))}`);
    }
    if (e.why) bump("why", Boolean(i.asksWhy), c.id, `${c.text} → asksWhy ${i.asksWhy}`);
    if (e.wf) bump("workflow", i.workflowIntent === e.wf, c.id, `${c.text} → ${i.workflowIntent}, expected ${e.wf}`);
  }
  return { totalCases: cases.length, categories: new Set(cases.map((c) => c.cat)).size, metrics, unitMistakes, crossFieldContamination, confirmationBypasses, failures, perCase };
}

export const pct = (t: Tally) => (t.n ? `${((t.ok / t.n) * 100).toFixed(1)}% (${t.ok}/${t.n})` : "n/a");
