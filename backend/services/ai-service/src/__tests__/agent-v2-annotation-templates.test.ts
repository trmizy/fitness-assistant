/**
 * M7-P5A2 Phase 3 (owner decision Q10) — the hand-off JSONL templates (m7-p5a2) match the CLI / contract exactly:
 *   1. every key is a contract / CLI key (nothing extra, nothing derived), every value is a <PLACEHOLDER> (or the schema version);
 *   2. an unfilled template is REFUSED by the CLI (so it can never pass by accident) without key errors;
 *   3. filled in memory with synthetic TEST FIXTURE values, the templates run through prepare → check-role → agreement →
 *      merge (+ tag audit) → validate → freeze --fixture.
 * The templates are copied byte-for-byte into docs/ai-v2/m7/annotation-handoff/05-jsonl-templates/ (local docs).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main, ADJUDICATOR_FILE_KEYS, ANNOTATOR_FILE_KEYS, QUESTION_FILE_KEYS, REQUIRED_CANDIDATE_FILES } from "./m7-benchmark/annotation-cli";
import { DERIVED_FIELDS, DOMAIN_KEYS, INTERPRETATION_KEYS, LABEL_KEYS, SCHEMA_VERSION, SOURCE_KEYS } from "./m7-benchmark/annotation-schema";
import { TAG_AUDIT_KEYS } from "./m7-benchmark/annotation-tag-audit";
import { acceptArgs, agreementArgs, anchorsOf, freezeArgs, mergeArgs, prepareArgs, signFromRefusal } from "./m7-benchmark/annotation-test-scenario";

const T = path.join(__dirname, "m7-benchmark", "annotation-templates");
type Obj = Record<string, any>;
const lines = (f: string): Obj[] => fs.readFileSync(path.join(T, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const quiet = { out: () => undefined, err: () => undefined };
const codes = (argv: string[]) => { const out: string[] = []; const code = main(argv, { out: (s) => out.push(s), err: () => undefined }); return { code, codes: out.filter((l) => l.startsWith("ERROR\t")).map((l) => l.split("\t")[4]) }; };

/** Every string leaf is a <PLACEHOLDER> or the schema version; reports the key paths. */
function leaves(v: unknown, p: string, out: Array<[string, unknown]>) {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${p}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, `${p}.${k}`, out);
  else out.push([p, v]);
}

test("TPL-1 template keys are exactly the contract / CLI keys; values are placeholders; no derived fields", () => {
  const files = fs.readdirSync(T).sort();
  assert.deepEqual(files, ["adjudicator-decisions.template.jsonl", "annotator-A.template.jsonl", "annotator-B.template.jsonl", "question.template.jsonl", "signoff.template.json", "tag-audit.template.jsonl"]);
  const [q] = lines("question.template.jsonl");
  assert.deepEqual(Object.keys(q), [...QUESTION_FILE_KEYS]); assert.deepEqual(Object.keys(q.source), [...SOURCE_KEYS]);
  for (const f of ["annotator-A.template.jsonl", "annotator-B.template.jsonl"]) {
    const [a] = lines(f);
    assert.deepEqual(Object.keys(a), [...ANNOTATOR_FILE_KEYS], f);
    assert.deepEqual(Object.keys(a.domains[0]), [...DOMAIN_KEYS]); assert.deepEqual(Object.keys(a.interpretations[0]), [...INTERPRETATION_KEYS]);
  }
  const [agreed, disagreed] = lines("adjudicator-decisions.template.jsonl");
  assert.deepEqual(Object.keys(agreed), ["schemaVersion", "id", "adjudicatorId", "finalRationale"], "agreed case: final rationale only");
  assert.deepEqual(Object.keys(disagreed), [...ADJUDICATOR_FILE_KEYS]);
  assert.deepEqual(Object.keys(disagreed.decision), [...LABEL_KEYS]);
  const [audit] = lines("tag-audit.template.jsonl");
  assert.deepEqual(Object.keys(audit), [...TAG_AUDIT_KEYS]);
  const signoff = JSON.parse(fs.readFileSync(path.join(T, "signoff.template.json"), "utf8"));
  assert.deepEqual(Object.keys(signoff), ["schemaVersion", "reviews", "agreementReview"]);
  assert.deepEqual(Object.keys(signoff.reviews[0]), ["id", "code", "findingSha256", "bindingSha256", "decision", "signedBy", "note"], "C4: approvals are content-bound");
  assert.deepEqual(Object.keys(signoff.agreementReview), ["role", "signedBy", "decision", "bindingSha256", "policyStatus", "agreementPolicySha256", "note", "calibration"], "F5: policy-bound");
  assert.deepEqual(Object.keys(signoff.agreementReview.calibration), ["caseIds", "ref"]);
  for (const f of files) {
    const text = fs.readFileSync(path.join(T, f), "utf8");
    assert.ok(!text.startsWith("﻿") && !text.includes("\r"), `${f}: UTF-8 without BOM, LF`);
    const all: Array<[string, unknown]> = [];
    for (const o of f.endsWith(".json") ? [JSON.parse(text)] : text.split("\n").filter(Boolean).map((l) => JSON.parse(l))) leaves(o, "$", all);
    for (const [p, v] of all) assert.ok(v === SCHEMA_VERSION || (typeof v === "string" && /^<[^<>]+>$/.test(v)), `${f} ${p} = ${JSON.stringify(v)} must be a placeholder`);
    for (const d of DERIVED_FIELDS) assert.ok(!text.includes(`"${d}"`), `${f} has derived field ${d}`);
    assert.ok(!/"tags"/.test(text) || f === "question.template.jsonl", `${f}: only the curator's question file carries tags (Q3)`);
  }
});

// ── filling (TEST FIXTURE values, in memory only) ───────────────────────────────────────────────────────────────────
const FILL: Record<string, unknown> = {
  "<AGENT>": "training", "<AGENT_OR_null>": "training", "<request_or_support>": "request", "<CATEGORY>": "SINGLE", "<SAFETY>": "NONE", "<PRE_ROUTING>": "ALLOW",
  "<ANNOTATOR_A_PSEUDONYM>": "A01", "<ANNOTATOR_B_PSEUDONYM>": "B02", "<ADJUDICATOR_PSEUDONYM>": "ADJ01", "<WRITER_PSEUDONYM>": "W01", "<CURATOR_PSEUDONYM>": "CUR01",
  "<SIGNER_PSEUDONYM_NOT_ANNOTATOR_A_OR_B>": "OWNER01", "<SIGNER_PSEUDONYM>": "OWNER01", "<synthetic_or_permitted>": "synthetic",
};
const DROP = new Set(["<AGENT_SERVED_ONLY_FOR_SUPPORT_OMIT_KEY_FOR_REQUEST>", "<ADJUDICATOR_PSEUDONYM_REQUIRED_FOR_GOVERNED_TAGS_ELSE_OMIT_KEY>"]);
function fill(v: unknown, extra: Record<string, unknown>): unknown {
  if (Array.isArray(v)) return v.map((x) => fill(x, extra));
  if (v && typeof v === "object") {
    const o: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "interpretations") continue; // SINGLE: no interpretations (the template shows the AMBIGUOUS shape)
      if (typeof x === "string" && DROP.has(x)) continue;
      o[k] = fill(x, extra);
    }
    return o;
  }
  if (typeof v === "string" && v in extra) return extra[v];
  if (typeof v === "string" && v in FILL) return FILL[v];
  if (typeof v === "string" && /^<[^<>]+>$/.test(v)) return `TEST FIXTURE ${v.slice(1, -1).toLowerCase().replace(/_/g, " ")}`;
  return v;
}
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("TPL-2 unfilled templates are refused by the CLI (placeholders never pass) and produce no key errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m7p5a2-tpl-"));
  try {
    const q = codes(["prepare", "--questions", path.join(T, "question.template.jsonl"), "--out-dir", path.join(dir, "p"), "--seed", "1", "--curator", "CUR01"]);
    assert.equal(q.code, 1); assert.ok(!q.codes.includes("UNEXPECTED_KEY") && !q.codes.includes("DERIVED_FIELD_NOT_ALLOWED"), q.codes.join());
    const a = codes(["check-role", "--role", "A", "--prepared", path.join(T, "question.template.jsonl"), "--labels", path.join(T, "annotator-A.template.jsonl")]);
    assert.equal(a.code, 1); assert.ok(!a.codes.includes("UNEXPECTED_KEY") && !a.codes.includes("DERIVED_FIELD_NOT_ALLOWED"), a.codes.join());
    assert.equal(fs.existsSync(path.join(dir, "p")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("TPL-3 the templates, filled with synthetic values, run end-to-end through the provenance chain (fixture freeze only)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m7p5a2-tpl-"));
  const w = { dir, p: (n: string) => path.join(dir, n) };
  const p = w.p;
  try {
    const [qT] = lines("question.template.jsonl");
    const QS = [["T-0001", "Tuần này mình nên tập lưng hai buổi hay ba buổi thì hợp lý?"], ["T-0002", "Ăn khoai lang trước giờ chạy bộ buổi tối có ổn không bạn?"]];
    const questions = (tagsOf: (id: string) => string[]) => jsonl(QS.map(([id, q]) => ({ ...(fill(qT, { "<CASE_ID>": id, "<QUESTION_TEXT_UTF8_NFC_TRIMMED>": q, "<true_or_false>": true }) as Obj), tags: tagsOf(id) })));
    fs.writeFileSync(p("questions.jsonl"), questions(() => [])); // writers start with tags: []
    const role = (f: string, ids: Array<[string, string]>) => jsonl(ids.map(([id, agent]) => fill(lines(f)[0], { "<CASE_ID>": id, "<AGENT>": agent, "<AGENT_OR_null>": agent })));
    fs.writeFileSync(p("A.jsonl"), role("annotator-A.template.jsonl", [["T-0001", "training"], ["T-0002", "nutrition"]]));
    fs.writeFileSync(p("B.jsonl"), role("annotator-B.template.jsonl", [["T-0001", "training"], ["T-0002", "training"]]));
    const [agreedT, disagreedT] = lines("adjudicator-decisions.template.jsonl");
    fs.writeFileSync(p("adjudicator.jsonl"), jsonl([fill(agreedT, { "<CASE_ID_WHERE_A_EQUALS_B>": "T-0001" }), fill(disagreedT, { "<CASE_ID_WHERE_A_DIFFERS_FROM_B>": "T-0002", "<AGENT>": "nutrition", "<AGENT_OR_null>": "nutrition" })]));
    fs.writeFileSync(p("audit.jsonl"), jsonl([fill(lines("tag-audit.template.jsonl")[0], { "<1_2_3_IN_FILE_ORDER>": 1, "<CASE_ID>": "T-0001" })].map((r) => ({ ...(r as Obj), from: [], to: ["multi_clause"] }))));
    fs.writeFileSync(p("guide.md"), "TEST FIXTURE guide\n");
    fs.writeFileSync(p("candidate.json"), JSON.stringify({ clean: true, files: REQUIRED_CANDIDATE_FILES.map((x) => ({ path: x, sha256: "c".repeat(64) })) }));
    assert.equal(main(prepareArgs(w, "prep", "3"), quiet), 0);
    for (const [r, f] of [["A", "A.jsonl"], ["B", "B.jsonl"]]) assert.equal(main(["check-role", "--role", r, "--prepared", p("prep/for-annotator-A.jsonl"), "--labels", p(f)], quiet), 0, r);
    assert.equal(main(acceptArgs(w), quiet), 0);
    assert.equal(main(agreementArgs(w), quiet), 3, "1 of 2 agree: calibration trigger");
    fs.writeFileSync(p("questions.jsonl"), questions((id) => (id === "T-0001" ? ["multi_clause"] : []))); // the curator's audited tag
    const merged = codes(mergeArgs(w, "m", { audit: "audit.jsonl" }));
    assert.ok(merged.code === 0 || merged.code === 3, merged.codes.join());
    const an = anchorsOf(w);
    const { reviews } = signFromRefusal(w, an, { src: { audit: "audit.jsonl" } });
    // the template's sign-off shape is exactly what the tool asks for
    const tplSignoff = fill(JSON.parse(fs.readFileSync(path.join(T, "signoff.template.json"), "utf8")), {}) as Obj;
    const written = JSON.parse(fs.readFileSync(p("signoff.json"), "utf8"));
    if (reviews.length) assert.deepEqual(Object.keys(written.reviews[0]), Object.keys(tplSignoff.reviews[0]));
    assert.deepEqual(Object.keys(written.agreementReview).sort(), Object.keys(tplSignoff.agreementReview).sort());
    const fz = codes(freezeArgs(w, an, { src: { audit: "audit.jsonl" } }));
    assert.equal(fz.code, 0, fz.codes.join());
    assert.match(JSON.parse(fs.readFileSync(p("freeze.json"), "utf8")).status, /^FIXTURE ONLY/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
