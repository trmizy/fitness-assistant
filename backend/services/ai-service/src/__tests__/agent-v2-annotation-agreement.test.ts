/** M7-P5A.1 - inter-annotator agreement metrics. Expected values are hand-computed in the comments. TEST FIXTURE only. */
import test from "node:test";
import assert from "node:assert/strict";
import { computeAgreement } from "./m7-benchmark/annotation-agreement";
import type { CaseLabel, Interpretation, Safety } from "./m7-benchmark/annotation-schema";
import type { AgentLabel } from "./m5-benchmark/dataset-v1";

const T: AgentLabel = "training", N: AgentLabel = "nutrition", R: AgentLabel = "recovery", P: AgentLabel = "progress";
function lab(agents: AgentLabel[], o: Partial<CaseLabel> = {}): CaseLabel {
  const category = agents.length === 0 ? "OOS" : agents.length === 1 ? "SINGLE" : agents.length === 2 ? "TWO" : "MULTI";
  return { domains: agents.map((agent) => ({ agent, role: "request" as const })), primaryAgent: agents[0] ?? null, category, safety: "NONE", expectedPreRouting: "ALLOW", ...o };
}
const interp = (agents: AgentLabel[]): Interpretation => ({ domains: agents.map((agent) => ({ agent, role: "request" as const })), primaryAgent: agents[0], rationale: "r" });
const amb = (...its: AgentLabel[][]): CaseLabel => ({ domains: [], primaryAgent: null, category: "AMBIGUOUS", safety: "NONE", expectedPreRouting: "ALLOW", interpretations: its.map(interp) });
const rep = (n: number, a: CaseLabel, b: CaseLabel, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, a, b }));
const near = (x: number | undefined, y: number, d = 5e-4) => assert.ok(x !== undefined && Math.abs(x - y) <= d, `${x} != ${y}`);

test("2x2 example: n=10, kappa(training) = 0.348, PABAK = 0.4", () => {
  // yy=5, yn=1, ny=2, nn=2 -> p_o = 7/10 = 0.7; pA = 6/10, pB = 7/10; p_e = .6*.7 + .4*.3 = 0.54; kappa = .16/.46 = 0.3478
  const pairs = [...rep(5, lab([T]), lab([T]), "yy"), ...rep(1, lab([T]), lab([N]), "yn"), ...rep(2, lab([N]), lab([T]), "ny"), ...rep(2, lab([N]), lab([N]), "nn")];
  const r = computeAgreement(pairs).withAmbiguous;
  const m = r.perAgentKappa.training;
  assert.deepEqual(m.counts, { aYesBYes: 5, aYesBNo: 1, aNoBYes: 2, aNoBNo: 2 });
  near(m.kappa.p_o, 0.7); near(m.kappa.p_e, 0.54); near(m.kappa.value, 0.348);
  near(m.pabak, 0.4); near(m.prevalence.A, 0.6); near(m.prevalence.B, 0.7); near(m.prevalence.pooled, 0.65);
  assert.equal(m.n, 10);
  assert.equal(m.percent, 70);
  assert.deepEqual(r.disagreements["agent:training"], ["yn0", "ny0", "ny1"]);
});

test("perfect agreement with variation: kappa = 1; constant variables are undefined (never 1 or 0)", () => {
  const ls = [lab([T]), lab([N]), lab([T, N]), lab([])];
  const pairs = ls.map((l, i) => ({ id: `c${i}`, a: l, b: l }));
  const r = computeAgreement(pairs).withAmbiguous;
  assert.equal(r.perAgentKappa.training.kappa.value, 1);   // yes in 2 of 4 for both: p_o=1, p_e=.5
  assert.equal(r.perAgentKappa.nutrition.kappa.value, 1);
  // recovery / progress never present: p_e = 1 -> undefined with reason
  for (const ag of [R, P] as const) {
    const k = r.perAgentKappa[ag].kappa;
    assert.equal(k.value, undefined); assert.match(k.reason ?? "", /1 - p_e = 0/);
    assert.equal(k.p_o, 1); assert.equal(k.p_e, 1);
  }
  assert.equal(r.macroKappa.definedCount, 2); assert.equal(r.macroKappa.undefinedCount, 2); near(r.macroKappa.value, 1);
  // safety / preRouting constant -> undefined, but percent agreement is still 100
  assert.equal(r.safety.percent, 100); assert.equal(r.safety.kappa.value, undefined);
  assert.equal(r.expectedPreRouting.kappa.value, undefined);
  assert.equal(r.exactRequiredSet.percent, 100); assert.equal(r.fullOrderedList.percent, 100);
});

test("chance-level disagreement: kappa = 0; systematic opposition: kappa = -1", () => {
  // yy=1,yn=1,ny=1,nn=1: p_o=.5, p_e=.5 -> 0
  const chance = [{ id: "a", a: lab([T]), b: lab([T]) }, { id: "b", a: lab([T]), b: lab([N]) }, { id: "c", a: lab([N]), b: lab([T]) }, { id: "d", a: lab([N]), b: lab([N]) }];
  const k0 = computeAgreement(chance).withAmbiguous.perAgentKappa.training;
  assert.equal(k0.kappa.value, 0); assert.equal(k0.pabak, 0);
  // yn=2, ny=2: p_o=0, p_e=.5 -> -1
  const opp = [...rep(2, lab([T]), lab([N]), "x"), ...rep(2, lab([N]), lab([T]), "y")];
  const k1 = computeAgreement(opp).withAmbiguous.perAgentKappa.training;
  near(k1.kappa.value, -1); assert.ok((k1.kappa.value as number) <= 0); near(k1.pabak, -1);
});

test("multi-class kappa (primary): n=6, kappa = 0.5", () => {
  // A: T T N N R R ; B: T N N N R T -> matches 4/6; pA(T,N,R)=2/6 each; pB: T 2/6, N 3/6, R 1/6
  // p_e = (2*2 + 2*3 + 2*1)/36 = 1/3 ; kappa = (2/3 - 1/3)/(2/3) = 0.5
  const a = [T, T, N, N, R, R], b = [T, N, N, N, R, T];
  const pairs = a.map((x, i) => ({ id: `p${i}`, a: lab([x]), b: lab([b[i]]) }));
  const r = computeAgreement(pairs).withAmbiguous;
  near(r.primary.kappa.p_o, 4 / 6); near(r.primary.kappa.p_e, 1 / 3); near(r.primary.kappa.value, 0.5);
  near(r.primary.percent, 66.667, 1e-2);
  assert.deepEqual(r.disagreements.primary, ["p1", "p5"]);
  assert.equal(r.prevalence.primary[N].A.count, 2); assert.equal(r.prevalence.primary[N].B.count, 3); assert.equal(r.prevalence.primary[N].pooled.count, 5);
  near(r.prevalence.primary[N].pooled.share, 5 / 12);
  assert.equal(r.prevalence.primary["null"].pooled.count, 0);
});

test("category / safety / expectedPreRouting / OOS metrics", () => {
  // 4 cases. category A: SINGLE SINGLE OOS TWO ; B: SINGLE TWO OOS TWO -> p_o .75
  const pairs = [
    { id: "k0", a: lab([T]), b: lab([T]) },
    { id: "k1", a: lab([T]), b: lab([T, N]) },
    { id: "k2", a: lab([], { safety: "MINOR" as Safety }), b: lab([], { safety: "NONE" as Safety }) },
    { id: "k3", a: lab([T, N], { expectedPreRouting: "SAFETY_BLOCK" }), b: lab([T, N]) },
  ];
  const r = computeAgreement(pairs).withAmbiguous;
  assert.equal(r.category.percent, 75); assert.deepEqual(r.disagreements.category, ["k1"]);
  assert.equal(r.safety.percent, 75); assert.deepEqual(r.disagreements.safety, ["k2"]);
  assert.equal(r.expectedPreRouting.percent, 75); assert.deepEqual(r.disagreements.expectedPreRouting, ["k3"]);
  // OOS: both annotators say OOS only for k2 -> yy=1, nn=3, p_o=1, kappa=1 (variable varies)
  assert.equal(r.oos.kappa.value, 1); assert.deepEqual(r.oos.counts, { aYesBYes: 1, aYesBNo: 0, aNoBYes: 0, aNoBNo: 3 });
  // safety: A NONE x3 + MINOR, B NONE x4 -> p_o=.75, pA(NONE)=.75, pB(NONE)=1 -> p_e=.75 -> kappa 0
  assert.equal(r.safety.kappa.value, 0);
  assert.equal(r.prevalence.safety.MINOR.A.count, 1); assert.equal(r.prevalence.safety.MINOR.B.count, 0);
  assert.equal(r.prevalence.expectedPreRouting.SAFETY_BLOCK.pooled.count, 1);
});

test("ordered first-two disagrees while exact set agrees (A [T,N,R] vs B [T,R,N])", () => {
  const pairs = [{ id: "o1", a: lab([T, N, R]), b: lab([T, R, N]) }];
  const r = computeAgreement(pairs).withAmbiguous;
  assert.equal(r.exactRequiredSet.percent, 100);      // {T,N,R} = {T,R,N}
  assert.equal(r.orderedFirstTwo.percent, 0);         // would run {T,N} vs {T,R}
  assert.equal(r.fullOrderedList.percent, 0);
  assert.equal(r.primary.percent, 100);               // both T
  assert.deepEqual(r.disagreements.orderedFirstTwo, ["o1"]);
  assert.deepEqual(r.disagreements.exactRequiredSet, []);
  // same set and same first two but swapped within first two: first-two (set) agrees, full ordered does not
  const sw = computeAgreement([{ id: "o2", a: lab([T, N]), b: lab([N, T]) }]).withAmbiguous;
  assert.equal(sw.orderedFirstTwo.percent, 100); assert.equal(sw.fullOrderedList.percent, 0); assert.equal(sw.primary.percent, 0);
  // role difference breaks the full ordered list only
  const supportB = lab([T, N]); supportB.domains[1] = { agent: N, role: "support", supports: T };
  const ro = computeAgreement([{ id: "o3", a: lab([T, N]), b: supportB }]).withAmbiguous;
  assert.equal(ro.exactRequiredSet.percent, 100); assert.equal(ro.fullOrderedList.percent, 0);
});

test("AMBIGUOUS: included (union semantics) and excluded blocks", () => {
  const pairs = [
    { id: "amb", a: amb([T, N], [N, T]), b: amb([T], [T, R]) },   // union A {T,N}, union B {T,R}
    { id: "ok", a: lab([T]), b: lab([T]) },
  ];
  const r = computeAgreement(pairs);
  assert.deepEqual(r.ambiguousIds, ["amb"]);
  assert.equal(r.n, 2);
  assert.equal(r.withAmbiguous.n, 2); assert.equal(r.excludingAmbiguous.n, 1);
  assert.equal(r.withAmbiguous.exactRequiredSet.percent, 50);       // amb: {T,N} vs {T,R} disagree
  assert.deepEqual(r.withAmbiguous.disagreements.exactRequiredSet, ["amb"]);
  assert.equal(r.excludingAmbiguous.exactRequiredSet.percent, 100);
  assert.equal(r.withAmbiguous.category.percent, 100);              // both AMBIGUOUS / SINGLE
  assert.equal(r.withAmbiguous.perAgentKappa.nutrition.counts.aYesBNo, 1);   // A has N via union, B does not
  assert.equal(r.withAmbiguous.perAgentKappa.recovery.counts.aNoBYes, 1);
  assert.equal(r.excludingAmbiguous.perAgentKappa.nutrition.kappa.value, undefined);
  // acceptable-set union: A {T,N}, B {T}+{T,R} -> {T,R}: first-two disagrees
  assert.equal(r.withAmbiguous.orderedFirstTwo.percent, 50);
  assert.equal(r.withAmbiguous.fullOrderedList.percent, 50);
  // all-ambiguous input -> excluded block empty, nothing crashes
  const only = computeAgreement([pairs[0]]);
  assert.equal(only.excludingAmbiguous.n, 0); assert.equal(only.excludingAmbiguous.exactRequiredSet.percent, undefined);
});

test("empty input: n = 0 -> everything undefined, no crash", () => {
  const r = computeAgreement([]);
  assert.equal(r.n, 0); assert.deepEqual(r.ambiguousIds, []);
  for (const b of [r.withAmbiguous, r.excludingAmbiguous]) {
    assert.equal(b.n, 0);
    assert.equal(b.exactRequiredSet.percent, undefined); assert.equal(b.orderedFirstTwo.percent, undefined); assert.equal(b.fullOrderedList.percent, undefined);
    for (const m of [b.primary, b.category, b.safety, b.expectedPreRouting, b.oos]) {
      assert.equal(m.percent, undefined); assert.equal(m.kappa.value, undefined); assert.match(m.kappa.reason ?? "", /n = 0/);
    }
    for (const ag of ["training", "nutrition", "recovery", "progress"] as const) {
      assert.equal(b.perAgentKappa[ag].kappa.value, undefined); assert.equal(b.perAgentKappa[ag].pabak, undefined); assert.equal(b.perAgentKappa[ag].prevalence.pooled, undefined);
    }
    assert.equal(b.macroKappa.value, undefined); assert.equal(b.macroKappa.undefinedCount, 4);
    assert.equal(b.prevalence.category.SINGLE.pooled.share, undefined);
  }
});

test("never mutates input (deep-frozen input does not throw; snapshot unchanged)", () => {
  const deepFreeze = <X>(o: X): X => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
  const pairs = deepFreeze([
    { id: "m1", a: lab([T, N, R]), b: lab([T, R, N]) },
    { id: "m2", a: amb([T, N], [N, T]), b: amb([T], [T, R]) },
  ]);
  const before = JSON.stringify(pairs);
  computeAgreement(pairs);
  assert.equal(JSON.stringify(pairs), before);
});
