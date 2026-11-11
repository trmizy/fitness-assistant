import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { validateAttestation, checkNormalizationDisclosure, auditSecondaryFields } from "../llm/query-routing-data/routing-single-intake";
import { canonicalBatchHash } from "../llm/query-routing-data/routing-provenance";

// DUMMY fixtures only — not human annotations.
const cwd = path.resolve(__dirname, "../..");
const REPO = path.resolve(__dirname, "../../../../..");
const INDEP = path.join(REPO, "data/eval/query-routing-independent");
const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
const batch = [{ id: "D1", text: "dummy one" }, { id: "D2", text: "dummy two" }, { id: "D3", text: "dummy three" }];
const GBYTES = "dummy guideline";
const GHASH = sha(GBYTES);

const ATT_OK = `# Annotator attestation\n\nAnnotator id (pseudonym only, e.g. A01): A01\n\n- [X] I labelled this batch myself.\n- [X] I did not use ChatGPT, Claude, Qwen or any other model to choose labels.\n- [X] I did not view the other annotator's labels before submitting.\n- [X] I did not see any classifier / resolver output or any intended (gold) labels.\n- [X] I used ANNOTATION_GUIDELINES_V1 (hash recorded in my provenance file).\n`;
const prov = (o: Record<string, unknown> = {}) => ({
  annotatorId: "A01", human: true, independent: true, usedLLMForLabels: false, sawOtherAnnotatorLabels: false, sawClassifierPredictions: false, sawGoldLabels: false,
  annotationGuidelineVersion: "ANNOTATION_GUIDELINES_V1", annotationGuidelineHash: GHASH, batchHash: canonicalBatchHash(batch),
  authority: "INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES", notes: "", ...o,
});
const HDR = "id,text,annotator,safetyLabel,programmingLabel,domain,tags,uncertain,comment,timestamp\n";
const csv = (rows: Array<Partial<Record<string, string>>>) => HDR + rows.map((r) => [r.id, r.text, r.annotator ?? "A01", r.safetyLabel ?? "NORMAL_FITNESS", r.programmingLabel ?? "NOT_PROGRAMMING", r.domain ?? "UNKNOWN", r.tags ?? "", r.uncertain ?? "false", "", r.timestamp ?? "2026-10-12T16:34:00+07:00"].join(",")).join("\n") + "\n";

function setup(opts: { rows?: string; provenance?: unknown; attestation?: string; guideline?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r6a2-"));
  fs.writeFileSync(path.join(dir, "batch.csv"), "id,text\n" + batch.map((b) => `${b.id},${b.text}`).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "G.md"), opts.guideline ?? GBYTES);
  fs.writeFileSync(path.join(dir, "G.freeze.json"), JSON.stringify({ version: "ANNOTATION_GUIDELINES_V1", file: "G.md", sha256: GHASH }));
  fs.writeFileSync(path.join(dir, "a.csv"), opts.rows ?? csv(batch));
  fs.writeFileSync(path.join(dir, "a.prov.json"), JSON.stringify(opts.provenance ?? prov()));
  fs.writeFileSync(path.join(dir, "att.md"), opts.attestation ?? ATT_OK);
  const run = (annotator = "A01") => {
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(cwd, "src/scripts/routingSingleAudit.ts"), `--annotator=${annotator}`, `--annotation=${path.join(dir, "a.csv")}`,
      `--provenance=${path.join(dir, "a.prov.json")}`, `--attestation=${path.join(dir, "att.md")}`, `--batch=${path.join(dir, "batch.csv")}`, `--freeze=${path.join(dir, "G.freeze.json")}`, `--manifest=${path.join(dir, "m.json")}`], { encoding: "utf8", cwd });
    return { status: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr, manifest: fs.existsSync(path.join(dir, "m.json")) };
  };
  return { dir, run, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("4.7R6A.2 single-human audit: valid DUMMY A01 passes, reports no agreement / kappa / adjudication", () => {
  const t = setup();
  const r = t.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.verdict, "A01_HUMAN_INTAKE_PASS");
  assert.equal(r.json.authority, "SINGLE_HUMAN_ANNOTATOR_VALIDATED");
  assert.equal(r.json.agreement, "NOT_AVAILABLE");
  assert.equal(r.json.kappa, "NOT_AVAILABLE");
  assert.equal(r.json.adjudication, "NOT_RUN");
  assert.equal(r.json.R6B, "NOT_READY");
  assert.equal(r.json.nextRequiredAnnotator, "A02");
  assert.equal(r.manifest, true);
  assert.ok(!("confusionMatrix" in r.json) && !("disagreements" in r.json));
  t.done();
});

test("4.7R6A.2 single-human audit: simulated / LLM-assisted / saw-labels provenance is rejected", () => {
  for (const p of [prov({ authority: "SIMULATED_LABELS", human: false }), prov({ usedLLMForLabels: true }), prov({ sawGoldLabels: true }), prov({ independent: false })]) {
    const t = setup({ provenance: p });
    const r = t.run();
    assert.equal(r.status, 3);
    assert.equal(r.json.verdict, "A01_HUMAN_INTAKE_BLOCKED");
    assert.equal(r.manifest, false);
    t.done();
  }
});

test("4.7R6A.2 single-human audit: wrong batch hash and wrong guideline hash are rejected", () => {
  let t = setup({ provenance: prov({ batchHash: sha("other") }) });
  assert.equal(t.run().status, 3); t.done();
  t = setup({ provenance: prov({ annotationGuidelineHash: sha("other") }) });
  assert.equal(t.run().status, 3); t.done();
  t = setup({ guideline: "guideline edited after freeze" }); // file no longer matches the freeze record
  const r = t.run();
  assert.equal(r.status, 3);
  assert.equal(r.json.code, "ANNOTATION_GUIDELINE_VERSION_MISMATCH");
  t.done();
});

test("4.7R6A.2 single-human audit: changed text, duplicate id, missing id and annotator A1 are rejected", () => {
  const bad: Array<[string, string, string?]> = [
    ["changed text", csv([{ id: "D1", text: "dummy ONE" }, batch[1], batch[2]])],
    ["duplicate id", csv([batch[0], batch[0], batch[1], batch[2]])],
    ["missing id", csv([batch[0], batch[1]])],
    ["annotator A1", csv(batch.map((b) => ({ ...b, annotator: "A1" })))],
  ];
  for (const [name, rows] of bad) {
    const t = setup({ rows });
    const r = t.run();
    assert.equal(r.status, 3, name);
    assert.equal(r.json.verdict, "A01_HUMAN_INTAKE_BLOCKED", name);
    t.done();
  }
});

test("4.7R6A.2 single-human audit: invalid enums (primary, domain ODD, uncertain) are rejected", () => {
  for (const [name, rows] of [
    ["safety enum", csv([{ ...batch[0], safetyLabel: "MAYBE" }, batch[1], batch[2]])],
    ["programming enum", csv([{ ...batch[0], programmingLabel: "PROG" }, batch[1], batch[2]])],
    ["domain ODD", csv([{ ...batch[0], domain: "ODD" }, batch[1], batch[2]])],
    ["uncertain not boolean", csv([{ ...batch[0], uncertain: "maybe" }, batch[1], batch[2]])],
  ] as Array<[string, string]>) {
    const t = setup({ rows });
    assert.equal(t.run().status, 3, name);
    t.done();
  }
});

test("4.7R6A.2 attestation: missing / unchecked / wrong id are rejected; normalization disclosure must state labels untouched", () => {
  assert.equal(validateAttestation(ATT_OK, "A01").ok, true);
  assert.equal(validateAttestation(ATT_OK.replace("[X] I labelled", "[ ] I labelled"), "A01").ok, false);
  assert.equal(validateAttestation(ATT_OK, "A02").ok, false);
  assert.equal(validateAttestation("# nothing", "A01").ok, false);
  const t = setup({ attestation: "# empty" });
  assert.equal(t.run().status, 3);
  t.done();
  assert.equal(checkNormalizationDisclosure("Post-annotation technical normalization by ChatGPT/OpenAI assistant only; no safetyLabel or programmingLabel values were changed.").ok, true);
  assert.equal(checkNormalizationDisclosure("Assistant cleaned up the labels").ok, false);
  assert.equal(checkNormalizationDisclosure("").ok, true);
});

test("4.7R6A.2 secondary fields: bad tag / timestamp flagged; blank domain and tags accepted", () => {
  const ok = { id: "x", domain: "", tags: "", uncertain: "false", timestamp: "2026-10-12T16:34:00+07:00" };
  assert.equal(auditSecondaryFields([ok]).ok, true);
  assert.equal(auditSecondaryFields([{ ...ok, tags: "FOO" }]).ok, false);
  assert.equal(auditSecondaryFields([{ ...ok, timestamp: "12/10/2026" }]).ok, false);
});

test("4.7R6A.2 fail-closed preserved: authoritative two-human human-intake still refuses with only A01 present", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r6a2i-"));
  const human = path.join(dir, "human"); fs.mkdirSync(human);
  fs.writeFileSync(path.join(dir, "batch.csv"), "id,text\n" + batch.map((b) => `${b.id},${b.text}`).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "G.md"), GBYTES);
  fs.writeFileSync(path.join(dir, "G.freeze.json"), JSON.stringify({ version: "ANNOTATION_GUIDELINES_V1", file: "G.md", sha256: GHASH }));
  fs.writeFileSync(path.join(human, "pilot_A01.csv"), csv(batch));
  fs.writeFileSync(path.join(human, "pilot_A01.provenance.json"), JSON.stringify(prov()));
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(cwd, "src/scripts/routingAnnotationTool.ts"), "human-intake", `--dir=${human}`, `--batch=${path.join(dir, "batch.csv")}`, `--freeze=${path.join(dir, "G.freeze.json")}`], { encoding: "utf8", cwd });
  assert.equal(r.status, 3);
  const j = JSON.parse(r.stdout);
  assert.equal(j.verdict, "REAL_HUMAN_ANNOTATION_REQUIRED");
  assert.deepEqual(j.missing.sort(), ["pilot_A02.csv", "pilot_A02.provenance.json"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("4.7R6A.2 repository state: real A01 manifest is single-annotator only, hashes match, no A02, no agreement artifacts", () => {
  const h = path.join(INDEP, "pilot/human");
  const m = JSON.parse(fs.readFileSync(path.join(h, "pilot_A01.manifest.json"), "utf8"));
  assert.equal(m.authority, "SINGLE_HUMAN_ANNOTATOR_VALIDATED");
  assert.equal(m.projectState, "A01_HUMAN_VALIDATED_AWAITING_A02");
  assert.equal(m.rowCount, 149);
  assert.equal(m.uniqueIdCount, 149);
  assert.equal(m.annotationFileHash, sha(fs.readFileSync(path.join(h, "pilot_A01.csv"))));
  assert.equal(m.provenanceFileHash, sha(fs.readFileSync(path.join(h, "pilot_A01.provenance.json"))));
  assert.equal(m.attestationFileHash, sha(fs.readFileSync(path.join(h, "attestation_A01.md"))));
  const files = fs.readdirSync(h);
  assert.ok(!files.some((f) => /A02/.test(f) && !/template/.test(f)));
  assert.ok(!files.some((f) => /agreement|disagree|adjudicat/i.test(f)));
});
