/**
 * M7-P5A2 FINAL INTEGRITY HARDENING — F1–F5 of the Codex verification of e6d9aaba, plus the owner-controlled acceptance record.
 * TEST FIXTURE only (synthetic data, OS temp dirs, offline). Every attack must FAIL CLOSED: nonzero exit, a clear code, no
 * finalized output, nothing existing replaced or removed.
 *   F1 review binding covers guide, candidate, contract, batch, A/B, adjudication, agreement, tag-audit revision
 *   F2 writer attribution bound at prepare        F3 source snapshot checked at every stage before the success marker
 *   F4 no-replace publication (exclusive claim + hard links + success marker)   F5 a supplied agreementReview is always validated
 *   AM owner acceptance record: draft / verify / freeze; the stated limit (consistency ≠ authenticity)
 * Process tests spawn the CLI through a test-only driver (tsx), or `node <bundle>` when M7_TEST_DRIVER_BUNDLE is set (POSIX run).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { AGREEMENT_POLICY_SHA256, PUBLICATION_MARKER, testHooks } from "./m7-benchmark/annotation-cli";
import { SCHEMA_VERSION } from "./m7-benchmark/annotation-schema";
import {
  FIXTURE_APPROVAL, acceptArgs, acceptanceDraftArgs, acceptanceRecord, acceptanceVerifyArgs, adjRows, agreementArgs, anchorsOf, cleanup,
  freezeArgs, jsonl, lab, mergeArgs, pipeline, prepareArgs, questionRows, readJsonl, reseal, roleRows, run, sha, signFromRefusal, workspace,
  type Anchors, type Obj, type Ws,
} from "./m7-benchmark/annotation-test-scenario";

const setQuestions = (w: Ws, f: (q: Obj) => Obj) => fs.writeFileSync(w.p("questions.jsonl"), jsonl(questionRows().map(f)));
const noOutput = (w: Ws, p: string) => assert.equal(fs.existsSync(w.p(p)), false, `${p} must not be published`);
const noStaging = (w: Ws) => assert.deepEqual(fs.readdirSync(w.dir).filter((f) => f.includes(".partial-")), [], "no staging left behind");
const json = (w: Ws, p: string) => JSON.parse(fs.readFileSync(w.p(p), "utf8"));
const has = (codes: string[], ...want: string[]) => { for (const c of want) assert.ok(codes.includes(c), `${c} expected in ${codes.join(",")}`); };
/** Appends one byte to a file once (the first time the hook fires). */
const touchOnce = (file: string) => { let done = false; return () => { if (!done) { done = true; fs.appendFileSync(file, "\n"); } }; };

// ── real processes ───────────────────────────────────────────────────────────────────────────────────────────────────
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const DRIVER = path.join(__dirname, "m7-benchmark", "annotation-cli-test-driver.ts");
function proc(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  const bundle = process.env.M7_TEST_DRIVER_BUNDLE;
  const bin = fs.existsSync(TSX) ? TSX : `${TSX}.cmd`;
  if (!bundle) assert.ok(fs.existsSync(bin), "tsx binary present (process tests must not be skipped silently)");
  const [cmd, pre] = bundle ? [process.execPath, [bundle]] : [bin, [DRIVER]];
  return new Promise((resolve) => {
    const c = spawn(cmd, [...pre, ...args], { shell: !bundle && process.platform === "win32", env: { ...process.env, FITNESS_DISABLE_REDIS: "true", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });
}

// ── F1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("HF-F1 guide / candidate replaced after sign-off: every old approval is invalid, also when the owner record accepts the new files", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    const { binding } = signFromRefusal(w, an);
    assert.equal(run(freezeArgs(w, an, { out: "f0.json" })).code, 0);
    const b = json(w, "f0.json").binding;
    assert.equal(b.annotationGuideSha256, sha(w.p("guide.md"))); assert.equal(b.candidateIdentitySha256, sha(w.p("candidate.json")));
    assert.equal(b.contractVersion, SCHEMA_VERSION); assert.equal(b.batchId, an.batchId); assert.equal(b.agreementReportSha256, sha(w.p("agreement.json")));
    assert.deepEqual([b.tagAuditSha256, b.tagAuditEntries], [null, 0], "tag-audit revision is part of the binding");
    const guide0 = fs.readFileSync(w.p("guide.md"));
    fs.writeFileSync(w.p("guide.md"), "TEST FIXTURE replacement guide\n");
    const r1 = run(freezeArgs(w, an, { out: "f1.json" }));
    assert.equal(r1.code, 1); has(r1.codes, "ANCHOR_MISMATCH"); noOutput(w, "f1.json");
    const r2 = run(freezeArgs(w, anchorsOf(w), { out: "f2.json" }));
    assert.equal(r2.code, 1); has(r2.codes, "REVIEW_BINDING_MISMATCH", "REVIEW_NOT_SIGNED", "AGREEMENT_REVIEW_BINDING_MISMATCH"); noOutput(w, "f2.json");
    fs.writeFileSync(w.p("guide.md"), guide0);
    const cand = json(w, "candidate.json"); cand.git.head = "1".repeat(40);
    fs.writeFileSync(w.p("candidate.json"), JSON.stringify(cand));
    const an3 = anchorsOf(w);
    const r3 = run(freezeArgs(w, an3, { out: "f3.json" }));
    assert.equal(r3.code, 1); has(r3.codes, "REVIEW_BINDING_MISMATCH", "AGREEMENT_REVIEW_BINDING_MISMATCH"); noOutput(w, "f3.json");
    const fresh = signFromRefusal(w, an3);
    assert.notEqual(fresh.binding, binding);
    assert.equal(run(freezeArgs(w, an3, { out: "f4.json" })).code, 0, "fresh approvals for the new content pass");
  } finally { cleanup(w); }
});

// ── F2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("HF-F2 writer attribution is bound at prepare: changed author / source record refused, never migrated; receipts without it refused", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w)); run(agreementArgs(w));
    const rc = json(w, "prep/prepare-manifest.json");
    assert.ok(rc.questions.every((q: Obj) => q.writerKey === "w01" && /^[0-9a-f]{64}$/.test(q.sourceSha256)), "each prepared question records its writer");
    setQuestions(w, (q) => ({ ...q, source: { ...q.source, author: "OWNER01" } }));
    const r = run(mergeArgs(w));
    assert.equal(r.code, 1); assert.deepEqual([...new Set(r.codes)], ["WRITER_ATTRIBUTION_CHANGED"]); noOutput(w, "m"); noStaging(w);
    setQuestions(w, (q) => ({ ...q, source: { ...q.source, author: "w01" } }));
    assert.deepEqual([...new Set(run(mergeArgs(w)).codes)], ["SOURCE_CHANGED"], "same writer key, other spelling: still a new source revision");
    setQuestions(w, (q) => (q.id === "Q-0002" ? { ...q, source: { ...q.source, note: "TEST FIXTURE — rewritten note" } } : q));
    assert.deepEqual(run(mergeArgs(w)).codes, ["SOURCE_CHANGED"]);
    setQuestions(w, (q) => q);
    assert.equal(run(mergeArgs(w)).code, 3);
    const an = anchorsOf(w); signFromRefusal(w, an);
    // Codex F2 scenario: the author is rewritten after merge, the writer then signs as a "non-writer" reviewer
    setQuestions(w, (q) => ({ ...q, source: { ...q.source, author: "OWNER01" } }));
    const so = json(w, "signoff.json"); so.agreementReview = { ...so.agreementReview, role: "reviewer", signedBy: "OWNER01" };
    fs.writeFileSync(w.p("signoff.json"), JSON.stringify(so));
    const fz = run(freezeArgs(w, an));
    assert.equal(fz.code, 1); has(fz.codes, "WRITER_ATTRIBUTION_CHANGED"); noOutput(w, "freeze.json");
    // the receipt itself cannot be edited, and an older receipt without writer attribution is not accepted
    const bad = { ...rc, questions: rc.questions.map((q: Obj, i: number) => (i === 0 ? { ...q, writerKey: "owner01" } : q)) };
    fs.cpSync(w.p("prep"), w.p("prep-x"), { recursive: true }); fs.writeFileSync(w.p("prep-x/prepare-manifest.json"), JSON.stringify(bad, null, 2));
    reseal(w.p("prep-x")); // a complete, consistently re-sealed forgery (G3 refuses incomplete / inconsistent markers earlier)
    has(run(mergeArgs(w, "mx", { prep: "prep-x" })).codes, "RECEIPT_INCONSISTENT");
    const old = { ...rc, questions: rc.questions.map(({ writerKey: _w, sourceSha256: _s, ...q }: Obj) => q) };
    fs.writeFileSync(w.p("prep-x/prepare-manifest.json"), JSON.stringify(old, null, 2)); reseal(w.p("prep-x"));
    const oldR = run(mergeArgs(w, "my", { prep: "prep-x" }));
    has(oldR.codes, "RECEIPT_INVALID"); assert.match(oldR.out.join("\n"), /earlier tool revision; re-run prepare/);
    // the curator is never a writer (the current file names OWNER01 as writer)
    const cw = run(["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p("prep-cw"), "--seed", "1", "--curator", "owner01"]);
    assert.deepEqual(cw.codes, ["CURATOR_IS_WRITER"]); noOutput(w, "prep-cw");
  } finally { cleanup(w); }
});

// ── F3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("HF-F3 a source changed at any stage before the success marker prevents publication; after it, the output names the bytes actually used", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w)); run(agreementArgs(w));
    const B0 = fs.readFileSync(w.p("B.jsonl"));
    // each check fires at ITS stage (the detail names the stage), so no later check silently stands in for an earlier one
    const stages: Array<[string, string, () => void]> = [
      ["after-load", "detected after validation", () => { const t = touchOnce(w.p("B.jsonl")); testHooks.afterLoad = (f) => { if (f.endsWith("B.jsonl")) t(); }; }],
      ["after-staging", "detected after staging", () => { testHooks.beforePublish = touchOnce(w.p("B.jsonl")); }],
      ["after-link", "detected after the members were linked", () => { testHooks.afterLink = touchOnce(w.p("B.jsonl")); }],
    ];
    const changed = (r: { out: string[] }, stage: string) => assert.ok(r.out.some((l) => l.includes("SOURCE_CHANGED_DURING_RUN") && l.includes(stage)), `${stage}: ${r.out.join("\n")}`);
    for (const [name, stage, arm] of stages) {
      try {
        arm();
        const r = run(mergeArgs(w, `m-${name}`));
        assert.equal(r.code, 1, name); changed(r, stage); noOutput(w, `m-${name}`); noStaging(w);
      } finally { delete testHooks.afterLoad; delete testHooks.beforePublish; delete testHooks.afterLink; fs.writeFileSync(w.p("B.jsonl"), B0); }
    }
    // single-file output: B changed between the temp write and the no-replace link, or right after the link (own file removed)
    for (const [hook, stage] of [["beforePublish", "detected after staging"], ["afterLink", "detected after publication"]] as const) {
      try {
        testHooks[hook] = touchOnce(w.p("B.jsonl"));
        const r = run(agreementArgs(w, `agreement-${hook}.json`));
        assert.equal(r.code, 1, hook); changed(r, stage); noOutput(w, `agreement-${hook}.json`); noStaging(w);
      } finally { delete testHooks[hook]; fs.writeFileSync(w.p("B.jsonl"), B0); }
    }
    // changed AFTER the success marker (no lock exists against other writers): the published provenance identifies the bytes
    // actually used, and every downstream step detects the difference
    try {
      testHooks.afterPublish = touchOnce(w.p("B.jsonl"));
      assert.equal(run(mergeArgs(w, "m-late")).code, 3);
    } finally { delete testHooks.afterPublish; }
    assert.equal(json(w, "m-late/merge-manifest.json").inputs.annotatorBSha256, json(w, "subs.json").annotatorB.sha256, "provenance = the accepted bytes that were used");
    assert.notEqual(sha(w.p("B.jsonl")), json(w, "m-late/merge-manifest.json").inputs.annotatorBSha256);
    fs.writeFileSync(w.p("signoff.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, reviews: [], agreementReview: null }));
    const fz = run(freezeArgs(w, anchorsOf(w, "m-late"), { m: "m-late" }));
    assert.equal(fz.code, 1); has(fz.codes, "SUBMISSION_CHANGED_SINCE_RECEIPT"); noOutput(w, "freeze.json");
  } finally { cleanup(w); }
});

// ── F4 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("HF-F4a an existing destination, non-empty or empty, is never replaced or removed", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    fs.mkdirSync(w.p("m-full")); fs.writeFileSync(w.p("m-full/keep.txt"), "OTHER\n");
    const a = run(mergeArgs(w, "m-full"));
    assert.equal(a.code, 1); assert.deepEqual(a.codes, ["OUTPUT_EXISTS"]); assert.deepEqual(fs.readdirSync(w.p("m-full")), ["keep.txt"]);
    fs.mkdirSync(w.p("m-empty"));
    const b = run(mergeArgs(w, "m-empty"));
    assert.equal(b.code, 1); assert.deepEqual(b.codes, ["OUTPUT_EXISTS"]); assert.deepEqual(fs.readdirSync(w.p("m-empty")), [], "the empty directory is left as it was");
    fs.mkdirSync(w.p("prep-empty"));
    assert.deepEqual(run(prepareArgs(w, "prep-empty")).codes, ["OUTPUT_EXISTS"]); assert.deepEqual(fs.readdirSync(w.p("prep-empty")), []);
    noStaging(w);
  } finally { cleanup(w); }
});

test("HF-F4b destination created concurrently (empty) or written into during publication: refused, the competitor is untouched, no success marker", () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    try {
      testHooks.beforePublish = (target) => fs.mkdirSync(target); // the window between the existence check and the claim
      const r = run(mergeArgs(w, "m-race"));
      assert.equal(r.code, 1); assert.deepEqual(r.codes, ["OUTPUT_EXISTS"]); assert.deepEqual(fs.readdirSync(w.p("m-race")), []); noStaging(w);
    } finally { delete testHooks.beforePublish; }
    try {
      testHooks.afterLink = (target, name) => { if (name === "dataset.jsonl") fs.writeFileSync(path.join(target, "adjudication.jsonl"), "COMPETITOR\n"); };
      const r = run(mergeArgs(w, "m-into"));
      assert.equal(r.code, 1); has(r.codes, "OUTPUT_EXISTS", "PUBLICATION_ABANDONED");
      assert.deepEqual(fs.readdirSync(w.p("m-into")), ["adjudication.jsonl"], "only the competitor's file remains; ours was rolled back, no marker");
      assert.equal(fs.readFileSync(w.p("m-into/adjudication.jsonl"), "utf8"), "COMPETITOR\n"); noStaging(w);
    } finally { delete testHooks.afterLink; }
  } finally { cleanup(w); }
});

test("HF-F4c interrupted publication: a handled failure rolls back; a KILLED process leaves no success marker, its output is never consumed or replaced", async () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w)); run(agreementArgs(w));
    try {
      testHooks.failAfterLinks = 1;
      const r = run(mergeArgs(w, "m-int"));
      assert.equal(r.code, 1); assert.deepEqual(r.codes, ["WRITE_FAILED"]); noOutput(w, "m-int"); noStaging(w);
    } finally { delete testHooks.failAfterLinks; }
    // killed after the LAST member was linked, before the marker: every member is present and correct, still never consumed
    const killed = await proc(mergeArgs(w, "m-kill"), { M7_TEST_KILL_AFTER_LINK: "merge-manifest.json" });
    assert.notEqual(killed.code, 0); assert.notEqual(killed.code, 3);
    assert.deepEqual(fs.readdirSync(w.p("m-kill")).sort(), ["adjudication.jsonl", "dataset.jsonl", "merge-manifest.json"], "killed mid-publication: members, no marker");
    assert.ok(fs.readdirSync(w.dir).some((f) => f.startsWith(".m-kill.partial-")), "a killed run leaves its private staging directory (documented)");
    const before = fs.readdirSync(w.p("m-kill")).map((f) => [f, sha(w.p(`m-kill/${f}`))]);
    const d = run(acceptanceDraftArgs(w, "draft-kill.json", { m: "m-kill" }));
    assert.equal(d.code, 1); assert.deepEqual([...new Set(d.codes)], ["PUBLICATION_INCOMPLETE"]); noOutput(w, "draft-kill.json");
    fs.writeFileSync(w.p("signoff.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, reviews: [], agreementReview: null }));
    const fz = run(freezeArgs(w, anchorsOf(w, "m-kill"), { m: "m-kill" }));
    assert.equal(fz.code, 1); has(fz.codes, "PUBLICATION_INCOMPLETE"); noOutput(w, "freeze.json");
    assert.deepEqual(run(mergeArgs(w, "m-kill")).codes, ["OUTPUT_EXISTS"], "never replaced or removed");
    assert.deepEqual(fs.readdirSync(w.p("m-kill")).map((f) => [f, sha(w.p(`m-kill/${f}`))]), before);
    // a killed prepare is equally unusable downstream
    const kp = await proc(prepareArgs(w, "prep-kill"), { M7_TEST_KILL_AFTER_LINK: "for-annotator-B.jsonl" });
    assert.notEqual(kp.code, 0);
    assert.ok(!fs.existsSync(w.p(`prep-kill/${PUBLICATION_MARKER}`)));
    has(run(acceptArgs(w, "subs-kill.json", "prep-kill")).codes, "FILE_MISSING");
  } finally { cleanup(w); }
});

test("HF-F4d cross-process contention: two real processes publish the same destination; exactly one wins, the other refuses, the result is complete", async () => {
  const w = workspace();
  try {
    run(prepareArgs(w)); run(acceptArgs(w));
    const [x, y] = await Promise.all([proc(mergeArgs(w, "m-both")), proc(mergeArgs(w, "m-both"))]);
    const codes = [x.code, y.code].sort();
    assert.deepEqual(codes, [1, 3], `${x.out}\n----\n${y.out}`);
    assert.match((x.code === 1 ? x : y).out, /OUTPUT_EXISTS/);
    const marker = json(w, `m-both/${PUBLICATION_MARKER}`);
    assert.deepEqual(marker.files.map((f: Obj) => f.name), ["dataset.jsonl", "adjudication.jsonl", "merge-manifest.json"]);
    for (const f of marker.files) assert.equal(sha(w.p(`m-both/${f.name}`)), f.sha256, f.name);
    assert.deepEqual(fs.readdirSync(w.p("m-both")).sort(), [PUBLICATION_MARKER, "adjudication.jsonl", "dataset.jsonl", "merge-manifest.json"].sort());
    noStaging(w);
  } finally { cleanup(w); }
});

// ── F5 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("HF-F5 a supplied agreementReview is ALWAYS validated (role, identity, binding, policy identity, evidence); a required one fails closed when absent", () => {
  const w = workspace();
  try {
    // κ = 1: no review required
    fs.writeFileSync(w.p("B.jsonl"), jsonl(roleRows("B").map((x) => (x.id === "Q-0003" ? { ...x, ...lab("training") } : x))));
    fs.writeFileSync(w.p("adjudicator.jsonl"), jsonl(adjRows().map((x) => { const { decision: _d, decisionRationale: _r, ...rest } = x as Obj; return rest; })));
    const an = pipeline(w);
    assert.equal(json(w, "agreement.json").policy.status, "NO_CALIBRATION_TRIGGER");
    const { binding } = signFromRefusal(w, an);
    const so = json(w, "signoff.json");
    assert.equal(so.agreementReview, null);
    assert.equal(run(freezeArgs(w, an, { out: "f0.json" })).code, 0, "no review required, none supplied");
    let n = 0;
    const tryReview = (ar: unknown) => { const f = `so-${++n}.json`; fs.writeFileSync(w.p(f), JSON.stringify({ ...so, agreementReview: ar })); return run(freezeArgs(w, an, { signoff: f, out: `fz-${n}.json` })); };
    const refused = (ar: unknown, ...codes: string[]) => { const r = tryReview(ar); assert.equal(r.code, 1, JSON.stringify(ar)); has(r.codes, ...codes); noOutput(w, `fz-${n}.json`); };
    // the Codex F5 reproduction: an annotator, a foreign binding, a decision for another policy state
    refused({ role: "adjudicator", signedBy: "A01", decision: "CALIBRATION_COMPLETED", bindingSha256: "0".repeat(64), note: "stale foreign approval" },
      "AGREEMENT_REVIEWER_IS_ANNOTATOR", "AGREEMENT_REVIEW_ROLE", "AGREEMENT_REVIEW_BINDING_MISMATCH", "AGREEMENT_REVIEW_DECISION");
    const base = { role: "adjudicator", signedBy: "ADJ01", decision: "REVIEWED", bindingSha256: binding, policyStatus: "NO_CALIBRATION_TRIGGER", agreementPolicySha256: AGREEMENT_POLICY_SHA256, note: "TEST FIXTURE voluntary review" };
    refused({ ...base, decision: "CALIBRATION_COMPLETED" }, "AGREEMENT_REVIEW_DECISION");
    refused({ ...base, policyStatus: "CALIBRATION_REQUIRED" }, "AGREEMENT_REVIEW_POLICY_MISMATCH");
    refused({ ...base, agreementPolicySha256: "f".repeat(64) }, "AGREEMENT_REVIEW_POLICY_MISMATCH");
    refused({ ...base, role: "reviewer", signedBy: "W01" }, "AGREEMENT_REVIEW_ROLE");
    refused({ ...base, signedBy: "B02", role: "reviewer" }, "AGREEMENT_REVIEWER_IS_ANNOTATOR");
    refused({ ...base, calibration: { caseIds: ["q-0001"], ref: "x" } }, "CALIBRATION_CASE_IN_DATASET");
    refused({ ...base, calibration: { caseIds: [], ref: "x" } }, "CALIBRATION_NOT_DOCUMENTED");
    refused({ ...base, approvedEverything: true }, "AGREEMENT_REVIEW_INVALID");
    refused({ ...base, note: "" }, "AGREEMENT_REVIEW_INVALID");
    refused("yes", "AGREEMENT_REVIEW_INVALID");
    // replay: a review given for earlier content
    const ok = tryReview(base);
    assert.equal(ok.code, 0, ok.out.join("\n"));
    assert.deepEqual(json(w, `fz-${n}.json`).agreementReview, { role: "adjudicator", signedBy: "ADJ01", decision: "REVIEWED", policyStatus: "NO_CALIBRATION_TRIGGER" });
    const adj = readJsonl(w.p("adjudicator.jsonl")); adj[0].finalRationale = "TEST FIXTURE: xác nhận cuối đã đổi";
    fs.writeFileSync(w.p("adjudicator.jsonl"), jsonl(adj));
    assert.equal(run(mergeArgs(w, "m2")).code, 3);
    const an2 = anchorsOf(w, "m2");
    const fresh = signFromRefusal(w, an2, { m: "m2" });
    fs.writeFileSync(w.p("so-replay.json"), JSON.stringify({ ...json(w, "signoff.json"), agreementReview: base }));
    const rp = run(freezeArgs(w, an2, { m: "m2", signoff: "so-replay.json", out: "fz-replay.json" }));
    assert.equal(rp.code, 1); has(rp.codes, "AGREEMENT_REVIEW_BINDING_MISMATCH"); noOutput(w, "fz-replay.json");
    assert.notEqual(fresh.binding, binding);
  } finally { cleanup(w); }
  // required + absent → fails closed
  const v = workspace();
  try {
    const an = pipeline(v);
    signFromRefusal(v, an, { agreementReview: null });
    const r = run(freezeArgs(v, an));
    assert.equal(r.code, 1); has(r.codes, "AGREEMENT_REVIEW_NOT_SIGNED"); noOutput(v, "freeze.json");
    assert.match(r.out.join("\n"), new RegExp(`agreementPolicySha256 ${AGREEMENT_POLICY_SHA256}`));
  } finally { cleanup(v); }
});

// ── owner-controlled acceptance record ───────────────────────────────────────────────────────────────────────────────
test("HF-AM1 acceptance draft: deterministic, six full SHA-256 identities, never declares acceptance; verify says NOT RECORDED until the owner fills it", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    const d = run(acceptanceDraftArgs(w));
    assert.equal(d.code, 3, d.out.join("\n")); has(d.reviewCodes, "OWNER_ACCEPTANCE_REQUIRED");
    const draft = json(w, "acceptance-draft.json");
    assert.deepEqual(draft.identities, acceptanceRecord(an).identities);
    for (const [k, v] of Object.entries(draft.identities)) if (k !== "contractVersion") assert.match(v as string, /^[0-9a-f]{64}$/, k);
    assert.deepEqual(draft.approval, { revision: null, provenance: null, recordedBy: null }, "the CLI never fills the approval");
    assert.ok(!/\d{4}-\d{2}-\d{2}T|timestamp|signature/i.test(fs.readFileSync(w.p("acceptance-draft.json"), "utf8")), "no timestamp / signature invented");
    assert.match(draft.notice, /not tamper-proof|NOT tamper-proof/);
    assert.equal(run(acceptanceDraftArgs(w, "acceptance-draft-2.json")).code, 3);
    assert.equal(sha(w.p("acceptance-draft.json")), sha(w.p("acceptance-draft-2.json")), "deterministic");
    assert.deepEqual(run(acceptanceDraftArgs(w)).codes, ["OUTPUT_EXISTS"]);
    const v0 = run(acceptanceVerifyArgs(w, "acceptance-draft.json"));
    assert.equal(v0.code, 3); has(v0.reviewCodes, "OWNER_ACCEPTANCE_NOT_RECORDED");
    signFromRefusal(w, an);
    const fz = run(freezeArgs(w, an, { acceptance: "acceptance-draft.json" }));
    assert.equal(fz.code, 1); has(fz.codes, "ACCEPTANCE_NOT_RECORDED"); noOutput(w, "freeze.json");
    fs.writeFileSync(w.p("owner.json"), JSON.stringify({ ...draft, approval: FIXTURE_APPROVAL }));
    const v1 = run(acceptanceVerifyArgs(w, "owner.json"));
    assert.equal(v1.code, 0, v1.out.join("\n")); assert.match(v1.out.join("\n"), /authenticity .*NOT verified/);
    assert.equal(run(freezeArgs(w, an, { acceptance: "owner.json" })).code, 0);
  } finally { cleanup(w); }
});

test("HF-AM2 malformed or mismatched owner records are refused (truncated / uppercase SHA, extra keys, contract version, partial approval, annotator recorder)", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    const good = acceptanceRecord(an);
    let n = 0;
    const verify = (rec: unknown) => { const f = `rec-${++n}.json`; fs.writeFileSync(w.p(f), JSON.stringify(rec)); return run(acceptanceVerifyArgs(w, f)); };
    const refused = (rec: unknown, ...codes: string[]) => { const r = verify(rec); assert.equal(r.code, 1, JSON.stringify(rec)); has(r.codes, ...codes); };
    const ids = (o: Obj) => ({ ...good, identities: { ...good.identities, ...o } });
    refused(ids({ batchId: an.batchId.slice(0, 12) }), "ANCHOR_INVALID");
    refused(ids({ mergeManifestSha256: an.mm.toUpperCase() }), "ANCHOR_INVALID");
    refused(ids({ annotationGuideSha256: "0".repeat(64) }), "ANCHOR_MISMATCH");
    refused(ids({ candidateIdentitySha256: "0".repeat(64) }), "ANCHOR_MISMATCH");
    refused(ids({ submissionsReceiptSha256: "0".repeat(64) }), "ANCHOR_MISMATCH");
    refused(ids({ contractVersion: "m7-p5a1" }), "CONTRACT_VERSION_MISMATCH");
    refused({ ...good, identities: { ...good.identities, extra: "x" } }, "ACCEPTANCE_RECORD_INVALID");
    refused({ ...good, approvedByCli: true }, "ACCEPTANCE_RECORD_INVALID");
    refused({ ...good, kind: "something-else" }, "ACCEPTANCE_RECORD_INVALID");
    refused({ ...good, approval: { revision: 1, provenance: null, recordedBy: "OWNER01" } }, "ACCEPTANCE_RECORD_INVALID");
    refused({ ...good, approval: { ...FIXTURE_APPROVAL, revision: 0 } }, "ACCEPTANCE_RECORD_INVALID");
    refused({ ...good, approval: { ...FIXTURE_APPROVAL, recordedBy: "a01" } }, "ACCEPTANCE_BY_ANNOTATOR");
    assert.equal(verify(good).code, 0);
  } finally { cleanup(w); }
});

test("HF-AM3 forged manifests: a rewritten merge manifest with a matching owner record is still refused (recomputation); a complete consistent re-run with attacker records passes ONLY --fixture (stated limit)", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    signFromRefusal(w, an);
    const mm = json(w, "m/merge-manifest.json"); mm.counts.cases = 99;
    fs.writeFileSync(w.p("m/merge-manifest.json"), JSON.stringify(mm, null, 2) + "\n");
    reseal(w.p("m")); // the forger re-seals the marker (G3: the marker is consistency metadata, not authentication)
    const forgedAn: Anchors = { ...an, mm: sha(w.p("m/merge-manifest.json")) };
    const r = run(freezeArgs(w, forgedAn));
    assert.equal(r.code, 1); has(r.codes, "MERGE_MANIFEST_NOT_REPRODUCIBLE"); noOutput(w, "freeze.json");
    has(run(acceptanceDraftArgs(w, "draft-forged.json")).codes, "MERGE_MANIFEST_NOT_REPRODUCIBLE");
    noOutput(w, "draft-forged.json");
  } finally { cleanup(w); }
  const v = workspace();
  try {
    pipeline(v);
    fs.writeFileSync(v.p("A.jsonl"), fs.readFileSync(v.p("A.jsonl"), "utf8").replace("lý do của A cho Q-0001", "lý do giả mạo"));
    assert.equal(run(acceptArgs(v, "subs2.json")).code, 0);
    assert.equal(run(mergeArgs(v, "m2", { subs: "subs2.json" })).code, 3);
    fs.rmSync(v.p("agreement.json")); assert.equal(run(agreementArgs(v)).code, 3);
    const forged = anchorsOf(v, "m2", "prep", "subs2.json");
    signFromRefusal(v, forged, { m: "m2", src: { subs: "subs2.json" } });
    assert.equal(run(freezeArgs(v, forged, { m: "m2", src: { subs: "subs2.json" } })).code, 0, "a consistent forgery is NOT detectable when the attacker controls the owner record");
    const off = run(freezeArgs(v, forged, { m: "m2", src: { subs: "subs2.json" }, fixture: false, out: "official.json" }));
    assert.deepEqual(off.codes, ["OFFICIAL_FREEZE_NOT_AUTHORIZED"]); noOutput(v, "official.json");
  } finally { cleanup(v); }
});

test("HF-OK authorized fixture flow: freeze records the owner record, the six identities and the full binding; official freeze stays refused", () => {
  const w = workspace();
  try {
    const an = pipeline(w);
    signFromRefusal(w, an);
    const r = run(freezeArgs(w, an));
    assert.equal(r.code, 0, r.out.join("\n"));
    const fz = json(w, "freeze.json");
    assert.deepEqual(fz.acceptedIdentities, acceptanceRecord(an).identities);
    assert.deepEqual(fz.acceptanceRecord, { sha256: sha(w.p("acceptance.freeze.json")), revision: 1, provenance: FIXTURE_APPROVAL.provenance, recordedBy: "OWNER01" });
    assert.match(fz.trust, /not authenticity/i);
    for (const k of ["contractVersion", "batchId", "prepareManifestSha256", "submissionsReceiptSha256", "annotatorASha256", "annotatorBSha256", "adjudicatorDecisionsSha256",
      "tagAuditSha256", "tagAuditEntries", "mergeManifestSha256", "datasetSha256", "adjudicationSha256", "agreementReportSha256", "agreementPolicyStatus", "annotationGuideSha256", "candidateIdentitySha256"]) assert.ok(k in fz.binding, k);
    for (const p of ["prep", "m"]) assert.ok(fs.existsSync(w.p(`${p}/${PUBLICATION_MARKER}`)), p);
    const off = run(freezeArgs(w, an, { fixture: false, out: "official.json" }));
    assert.deepEqual(off.codes, ["OFFICIAL_FREEZE_NOT_AUTHORIZED"]); noOutput(w, "official.json");
  } finally { cleanup(w); }
});
