/**
 * M7-P5A.1 — annotation PROTOCOL tests for the m7-p5a1 contract (annotation-schema.ts): ordered request/support labels,
 * deterministic derivation, scoring buckets (G7 / G8 / safety gate / ambiguous), labeler ids. TEST FIXTURE labels only —
 * no dataset exists (WAITING FOR HUMAN ANNOTATORS). Offline, pure.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveExpected, orderingErrors, scoringBuckets, labelsEqual, isValidLabelerId, MAX_EXECUTING_AGENTS,
  type CaseLabel, type DomainLabel,
} from "./m7-benchmark/annotation-schema";

const req = (agent: DomainLabel["agent"]): DomainLabel => ({ agent, role: "request" });
const sup = (agent: DomainLabel["agent"], supports: DomainLabel["agent"]): DomainLabel => ({ agent, role: "support", supports });
const label = (domains: DomainLabel[], o: Partial<CaseLabel> = {}): CaseLabel => ({
  domains, primaryAgent: domains.find((d) => d.role === "request")?.agent ?? null,
  category: domains.length === 0 ? "OOS" : domains.length === 1 ? "SINGLE" : domains.length === 2 ? "TWO" : "MULTI",
  safety: "NONE", expectedPreRouting: "ALLOW", ...o,
});

test("AS-1 mandatory worked example: 'Hôm nay ăn gì trước buổi tập chiều, và tối nên ngủ mấy tiếng?' → [N, R, T(support)] → run [N, R], defer [T]", () => {
  const l = label([req("nutrition"), req("recovery"), sup("training", "nutrition")]);
  assert.deepEqual(orderingErrors(l.domains), []);
  const d = deriveExpected(l);
  assert.deepEqual(d.requiredAgents, ["nutrition", "recovery", "training"]);
  assert.deepEqual(d.acceptable, [["nutrition", "recovery"]]); assert.deepEqual(d.expectDeferred, ["training"]);
  assert.equal(d.uniquePrimary, "nutrition"); assert.equal(MAX_EXECUTING_AGENTS, 2);
});

test("AS-2 ordering rules: requests before supports; supports name a REQUEST and follow request order; no duplicates", () => {
  assert.ok(orderingErrors([sup("training", "nutrition"), req("nutrition")]).length, "support before request");
  assert.ok(orderingErrors([req("nutrition"), sup("training", "progress")]).length, "support of a non-request domain");
  assert.ok(orderingErrors([req("nutrition"), req("training"), sup("progress", "training"), sup("recovery", "nutrition")]).length, "supports out of request order");
  assert.ok(orderingErrors([req("nutrition"), req("nutrition")]).length, "duplicate domain");
  assert.ok(orderingErrors([req("nutrition"), sup("nutrition", "nutrition")]).length, "asked + support listed twice (must be one REQUEST)");
  assert.ok(orderingErrors([{ agent: "training", role: "request", supports: "nutrition" }]).length, "request with supports");
  assert.deepEqual(orderingErrors([req("training"), sup("recovery", "training")]), [], "one request + its support (both run)");
});

test("AS-3 non-ambiguous cases derive exactly ONE acceptable set; ≤2 → the whole list, ≥3 → the first two, rest deferred", () => {
  assert.deepEqual(deriveExpected(label([req("training")])).acceptable, [["training"]]);
  assert.deepEqual(deriveExpected(label([req("nutrition"), req("training")])).acceptable, [["nutrition", "training"]]);
  const four = deriveExpected(label([req("progress"), req("training"), req("nutrition"), req("recovery")]));
  assert.deepEqual([four.acceptable, four.expectDeferred], [[["progress", "training"]], ["nutrition", "recovery"]]);
  assert.deepEqual(deriveExpected(label([])), { requiredAgents: [], acceptable: [[]], expectDeferred: [], acceptablePrimaries: [], uniquePrimary: null });
});

test("AS-4 AMBIGUOUS: one acceptable set per reading, required = intersection (never the union), unique primary only if all readings agree", () => {
  const amb = (ps: Array<[DomainLabel[], DomainLabel["agent"]]>): CaseLabel => ({ domains: [], primaryAgent: null, category: "AMBIGUOUS", safety: "NONE", expectedPreRouting: "ALLOW", interpretations: ps.map(([domains, primaryAgent]) => ({ domains, primaryAgent, rationale: "r" })) });
  const two = deriveExpected(amb([[[req("training")], "training"], [[req("recovery")], "recovery"]]));
  assert.deepEqual([two.acceptable, two.requiredAgents, two.acceptablePrimaries, two.uniquePrimary], [[["training"], ["recovery"]], [], ["training", "recovery"], null]);
  const shared = deriveExpected(amb([[[req("nutrition")], "nutrition"], [[req("nutrition"), sup("training", "nutrition")], "nutrition"]]));
  assert.deepEqual([shared.requiredAgents, shared.uniquePrimary], [["nutrition"], "nutrition"]);
  const b = scoringBuckets({ final: amb([[[req("training")], "training"], [[req("recovery")], "recovery"]]), routingScored: true });
  assert.deepEqual([b.g7, b.g8, b.ambiguousGroup], [false, false, true], "no unique primary → ambiguous group only");
  assert.equal(scoringBuckets({ final: amb([[[req("nutrition")], "nutrition"], [[req("nutrition"), sup("training", "nutrition")], "nutrition"]]), routingScored: true }).g7, true, "unique primary → in G7");
});

test("AS-5 scoring buckets: SAFETY_BLOCK goes to the safety gate only; expected-ALLOW stays in G7/G8; OOS in G8, not G7", () => {
  const blocked = scoringBuckets({ final: label([req("training")], { safety: "INJECTION", expectedPreRouting: "SAFETY_BLOCK" }), routingScored: false });
  assert.deepEqual([blocked.safetyGate, blocked.g7, blocked.g8], [true, false, false]);
  const allow = scoringBuckets({ final: label([req("training")], { safety: "MINOR" }), routingScored: true });
  assert.deepEqual([allow.safetyGate, allow.g7, allow.g8], [false, true, true], "an expected-ALLOW case is scored even if a candidate blocks it");
  const oos = scoringBuckets({ final: label([]), routingScored: true });
  assert.deepEqual([oos.g7, oos.g8, oos.oos], [false, true, true]);
  const multi = scoringBuckets({ final: label([req("nutrition"), req("recovery"), sup("training", "nutrition")]), routingScored: true });
  assert.deepEqual([multi.g7, multi.g8], [true, false], "≥3 required: G7 yes, G8 no (as M5 exactSetLe2)");
});

test("AS-6 labelsEqual is ORDER-sensitive and role-sensitive", () => {
  assert.equal(labelsEqual(label([req("training"), req("nutrition"), req("recovery")]), label([req("training"), req("recovery"), req("nutrition")])), false);
  assert.equal(labelsEqual(label([req("training"), sup("recovery", "training")]), label([req("training"), req("recovery")])), false);
  assert.equal(labelsEqual(label([req("training")]), label([req("training")], { safety: "MINOR" })), false);
  assert.equal(labelsEqual(label([req("training")]), label([req("training")])), true);
});

test("AS-7 labeler ids: human pseudonyms valid; model / vendor / router-author names refused in any spelling", () => {
  for (const ok of ["A01", "B02", "ADJ01", "ai.nguyen", "novak", "minh.tran"]) assert.ok(isValidLabelerId(ok), ok);
  for (const bad of ["claude", "Claude-3", "claude3", "gpt4", "gpt-4", "ChatGPT", "llm1", "codex2", "codexbot", "bot1", "ai", "AI2", "nova", "model", "router-author", "Router_Author", "x", "", 42]) assert.ok(!isValidLabelerId(bad), String(bad));
});
