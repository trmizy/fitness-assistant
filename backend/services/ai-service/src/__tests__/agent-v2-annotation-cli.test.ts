/**
 * M7-P5A2 Phase 2 (+ C1–C4 remediation) — tests of the OFFLINE annotation CLI on SYNTHETIC fixtures only (TEST FIXTURE):
 * prepare → check-role → accept-submissions → agreement → merge → validate → freeze --fixture, plus interrupted /
 * duplicated / malformed submissions, no-overwrite, determinism, tag leakage and A/B immutability.
 * Integrity attacks (C1–C4) are in agent-v2-annotation-integrity.test.ts. Every file lives in a fresh OS temp directory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { computeAgreement } from "./m7-benchmark/annotation-agreement";
import { REQUIRED_CANDIDATE_FILES } from "./m7-benchmark/annotation-cli";
import { SCHEMA_VERSION } from "./m7-benchmark/annotation-schema";
import {
  CANDIDATE, QUESTIONS, acceptArgs, acceptanceRecord, adjRows, agreementArgs, anchorsOf, cleanup, freezeArgs, jsonl, lab, mergeArgs, pipeline, prepareArgs,
  questionRows, readJsonl, roleRows, run, sha, signFromRefusal, workspace, type Obj,
} from "./m7-benchmark/annotation-test-scenario";

const CLI = path.join(__dirname, "m7-benchmark", "annotation-cli.ts");

test("CLI-1 prepare: annotators get id / question / accented ONLY; receipt binds every question's content and tags; deterministic; never overwrites", () => {
  const w = workspace();
  try {
    const r = run(prepareArgs(w));
    assert.equal(r.code, 0, r.out.join("\n"));
    for (const f of ["for-annotator-A.jsonl", "for-annotator-B.jsonl"]) {
      const rows = readJsonl(w.p(`prep/${f}`));
      assert.deepEqual(rows.map((x) => Object.keys(x)), rows.map(() => ["id", "question", "accented"]));
      assert.deepEqual(rows.map((x) => x.id).sort(), QUESTIONS.map((c) => c.id));
      const raw = fs.readFileSync(w.p(`prep/${f}`), "utf8");
      for (const leak of ["tags", "review", "long_question", "source", "W01", "CUR01", "annotatorId", "primaryAgent"]) assert.ok(!raw.includes(`"${leak}"`), `${f} leaks ${leak}`);
      assert.ok(!raw.startsWith("﻿") && !raw.includes("\r"), "UTF-8 without BOM, LF");
    }
    const rc = JSON.parse(fs.readFileSync(w.p("prep/prepare-manifest.json"), "utf8"));
    assert.equal(rc.seed, 42); assert.equal(rc.curatorId, "CUR01"); assert.deepEqual(rc.writerKeys, ["w01"]);
    assert.equal(rc.inputs.questionsSha256, sha(w.p("questions.jsonl"))); assert.equal(rc.outputs.forAnnotatorASha256, sha(w.p("prep/for-annotator-A.jsonl")));
    assert.deepEqual(rc.questions.map((q: Obj) => [q.id, q.tags]), QUESTIONS.map((c) => [c.id, c.tags]));
    assert.match(rc.batchId, /^[0-9a-f]{64}$/);
    assert.ok(r.out.some((l) => l.includes(rc.batchId)), "the batchId to record out of band is printed");
    assert.equal(run(prepareArgs(w, "prep2")).code, 0);
    for (const f of ["for-annotator-A.jsonl", "for-annotator-B.jsonl", "prepare-manifest.json"]) assert.equal(sha(w.p(`prep/${f}`)), sha(w.p(`prep2/${f}`)), f);
    const before = fs.readdirSync(w.p("prep")).map((f) => [f, sha(w.p(`prep/${f}`))]);
    const again = run(prepareArgs(w, "prep", "7"));
    assert.equal(again.code, 1); assert.deepEqual(again.codes, ["OUTPUT_EXISTS"]);
    assert.deepEqual(fs.readdirSync(w.p("prep")).map((f) => [f, sha(w.p(`prep/${f}`))]), before);
    assert.deepEqual(fs.readdirSync(w.dir).filter((f) => f.includes(".partial-")), [], "no staging left behind");
    const bad = questionRows();
    bad[1].id = "q-0001"; bad[2].question = ` ${bad[2].question}`; (bad[3].source as Obj).author = ""; (bad[4] as Obj).final = lab("training");
    fs.writeFileSync(w.p("bad-questions.jsonl"), jsonl(bad));
    const rb = run(["prepare", "--questions", w.p("bad-questions.jsonl"), "--out-dir", w.p("prep3"), "--seed", "1", "--curator", "CUR01"]);
    assert.equal(rb.code, 1);
    for (const c of ["DUPLICATE_ID", "QUESTION_NOT_TRIMMED", "INVALID_SOURCE", "UNEXPECTED_KEY"]) assert.ok(rb.codes.includes(c), c);
    assert.equal(fs.existsSync(w.p("prep3")), false, "nothing written on refusal");
    assert.equal(run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep4"), "--seed", "-1", "--curator", "CUR01"]).code, 2);
    assert.equal(run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep5"), "--seed", "1"]).code, 2, "--curator is required");
    const cw = run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep6"), "--seed", "1", "--curator", "w01"]);
    assert.deepEqual(cw.codes, ["CURATOR_IS_WRITER"]); assert.equal(fs.existsSync(w.p("prep6")), false);
  } finally { cleanup(w); }
});

test("CLI-2 check-role: complete files pass; interrupted, duplicated, malformed, tag-carrying and id-inconsistent files are refused", () => {
  const w = workspace();
  try {
    const cr = (file: string, extra: string[] = []) => run(["check-role", "--role", "A", "--prepared", w.p("questions.jsonl"), "--labels", file, ...extra]);
    const ok = cr(w.p("A.jsonl"));
    assert.equal(ok.code, 0); assert.ok(ok.out.some((l) => l.includes(sha(w.p("A.jsonl")))), "submission sha printed (receipt)");
    assert.equal(cr(w.p("A.jsonl"), ["--other", w.p("B.jsonl")]).code, 0);
    const write = (n: string, t: string) => { fs.writeFileSync(w.p(n), t); return w.p(n); };
    const full = fs.readFileSync(w.p("A.jsonl"), "utf8");
    const cut = cr(write("cut.jsonl", full.slice(0, full.length - 60)));
    assert.equal(cut.code, 1); assert.ok(cut.codes.includes("MALFORMED_JSON") && cut.codes.includes("MISSING_SUBMISSION"), cut.codes.join());
    assert.deepEqual(cr(write("short.jsonl", jsonl(roleRows("A").slice(0, 3)))).codes, ["MISSING_SUBMISSION", "MISSING_SUBMISSION"]);
    const rows = roleRows("A");
    assert.deepEqual(cr(write("dup.jsonl", jsonl([...rows, { ...rows[0], primaryAgent: "nutrition", domains: [{ agent: "nutrition", role: "request" }] }]))).codes, ["DUPLICATE_ID"]);
    assert.deepEqual(cr(write("bom.jsonl", "﻿" + full)).codes, ["FILE_HAS_BOM"]);
    const mal = cr(write("mal.jsonl", jsonl([...rows, [1, 2], { ...rows[0], id: "Q-9999" }])));
    assert.ok(mal.codes.includes("NOT_OBJECT") && mal.codes.includes("UNKNOWN_ID"));
    assert.ok(cr(write("tag.jsonl", jsonl(rows.map((x, i) => (i === 0 ? { ...x, tags: ["minor"] } : x))))).codes.includes("TAG_IN_ANNOTATOR_FILE"));
    assert.deepEqual(cr(write("norat.jsonl", jsonl(rows.map((x, i) => (i === 1 ? { ...x, rationale: "" } : x))))).codes, ["MISSING_ANNOTATOR_RATIONALE"]);
    assert.deepEqual(cr(write("ids.jsonl", jsonl(rows.map((x, i) => (i === 2 ? { ...x, annotatorId: "A77" } : x))))).codes, ["ROLE_ID_INCONSISTENT"]);
    assert.deepEqual(cr(write("der.jsonl", jsonl(rows.map((x, i) => (i === 0 ? { ...x, acceptable: [["training"]] } : x))))).codes, ["DERIVED_FIELD_NOT_ALLOWED"]);
    assert.deepEqual(cr(write("llm.jsonl", jsonl(rows.map((x) => ({ ...x, annotatorId: "claude-labeler" }))))).codes, Array(5).fill("INVALID_ANNOTATOR_ID"));
    assert.deepEqual(cr(w.p("A.jsonl"), ["--other", write("Bsame.jsonl", jsonl(roleRows("B", "a01")))]).codes, ["ROLE_CONFLICT"]);
    assert.equal(fs.readFileSync(w.p("A.jsonl"), "utf8"), full, "inputs are never modified");
  } finally { cleanup(w); }
});

test("CLI-3 accept-submissions + agreement: ORIGINAL A/B only; κ, PABAK, prevalence, queue; κ < 0.60 → exit 3; missing labels refused", () => {
  const w = workspace();
  try {
    assert.equal(run(prepareArgs(w)).code, 0);
    const acc = run(acceptArgs(w));
    assert.equal(acc.code, 0, acc.out.join("\n"));
    const subs = JSON.parse(fs.readFileSync(w.p("subs.json"), "utf8"));
    assert.deepEqual([subs.annotatorA.sha256, subs.annotatorB.sha256, subs.annotatorA.annotatorId], [sha(w.p("A.jsonl")), sha(w.p("B.jsonl")), "A01"]);
    assert.ok(acc.out.some((l) => l.includes(sha(w.p("subs.json")))), "the receipt sha to record out of band is printed");
    const r = run(agreementArgs(w));
    assert.equal(r.code, 3, r.out.join("\n")); assert.deepEqual(r.reviewCodes, ["CALIBRATION_REQUIRED"]);
    const rep = JSON.parse(fs.readFileSync(w.p("agreement.json"), "utf8"));
    assert.deepEqual(rep.adjudicationQueue, ["Q-0003"]);
    assert.deepEqual(rep.exactLabelAgreement, { agree: 4, n: 5, percent: 80 });
    const expected = computeAgreement(QUESTIONS.map((c) => ({ id: c.id, a: c.A, b: c.B })));
    assert.ok(Math.abs(rep.report.withAmbiguous.primary.kappa.value - 0.24 / 0.44) < 1e-12);
    assert.equal(rep.report.withAmbiguous.primary.kappa.value, expected.withAmbiguous.primary.kappa.value);
    assert.equal(rep.policy.status, "CALIBRATION_REQUIRED");
    assert.ok("pabak" in rep.report.withAmbiguous.perAgentKappa.training && "prevalence" in rep.report.withAmbiguous);
    assert.equal(rep.report.withAmbiguous.perAgentKappa.recovery.kappa.value, null, "undefined κ stays visible as null");
    assert.equal(rep.inputs.annotatorASha256, sha(w.p("A.jsonl")));
    assert.equal(run(agreementArgs(w)).code, 1, "never overwrites");
    fs.writeFileSync(w.p("B.jsonl"), jsonl(roleRows("B").slice(0, 4)));
    const miss = run(agreementArgs(w, "agreement2.json"));
    assert.equal(miss.code, 1); assert.ok(miss.out.some((l) => l.includes('"missingLabels":{"A":0,"B":1}')));
    assert.equal(fs.existsSync(w.p("agreement2.json")), false);
    assert.equal(run(acceptArgs(w, "subs2.json")).code, 1, "an incomplete submission is never accepted");
  } finally { cleanup(w); }
});

test("CLI-4 merge: A/B copied unchanged, final = shared label or the adjudicator's decision, separate adjudication.jsonl, deterministic, inputs untouched", () => {
  const w = workspace();
  try {
    const inputs = () => ["questions.jsonl", "A.jsonl", "B.jsonl", "adjudicator.jsonl"].map((f) => [f, sha(w.p(f))]);
    const before = inputs();
    pipeline(w);
    assert.deepEqual(inputs(), before, "inputs untouched");
    const ds = readJsonl(w.p("m/dataset.jsonl"));
    assert.deepEqual(ds.map((x) => x.id), QUESTIONS.map((c) => c.id));
    const A = readJsonl(w.p("A.jsonl")), B = readJsonl(w.p("B.jsonl"));
    const strip = ({ schemaVersion: _s, id: _i, ...rest }: Obj) => rest;
    ds.forEach((row, i) => { assert.deepEqual(row.annotatorA, strip(A[i])); assert.deepEqual(row.annotatorB, strip(B[i])); });
    const q3 = ds.find((x) => x.id === "Q-0003")!;
    assert.deepEqual(q3.final, lab("nutrition"), "final = the adjudicator decision, not annotator A");
    assert.notEqual(q3.final.primaryAgent, q3.annotatorA.primaryAgent);
    assert.deepEqual(ds.filter((x) => x.id !== "Q-0003").map((x) => x.adjudication), Array(4).fill({ needed: false }));
    assert.ok(ds.every((x) => x.rationaleBy === "ADJ01"));
    assert.equal(ds.find((x) => x.id === "Q-0005")!.routingScored, false, "Q6");
    const adj = readJsonl(w.p("m/adjudication.jsonl"));
    assert.deepEqual(adj.map((x) => x.id), QUESTIONS.map((c) => c.id), "one line per id (Q8)");
    const man = JSON.parse(fs.readFileSync(w.p("m/merge-manifest.json"), "utf8"));
    assert.equal(man.outputs.datasetSha256, sha(w.p("m/dataset.jsonl"))); assert.equal(man.outputs.adjudicationSha256, sha(w.p("m/adjudication.jsonl")));
    assert.equal(man.inputs.annotatorASha256, sha(w.p("A.jsonl"))); assert.equal(man.inputs.submissionsReceiptSha256, sha(w.p("subs.json")));
    assert.deepEqual(man.counts, { cases: 5, agreements: 4, disagreements: 1, tagAuditEntries: 0 });
    assert.deepEqual(man.roles, { annotatorA: "A01", annotatorB: "B02", adjudicator: "ADJ01", curator: "CUR01" });
    assert.equal(run(mergeArgs(w, "m2")).code, 3);
    for (const f of ["dataset.jsonl", "adjudication.jsonl", "merge-manifest.json"]) assert.equal(sha(w.p(`m/${f}`)), sha(w.p(`m2/${f}`)), f);
    const again = run(mergeArgs(w, "m"));
    assert.equal(again.code, 1); assert.deepEqual(again.codes, ["OUTPUT_EXISTS"]);
    assert.equal(sha(w.p("m/dataset.jsonl")), man.outputs.datasetSha256);
  } finally { cleanup(w); }
});

test("CLI-5 merge refuses (publishes nothing) on a missing decision, an unneeded decision, a non-independent adjudicator, missing / duplicate ids", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    const variants: Array<[string, Obj[], string]> = [
      ["no decision for the disagreement", adjRows().map((x) => (x.id === "Q-0003" ? { schemaVersion: x.schemaVersion, id: x.id, adjudicatorId: x.adjudicatorId, finalRationale: x.finalRationale } : x)), "ADJUDICATION_MISSING"],
      ["decision on an agreed case", adjRows().map((x) => (x.id === "Q-0001" ? { ...x, decision: lab("training"), decisionRationale: "TEST FIXTURE" } : x)), "ADJUDICATION_NOT_NEEDED"],
      ["adjudicator = annotator B", adjRows().map((x) => ({ ...x, adjudicatorId: "B02" })), "ADJUDICATOR_IS_ANNOTATOR"],
      ["adjudicator = curator", adjRows().map((x) => ({ ...x, adjudicatorId: "CUR01" })), "ROLE_CONFLICT"],
      ["two adjudicator ids", adjRows().map((x, i) => (i === 4 ? { ...x, adjudicatorId: "ADJ02" } : x)), "ROLE_ID_INCONSISTENT"],
      ["missing adjudicator line", adjRows().slice(0, 4), "MISSING_SUBMISSION"],
      ["duplicated adjudicator line", [...adjRows(), adjRows()[0]], "DUPLICATE_ID"],
      ["no final rationale", adjRows().map((x, i) => (i === 0 ? { ...x, finalRationale: " " } : x)), "MISSING_RATIONALE"],
    ];
    variants.forEach(([what, rows, code], i) => {
      fs.writeFileSync(w.p(`adj-${i}.jsonl`), jsonl(rows));
      const r = run(mergeArgs(w, `out-${i}`, { adj: `adj-${i}.jsonl` }));
      assert.equal(r.code, 1, what); assert.ok(r.codes.includes(code), `${what}: ${r.codes.join()}`);
      assert.equal(fs.existsSync(w.p(`out-${i}`)), false, `${what}: nothing written`);
    });
  } finally { cleanup(w); }
});

test("CLI-6 merge applies the curator's tag audit against the PREPARED tags (governed tags need the adjudicator); labels untouched", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w)); run(agreementArgs(w));
    const entry = (o: Obj) => JSON.stringify({ schemaVersion: SCHEMA_VERSION, seq: 1, id: "Q-0002", from: [], to: ["multi_clause"], reason: "TEST FIXTURE: hai mệnh đề", curatorId: "CUR01", ...o }) + "\n";
    const setTags = (id: string, tags: string[]) => fs.writeFileSync(w.p("questions.jsonl"), jsonl(questionRows().map((q) => (q.id === id ? { ...q, tags } : q))));
    // the current question file carries the audited tags; the tags are replayed from the receipt, never trusted from the file
    setTags("Q-0002", ["multi_clause"]);
    fs.writeFileSync(w.p("audit-ok.jsonl"), entry({}));
    const ok = run(mergeArgs(w, "m", { audit: "audit-ok.jsonl" }));
    assert.equal(ok.code, 3, ok.out.join("\n"));
    assert.deepEqual(readJsonl(w.p("m/dataset.jsonl")).find((x) => x.id === "Q-0002")!.tags, ["multi_clause"]);
    const man = JSON.parse(fs.readFileSync(w.p("m/merge-manifest.json"), "utf8"));
    assert.equal(man.inputs.tagAuditSha256, sha(w.p("audit-ok.jsonl")));
    setTags("Q-0002", ["high_risk"]);
    fs.writeFileSync(w.p("audit-gov.jsonl"), entry({ to: ["high_risk"] }));
    const gov = run(mergeArgs(w, "m2", { audit: "audit-gov.jsonl" }));
    assert.equal(gov.code, 1); assert.ok(gov.codes.includes("TAG_AUDIT_CONFIRMATION_MISSING")); assert.equal(fs.existsSync(w.p("m2")), false);
    fs.writeFileSync(w.p("audit-label.jsonl"), entry({ safety: "HIGH_RISK" }));
    assert.ok(run(mergeArgs(w, "m3", { audit: "audit-label.jsonl" })).codes.includes("TAG_AUDIT_LABEL_EDIT_FORBIDDEN"));
    fs.writeFileSync(w.p("audit-ann.jsonl"), entry({ curatorId: "A01" }));
    assert.ok(run(mergeArgs(w, "m4", { audit: "audit-ann.jsonl" })).codes.includes("ROLE_CONFLICT"));
    setTags("Q-0002", ["multi_clause"]);
    fs.writeFileSync(w.p("audit-cur.jsonl"), entry({ curatorId: "CUR09" }));
    assert.ok(run(mergeArgs(w, "m5", { audit: "audit-cur.jsonl" })).codes.includes("CURATOR_MISMATCH"));
  } finally { cleanup(w); }
});

test("CLI-7 freeze --fixture happy path: anchors, recomputation, content-bound sign-offs, Q8 / Q9; deterministic; never overwrites", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    assert.equal(run(["validate", w.p("m/dataset.jsonl"), "--no-distribution"]).code, 3);
    signFromRefusal(w, an);
    const ok = run(freezeArgs(w, an));
    assert.equal(ok.code, 0, ok.out.join("\n"));
    const fz = JSON.parse(fs.readFileSync(w.p("freeze.json"), "utf8"));
    assert.match(fz.status, /^FIXTURE ONLY/); assert.equal(fz.fixture, true); assert.match(fz.trust, /do not prove authenticity/);
    assert.equal(fz.files.adjudicatedLabelsSha256, sha(w.p("m/adjudication.jsonl")), "Q8");
    assert.notEqual(fz.files.adjudicatedLabelsSha256, fz.binding.datasetSha256);
    assert.deepEqual(fz.acceptedIdentities, acceptanceRecord(an).identities, "the six identities of the owner acceptance record");
    assert.equal(fz.binding.annotatorASha256, sha(w.p("A.jsonl"))); assert.equal(fz.files.annotationGuideSha256, sha(w.p("guide.md")));
    assert.deepEqual(fz.candidate.requiredFilesQ9, [...REQUIRED_CANDIDATE_FILES]); assert.equal(fz.candidate.modelId, "PENDING");
    assert.equal(fz.validator.reviews, fz.validator.reviewsSigned);
    assert.deepEqual(fz.agreementReview, { role: "adjudicator", signedBy: "ADJ01", decision: "CALIBRATION_COMPLETED", policyStatus: "CALIBRATION_REQUIRED" });
    assert.equal(run(freezeArgs(w, an)).code, 1, "never overwrites freeze.json");
    assert.equal(run(freezeArgs(w, an, { out: "freeze2.json" })).code, 0);
    assert.equal(sha(w.p("freeze.json")), sha(w.p("freeze2.json")), "deterministic");
    // an OFFICIAL freeze is never authorized by this tool (no trust anchor custody, hashes ≠ authenticity)
    const off = run(freezeArgs(w, an, { fixture: false, out: "freeze-official.json" }));
    assert.deepEqual(off.codes, ["OFFICIAL_FREEZE_NOT_AUTHORIZED"]); assert.equal(fs.existsSync(w.p("freeze-official.json")), false);
  } finally { cleanup(w); }
});

test("CLI-8 freeze refuses an unclean candidate or one without the Q9 safety files; a tag-audited merge needs its audit file", () => {
  const w = workspace();
  try {
    pipeline(w);
    // F1: the candidate identity is part of the owner record and of the review binding, so each candidate is re-anchored and re-signed
    const resign = () => { const x = anchorsOf(w); signFromRefusal(w, x); return x; };
    fs.writeFileSync(w.p("candidate.json"), JSON.stringify(CANDIDATE({ clean: false })));
    assert.deepEqual(run(freezeArgs(w, resign())).codes, ["CANDIDATE_NOT_CLEAN"]);
    for (const missing of REQUIRED_CANDIDATE_FILES) {
      fs.writeFileSync(w.p("candidate.json"), JSON.stringify(CANDIDATE({ files: REQUIRED_CANDIDATE_FILES.filter((p) => p !== missing).map((p) => ({ path: p, sha256: "b".repeat(64) })) })));
      assert.deepEqual(run(freezeArgs(w, resign())).codes, ["CANDIDATE_MISSING_REQUIRED_FILE"], missing);
    }
    fs.writeFileSync(w.p("candidate.json"), JSON.stringify(CANDIDATE()));
    fs.writeFileSync(w.p("questions.jsonl"), jsonl(questionRows().map((q) => (q.id === "Q-0002" ? { ...q, tags: ["multi_clause"] } : q))));
    fs.writeFileSync(w.p("audit.jsonl"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, seq: 1, id: "Q-0002", from: [], to: ["multi_clause"], reason: "TEST FIXTURE", curatorId: "CUR01" }) + "\n");
    assert.equal(run(mergeArgs(w, "ma", { audit: "audit.jsonl" })).code, 3);
    const an2 = anchorsOf(w, "ma");
    const noAudit = run(freezeArgs(w, an2, { m: "ma" }));
    assert.equal(noAudit.code, 1, "without the audit the recomputed merge does not reproduce the audited dataset");
    assert.ok(noAudit.codes.includes("TAG_CHANGED_WITHOUT_AUDIT"), noAudit.codes.join());
    signFromRefusal(w, an2, { m: "ma", src: { audit: "audit.jsonl" } });
    assert.equal(run(freezeArgs(w, an2, { m: "ma", src: { audit: "audit.jsonl" } })).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(w.p("freeze.json"), "utf8")).binding.tagAuditSha256, sha(w.p("audit.jsonl")));
  } finally { cleanup(w); }
});

test("CLI-9 real process: usage → exit 2, validate of the m7-p5a2 fixture → exit 0; the CLI source has no network / model / AWS dependency", () => {
  const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx");
  const bin = fs.existsSync(tsx) ? tsx : fs.existsSync(`${tsx}.cmd`) ? `${tsx}.cmd` : null;
  assert.ok(bin, "tsx binary present (the process-boundary checks must not be skipped silently)");
  const opts = { encoding: "utf8" as const, shell: process.platform === "win32", env: { ...process.env, FITNESS_DISABLE_REDIS: "true" } };
  assert.equal(spawnSync(bin!, [CLI], opts).status, 2);
  const fx = path.join(__dirname, "m7-benchmark", "annotation-fixtures", "synthetic-valid-sample.m7-p5a2.jsonl");
  assert.equal(spawnSync(bin!, [CLI, "validate", fx, "--no-distribution"], opts).status, 0);
  const src = ["annotation-cli.ts", "annotation-tag-audit.ts", "annotation-validator.ts", "annotation-schema.ts", "annotation-agreement.ts", "annotation-dataset-checks.ts", "annotation-json.ts"]
    .map((f) => fs.readFileSync(path.join(__dirname, "m7-benchmark", f), "utf8")).join("\n");
  const imports = src.split("\n").filter((l) => /^import |^\} from |require\(/.test(l)).join("\n");
  for (const bad of [/"node:(http|https|net|dns|tls|dgram|child_process)"/, /aws-sdk|bedrock|ioredis|prisma|openai|anthropic/i]) assert.ok(!bad.test(imports), `${String(bad)}\n${imports}`);
  assert.ok(!/\bfetch\(/.test(src));
});
