import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluateSafetyEnvelope, answerKindAllowed, type AnswerKind } from "../llm/safety-envelope";
import type { SafetySignalResolution } from "../llm/safety-signals";
import type { SafetyNarrativeResolution } from "../llm/safety-narrative";
import {
  validateRow, findExactDuplicates, findNearDuplicates, findLeakage, assignFamilySplit, familyOverlap, blindExport,
  rawAgreement, cohenKappa, adjudicate, detectPii, parseCsv, toCsv, type AnnotationRow,
} from "../llm/query-routing-data/routing-data-tools";

const narrative = (o: Partial<SafetyNarrativeResolution> = {}): SafetyNarrativeResolution => ({
  level: "NONE", personal: false, general: false, signals: [], eventSignals: [], symptomSignals: [], temporalSignals: [], functionalSignals: [],
  expectedTrainingResponse: false, reasons: [], finalSafetyAction: "NORMAL_RAG", ...o,
});
const res = (level: SafetySignalResolution["level"], o: { personal?: boolean; n?: Partial<SafetyNarrativeResolution> } = {}): SafetySignalResolution => ({
  level, signals: [], namedCondition: false, personal: !!o.personal, reasons: [], narrative: narrative({ personal: !!o.personal, ...o.n }),
});

// ── safety envelope ─────────────────────────────────────────────────────────
test("4.7R6 envelope: ordinary fitness (no signal) is allowed", () => {
  const d = evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true }) });
  assert.equal(d.action, "ALLOW_NORMAL_FITNESS");
  assert.equal(d.state, "SAFE_CLEAR");
});

test("4.7R6 envelope: personal HIGH_RISK => SAFE_ABSTAIN; general HIGH_RISK knowledge => GENERAL_INFORMATION_ONLY", () => {
  assert.equal(evaluateSafetyEnvelope({ resolution: res("HIGH_RISK", { personal: true }) }).action, "SAFE_ABSTAIN");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("HIGH_RISK", { n: { general: true } }) }).action, "GENERAL_INFORMATION_ONLY");
});

test("4.7R6 envelope: CAUTION personal blocks personalisation unless it is a recognised expected training response", () => {
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true }) }).action, "GENERAL_INFORMATION_ONLY");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true, n: { expectedTrainingResponse: true } }) }).action, "ALLOW_NORMAL_FITNESS");
});

test("4.7R6 envelope: unexplained personal body-state material is SAFETY_UNCERTAIN and never falls through", () => {
  const d = evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true, n: { symptomSignals: ["x"] } }) });
  assert.equal(d.state, "SAFETY_UNCERTAIN");
  assert.equal(d.action, "SAFE_ABSTAIN");
  assert.ok(d.reasons.includes("PERSONAL_BODY_STATE_UNCLASSIFIED"));
});

test("4.7R6 envelope: general-knowledge phrasing and expected training response do not trigger uncertainty", () => {
  assert.equal(evaluateSafetyEnvelope({ resolution: res("NONE", { n: { general: true, symptomSignals: ["x"] } }) }).action, "ALLOW_NORMAL_FITNESS");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true, n: { expectedTrainingResponse: true, symptomSignals: ["doms"] } }) }).action, "ALLOW_NORMAL_FITNESS");
});

test("4.7R6 envelope: SAFE_ABSTAIN answers nothing but the abstention (CATALOG/PROGRAMMING/STRENGTH/HYPERTROPHY/personalised blocked)", () => {
  const blocked: AnswerKind[] = ["PERSONALIZED_RECOMMENDATION", "PROGRAMMING", "STRENGTH", "HYPERTROPHY", "CATALOG", "GENERAL_EDUCATION"];
  for (const k of blocked) assert.equal(answerKindAllowed("SAFE_ABSTAIN", k), false, k);
  assert.equal(answerKindAllowed("SAFE_ABSTAIN", "SAFETY_ABSTENTION"), true);
});

test("4.7R6 envelope: GENERAL_INFORMATION_ONLY allows education but no personalised / programming / catalog answers", () => {
  assert.equal(answerKindAllowed("GENERAL_INFORMATION_ONLY", "GENERAL_EDUCATION"), true);
  for (const k of ["PERSONALIZED_RECOMMENDATION", "PROGRAMMING", "STRENGTH", "HYPERTROPHY", "CATALOG"] as AnswerKind[]) assert.equal(answerKindAllowed("GENERAL_INFORMATION_ONLY", k), false, k);
});

test("4.7R6 envelope: a classifier can escalate but never downgrade", () => {
  const up = evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true }), classifierEscalates: true });
  assert.equal(up.action, "SAFE_ABSTAIN");
  assert.ok(up.reasons.includes("CLASSIFIER_ESCALATION"));
  for (const level of ["HIGH_RISK", "CAUTION"] as const) {
    const before = evaluateSafetyEnvelope({ resolution: res(level, { personal: true }) });
    const after = evaluateSafetyEnvelope({ resolution: res(level, { personal: true }), classifierSaysNormal: true });
    assert.equal(after.action, before.action);
    assert.ok(after.reasons.includes("CLASSIFIER_DOWNGRADE_IGNORED"));
  }
  const uncertain = evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true, n: { eventSignals: ["x"] } }), classifierSaysNormal: true });
  assert.equal(uncertain.action, "SAFE_ABSTAIN");
});

test("4.7R6 envelope: the module is inert (no production module imports it or the routing-data tooling)", () => {
  const root = path.resolve(__dirname, "..");
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(p); continue; }
      if (!p.endsWith(".ts") || /safety-envelope\.ts$|routing-data-tools\.ts$|routingAnnotationTool.ts$|routingSingleAudit.ts$|trainQueryClassifiers\.ts$/.test(p) || p.includes(`${path.sep}query-classifiers${path.sep}`) || p.includes(`${path.sep}query-routing-data${path.sep}`)) continue;
      if (/safety-envelope|routing-data-tools|query-classifiers\/classifier-runtime/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

// ── routing data tooling ────────────────────────────────────────────────────
const rows: AnnotationRow[] = [
  { id: "a", familyId: "F1", text: "Tuần trước mình mới mổ ruột thừa, tập chân được chưa" },
  { id: "b", familyId: "F1", text: "tuan truoc minh moi mo ruot thua tap chan duoc chua" },
  { id: "c", familyId: "F2", text: "Tuần trước mình mới mổ ruột thừa nên tập chân được chưa nhỉ" },
  { id: "d", familyId: "F3", text: "Nên tập ngực mấy buổi một tuần" },
];

test("4.7R6 data: schema validation catches empty text, missing id/family, PII, bad labels and non-pseudonymous annotators", () => {
  assert.deepEqual(validateRow(rows[3]), []);
  assert.ok(validateRow({ id: "", familyId: "", text: " " }).length >= 3);
  assert.ok(validateRow({ id: "x", familyId: "f", text: "gọi 0912345678 hoặc a@b.com" }).some((e) => e.includes("PII")));
  const labelled = { ...rows[3], annotator: "john doe@mail.com", safetyLabel: "MAYBE" };
  const errs = validateRow(labelled, { requireLabels: true });
  assert.ok(errs.some((e) => e.includes("pseudonymous")));
  assert.ok(errs.some((e) => e.includes("bad safetyLabel")));
  assert.deepEqual(validateRow({ ...rows[3], annotator: "A01", safetyLabel: "NORMAL_FITNESS", programmingLabel: "PROGRAMMING" }, { requireLabels: true }), []);
});

test("4.7R6 data: exact (accent-insensitive) and near duplicates are detected and kept distinct", () => {
  assert.deepEqual(findExactDuplicates(rows), [["a", "b"]]);
  const near = findNearDuplicates(rows);
  assert.ok(near.some((n) => (n.a === "a" && n.b === "c") || (n.a === "b" && n.b === "c")));
  assert.ok(!near.some((n) => n.a === "d" || n.b === "d"));
});

test("4.7R6 data: leakage against reference (V1-V5-style) sentences is flagged exact and near", () => {
  const refs = ["Nên tập ngực mấy buổi một tuần", "tuần trước mình mới mổ ruột thừa tập chân được chưa"];
  const leaks = findLeakage(rows, refs);
  assert.ok(leaks.some((l) => l.id === "d" && l.kind === "exact"));
  assert.ok(leaks.some((l) => l.id === "a"));
});

test("4.7R6 data: family split never places one family in two splits; overlap detector catches violations", () => {
  const fams = Array.from({ length: 40 }, (_, i) => `fam${i}`);
  const split = assignFamilySplit(fams);
  assert.equal(Object.keys(split).length, 40);
  assert.deepEqual(familyOverlap(fams.map((f) => ({ familyId: f, split: split[f] }))), []);
  assert.deepEqual(familyOverlap([{ familyId: "x", split: "train" }, { familyId: "x", split: "test" }]), ["x"]);
  assert.ok(new Set(Object.values(split)).size === 3);
});

test("4.7R6 data: blind export carries only id + text (no family, labels or predictions)", () => {
  const dirty = rows.map((r) => ({ ...r, safetyLabel: "SAFE_ABSTAIN", modelScore: 0.93, resolver: "HIGH_RISK" })) as AnnotationRow[];
  const out = blindExport(dirty);
  assert.equal(out.length, rows.length);
  for (const o of out) assert.deepEqual(Object.keys(o).sort(), ["id", "text"]);
  assert.deepEqual(blindExport(dirty).map((o) => o.id), out.map((o) => o.id)); // deterministic
});

test("4.7R6 data: raw agreement and Cohen's kappa", () => {
  const a = ["x", "x", "y", "y"], b = ["x", "y", "y", "y"];
  assert.equal(rawAgreement(a, b), 0.75);
  assert.ok(Math.abs(cohenKappa(a, b) - 0.5) < 1e-9);
  assert.equal(cohenKappa(["x", "y"], ["x", "y"]), 1);
});

test("4.7R6 data: a disagreement is resolved only by an explicit adjudication; policy ambiguity is never finalised", () => {
  const A = { 1: "SAFE_ABSTAIN", 2: "NORMAL_FITNESS", 3: "SAFE_ABSTAIN", 4: "NORMAL_FITNESS" } as Record<string, string>;
  const B = { 1: "SAFE_ABSTAIN", 2: "GENERAL_INFORMATION_ONLY", 3: "NORMAL_FITNESS", 4: "SAFE_ABSTAIN" } as Record<string, string>;
  const r = adjudicate(A, B, [
    { id: "2", finalLabel: "GENERAL_INFORMATION_ONLY", reasonClass: "ANNOTATOR_MISTAKE", adjudicator: "J01" },
    { id: "3", finalLabel: "SAFE_ABSTAIN", reasonClass: "POLICY_AMBIGUITY", adjudicator: "J01" },
  ]);
  assert.deepEqual(r.disagreements.sort(), ["2", "3", "4"]);
  assert.equal(r.final["1"], "SAFE_ABSTAIN");
  assert.equal(r.final["2"], "GENERAL_INFORMATION_ONLY");
  assert.equal(r.final["3"], undefined);
  assert.deepEqual(r.policyAmbiguous, ["3"]);
  assert.deepEqual(r.pending, ["4"]);
});

test("4.7R6 data: CSV round-trips quoted commas / quotes / newlines", () => {
  const csv = toCsv([["id", "text"], ["1", 'a, "b"\nc']]);
  assert.deepEqual(parseCsv(csv), [["id", "text"], ["1", 'a, "b"\nc']]);
});

test("4.7R6 data: committed corpus fixtures contain no PII and the independent corpus directory holds no labelled rows", () => {
  const repo = path.resolve(__dirname, "../../../../..");
  const indep = path.join(repo, "data/eval/query-routing-independent");
  const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of files(indep).filter((x) => !/pilot[\/]simulated|pilot_batch.csv$|manifest.json$|provenance.json$|pilot_A0[12].csv$/.test(x))) assert.deepEqual(detectPii(fs.readFileSync(f, "utf8").replace(/Z$/gm, "")).filter((p) => p !== "url"), [], f);
  const batch = parseCsv(fs.readFileSync(path.join(indep, "annotation_batch_template.csv"), "utf8"));
  assert.equal(batch.length, 2); // header + one format example only
  const qc = path.join(repo, "data/eval/query-classifiers");
  for (const f of fs.readdirSync(qc).filter((x) => /families/.test(x))) {
    const j = JSON.parse(fs.readFileSync(path.join(qc, f), "utf8"));
    for (const fam of j.families) for (const s of fam.s) assert.deepEqual(detectPii(s), [], `${f}:${fam.id}`);
  }
});
