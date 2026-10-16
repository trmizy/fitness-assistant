import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  canonicalBatchHash, validateHumanProvenance, verifyGuidelineFreeze, checkSameBatch, auditAnnotationFile, axisReport, type HumanProvenance, type ProvenanceExpectation,
} from "../llm/query-routing-data/routing-provenance";
import { forbiddenColumns } from "../llm/query-routing-data/routing-data-tools";

// All fixtures below are DUMMY data. They are NOT human annotations.
const REPO = path.resolve(__dirname, "../../../../..");
const INDEP = path.join(REPO, "data/eval/query-routing-independent");
const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

const batch = [{ id: "D1", text: "dummy one" }, { id: "D2", text: "dummy two" }, { id: "D3", text: "dummy three" }];
const GHASH = sha("dummy guideline");
const exp = (annotatorId: string): ProvenanceExpectation => ({ annotatorId, batchHash: canonicalBatchHash(batch), guidelineVersion: "ANNOTATION_GUIDELINES_V1", guidelineHash: GHASH });
const prov = (annotatorId: string, o: Partial<HumanProvenance> = {}): HumanProvenance => ({
  annotatorId, human: true, independent: true, usedLLMForLabels: false, sawOtherAnnotatorLabels: false, sawClassifierPredictions: false, sawGoldLabels: false,
  annotationGuidelineVersion: "ANNOTATION_GUIDELINES_V1", annotationGuidelineHash: GHASH, batchHash: canonicalBatchHash(batch),
  authority: "INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES", ...o,
});

// ── provenance ──────────────────────────────────────────────────────────────
test("4.7R6A.1 provenance: valid A01 and A02 manifests are accepted", () => {
  assert.deepEqual(validateHumanProvenance(prov("A01"), exp("A01")), { ok: true, errors: [] });
  assert.deepEqual(validateHumanProvenance(prov("A02"), exp("A02")), { ok: true, errors: [] });
});

test("4.7R6A.1 provenance: missing / simulated / LLM-assisted / non-independent / saw-labels are rejected with INDEPENDENT_HUMAN_PROVENANCE_REQUIRED", () => {
  const cases: Array<[string, unknown]> = [
    ["missing", undefined],
    ["simulated authority", prov("A01", { authority: "SIMULATED_LABELS", human: false })],
    ["llm assisted", prov("A01", { usedLLMForLabels: true })],
    ["not independent", prov("A01", { independent: false })],
    ["saw other labels", prov("A01", { sawOtherAnnotatorLabels: true })],
    ["saw classifier predictions", prov("A01", { sawClassifierPredictions: true })],
    ["saw gold labels", prov("A01", { sawGoldLabels: true })],
    ["not human", prov("A01", { human: false })],
    ["wrong annotator", prov("A02")],
  ];
  for (const [name, p] of cases) {
    const r = validateHumanProvenance(p, exp("A01"));
    assert.equal(r.ok, false, name);
    assert.equal(r.code, "INDEPENDENT_HUMAN_PROVENANCE_REQUIRED", name);
  }
});

test("4.7R6A.1 provenance: wrong guideline hash and wrong batch hash fail with their own codes", () => {
  assert.equal(validateHumanProvenance(prov("A01", { annotationGuidelineHash: sha("other") }), exp("A01")).code, "ANNOTATION_GUIDELINE_VERSION_MISMATCH");
  assert.equal(validateHumanProvenance(prov("A01", { annotationGuidelineVersion: "ANNOTATION_GUIDELINES_V2" }), exp("A01")).code, "ANNOTATION_GUIDELINE_VERSION_MISMATCH");
  assert.equal(validateHumanProvenance(prov("A01", { batchHash: sha("other batch") }), exp("A01")).code, "ANNOTATION_BATCH_MISMATCH");
});

test("4.7R6A.1 provenance: identity / personal fields are rejected inside a provenance manifest", () => {
  const withEmail = { ...prov("A01"), email: "someone@example.com" };
  const r = validateHumanProvenance(withEmail, exp("A01"));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("forbidden personal-data")));
  assert.equal(validateHumanProvenance({ ...prov("A01"), notes: "contact me at a@b.com" }, exp("A01")).ok, false);
  assert.equal(validateHumanProvenance({ ...prov("A01"), full_name: "x" }, exp("A01")).ok, false);
});

test("4.7R6A.1 guideline: freeze record is verified against the actual file hash", () => {
  const bytes = Buffer.from("dummy guideline");
  assert.equal(verifyGuidelineFreeze({ version: "V1", sha256: sha(bytes) }, bytes).ok, true);
  assert.equal(verifyGuidelineFreeze({ version: "V1", sha256: sha("changed") }, bytes).code, "ANNOTATION_GUIDELINE_VERSION_MISMATCH");
  const real = JSON.parse(fs.readFileSync(path.join(INDEP, "ANNOTATION_GUIDELINES_V1.freeze.json"), "utf8"));
  assert.equal(verifyGuidelineFreeze(real, fs.readFileSync(path.join(INDEP, real.file))).ok, true);
});

// ── batch integrity ─────────────────────────────────────────────────────────
test("4.7R6A.1 batch: same ids/texts in a different order are accepted (joined by id)", () => {
  const a = [...batch], b = [...batch].reverse();
  assert.equal(checkSameBatch(batch, a, b).ok, true);
  assert.equal(canonicalBatchHash(a), canonicalBatchHash(b));
});

test("4.7R6A.1 batch: missing id, extra id, duplicate id and changed text are ANNOTATION_BATCH_MISMATCH", () => {
  const bad: Array<[string, typeof batch]> = [
    ["missing", batch.slice(1)],
    ["extra", [...batch, { id: "D9", text: "x" }]],
    ["duplicate", [...batch, { id: "D1", text: "dummy one" }]],
    ["changed text", [{ id: "D1", text: "dummy ONE" }, ...batch.slice(1)]],
  ];
  for (const [name, b] of bad) {
    const r = checkSameBatch(batch, batch, b);
    assert.equal(r.ok, false, name);
    assert.equal(r.code, "ANNOTATION_BATCH_MISMATCH", name);
  }
});

test("4.7R6A.1 audit: schema / enum / annotator / completeness / forbidden column checks", () => {
  const head = ["id", "text", "annotator", "safetyLabel", "programmingLabel"];
  const ok = batch.map((r) => ({ ...r, annotator: "A01", safetyLabel: "NORMAL_FITNESS", programmingLabel: "NOT_PROGRAMMING" }));
  assert.equal(auditAnnotationFile(ok, head, batch, "A01").ok, true);
  assert.equal(auditAnnotationFile(ok.map((r) => ({ ...r, annotator: "A02" })), head, batch, "A01").ok, false);
  assert.equal(auditAnnotationFile(ok.map((r, i) => (i ? r : { ...r, safetyLabel: "MAYBE" })), head, batch, "A01").ok, false);
  assert.equal(auditAnnotationFile(ok.slice(1), head, batch, "A01").ok, false); // incomplete
  assert.equal(auditAnnotationFile(ok, [...head, "email"], batch, "A01").ok, false);
  assert.equal(forbiddenColumns(["id", "user_id", "medical_record_id", "full_name", "account_id", "phone", "email"]).length, 6);
});

// ── agreement (two axes separately) ─────────────────────────────────────────
test("4.7R6A.1 agreement: confusion matrix, disagreement fields and independent axes", () => {
  const mk = (id: string, ann: string, s: string, p: string, u = "false", c = "") => ({ id, text: `t-${id}`, annotator: ann, safetyLabel: s, programmingLabel: p, uncertain: u, comment: c });
  const A = [mk("1", "A01", "NORMAL_FITNESS", "PROGRAMMING"), mk("2", "A01", "SAFE_ABSTAIN", "NOT_PROGRAMMING", "true", "unsure"), mk("3", "A01", "GENERAL_INFORMATION_ONLY", "PROGRAMMING")];
  const B = [mk("3", "A02", "GENERAL_INFORMATION_ONLY", "NOT_PROGRAMMING"), mk("1", "A02", "NORMAL_FITNESS", "PROGRAMMING"), mk("2", "A02", "GENERAL_INFORMATION_ONLY", "NOT_PROGRAMMING", "false", "borderline")];
  const s = axisReport("safetyLabel", A, B), p = axisReport("programmingLabel", A, B);
  assert.equal(s.n, 3);
  assert.ok(Math.abs(s.rawAgreement - 2 / 3) < 1e-9);
  assert.deepEqual(s.confusionMatrix, { NORMAL_FITNESS: { NORMAL_FITNESS: 1 }, SAFE_ABSTAIN: { GENERAL_INFORMATION_ONLY: 1 }, GENERAL_INFORMATION_ONLY: { GENERAL_INFORMATION_ONLY: 1 } });
  assert.equal(s.disagreements.length, 1);
  assert.deepEqual(s.disagreements[0], { id: "2", text: "t-2", labelA01: "SAFE_ABSTAIN", labelA02: "GENERAL_INFORMATION_ONLY", uncertainA01: "true", uncertainA02: "false", commentA01: "unsure", commentA02: "borderline" });
  // programming axis disagrees on a different row => axes are not collapsed
  assert.deepEqual(p.disagreements.map((d) => d.id), ["3"]);
  assert.ok(!("intended" in s.disagreements[0]));
});

// ── quarantine status of the simulated artifacts ───────────────────────────
test("4.7R6A.1 quarantine: simulated manifest marks files non-independent, hashes match, and no human files are fabricated", () => {
  const dir = path.join(INDEP, "pilot/simulated");
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(m.status, "SIMULATED_PIPELINE_SMOKE_ONLY");
  assert.equal(m.independentHumanAnnotation, false);
  for (const u of ["classifier gold", "independent agreement evidence", "policy signoff", "R6B signoff", "Heldout V6 readiness"]) assert.ok(m.forbiddenUses.includes(u), u);
  for (const [f, h] of Object.entries(m.files)) assert.equal(sha(fs.readFileSync(path.join(dir, f))), h, f);
  const human = fs.readdirSync(path.join(INDEP, "pilot/human"));
  // R6A.2: a real human A01 now exists (validated separately); A02 must not exist until a second real annotator delivers
  assert.ok(!human.some((f) => /^pilot_A02\.(csv|provenance\.json)$/.test(f)), "no A02 file may exist yet");
});

// ── intake CLI end-to-end (DUMMY data) ──────────────────────────────────────
test("4.7R6A.1 intake CLI (DUMMY): missing -> REAL_HUMAN_ANNOTATION_REQUIRED; simulated provenance blocked; valid dummy passes; wrong guideline hash blocked", () => {
  const tool = path.join(__dirname, "../scripts/routingAnnotationTool.ts");
  const cwd = path.resolve(__dirname, "../..");
  const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", tool, ...a], { encoding: "utf8", cwd });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r6a1-"));
  const human = path.join(dir, "human"); fs.mkdirSync(human);
  const batchCsv = path.join(dir, "batch.csv");
  fs.writeFileSync(batchCsv, "id,text\n" + batch.map((r) => `${r.id},${r.text}`).join("\n") + "\n");
  const gfile = path.join(dir, "G.md"); fs.writeFileSync(gfile, "dummy guideline");
  const freeze = path.join(dir, "G.freeze.json");
  fs.writeFileSync(freeze, JSON.stringify({ version: "ANNOTATION_GUIDELINES_V1", file: "G.md", sha256: GHASH }));
  const args = [`--dir=${human}`, `--batch=${batchCsv}`, `--freeze=${freeze}`, `--out=${path.join(dir, "out")}`];

  let r = run("human-intake", ...args);
  assert.equal(r.status, 3);
  assert.equal(JSON.parse(r.stdout).verdict, "REAL_HUMAN_ANNOTATION_REQUIRED");

  const hdr = "id,text,annotator,safetyLabel,programmingLabel,domain,tags,uncertain,comment,timestamp\n";
  const body = (ann: string, s: string[]) => hdr + batch.map((b, i) => `${b.id},${b.text},${ann},${s[i]},NOT_PROGRAMMING,,,false,,t`).join("\n") + "\n";
  fs.writeFileSync(path.join(human, "pilot_A01.csv"), body("A01", ["NORMAL_FITNESS", "SAFE_ABSTAIN", "GENERAL_INFORMATION_ONLY"]));
  fs.writeFileSync(path.join(human, "pilot_A02.csv"), body("A02", ["NORMAL_FITNESS", "GENERAL_INFORMATION_ONLY", "GENERAL_INFORMATION_ONLY"]));
  fs.writeFileSync(path.join(human, "pilot_A01.provenance.json"), JSON.stringify(prov("A01", { authority: "SIMULATED_LABELS", human: false })));
  fs.writeFileSync(path.join(human, "pilot_A02.provenance.json"), JSON.stringify(prov("A02")));
  r = run("human-intake", ...args);
  assert.equal(r.status, 3);
  assert.equal(JSON.parse(r.stdout).verdict, "HUMAN_PILOT_AUDIT_BLOCKED");

  fs.writeFileSync(path.join(human, "pilot_A01.provenance.json"), JSON.stringify(prov("A01")));
  r = run("human-intake", ...args);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const j = JSON.parse(r.stdout);
  assert.equal(j.verdict, "HUMAN_PILOT_AGREEMENT_READY");
  assert.equal(j.authority, "INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES");
  assert.equal(j.safety.disagreements.length, 1);
  assert.equal(j.adjudication, "NOT_RUN (manual)");
  assert.ok(fs.existsSync(path.join(dir, "out", "safety_disagreements.csv")));

  fs.writeFileSync(gfile, "guideline edited after freeze");
  r = run("human-intake", ...args);
  assert.equal(r.status, 3);
  assert.equal(JSON.parse(r.stdout).code, "ANNOTATION_GUIDELINE_VERSION_MISMATCH");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("4.7R6A.1 agreement command output is labelled SIMULATED_TOOLING_DIAGNOSTIC, never independent", () => {
  const tool = path.join(__dirname, "../scripts/routingAnnotationTool.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r6a1b-"));
  const hdr = "id,text,annotator,safetyLabel\n";
  fs.writeFileSync(path.join(dir, "a.csv"), hdr + "D1,x,A01,NORMAL_FITNESS\n");
  fs.writeFileSync(path.join(dir, "b.csv"), hdr + "D1,x,A02,NORMAL_FITNESS\n");
  const r = spawnSync(process.execPath, ["--import", "tsx", tool, "agreement", `--a=${path.join(dir, "a.csv")}`, `--b=${path.join(dir, "b.csv")}`, "--column=safetyLabel"], { encoding: "utf8", cwd: path.resolve(__dirname, "../..") });
  assert.equal(JSON.parse(r.stdout).authority, "SIMULATED_TOOLING_DIAGNOSTIC");
  fs.rmSync(dir, { recursive: true, force: true });
});
