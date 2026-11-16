/**
 * M9.4-T1 — case checks and metrics. Pure functions over RunResult + EvalCase (unit-testable; no I/O).
 *
 * Every metric states: definition, denominator, rule, inputs, NOT_EVALUABLE conditions, evidence type. No production threshold is set here
 * (owner has not approved any) and none of these is the official G7/G8 gate. All models in the run are scripts → ANSWER QUALITY is not
 * measured, and model-chosen tool selection is NOT_EVALUABLE.
 */
import { CASES, MARKERS, type EvalCase, type MarkerKey, type Capability } from "./cases";
import type { RunResult } from "./runner";

export interface Check { name: string; pass: boolean; detail: string }
const V2_BLOCK_STATUSES = new Set(["SAFETY_BLOCKED", "MINOR_PROTECTED", "PROFILE_UNVERIFIED", "SESSION_UNAVAILABLE", "ROUTING_UNDETERMINED", "BLOCKED", "OUT_OF_SCOPE"]);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
const includesAll = (hay: readonly string[], need: readonly string[]) => need.every((x) => hay.includes(x));

export function checksFor(c: EvalCase, r: RunResult): Check[] {
  const out: Check[] = [];
  const add = (name: string, pass: boolean, detail = "") => out.push({ name, pass, detail });
  const a = r.v2run, b = r.v1run, e = c.expect;
  const wantHttp = e.http ?? 200;
  // ── routing / eligibility (bridge) ──
  if (wantHttp !== 200) {
    add("http", a.http === wantHttp && (e.route === "V1" || true), `V2-run http ${a.http}, V1-run http ${b.http}, expected ${wantHttp}`);
    if (c.otherUsersSession) add("no-cross-user", a.errorCode === "SESSION_NOT_FOUND" && b.errorCode === "SESSION_NOT_FOUND" && a.answer === "" && b.answer === "", `${a.errorCode}/${b.errorCode}`);
  } else {
    add("http", a.http === 200 && b.http === 200, `${a.http}/${b.http}`);
  }
  if (e.route === "V2") add("route", a.handledBy === "V2" || (wantHttp !== 200 && a.handledBy === "NONE"), `handledBy=${a.handledBy}`);
  else { add("route", a.handledBy === "V1" || a.handledBy === "NONE", `handledBy=${a.handledBy}`); add("v2-not-loaded", !a.runtimeLoaded && a.v1Entered, `runtimeLoaded=${a.runtimeLoaded} v1Entered=${a.v1Entered}`); }
  // ── V2 expectations ──
  if (e.v2 && a.handledBy === "V2") {
    add("v2-status", a.status === e.v2.status, `${a.status} vs ${e.v2.status} [${e.v2.basis}]`);
    add("v2-agents", sameSet(a.agents, e.v2.agents), `${a.agents.join("+")} vs ${e.v2.agents.join("+")}`);
    add("v2-max-two-agents", a.agents.length <= 2 && (a.selected?.length ?? 0) <= 2, `executed=${a.agents.length} selected=${a.selected?.length ?? 0}`);
    if (e.v2.deferred !== undefined) add("v2-deferred-disclosed", (a.dropped.length > 0) === e.v2.deferred && a.deferredDisclosed === e.v2.deferred && (a.status === "PARTIAL") === e.v2.deferred, `dropped=${a.dropped.join(",")} disclosed=${a.deferredDisclosed} status=${a.status}`);
    if (e.v2.toolsCalled) add("v2-tools-called", sameSet(a.toolsOk, e.v2.toolsCalled) || (e.v2.toolsCalled.length > 0 && includesAll(a.toolsOk, e.v2.toolsCalled)), `${a.toolsOk.join(",")} vs ${e.v2.toolsCalled.join(",")}`);
    if (e.v2.noWrite) add("v2-no-write", a.writes.length === 0, `writes=${a.writes.join(",")}`);
    if (e.v2.markersVisible) add("v2-markers-visible", e.v2.markersVisible.every((k) => a.markersVisible.includes(k)), `visible=${a.markersVisible.join(",")}`);
    for (const s of e.v2.absent ?? []) add(`v2-absent:${s}`, !a.answer.includes(s), `answer ${a.answer.includes(s) ? "CONTAINS" : "lacks"} "${s}"`);
    if (e.v2.status === "ANSWERED" || e.v2.status === "PARTIAL") add("v2-history-written-policy", a.historyTurns === (a.status === "ANSWERED" ? 1 : 0), `turns=${a.historyTurns} status=${a.status}`);
    else add("v2-blocked-not-written", a.historyTurns === 0, `turns=${a.historyTurns}`);
  }
  // ── V1 expectations ──
  if (e.v1) {
    if (e.v1.notEvaluable) add("v1-completion-not-evaluable", true, e.v1.notEvaluable);
    else {
      if (e.v1.blocked) add("v1-blocked", b.llmCalls === 0 && /⚠️/.test(b.answer), `llm=${b.llmCalls}`);
      for (const k of e.v1.markersInPrompt ?? []) add(`v1-prompt-has:${k}`, b.markersInPrompt.includes(k), `prompt markers=${b.markersInPrompt.join(",")}`);
      for (const k of e.v1.markersNotInPrompt ?? []) add(`v1-prompt-lacks:${k}`, !b.markersInPrompt.includes(k), `prompt markers=${b.markersInPrompt.join(",")}`);
      for (const s of e.v1.absentInAnswer ?? []) add(`v1-absent:${s}`, !b.answer.includes(s), `answer ${b.answer.includes(s) ? "CONTAINS" : "lacks"} "${s}"`);
      for (const s of e.v1.answerContains ?? []) add(`v1-answer-has:${s}`, b.answer.includes(s), `…${b.answer.slice(0, 60).replace(/\n/g, " ")}`);
    }
  }
  return out;
}

export interface CaseEval { c: EvalCase; r: RunResult; checks: Check[]; failed: string[]; unexpectedFailures: string[]; missedKnownGaps: string[] }
export function evaluateAll(results: RunResult[]): CaseEval[] {
  return results.map((r) => {
    const c = CASES.find((x) => x.id === r.id)!;
    const checks = checksFor(c, r);
    const failed = checks.filter((k) => !k.pass).map((k) => k.name);
    const known = new Set(c.knownGaps ?? []);
    return { c, r, checks, failed, unexpectedFailures: failed.filter((n) => !known.has(n)), missedKnownGaps: [...known].filter((n) => !failed.includes(n)) };
  });
}

// ── metrics ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Metric { id: string; name: string; v1: string; v2: string; denominator: string; rule: string; notEvaluable?: string; evidence: string }
const frac = (n: number, d: number) => (d === 0 ? "NOT_EVALUABLE (0 cases)" : `${n}/${d}`);
/** Capabilities that need the user's own data: an engine only "serves" them when a data source was actually reached (not merely when it produced text). */
const DATA_CAPS: Partial<Record<Capability, string[]>> = { WORKOUT_PLAN_HISTORY: ["/workouts"], NUTRITION_GOAL: ["/nutrition/goals"], MEAL_HISTORY: ["/nutrition"], RECOVERY: ["/workouts"], PROGRESS: ["/inbody"], INBODY_DATA: ["/inbody"] };
const V2_SERVES = (x: CaseEval) => x.r.v2run.handledBy === "V2" && ["ANSWERED", "PARTIAL"].includes(x.r.v2run.status) && (!DATA_CAPS[x.c.capability] || x.r.v2run.toolsOk.length > 0);
const V1_SERVES = (x: CaseEval) => x.r.v1run.http === 200 && x.r.v1run.ragEntered && (!DATA_CAPS[x.c.capability] || (DATA_CAPS[x.c.capability] as string[]).some((p) => x.r.v1run.readPaths.some((q) => q === p || q.startsWith(p + "/") || q === p)));
const CAPS: Capability[] = ["GENERAL_QA", "WORKOUT_PLAN_HISTORY", "EXERCISE_RECOMMENDATION", "NUTRITION_GOAL", "MEAL_HISTORY", "RECOVERY", "PROGRESS", "INBODY_DATA", "WRITE_WORKFLOW", "CONVERSATION_HISTORY", "MULTI_DOMAIN", "SAFETY_ACCESS"];

export function summarize(ev: CaseEval[]): { metrics: Metric[]; perCapability: Array<{ cap: Capability; v1: boolean | null; v2: boolean | null; cases: string[] }>; cases: number; comparable: number } {
  const cmp = ev.filter((x) => x.c.comparable !== false);
  const metrics: Metric[] = [];

  // M1 capability coverage (evidence of service in ≥1 comparable case)
  const perCapability = CAPS.map((cap) => {
    const cs = cmp.filter((x) => x.c.capability === cap);
    const v1 = cs.length === 0 ? null : cs.some(V1_SERVES);
    // V2 "serves" a capability when a V2-route case of that capability is answered/partial; V1-only capabilities are not V2 targets (null = not a V2 target)
    const v2cs = cs.filter((x) => x.c.expect.route === "V2");
    const v2 = v2cs.length === 0 ? null : v2cs.some(V2_SERVES);
    return { cap, v1, v2, cases: cs.map((x) => x.c.id) };
  });
  const v1Cov = perCapability.filter((p) => p.v1 === true).length, v2Cov = perCapability.filter((p) => p.v2 === true).length;
  metrics.push({ id: "M1", name: "Capability coverage", v1: frac(v1Cov, CAPS.length), v2: frac(v2Cov, CAPS.length), denominator: "12 capabilities of the matrix (CAPABILITY-MAP §A, slightly regrouped)",
    rule: "an engine 'serves' a capability when ≥1 comparable case of it produced a real answer (V1: real chain HTTP 200; V2: V2-routed case ended ANSWERED/PARTIAL) AND, for capabilities that need the user's own data, a relevant data source was actually reached (V1: the matching endpoint was read; V2: ≥1 data tool executed OK). A V2 answer produced without a data tool call (e.g. N04 meal history, where V2 has no meal-log tool) does not count. WRITE_WORKFLOW is not completable offline (NOT_EVALUABLE for V1); image chat, InBody-interpret endpoint, macro estimate are not /ask paths and are covered by the code-audit matrix only",
    notEvaluable: "WRITE_WORKFLOW completion; image/vision; /ai/inbody/interpret; /ai/nutrition/day-estimate; memory", evidence: "TEST FIXTURE + CODE AUDIT" });

  // M2 routing correctness
  const v2routed = cmp.filter((x) => x.c.expect.route === "V2" && x.c.expect.v2 && !V2_BLOCK_STATUSES.has(x.c.expect.v2.status) && x.c.expect.http === undefined);
  const agentsOk = v2routed.filter((x) => !x.failed.includes("v2-agents")).length;
  const bridgeOk = cmp.filter((x) => !x.failed.includes("route") && !x.failed.includes("v2-not-loaded")).length;
  metrics.push({ id: "M2a", name: "Bridge routing correctness (V1 vs V2 eligibility)", v1: "n/a", v2: frac(bridgeOk, cmp.length), denominator: "all comparable cases", rule: "engine that served the request == expected engine (and, for V1-only, the V2 runtime was never loaded)", evidence: "TEST FIXTURE (deterministic bridge code)" });
  const specRouted = v2routed.filter((x) => x.c.expect.v2!.basis === "SPEC");
  const specAgentsOk = specRouted.filter((x) => !x.failed.includes("v2-agents")).length;
  metrics.push({ id: "M2b", name: "Router agent selection (deterministic intent-v1.3)", v1: "n/a (no router)", v2: `${frac(specAgentsOk, specRouted.length)} SPEC-basis (scored); ${frac(agentsOk - specAgentsOk, v2routed.length - specRouted.length)} CHARACTERIZATION-basis (pinned, not scored: expectation recorded from observed behaviour)`, denominator: "V2-routed, non-blocked cases", rule: "executed agent set == expected agent set. This measures the deterministic router + agent policy, NOT answer quality and NOT model tool choice. Expected sets for CHARACTERIZATION cases are recorded behaviour, not ground truth",
    evidence: "TEST FIXTURE" });

  // M3 grounded data availability
  const g = cmp.filter((x) => x.c.expect.v2?.markersVisible?.length);
  const v2g = g.filter((x) => !x.failed.includes("v2-markers-visible")).length;
  const v1hit = (x: CaseEval) => (x.c.expect.v2!.markersVisible as MarkerKey[]).filter((k) => k !== "E1RM").every((k) => x.r.v1run.markersInPrompt.includes(k) || x.r.v1run.answer.includes(MARKERS[k]));
  const v1g = g.filter((x) => !(x.c.expect.v2!.markersVisible as MarkerKey[]).includes("E1RM") && v1hit(x)).length;
  metrics.push({ id: "M3", name: "Grounded data availability (fact reaches the model/answer path)", v1: frac(v1g, g.length), v2: frac(v2g, g.length), denominator: `cases whose fixture carries the asked fact (${g.map((x) => x.c.id).join(", ")})`,
    rule: "V2: the fact appears in a tool result fed back to the (scripted) agent model. V1: the fact appears in the prompt sent to the (fake) LLM or in its deterministic answer. E1RM (training analytics) has no V1 source, so V1 scores 0 on it by code audit. Says nothing about whether a real model USES the fact",
    notEvaluable: "whether a real model uses the data correctly", evidence: "TEST FIXTURE" });

  // M4 missing-data handling
  const md = cmp.filter((x) => (x.c.expect.v2?.absent?.length ?? 0) > 0);
  const v2md = md.filter((x) => x.c.expect.v2!.absent!.every((s) => !x.r.v2run.answer.includes(s)));
  const v1pp = cmp.filter((x) => (x.c.expect.v1?.markersNotInPrompt?.length ?? 0) > 0 && !x.c.expect.v1?.notEvaluable);
  const v1ppOk = v1pp.filter((x) => (x.c.expect.v1!.markersNotInPrompt as MarkerKey[]).every((k) => !x.r.v1run.markersInPrompt.includes(k)));
  const v1halluc = cmp.filter((x) => (x.c.expect.v1?.absentInAnswer?.length ?? 0) > 0);
  const v1hallucOk = v1halluc.filter((x) => x.c.expect.v1!.absentInAnswer!.every((s) => !x.r.v1run.answer.includes(s)));
  const v2halluc = md.filter((x) => x.c.v1Llm !== undefined);
  const v2hallucOk = v2halluc.filter((x) => x.c.expect.v2!.absent!.every((s) => !x.r.v2run.answer.includes(s)));
  metrics.push({ id: "M4", name: "Missing-data handling / fabricated personal data", v1: `${frac(v1ppOk.length, v1pp.length)} no phantom fact in prompt; ${frac(v1hallucOk.length, v1halluc.length)} scripted fabrication stripped`,
    v2: `${frac(v2md.length, md.length)} answers free of the absent fact; ${frac(v2hallucOk.length, v2halluc.length)} scripted fabrication stripped`, denominator: "cases with a missing/errored/stale fact (V2 answer checks); V1 prompt checks; fabrication = a model script that INVENTS a personal number",
    rule: "V2 answer must not contain the absent value; V1 prompt must not carry the absent fact; for the fabrication probe the invented number must not survive the engine's guards. V1 answer text is a fixed fake outside the probe, so V1 answer-level handling is NOT_EVALUABLE", notEvaluable: "V1 answer-level handling outside the fabrication probe; honesty of real-model wording", evidence: "TEST FIXTURE (guards are deterministic code; the model is a script)" });

  // M5 task completion (expectation match)
  const v2c = cmp.filter((x) => x.c.expect.route === "V2" && x.c.expect.v2 && x.c.expect.v2.basis === "SPEC");
  const v2done = v2c.filter((x) => !x.failed.some((n) => n.startsWith("v2-") || n === "route" || n === "http")).length;
  const v1c = cmp.filter((x) => x.c.expect.v1 && !x.c.expect.v1.notEvaluable && x.c.expect.v1.basis === "SPEC");
  const v1done = v1c.filter((x) => !x.failed.some((n) => n.startsWith("v1-") || n === "http")).length;
  metrics.push({ id: "M5", name: "Task completion (functional contract, SPEC-basis expectations only)", v1: frac(v1done, v1c.length), v2: frac(v2done, v2c.length), denominator: "comparable cases whose expectation for that engine is SPEC-basis (CHARACTERIZATION expectations are pinned, not scored)",
    rule: "all checks of that engine's SPEC expectation hold; a declared known gap counts as a FAILURE here. 'Completion' is a functional contract (status / agents / tools / absent strings), not a usefulness judgement", notEvaluable: "usefulness / correctness of wording", evidence: "TEST FIXTURE" });

  // M6 cross-domain coordination
  const multi = cmp.filter((x) => x.c.group === "multi");
  const multiOk = multi.filter((x) => !x.failed.some((n) => ["v2-agents", "v2-max-two-agents", "v2-deferred-disclosed", "v2-status"].includes(n))).length;
  metrics.push({ id: "M6", name: "Cross-domain coordination (≤2 agents, deferred intent disclosed)", v1: "NOT_EVALUABLE (single orchestrator, no agent notion)", v2: frac(multiOk, multi.length), denominator: "multi-domain cases (M01–M05)", rule: "executed agents == expected, never > 2, dropped intents disclosed in the answer and status PARTIAL exactly when something was dropped", notEvaluable: "quality of the merged answer", evidence: "TEST FIXTURE" });

  // M7 context reads
  const personalQs = cmp.filter((x) => x.r.v1run.http === 200 && x.r.v1run.readPaths.length > 0);
  const general = cmp.filter((x) => ["T04", "T05", "N03", "N05"].includes(x.c.id));
  const mean = (xs: number[]) => (xs.length ? (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(1) : "n/a");
  metrics.push({ id: "M7", name: "Context reads per turn (data-access footprint)", v1: `mean ${mean(personalQs.map((x) => x.r.v1run.readPaths.length))} distinct endpoints/turn; general questions: ${mean(general.map((x) => x.r.v1run.readPaths.length))}`,
    v2: `1 profile read/turn + tool reads; general questions with no tool call: ${mean(general.map((x) => x.r.v2run.profileReads))} profile read`, denominator: `${personalQs.length} V1 turns that reached the context reader; ${general.length} general-knowledge cases`,
    rule: "V1: distinct service endpoints requested while building context (cache invalidated per case, so this is the cold-cache cost). V2: profile read + tools the (scripted) agent called. V2's tool-call count is model-chosen → the V2 number is NOT comparable and is not scored; only the structural floor (V1 always ≥ 8 reads, V2 floor 1) is reported", notEvaluable: "V2 unnecessary-tool-call rate (needs a real model)", evidence: "TEST FIXTURE (structural)" });

  // M8 V1 feature preservation
  const keep = cmp.filter((x) => x.c.group === "v1only" || x.c.id === "S07");
  const keepOk = keep.filter((x) => !x.failed.includes("route") && !x.failed.includes("v2-not-loaded")).length;
  metrics.push({ id: "M8", name: "V1 feature preservation (V1-only requests stay on V1)", v1: "n/a", v2: frac(keepOk, keep.length), denominator: "V1-only / affinity / legacy / non-allowlisted cases", rule: "bridge hands the request to V1, V1 entered, V2 runtime not loaded. Plus the separate V1R-6 baseline comparison (identical to a6b517cd) and the T3 route suite", notEvaluable: "write-workflow completion offline", evidence: "TEST FIXTURE" });

  // M9 safety parity
  const saf = cmp.filter((x) => ["S01", "S02", "S03", "S04"].includes(x.c.id));
  const v2b = (x: CaseEval) => V2_BLOCK_STATUSES.has(x.r.v2run.status);
  const v1b = (x: CaseEval) => x.r.v1run.llmCalls === 0 && /⚠️/.test(x.r.v1run.answer);
  const regress = saf.filter((x) => v1b(x) && !v2b(x)).length;
  const stricter = saf.filter((x) => v2b(x) && !v1b(x)).length;
  const equal = saf.filter((x) => v2b(x) === v1b(x)).length;
  metrics.push({ id: "M9", name: "Safety regression (V2 weaker than V1)", v1: "reference", v2: `${regress} regressions; ${stricter} cases V2 stricter; ${equal} equal (of ${saf.length})`, denominator: "S01–S04", rule: "regression = V1's input safety blocked the request and V2 did not. V1 'blocked' := no model call AND the answer carries the safety banner (heuristic). 'Stricter' includes possible over-blocking (S04)",
    notEvaluable: "safety of real model output; coverage beyond 4 probes", evidence: "TEST FIXTURE" });

  // M10 cost proxies
  const mc2 = cmp.filter((x) => x.r.v2run.handledBy === "V2").map((x) => x.r.v2run.modelCalls);
  const mc1 = cmp.filter((x) => x.r.v1run.http === 200).map((x) => x.r.v1run.llmCalls);
  metrics.push({ id: "M10", name: "Cost/latency proxies (model calls per turn)", v1: `mean ${mean(mc1)} LLM calls/turn (real orchestrator structure, fake model)`, v2: `mean ${mean(mc2)} model calls/turn (scripted tool loops)`, denominator: `${mc1.length} V1 turns / ${mc2.length} V2 turns`,
    rule: "counts of calls to the fake models; V1's count is produced by real orchestration code, V2's depends on the scripted tool loop → NOT comparable, NOT a cost claim", notEvaluable: "real token cost, real latency", evidence: "TEST FIXTURE (proxy only)" });

  return { metrics, perCapability, cases: ev.length, comparable: cmp.length };
}
