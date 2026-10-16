import { classifyGlobal, type GlobalRoute } from "./router";

export interface GlobalCase {
  id: string; cat: string; text: string;
  exp: { route: GlobalRoute; topic?: string; wf?: string; interrupts?: boolean; multi?: GlobalRoute[] };
  ctx: { active?: { wf: string; slot?: string }; proposal?: boolean };
}
type Tally = { n: number; ok: number };
const tally = (): Tally => ({ n: 0, ok: 0 });

export interface GlobalEvaluation {
  total: number;
  metrics: Record<string, Tally>;
  unsafeMisroutes: number;
  failures: string[];
  perCase: Array<{ id: string; text: string; got: string; expected: string; ok: boolean }>;
}

const fmt = (r: { route: string; topic?: string; workflow?: string }) => `${r.route}${r.topic ? `(${r.topic})` : r.workflow ? `(${r.workflow})` : ""}`;

export function evaluateGlobal(cases: GlobalCase[]): GlobalEvaluation {
  const m: Record<string, Tally> = {};
  for (const k of ["route", "readVsFind", "readVsRecommend", "workflowStart", "interruption", "switchCancel", "correction", "reference", "multiIntent", "topic", "knowledgeQa", "negation", "writeIsProposalOnly"]) m[k] = tally();
  const failures: string[] = [];
  const perCase: GlobalEvaluation["perCase"] = [];
  let unsafe = 0;
  const bump = (k: string, ok: boolean) => { m[k].n += 1; if (ok) m[k].ok += 1; };

  for (const c of cases) {
    const got = classifyGlobal(c.text, { active: c.ctx.active ?? null, proposal: c.ctx.proposal });
    const routeOk = got.route === c.exp.route;
    const topicOk = c.exp.topic ? got.topic === c.exp.topic : true;
    const wfOk = c.exp.wf ? got.workflow === c.exp.wf : true;
    const multiOk = c.exp.multi ? got.route === "MULTI" && JSON.stringify([...(got.multi ?? [])].sort()) === JSON.stringify([...c.exp.multi].sort()) : true;
    const interruptOk = c.exp.interrupts ? Boolean(got.interrupts) : true;
    const ok = routeOk && topicOk && wfOk && multiOk && interruptOk;
    perCase.push({ id: c.id, text: c.text, got: `${fmt(got)}${got.interrupts ? "+interrupt" : ""}`, expected: `${fmt({ route: c.exp.route, topic: c.exp.topic, workflow: c.exp.wf })}${c.exp.interrupts ? "+interrupt" : ""}`, ok });
    if (!ok) failures.push(`${c.id} [${c.cat}] "${c.text}" → ${fmt(got)}${got.interrupts ? "+interrupt" : ""}, expected ${fmt({ route: c.exp.route, topic: c.exp.topic, workflow: c.exp.wf })}${c.exp.interrupts ? "+interrupt" : ""}`);

    bump("route", routeOk);
    if (c.exp.topic && ["READ_STATE", "RECOMMEND", "WRITE_ACTION"].includes(c.exp.route)) bump("topic", topicOk && routeOk);
    if (c.exp.route === "READ_STATE" && ["PT_STATUS", "CONTRACT_STATUS", "PROGRAM_STATUS", "NUTRITION_PROGRAM", "SCHEDULE"].includes(c.exp.topic ?? "") && !c.ctx.active) bump("readVsFind", got.route === "READ_STATE");
    if (c.exp.route === "START_WORKFLOW" && !c.ctx.active) bump("readVsFind", got.route === "START_WORKFLOW");
    if ((c.exp.route === "READ_STATE" || c.exp.route === "RECOMMEND") && !c.ctx.active) bump("readVsRecommend", routeOk);
    if (c.exp.route === "START_WORKFLOW") bump("workflowStart", routeOk && wfOk);
    if (c.ctx.active) bump("interruption", ok);
    if (c.cat === "switch-cancel") bump("switchCancel", ok);
    if (c.exp.route === "CORRECTION") bump("correction", routeOk);
    if (c.cat === "reference") bump("reference", routeOk);
    if (c.exp.route === "MULTI" || c.exp.route === "EXPLAIN_AND_PROPOSE") bump("multiIntent", ok);
    if (c.exp.route === "KNOWLEDGE_QA") bump("knowledgeQa", routeOk);
    if (c.exp.route === "NEGATE_ACTION") bump("negation", routeOk);
    if (c.exp.route === "WRITE_ACTION") bump("writeIsProposalOnly", routeOk);

    // a turn that must NOT mutate anything (read/recommend/negation/QA) routed to something that can mutate
    const mutating = got.route === "START_WORKFLOW" || got.route === "SLOT_ANSWER" || got.route === "WRITE_ACTION";
    if (["READ_STATE", "RECOMMEND", "KNOWLEDGE_QA", "NEGATE_ACTION"].includes(c.exp.route) && mutating && !c.ctx.active) unsafe += 1;
  }
  return { total: cases.length, metrics: m, unsafeMisroutes: unsafe, failures, perCase };
}
export const pct = (t: Tally) => (t.n ? `${((t.ok / t.n) * 100).toFixed(1)}% (${t.ok}/${t.n})` : "n/a");
