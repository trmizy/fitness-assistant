/**
 * M7-P5A2 Phase 2 — tests of the OFFLINE annotation CLI (annotation-cli.ts) on SYNTHETIC fixtures only (TEST FIXTURE):
 * prepare → check-role → agreement → merge → validate → freeze, plus interrupted / duplicated / malformed submissions,
 * no-overwrite, determinism, tag leakage, A/B immutability, freeze provenance (Q8 / Q9) and tamper detection.
 * Every file lives in a fresh OS temp directory that is removed afterwards. No network, no model, no official dataset.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { main, REQUIRED_CANDIDATE_FILES, type Io } from "./m7-benchmark/annotation-cli";
import { validateRoutingAnnotations } from "./m7-benchmark/annotation-validator";
import { computeAgreement } from "./m7-benchmark/annotation-agreement";
import { SCHEMA_VERSION, type CaseLabel, type DomainLabel } from "./m7-benchmark/annotation-schema";

const CLI = path.join(__dirname, "m7-benchmark", "annotation-cli.ts");
const NOTE = "TEST FIXTURE — not evaluation data";
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
type Obj = Record<string, any>;
const R = (agent: DomainLabel["agent"]): DomainLabel => ({ agent, role: "request" });
const lab = (agent: DomainLabel["agent"], o: Partial<CaseLabel> = {}): CaseLabel => ({ domains: [R(agent)], primaryAgent: agent, category: "SINGLE", safety: "NONE", expectedPreRouting: "ALLOW", ...o });

function run(argv: string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s) };
  return { code: main(argv, io), out, err };
}
const codesOf = (r: { out: string[] }) => r.out.filter((l) => l.startsWith("ERROR\t")).map((l) => l.split("\t")[4]);
const reviewCodes = (r: { out: string[] }) => r.out.filter((l) => l.startsWith("REVIEW\t")).map((l) => l.split("\t")[4]);
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const readJsonl = (p: string) => fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ── synthetic scenario ───────────────────────────────────────────────────────────────────────────────────────────────
const LONG = (() => { let s = "cau hoi dai thu nghiem cong cu gop nhan"; for (let k = 0; s.length < 700; k++) s += ` zq${k}x`; return s.slice(0, 700).trimEnd(); })();
const QUESTIONS = [
  { id: "Q-0001", q: "Chiều thứ năm mình có nên chèn thêm một buổi kéo xà đơn ngắn không?", tags: [], A: lab("training"), B: lab("training") },
  { id: "Q-0002", q: "Bữa trưa ở căng tin toàn đồ chiên thì chọn món nào cho đỡ ngấy?", tags: [], A: lab("nutrition"), B: lab("nutrition") },
  { id: "Q-0003", q: "Đi bộ leo dốc buổi sáng có tính là cardio hay chỉ là vận động nhẹ thôi?", tags: [], A: lab("training"), B: lab("nutrition") },
  { id: "Q-0004", q: "Con gái tôi mười lăm tuổi muốn tập tạ cùng bạn, nên bắt đầu ra sao?", tags: ["review"], A: lab("training"), B: lab("training") },
  { id: "Q-0005", q: LONG, tags: ["long_question"], A: lab("training"), B: lab("training") },
];
const accented = (q: string) => /[̀-ͯ]|đ|Đ/.test(q.normalize("NFD"));
const questionRows = () => QUESTIONS.map((c) => ({ schemaVersion: SCHEMA_VERSION, id: c.id, question: c.q, accented: accented(c.q), tags: c.tags, source: { kind: "synthetic", author: "W01", note: NOTE } }));
const roleRows = (role: "A" | "B", id = role === "A" ? "A01" : "B02") => QUESTIONS.map((c) => ({ schemaVersion: SCHEMA_VERSION, id: c.id, annotatorId: id, rationale: `TEST FIXTURE: lý do của ${role} cho ${c.id}`, ...(role === "A" ? c.A : c.B) }));
const adjRows = () => QUESTIONS.map((c) => ({
  schemaVersion: SCHEMA_VERSION, id: c.id, adjudicatorId: "ADJ01",
  finalRationale: c.id === "Q-0004" ? "TEST FIXTURE: ngôi thứ ba — phụ huynh hỏi hộ, an toàn theo nội dung" : `TEST FIXTURE: xác nhận cuối cho ${c.id}`,
  ...(c.id === "Q-0003" ? { decision: lab("nutrition"), decisionRationale: "TEST FIXTURE: chọn nhãn khác nhãn của A để kiểm tra final" } : {}),
}));
const CANDIDATE = (o: Obj = {}) => ({
  stage: "TEST FIXTURE candidate", clean: true, git: { head: "0".repeat(40) }, liveModel: { modelId: "PENDING", awsRegion: "PENDING" },
  files: REQUIRED_CANDIDATE_FILES.map((p) => ({ path: p, sha256: "a".repeat(64) })), ...o,
});

interface Ws { dir: string; p: (n: string) => string }
function workspace(): Ws {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m7p5a2-cli-"));
  const p = (n: string) => path.join(dir, n);
  fs.writeFileSync(p("questions.jsonl"), jsonl(questionRows()));
  fs.writeFileSync(p("A.jsonl"), jsonl(roleRows("A")));
  fs.writeFileSync(p("B.jsonl"), jsonl(roleRows("B")));
  fs.writeFileSync(p("adjudicator.jsonl"), jsonl(adjRows()));
  fs.writeFileSync(p("guide.md"), "TEST FIXTURE guide\n");
  fs.writeFileSync(p("candidate.json"), JSON.stringify(CANDIDATE()));
  return { dir, p };
}
const cleanup = (w: Ws) => fs.rmSync(w.dir, { recursive: true, force: true });
const mergeArgs = (w: Ws, out: string, extra: string[] = []) => ["merge", "--questions", w.p("questions.jsonl"), "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--adjudicator", w.p("adjudicator.jsonl"), "--out-dir", w.p(out), "--no-distribution", ...extra];
const freezeArgs = (w: Ws, m: string, extra: string[] = [], out = "freeze.json") => ["freeze", "--fixture", "--dataset", w.p(`${m}/dataset.jsonl`), "--adjudication", w.p(`${m}/adjudication.jsonl`), "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--guide", w.p("guide.md"), "--merge-manifest", w.p(`${m}/merge-manifest.json`), "--agreement", w.p("agreement.json"), "--candidate", w.p("candidate.json"), "--signoff", w.p("signoff.json"), "--out", w.p(out), ...extra];
/** Signs every REVIEW item of the merged dataset + the agreement review (a human's job; here a TEST FIXTURE signer). */
function signAll(w: Ws, m: string, o: Obj = {}) {
  const v = validateRoutingAnnotations(fs.readFileSync(w.p(`${m}/dataset.jsonl`), "utf8"), { checkDistribution: false, checkBenchmarkOverlap: true });
  fs.writeFileSync(w.p("signoff.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, reviews: v.reviews.map((r) => ({ id: r.id, code: r.code, signedBy: "OWNER01", note: "TEST FIXTURE sign-off" })), agreementReview: { signedBy: "OWNER01", note: "TEST FIXTURE: calibration outside the dataset" }, ...o }));
  return v;
}

// ── prepare ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CLI-1 prepare: annotators get id / question / accented ONLY (no tags, source, labels); seeded, deterministic, never overwrites", () => {
  const w = workspace();
  try {
    const r = run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep"), "--seed", "42"]);
    assert.equal(r.code, 0, r.out.join("\n"));
    for (const f of ["for-annotator-A.jsonl", "for-annotator-B.jsonl"]) {
      const rows = readJsonl(w.p(`prep/${f}`));
      assert.deepEqual(rows.map((x) => Object.keys(x)), rows.map(() => ["id", "question", "accented"]));
      assert.deepEqual(rows.map((x) => x.id).sort(), QUESTIONS.map((c) => c.id));
      const raw = fs.readFileSync(w.p(`prep/${f}`), "utf8");
      for (const leak of ["tags", "review", "long_question", "source", "W01", "annotatorId", "primaryAgent"]) assert.ok(!raw.includes(`"${leak}"`), `${f} leaks ${leak}`);
      assert.ok(!raw.startsWith("﻿") && !raw.includes("\r"), "UTF-8 without BOM, LF");
    }
    const man = JSON.parse(fs.readFileSync(w.p("prep/prepare-manifest.json"), "utf8"));
    assert.equal(man.seed, 42); assert.equal(man.inputs.questions.sha256, sha(w.p("questions.jsonl")));
    assert.equal(man.outputs.forAnnotatorA.sha256, sha(w.p("prep/for-annotator-A.jsonl")));
    // determinism: same input + seed → byte-identical outputs in another directory
    assert.equal(run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep2"), "--seed", "42"]).code, 0);
    for (const f of ["for-annotator-A.jsonl", "for-annotator-B.jsonl", "prepare-manifest.json"]) assert.equal(sha(w.p(`prep/${f}`)), sha(w.p(`prep2/${f}`)), f);
    // no overwrite: refused, nothing changed, no temp file left behind
    const before = fs.readdirSync(w.p("prep")).map((f) => [f, sha(w.p(`prep/${f}`))]);
    const again = run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep"), "--seed", "7"]);
    assert.equal(again.code, 1); assert.ok(codesOf(again).every((c) => c === "OUTPUT_EXISTS") && codesOf(again).length === 3);
    assert.deepEqual(fs.readdirSync(w.p("prep")).map((f) => [f, sha(w.p(`prep/${f}`))]), before);
    // refusals: duplicate id, untrimmed question, missing author, label in the question file; bad seed is usage
    const bad = questionRows();
    bad[1].id = "q-0001"; bad[2].question = ` ${bad[2].question}`; (bad[3].source as Obj).author = ""; (bad[4] as Obj).final = lab("training");
    fs.writeFileSync(w.p("bad-questions.jsonl"), jsonl(bad));
    const rb = run(["prepare", "--questions", w.p("bad-questions.jsonl"), "--out-dir", w.p("prep3"), "--seed", "1"]);
    assert.equal(rb.code, 1);
    for (const c of ["DUPLICATE_ID", "QUESTION_NOT_TRIMMED", "INVALID_SOURCE", "UNEXPECTED_KEY"]) assert.ok(codesOf(rb).includes(c), c);
    assert.equal(fs.existsSync(w.p("prep3")), false, "nothing written on refusal");
    assert.equal(run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep4"), "--seed", "-1"]).code, 2);
  } finally { cleanup(w); }
});

// ── check-role: interrupted / duplicated / malformed submissions ────────────────────────────────────────────────────
test("CLI-2 check-role: complete files pass; interrupted, duplicated, malformed, tag-carrying and id-inconsistent files are refused", () => {
  const w = workspace();
  try {
    const cr = (file: string, extra: string[] = []) => run(["check-role", "--role", "A", "--prepared", w.p("questions.jsonl"), "--labels", file, ...extra]);
    assert.equal(cr(w.p("A.jsonl")).code, 0);
    assert.equal(cr(w.p("A.jsonl"), ["--other", w.p("B.jsonl")]).code, 0);
    const write = (n: string, t: string) => { fs.writeFileSync(w.p(n), t); return w.p(n); };
    const full = fs.readFileSync(w.p("A.jsonl"), "utf8");
    // interrupted: the last line is cut in half (the save was interrupted)
    const cut = cr(write("cut.jsonl", full.slice(0, full.length - 60)));
    assert.equal(cut.code, 1); assert.ok(codesOf(cut).includes("MALFORMED_JSON") && codesOf(cut).includes("MISSING_SUBMISSION"), codesOf(cut).join());
    // missing whole lines
    const short = cr(write("short.jsonl", jsonl(roleRows("A").slice(0, 3))));
    assert.deepEqual(codesOf(short), ["MISSING_SUBMISSION", "MISSING_SUBMISSION"]);
    // duplicated submission line
    const rows = roleRows("A");
    const dup = cr(write("dup.jsonl", jsonl([...rows, { ...rows[0], primaryAgent: "nutrition", domains: [R("nutrition")] }])));
    assert.deepEqual(codesOf(dup), ["DUPLICATE_ID"]);
    // BOM, not-object, unknown id, tags key, missing rationale, inconsistent id, derived field, model name
    assert.deepEqual(codesOf(cr(write("bom.jsonl", "﻿" + full))), ["FILE_HAS_BOM"]);
    const mal = cr(write("mal.jsonl", jsonl([...rows, [1, 2], { ...rows[0], id: "Q-9999" }])));
    assert.ok(codesOf(mal).includes("NOT_OBJECT") && codesOf(mal).includes("UNKNOWN_ID"));
    assert.ok(codesOf(cr(write("tag.jsonl", jsonl(rows.map((x, i) => (i === 0 ? { ...x, tags: ["minor"] } : x)))))).includes("TAG_IN_ANNOTATOR_FILE"));
    assert.deepEqual(codesOf(cr(write("norat.jsonl", jsonl(rows.map((x, i) => (i === 1 ? { ...x, rationale: "" } : x)))))), ["MISSING_ANNOTATOR_RATIONALE"]);
    assert.deepEqual(codesOf(cr(write("ids.jsonl", jsonl(rows.map((x, i) => (i === 2 ? { ...x, annotatorId: "A77" } : x)))))), ["ROLE_ID_INCONSISTENT"]);
    assert.deepEqual(codesOf(cr(write("der.jsonl", jsonl(rows.map((x, i) => (i === 0 ? { ...x, acceptable: [["training"]] } : x)))))), ["DERIVED_FIELD_NOT_ALLOWED"]);
    assert.deepEqual(codesOf(cr(write("llm.jsonl", jsonl(rows.map((x) => ({ ...x, annotatorId: "claude-labeler" })))))), Array(5).fill("INVALID_ANNOTATOR_ID"));
    // incompatible role assignment: B uses A's id
    const conflict = cr(w.p("A.jsonl"), ["--other", write("Bsame.jsonl", jsonl(roleRows("B", "a01")))]);
    assert.deepEqual(codesOf(conflict), ["ROLE_CONFLICT"]);
    assert.equal(fs.readFileSync(w.p("A.jsonl"), "utf8"), full, "inputs are never modified");
  } finally { cleanup(w); }
});

// ── agreement ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CLI-3 agreement: computed on ORIGINAL A/B labels; κ, PABAK, prevalence, disagreement queue; κ < 0.60 → exit 3 (calibration), refuses missing labels", () => {
  const w = workspace();
  try {
    const r = run(["agreement", "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--prepared", w.p("questions.jsonl"), "--out", w.p("agreement.json")]);
    assert.equal(r.code, 3, r.out.join("\n"));
    assert.deepEqual(reviewCodes(r), ["CALIBRATION_REQUIRED"]);
    const rep = JSON.parse(fs.readFileSync(w.p("agreement.json"), "utf8"));
    assert.deepEqual(rep.adjudicationQueue, ["Q-0003"]);
    assert.deepEqual(rep.exactLabelAgreement, { agree: 4, n: 5, percent: 80 });
    assert.deepEqual(rep.missingLabels, { A: 0, B: 0 });
    // independent recomputation from the original labels: primary pairs (t,t)(n,n)(t,n)(t,t)(t,t) → κ = (0.8 − 0.56) / 0.44
    const expected = computeAgreement(QUESTIONS.map((c) => ({ id: c.id, a: c.A, b: c.B })));
    assert.ok(Math.abs(rep.report.withAmbiguous.primary.kappa.value - 0.24 / 0.44) < 1e-12);
    assert.equal(rep.report.withAmbiguous.primary.kappa.value, expected.withAmbiguous.primary.kappa.value);
    assert.equal(rep.policy.status, "CALIBRATION_REQUIRED");
    assert.ok("pabak" in rep.report.withAmbiguous.perAgentKappa.training && "prevalence" in rep.report.withAmbiguous);
    assert.equal(rep.report.withAmbiguous.perAgentKappa.recovery.kappa.value, null, "undefined κ stays visible as null with a reason");
    assert.match(rep.report.withAmbiguous.perAgentKappa.recovery.kappa.reason, /not defined/);
    assert.equal(rep.inputs.a.sha256, sha(w.p("A.jsonl")));
    assert.equal(run(["agreement", "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--prepared", w.p("questions.jsonl"), "--out", w.p("agreement.json")]).code, 1, "never overwrites");
    fs.writeFileSync(w.p("B-short.jsonl"), jsonl(roleRows("B").slice(0, 4)));
    const miss = run(["agreement", "--a", w.p("A.jsonl"), "--b", w.p("B-short.jsonl"), "--prepared", w.p("questions.jsonl"), "--out", w.p("agreement2.json")]);
    assert.equal(miss.code, 1); assert.ok(miss.out.some((l) => l.includes('"missingLabels":{"A":0,"B":1}')));
    assert.equal(fs.existsSync(w.p("agreement2.json")), false);
  } finally { cleanup(w); }
});

// ── merge ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CLI-4 merge: A/B copied unchanged, final = shared label or the adjudicator's decision, separate adjudication.jsonl, deterministic, inputs untouched", () => {
  const w = workspace();
  try {
    const inputs = ["questions.jsonl", "A.jsonl", "B.jsonl", "adjudicator.jsonl"].map((f) => [f, sha(w.p(f))]);
    const r = run(mergeArgs(w, "m"));
    assert.equal(r.code, 3, r.out.join("\n"));
    assert.ok(reviewCodes(r).includes("THIRD_PARTY_MINOR_REVIEW") && reviewCodes(r).includes("LONG_QUESTION_REVIEW"));
    assert.deepEqual(["questions.jsonl", "A.jsonl", "B.jsonl", "adjudicator.jsonl"].map((f) => [f, sha(w.p(f))]), inputs, "inputs untouched");
    const ds = readJsonl(w.p("m/dataset.jsonl"));
    assert.deepEqual(ds.map((x) => x.id), QUESTIONS.map((c) => c.id));
    const A = readJsonl(w.p("A.jsonl")), B = readJsonl(w.p("B.jsonl"));
    const strip = ({ schemaVersion: _s, id: _i, ...rest }: Obj) => rest;
    ds.forEach((row, i) => { assert.deepEqual(row.annotatorA, strip(A[i])); assert.deepEqual(row.annotatorB, strip(B[i])); });
    const q3 = ds.find((x) => x.id === "Q-0003");
    assert.deepEqual(q3.adjudication, { needed: true, adjudicatorId: "ADJ01", decision: lab("nutrition"), rationale: "TEST FIXTURE: chọn nhãn khác nhãn của A để kiểm tra final" });
    assert.deepEqual(q3.final, lab("nutrition"), "final = the adjudicator decision, not annotator A");
    assert.notDeepEqual(q3.final.primaryAgent, q3.annotatorA.primaryAgent, "the decision differs from A on purpose");
    assert.deepEqual(ds.filter((x) => x.id !== "Q-0003").map((x) => x.adjudication), Array(4).fill({ needed: false }));
    assert.ok(ds.every((x) => x.rationaleBy === "ADJ01"));
    assert.equal(ds.find((x) => x.id === "Q-0005").routingScored, false, "Q6: long question not routing-scored");
    const adj = readJsonl(w.p("m/adjudication.jsonl"));
    assert.deepEqual(adj.map((x) => x.id), QUESTIONS.map((c) => c.id), "one line per id, needed:false included (Q8)");
    assert.deepEqual(adj.map((x) => x.adjudication), ds.map((x) => x.adjudication));
    const man = JSON.parse(fs.readFileSync(w.p("m/merge-manifest.json"), "utf8"));
    assert.equal(man.outputs.dataset.sha256, sha(w.p("m/dataset.jsonl"))); assert.equal(man.outputs.adjudication.sha256, sha(w.p("m/adjudication.jsonl")));
    assert.notEqual(man.outputs.dataset.sha256, man.outputs.adjudication.sha256);
    assert.deepEqual(man.counts, { cases: 5, agreements: 4, disagreements: 1, tagAuditEntries: 0 });
    assert.deepEqual(man.roles, { annotatorA: "A01", annotatorB: "B02", adjudicator: "ADJ01", curator: null });
    // deterministic + no overwrite
    assert.equal(run(mergeArgs(w, "m2")).code, 3);
    for (const f of ["dataset.jsonl", "adjudication.jsonl", "merge-manifest.json"]) assert.equal(sha(w.p(`m/${f}`)), sha(w.p(`m2/${f}`)), f);
    const again = run(mergeArgs(w, "m"));
    assert.equal(again.code, 1); assert.deepEqual(codesOf(again), ["OUTPUT_EXISTS", "OUTPUT_EXISTS", "OUTPUT_EXISTS"]);
    assert.equal(sha(w.p("m/dataset.jsonl")), man.outputs.dataset.sha256);
  } finally { cleanup(w); }
});

test("CLI-5 merge refuses (writes nothing) on a missing decision, an unneeded decision, a non-independent adjudicator, missing / duplicate ids", () => {
  const w = workspace();
  try {
    const variants: Array<[string, Obj[], string]> = [
      ["no decision for the disagreement", adjRows().map((x) => (x.id === "Q-0003" ? { schemaVersion: x.schemaVersion, id: x.id, adjudicatorId: x.adjudicatorId, finalRationale: x.finalRationale } : x)), "ADJUDICATION_MISSING"],
      ["decision on an agreed case", adjRows().map((x) => (x.id === "Q-0001" ? { ...x, decision: lab("training"), decisionRationale: "TEST FIXTURE" } : x)), "ADJUDICATION_NOT_NEEDED"],
      ["adjudicator = annotator B", adjRows().map((x) => ({ ...x, adjudicatorId: "B02" })), "ADJUDICATOR_IS_ANNOTATOR"],
      ["two adjudicator ids", adjRows().map((x, i) => (i === 4 ? { ...x, adjudicatorId: "ADJ02" } : x)), "ROLE_ID_INCONSISTENT"],
      ["missing adjudicator line", adjRows().slice(0, 4), "MISSING_SUBMISSION"],
      ["duplicated adjudicator line", [...adjRows(), adjRows()[0]], "DUPLICATE_ID"],
      ["no final rationale", adjRows().map((x, i) => (i === 0 ? { ...x, finalRationale: " " } : x)), "MISSING_RATIONALE"],
    ];
    variants.forEach(([what, rows, code], i) => {
      fs.writeFileSync(w.p(`adj-${i}.jsonl`), jsonl(rows));
      const r = run(["merge", "--questions", w.p("questions.jsonl"), "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--adjudicator", w.p(`adj-${i}.jsonl`), "--out-dir", w.p(`out-${i}`), "--no-distribution"]);
      assert.equal(r.code, 1, what); assert.ok(codesOf(r).includes(code), `${what}: ${codesOf(r).join()}`);
      assert.equal(fs.existsSync(w.p(`out-${i}`)), false, `${what}: nothing written`);
    });
    fs.writeFileSync(w.p("A-cut.jsonl"), fs.readFileSync(w.p("A.jsonl"), "utf8").slice(0, -40));
    const cut = run(["merge", "--questions", w.p("questions.jsonl"), "--a", w.p("A-cut.jsonl"), "--b", w.p("B.jsonl"), "--adjudicator", w.p("adjudicator.jsonl"), "--out-dir", w.p("out-cut"), "--no-distribution"]);
    assert.equal(cut.code, 1); assert.equal(fs.existsSync(w.p("out-cut")), false);
  } finally { cleanup(w); }
});

test("CLI-6 merge applies the curator's tag audit (governed tags need the adjudicator) and records it; labels are untouched", () => {
  const w = workspace();
  try {
    const entry = (o: Obj) => JSON.stringify({ schemaVersion: SCHEMA_VERSION, seq: 1, id: "Q-0002", from: [], to: ["multi_clause"], reason: "TEST FIXTURE: hai mệnh đề", curatorId: "CUR01", ...o }) + "\n";
    fs.writeFileSync(w.p("audit-ok.jsonl"), entry({}));
    const ok = run(mergeArgs(w, "m", ["--tag-audit", w.p("audit-ok.jsonl")]));
    assert.equal(ok.code, 3, ok.out.join("\n"));
    assert.deepEqual(readJsonl(w.p("m/dataset.jsonl")).find((x) => x.id === "Q-0002").tags, ["multi_clause"]);
    const man = JSON.parse(fs.readFileSync(w.p("m/merge-manifest.json"), "utf8"));
    assert.equal(man.inputs.tagAudit.sha256, sha(w.p("audit-ok.jsonl"))); assert.equal(man.roles.curator, "CUR01");
    fs.writeFileSync(w.p("audit-gov.jsonl"), entry({ to: ["high_risk"] }));
    const gov = run(mergeArgs(w, "m2", ["--tag-audit", w.p("audit-gov.jsonl")]));
    assert.equal(gov.code, 1); assert.ok(codesOf(gov).includes("TAG_AUDIT_CONFIRMATION_MISSING")); assert.equal(fs.existsSync(w.p("m2")), false);
    fs.writeFileSync(w.p("audit-label.jsonl"), entry({ safety: "HIGH_RISK" }));
    assert.ok(codesOf(run(mergeArgs(w, "m3", ["--tag-audit", w.p("audit-label.jsonl")]))).includes("TAG_AUDIT_LABEL_EDIT_FORBIDDEN"));
    fs.writeFileSync(w.p("audit-ann.jsonl"), entry({ curatorId: "A01" }));
    assert.ok(codesOf(run(mergeArgs(w, "m4", ["--tag-audit", w.p("audit-ann.jsonl")]))).includes("ROLE_CONFLICT"));
  } finally { cleanup(w); }
});

// ── validate + freeze ────────────────────────────────────────────────────────────────────────────────────────────────
test("CLI-7 freeze (fixture only): Q8 adjudication hash, Q9 candidate files, every review signed, tamper / unclean candidate refused, no overwrite", () => {
  const w = workspace();
  try {
    assert.equal(run(["agreement", "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--prepared", w.p("questions.jsonl"), "--out", w.p("agreement.json")]).code, 3);
    assert.equal(run(mergeArgs(w, "m")).code, 3);
    assert.equal(run(["validate", w.p("m/dataset.jsonl"), "--no-distribution"]).code, 3);
    // unsigned: refused
    fs.writeFileSync(w.p("signoff.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, reviews: [], agreementReview: null }));
    const unsigned = run(freezeArgs(w, "m"));
    assert.equal(unsigned.code, 1);
    assert.ok(codesOf(unsigned).includes("REVIEW_NOT_SIGNED") && codesOf(unsigned).includes("AGREEMENT_REVIEW_NOT_SIGNED"), codesOf(unsigned).join());
    assert.equal(fs.existsSync(w.p("freeze.json")), false);
    // an annotator may not sign review items
    const v = signAll(w, "m");
    fs.writeFileSync(w.p("signoff-ann.json"), JSON.stringify({ reviews: v.reviews.map((r) => ({ id: r.id, code: r.code, signedBy: "B02", note: "x" })), agreementReview: { signedBy: "OWNER01", note: "x" } }));
    const byAnn = run(freezeArgs(w, "m").map((x) => (x === w.p("signoff.json") ? w.p("signoff-ann.json") : x)));
    assert.ok(codesOf(byAnn).includes("SIGNOFF_BY_ANNOTATOR"));
    // signed: fixture manifest written
    const ok = run(freezeArgs(w, "m"));
    assert.equal(ok.code, 0, ok.out.join("\n"));
    const fz = JSON.parse(fs.readFileSync(w.p("freeze.json"), "utf8"));
    assert.match(fz.status, /^FIXTURE ONLY/); assert.equal(fz.fixture, true);
    assert.equal(fz.files.adjudicatedLabelsSha256, sha(w.p("m/adjudication.jsonl")), "Q8: hash of the separate adjudication.jsonl");
    assert.notEqual(fz.files.adjudicatedLabelsSha256, fz.files.datasetSha256);
    assert.equal(fz.files.originalLabelsASha256, sha(w.p("A.jsonl"))); assert.equal(fz.files.annotationGuideSha256, sha(w.p("guide.md")));
    assert.deepEqual(fz.candidate.requiredFilesQ9, [...REQUIRED_CANDIDATE_FILES]); assert.equal(fz.candidate.modelId, "PENDING");
    assert.equal(fz.validator.reviews, fz.validator.reviewsSigned);
    assert.equal(run(freezeArgs(w, "m")).code, 1, "never overwrites freeze.json");
    // deterministic
    assert.equal(run(freezeArgs(w, "m", [], "freeze2.json")).code, 0);
    assert.equal(sha(w.p("freeze.json")), sha(w.p("freeze2.json")));
    // tamper: dataset edited after the merge
    fs.cpSync(w.p("m"), w.p("t"), { recursive: true });
    fs.appendFileSync(w.p("t/dataset.jsonl"), "\n");
    assert.ok(codesOf(run(freezeArgs(w, "t", [], "f3.json"))).includes("FILE_CHANGED_SINCE_MERGE"));
    // annotator file edited after the merge (original labels are immutable)
    fs.writeFileSync(w.p("A.jsonl"), fs.readFileSync(w.p("A.jsonl"), "utf8").replace("lý do của A cho Q-0001", "lý do đã sửa"));
    const edited = run(freezeArgs(w, "m", [], "f4.json"));
    assert.ok(codesOf(edited).includes("FILE_CHANGED_SINCE_MERGE") && codesOf(edited).includes("AGREEMENT_INPUT_MISMATCH"), codesOf(edited).join());
  } finally { cleanup(w); }
});

test("CLI-8 freeze refuses an unclean candidate or one without the Q9 safety files; a tag-audited merge needs its audit file", () => {
  const w = workspace();
  try {
    run(["agreement", "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--prepared", w.p("questions.jsonl"), "--out", w.p("agreement.json")]);
    run(mergeArgs(w, "m")); signAll(w, "m");
    fs.writeFileSync(w.p("candidate.json"), JSON.stringify(CANDIDATE({ clean: false })));
    assert.deepEqual(codesOf(run(freezeArgs(w, "m"))), ["CANDIDATE_NOT_CLEAN"]);
    for (const missing of REQUIRED_CANDIDATE_FILES) {
      fs.writeFileSync(w.p("candidate.json"), JSON.stringify(CANDIDATE({ files: REQUIRED_CANDIDATE_FILES.filter((p) => p !== missing).map((p) => ({ path: p, sha256: "b".repeat(64) })) })));
      assert.deepEqual(codesOf(run(freezeArgs(w, "m"))), ["CANDIDATE_MISSING_REQUIRED_FILE"], missing);
    }
    fs.writeFileSync(w.p("candidate.json"), JSON.stringify(CANDIDATE()));
    fs.writeFileSync(w.p("audit.jsonl"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, seq: 1, id: "Q-0002", from: [], to: ["multi_clause"], reason: "TEST FIXTURE", curatorId: "CUR01" }) + "\n");
    run(mergeArgs(w, "ma", ["--tag-audit", w.p("audit.jsonl")])); signAll(w, "ma");
    assert.deepEqual(codesOf(run(freezeArgs(w, "ma"))), ["FILE_MISSING"], "the audit used by the merge must be passed");
    assert.equal(run(freezeArgs(w, "ma", ["--tag-audit", w.p("audit.jsonl")])).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(w.p("freeze.json"), "utf8")).files.tagAuditSha256, sha(w.p("audit.jsonl")));
  } finally { cleanup(w); }
});

// ── process boundary + offline guarantee ──────────────────────────────────────────────────────────────────────────────
test("CLI-9 real process: usage → exit 2, validate of the m7-p5a2 fixture → exit 0; the CLI source has no network / model / AWS dependency", () => {
  const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx");
  const bin = fs.existsSync(tsx) ? tsx : fs.existsSync(`${tsx}.cmd`) ? `${tsx}.cmd` : null;
  if (bin) {
    const opts = { encoding: "utf8" as const, shell: process.platform === "win32", env: { ...process.env, FITNESS_DISABLE_REDIS: "true" } };
    assert.equal(spawnSync(bin, [CLI], opts).status, 2);
    const fx = path.join(__dirname, "m7-benchmark", "annotation-fixtures", "synthetic-valid-sample.m7-p5a2.jsonl");
    assert.equal(spawnSync(bin, [CLI, "validate", fx, "--no-distribution"], opts).status, 0);
  }
  const src = ["annotation-cli.ts", "annotation-tag-audit.ts", "annotation-validator.ts", "annotation-schema.ts", "annotation-agreement.ts", "annotation-dataset-checks.ts", "annotation-json.ts"]
    .map((f) => fs.readFileSync(path.join(__dirname, "m7-benchmark", f), "utf8")).join("\n");
  const imports = src.split("\n").filter((l) => /^import |^\} from |require\(/.test(l)).join("\n");
  for (const bad of [/"node:(http|https|net|dns|tls|dgram|child_process)"/, /aws-sdk|bedrock|ioredis|prisma|openai|anthropic/i]) assert.ok(!bad.test(imports), `${String(bad)}\n${imports}`);
  assert.ok(!/\bfetch\(/.test(src));
});
