/**
 * M7-P5A2 C1–C4 INTEGRITY remediation — adversarial tests (TEST FIXTURE, synthetic, OS temp dirs, offline).
 * Each attack must FAIL CLOSED: nonzero exit, a clear code, and no finalized output. The original A / B files never change.
 * C1 prepare→merge binding · C2 agreement policy forgery · C3 original A / B provenance · C4 review replay · atomic outputs ·
 * concurrent / interrupted writes · sources changed mid-run · the stated limit (hash consistency ≠ authenticity).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { testHooks } from "./m7-benchmark/annotation-cli";
import { SCHEMA_VERSION } from "./m7-benchmark/annotation-schema";
import {
  acceptArgs, adjRows, agreementArgs, anchorsOf, cleanup, freezeArgs, jsonl, mergeArgs, pipeline, prepareArgs, questionRows, readJsonl,
  reseal, roleRows, run, sha, signFromRefusal, workspace, type Obj, type Ws,
} from "./m7-benchmark/annotation-test-scenario";

const hashes = (w: Ws) => ["A.jsonl", "B.jsonl", "questions.jsonl", "adjudicator.jsonl"].map((f) => [f, sha(w.p(f))]);
const setQuestions = (w: Ws, f: (q: Obj) => Obj | null) => fs.writeFileSync(w.p("questions.jsonl"), jsonl(questionRows().map(f).filter((x): x is Obj => x !== null)));
const noOutput = (w: Ws, dir: string) => assert.equal(fs.existsSync(w.p(dir)), false, `${dir} must not be published`);
const noStaging = (w: Ws) => assert.deepEqual(fs.readdirSync(w.dir).filter((f) => f.includes(".partial-")), [], "no staging left behind");
const shaOf = (s: string) => createHash("sha256").update(s).digest("hex");

// ── C1: prepare → merge binding ──────────────────────────────────────────────────────────────────────────────────────
test("INT-C1a question text changed after prepare (same id): merge refuses, nothing published, labels never attach to the new text", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    const before = hashes(w);
    setQuestions(w, (q) => (q.id === "Q-0001" ? { ...q, question: "Tối nay ăn khoai lang luộc thay cơm trắng có ổn không bạn?" } : q));
    const r = run(mergeArgs(w));
    assert.equal(r.code, 1); assert.deepEqual(r.codes, ["QUESTION_CONTENT_CHANGED"]); noOutput(w, "m"); noStaging(w);
    assert.deepEqual(hashes(w).filter(([f]) => f !== "questions.jsonl"), before.filter(([f]) => f !== "questions.jsonl"));
    // accented flag flipped alone is also a content change
    setQuestions(w, (q) => (q.id === "Q-0002" ? { ...q, question: "Bua trua o cang tin toan do chien thi chon mon nao cho do ngay?", accented: false } : q));
    assert.deepEqual(run(mergeArgs(w)).codes, ["QUESTION_CONTENT_CHANGED"]);
  } finally { cleanup(w); }
});

test("INT-C1b different id for the same text, a missing prepared question, a foreign question: all refused", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    setQuestions(w, (q) => (q.id === "Q-0002" ? { ...q, id: "Q-0099" } : q));
    const moved = run(mergeArgs(w));
    assert.equal(moved.code, 1); assert.ok(moved.codes.includes("QUESTION_ID_CHANGED") && moved.codes.includes("MISSING_PREPARED_QUESTION"), moved.codes.join()); noOutput(w, "m");
    setQuestions(w, (q) => (q.id === "Q-0002" ? null : q));
    assert.deepEqual(run(mergeArgs(w)).codes, ["MISSING_PREPARED_QUESTION"]);
    setQuestions(w, (q) => q);
    fs.appendFileSync(w.p("questions.jsonl"), JSON.stringify({ ...questionRows()[0], id: "Q-0777", question: "Câu hỏi lạ chưa từng được chuẩn bị cho người gán nhãn đâu nhé?" }) + "\n");
    assert.deepEqual(run(mergeArgs(w)).codes, ["FOREIGN_QUESTION"]);
    noOutput(w, "m");
  } finally { cleanup(w); }
});

test("INT-C1c a foreign / duplicate / missing annotation row is never accepted", () => {
  const w = workspace();
  try {
    run(prepareArgs(w));
    const rows = roleRows("A");
    fs.writeFileSync(w.p("A.jsonl"), jsonl([...rows, { ...rows[0], id: "Q-0777" }]));
    assert.ok(run(acceptArgs(w)).codes.includes("UNKNOWN_ID"));
    fs.writeFileSync(w.p("A.jsonl"), jsonl([...rows, rows[1]]));
    assert.ok(run(acceptArgs(w)).codes.includes("DUPLICATE_ID"));
    fs.writeFileSync(w.p("A.jsonl"), jsonl(rows.slice(1)));
    assert.deepEqual(run(acceptArgs(w)).codes, ["MISSING_SUBMISSION"]);
    noOutput(w, "subs.json");
  } finally { cleanup(w); }
});

test("INT-C1d removing the governed `review` tag without an audit is refused; with an adjudicator-confirmed audit entry it is applied", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    setQuestions(w, (q) => (q.id === "Q-0004" ? { ...q, tags: [] } : q));
    const silent = run(mergeArgs(w));
    assert.equal(silent.code, 1); assert.deepEqual(silent.codes, ["TAG_CHANGED_WITHOUT_AUDIT"]); noOutput(w, "m");
    const entry = (o: Obj) => JSON.stringify({ schemaVersion: SCHEMA_VERSION, seq: 1, id: "Q-0004", from: ["review"], to: [], reason: "TEST FIXTURE: curator correction", curatorId: "CUR01", ...o }) + "\n";
    fs.writeFileSync(w.p("audit-noconf.jsonl"), entry({}));
    assert.deepEqual(run(mergeArgs(w, "m1", { audit: "audit-noconf.jsonl" })).codes, ["TAG_AUDIT_CONFIRMATION_MISSING"]);
    fs.writeFileSync(w.p("audit-ok.jsonl"), entry({ confirmedBy: "ADJ01" }));
    const ok = run(mergeArgs(w, "m2", { audit: "audit-ok.jsonl" }));
    assert.equal(ok.code, 3, ok.out.join("\n"));
    assert.deepEqual(readJsonl(w.p("m2/dataset.jsonl")).find((x) => x.id === "Q-0004")!.tags, []);
    assert.ok(ok.reviewCodes.includes("THIRD_PARTY_MARKER_WITHOUT_REVIEW_TAG"), "the removal is still surfaced for a human");
  } finally { cleanup(w); }
});

test("INT-C1e an edited prepare receipt is detected; a re-generated receipt does not match the accepted submissions / the accepted batchId", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    signFromRefusal(w, an);
    const rc = JSON.parse(fs.readFileSync(w.p("prep/prepare-manifest.json"), "utf8"));
    rc.questions[0].tags = ["minor"];
    fs.writeFileSync(w.p("prep/prepare-manifest.json"), JSON.stringify(rc, null, 2) + "\n");
    reseal(w.p("prep")); // the forger controls the directory and re-seals the marker (G3: otherwise the marker check refuses first)
    assert.deepEqual(run(mergeArgs(w, "m2")).codes, ["RECEIPT_INCONSISTENT"]);
    // regenerate a full new receipt from edited questions (an internally consistent rewrite)
    setQuestions(w, (q) => (q.id === "Q-0001" ? { ...q, question: "Tối nay ăn khoai lang luộc thay cơm trắng có ổn không bạn?" } : q));
    assert.equal(run(prepareArgs(w, "prep-new")).code, 0);
    const r = run(mergeArgs(w, "m3", { prep: "prep-new" }));
    assert.equal(r.code, 1); assert.deepEqual(r.codes, ["RECEIPT_MISMATCH"], "the accepted submissions belong to the original batch");
    const fz = run(freezeArgs(w, { ...an }, { src: { prep: "prep-new" }, out: "f-new.json" }));
    assert.ok(fz.codes.includes("ANCHOR_MISMATCH"), fz.codes.join()); noOutput(w, "f-new.json");
  } finally { cleanup(w); }
});

// ── C2: agreement policy ─────────────────────────────────────────────────────────────────────────────────────────────
test("INT-C2a a forged agreement policy flag never authorizes: the report must equal the recomputation and the review is still required", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    signFromRefusal(w, an, { agreementReview: null });
    const ag = JSON.parse(fs.readFileSync(w.p("agreement.json"), "utf8"));
    assert.equal(ag.policy.status, "CALIBRATION_REQUIRED");
    ag.policy.reviewRequired = false; ag.policy.calibrationRequired = false; ag.policy.status = "NO_CALIBRATION_TRIGGER";
    fs.writeFileSync(w.p("agreement.json"), JSON.stringify(ag, null, 2) + "\n");
    const r = run(freezeArgs(w, an));
    assert.equal(r.code, 1);
    assert.ok(r.codes.includes("AGREEMENT_REPORT_MISMATCH") && r.codes.includes("AGREEMENT_REVIEW_NOT_SIGNED"), r.codes.join());
    noOutput(w, "freeze.json");
    // a forged κ value is caught the same way
    ag.policy.reviewRequired = true; ag.report.withAmbiguous.primary.kappa.value = 0.95;
    fs.writeFileSync(w.p("agreement.json"), JSON.stringify(ag, null, 2) + "\n");
    assert.ok(run(freezeArgs(w, an)).codes.includes("AGREEMENT_REPORT_MISMATCH"));
  } finally { cleanup(w); }
});

test("INT-C2b agreement review: annotators refused; adjudicator or a non-writer reviewer accepted; calibration documented and outside the dataset", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    const { binding } = signFromRefusal(w, an);
    const so = JSON.parse(fs.readFileSync(w.p("signoff.json"), "utf8"));
    const tryReview = (ar: Obj | null, out: string) => { fs.writeFileSync(w.p("so.json"), JSON.stringify({ ...so, agreementReview: ar })); return run(freezeArgs(w, an, { signoff: "so.json", out })); };
    const base = so.agreementReview as Obj;
    assert.ok(tryReview({ ...base, role: "reviewer", signedBy: "A01" }, "x1.json").codes.includes("AGREEMENT_REVIEWER_IS_ANNOTATOR"));
    assert.ok(tryReview({ ...base, role: "adjudicator", signedBy: "b02" }, "x2.json").codes.includes("AGREEMENT_REVIEWER_IS_ANNOTATOR"));
    assert.ok(tryReview({ ...base, role: "adjudicator", signedBy: "OWNER01" }, "x3.json").codes.includes("AGREEMENT_REVIEW_ROLE"), "role adjudicator must be THE adjudicator");
    assert.ok(tryReview({ ...base, role: "reviewer", signedBy: "W01" }, "x4.json").codes.includes("AGREEMENT_REVIEW_ROLE"), "a writer is not a reviewer");
    assert.ok(tryReview({ ...base, role: "boss" }, "x5.json").codes.includes("AGREEMENT_REVIEW_ROLE"));
    assert.ok(tryReview({ ...base, decision: "REVIEWED" }, "x6.json").codes.includes("AGREEMENT_REVIEW_DECISION"));
    assert.ok(tryReview({ ...base, calibration: undefined }, "x7.json").codes.includes("CALIBRATION_NOT_DOCUMENTED"));
    assert.ok(tryReview({ ...base, calibration: { caseIds: ["q-0002"], ref: "x" } }, "x8.json").codes.includes("CALIBRATION_CASE_IN_DATASET"));
    for (const n of ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"]) noOutput(w, `${n}.json`);
    assert.equal(tryReview({ ...base, role: "reviewer", signedBy: "OWNER01", bindingSha256: binding }, "ok.json").code, 0);
  } finally { cleanup(w); }
});

// ── C3: original A / B provenance ────────────────────────────────────────────────────────────────────────────────────
test("INT-C3a merged A/B edited + manifest hashes rewritten: refused by the accepted anchor, and still refused if the attacker also supplies the new anchor", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    signFromRefusal(w, an);
    const ds = readJsonl(w.p("m/dataset.jsonl"));
    ds[0].annotatorA.rationale = "Replaced after merge";
    fs.writeFileSync(w.p("m/dataset.jsonl"), jsonl(ds));
    const mm = JSON.parse(fs.readFileSync(w.p("m/merge-manifest.json"), "utf8"));
    mm.outputs.datasetSha256 = sha(w.p("m/dataset.jsonl"));
    fs.writeFileSync(w.p("m/merge-manifest.json"), JSON.stringify(mm, null, 2) + "\n");
    reseal(w.p("m")); // forger re-seals (G3)
    const r1 = run(freezeArgs(w, an));
    assert.deepEqual(r1.codes, ["ANCHOR_MISMATCH"]); noOutput(w, "freeze.json");
    const r2 = run(freezeArgs(w, { ...an, mm: sha(w.p("m/merge-manifest.json")) }));
    assert.ok(r2.codes.includes("DATASET_NOT_REPRODUCIBLE") && r2.codes.includes("MERGE_MANIFEST_NOT_REPRODUCIBLE"), r2.codes.join()); noOutput(w, "freeze.json");
    // a label edit (not only a rationale) is caught the same way
    ds[0].annotatorA.rationale = readJsonl(w.p("A.jsonl"))[0].rationale; ds[0].annotatorB.primaryAgent = "progress";
    fs.writeFileSync(w.p("m/dataset.jsonl"), jsonl(ds));
    reseal(w.p("m")); // forger re-seals (G3)
    assert.ok(run(freezeArgs(w, { ...an, mm: sha(w.p("m/merge-manifest.json")) })).codes.includes("DATASET_NOT_REPRODUCIBLE"));
  } finally { cleanup(w); }
});

test("INT-C3b the adjudication file / original A file edited after acceptance: refused; a re-issued submissions receipt does not match the accepted one", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    signFromRefusal(w, an);
    const adj = readJsonl(w.p("m/adjudication.jsonl")); adj[2].rationaleBy = "ADJ09";
    fs.copyFileSync(w.p("m/adjudication.jsonl"), w.p("adj.bak"));
    fs.writeFileSync(w.p("m/adjudication.jsonl"), jsonl(adj));
    reseal(w.p("m")); // forger re-seals (G3)
    assert.ok(run(freezeArgs(w, an)).codes.includes("ADJUDICATION_NOT_REPRODUCIBLE"));
    fs.copyFileSync(w.p("adj.bak"), w.p("m/adjudication.jsonl"));
    reseal(w.p("m"));
    const original = fs.readFileSync(w.p("A.jsonl"), "utf8");
    fs.writeFileSync(w.p("A.jsonl"), original.replace("lý do của A cho Q-0001", "lý do đã sửa"));
    const r = run(freezeArgs(w, an));
    assert.ok(r.codes.includes("SUBMISSION_CHANGED_SINCE_RECEIPT"), r.codes.join());
    assert.equal(run(acceptArgs(w, "subs-new.json")).code, 0);
    assert.ok(run(freezeArgs(w, an, { src: { subs: "subs-new.json" } })).codes.includes("ANCHOR_MISMATCH"));
    noOutput(w, "freeze.json");
  } finally { cleanup(w); }
});

test("INT-C3c STATED LIMIT: a complete, internally consistent re-run with attacker-chosen anchors passes --fixture — hashes prove consistency, not authenticity; official freeze is refused", () => {
  const w = workspace();
  try {
    pipeline(w);
    fs.writeFileSync(w.p("A.jsonl"), fs.readFileSync(w.p("A.jsonl"), "utf8").replace("lý do của A cho Q-0001", "lý do giả mạo"));
    assert.equal(run(acceptArgs(w, "subs2.json")).code, 0);
    assert.equal(run(mergeArgs(w, "m2", { subs: "subs2.json" })).code, 3);
    fs.rmSync(w.p("agreement.json")); // the forger also re-runs the agreement on the forged submission
    assert.equal(run(agreementArgs(w)).code, 3);
    const forged = anchorsOf(w, "m2", "prep", "subs2.json");
    signFromRefusal(w, forged, { m: "m2", src: { subs: "subs2.json" } });
    assert.equal(run(freezeArgs(w, forged, { m: "m2", src: { subs: "subs2.json" } })).code, 0, "consistent forgery is NOT detectable without independently kept anchors");
    const off = run(freezeArgs(w, forged, { m: "m2", src: { subs: "subs2.json" }, fixture: false, out: "official.json" }));
    assert.deepEqual(off.codes, ["OFFICIAL_FREEZE_NOT_AUTHORIZED"]); noOutput(w, "official.json");
  } finally { cleanup(w); }
});

// ── C4: review replay ────────────────────────────────────────────────────────────────────────────────────────────────
test("INT-C4 approvals are bound to the content: changed content invalidates every old approval (reviews and agreement review)", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    signFromRefusal(w, an);
    assert.equal(run(freezeArgs(w, an)).code, 0);
    const a = readJsonl(w.p("adjudicator.jsonl"));
    a[3].finalRationale = "TEST FIXTURE: ngôi thứ ba — nội dung xác nhận đã thay đổi";
    fs.writeFileSync(w.p("adjudicator.jsonl"), jsonl(a));
    assert.equal(run(mergeArgs(w, "m2")).code, 3);
    const an2 = anchorsOf(w, "m2");
    const r = run(freezeArgs(w, an2, { m: "m2", out: "f2.json" }));
    assert.equal(r.code, 1);
    for (const c of ["REVIEW_BINDING_MISMATCH", "REVIEW_NOT_SIGNED", "AGREEMENT_REVIEW_BINDING_MISMATCH"]) assert.ok(r.codes.includes(c), `${c}: ${r.codes.join()}`);
    noOutput(w, "f2.json");
    // an approval with the right binding but for another finding does not cover this one
    const so = JSON.parse(fs.readFileSync(w.p("signoff.json"), "utf8"));
    const { binding } = signFromRefusal(w, an2, { m: "m2" });
    const fresh = JSON.parse(fs.readFileSync(w.p("signoff.json"), "utf8"));
    fresh.reviews[0].findingSha256 = shaOf("another finding");
    fs.writeFileSync(w.p("so-swap.json"), JSON.stringify(fresh));
    const sw = run(freezeArgs(w, an2, { m: "m2", signoff: "so-swap.json", out: "f3.json" }));
    assert.ok(sw.codes.includes("REVIEW_NOT_SIGNED") && sw.codes.includes("SIGNOFF_UNMATCHED"), sw.codes.join());
    // an annotator cannot sign review items
    const byAnn = { ...fresh, reviews: (JSON.parse(fs.readFileSync(w.p("signoff.json"), "utf8")).reviews as Obj[]).map((x) => ({ ...x, signedBy: "A01" })) };
    fs.writeFileSync(w.p("so-ann.json"), JSON.stringify(byAnn));
    assert.ok(run(freezeArgs(w, an2, { m: "m2", signoff: "so-ann.json", out: "f4.json" })).codes.includes("SIGNOFF_BY_ANNOTATOR"));
    assert.equal(run(freezeArgs(w, an2, { m: "m2", out: "f5.json" })).code, 0, "fresh approvals for the new content pass");
    assert.notEqual(so.reviews[0].bindingSha256, binding);
  } finally { cleanup(w); }
});

// ── atomic outputs, concurrency, mid-run changes, failed validation ──────────────────────────────────────────────────
test("INT-W interrupted merge, concurrent writer, source changed mid-run, failed validation: no finalized output, nothing overwritten", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    try {
      testHooks.failAfterFiles = 1;
      const r = run(mergeArgs(w, "m-int"));
      assert.equal(r.code, 1); assert.deepEqual(r.codes, ["WRITE_FAILED"]); noOutput(w, "m-int"); noStaging(w);
    } finally { delete testHooks.failAfterFiles; }
    try {
      testHooks.beforePublish = (dir) => { fs.mkdirSync(dir); fs.writeFileSync(`${dir}/dataset.jsonl`, "COMPETITOR\n"); };
      const r = run(mergeArgs(w, "m-race"));
      assert.equal(r.code, 1); assert.deepEqual(r.codes, ["OUTPUT_EXISTS"]);
      assert.equal(fs.readFileSync(w.p("m-race/dataset.jsonl"), "utf8"), "COMPETITOR\n", "the other writer's output is untouched"); noStaging(w);
    } finally { delete testHooks.beforePublish; }
    try {
      testHooks.afterLoad = (file) => { if (file.endsWith("B.jsonl")) fs.appendFileSync(file, "\n"); };
      const r = run(mergeArgs(w, "m-mid"));
      assert.equal(r.code, 1); assert.ok(r.codes.includes("SOURCE_CHANGED_DURING_RUN"), r.codes.join()); noOutput(w, "m-mid");
    } finally { delete testHooks.afterLoad; }
    fs.writeFileSync(w.p("B.jsonl"), jsonl(roleRows("B")));
    // validation failure → nothing published (A and B both label the third-person case MINOR without tag minor)
    const minor = (role: "A" | "B") => roleRows(role).map((x) => (x.id === "Q-0004" ? { ...x, safety: "MINOR" } : x));
    fs.writeFileSync(w.p("A.jsonl"), jsonl(minor("A"))); fs.writeFileSync(w.p("B.jsonl"), jsonl(minor("B")));
    assert.equal(run(acceptArgs(w, "subs-minor.json")).code, 0);
    const v = run(mergeArgs(w, "m-invalid", { subs: "subs-minor.json" }));
    assert.equal(v.code, 1); assert.ok(v.codes.includes("THIRD_PARTY_MINOR_SAFETY"), v.codes.join()); noOutput(w, "m-invalid");
    // freeze also re-checks the sources on disk before publishing
    fs.writeFileSync(w.p("A.jsonl"), jsonl(roleRows("A"))); fs.writeFileSync(w.p("B.jsonl"), jsonl(roleRows("B")));
    assert.equal(run(mergeArgs(w, "m")).code, 3);
    run(agreementArgs(w));
    const an = anchorsOf(w);
    signFromRefusal(w, an);
    try {
      testHooks.afterLoad = (file) => { if (file.endsWith("guide.md")) fs.appendFileSync(file, "x"); };
      const f = run(freezeArgs(w, an));
      assert.ok(f.codes.includes("SOURCE_CHANGED_DURING_RUN"), f.codes.join()); noOutput(w, "freeze.json");
    } finally { delete testHooks.afterLoad; }
    assert.equal(adjRows().length, 5);
  } finally { cleanup(w); }
});
