import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { evaluateSafetyEnvelope, answerKindAllowed, type AnswerKind } from "../llm/safety-envelope";
import { resolveSafetySignals, type SafetySignalResolution } from "../llm/safety-signals";
import type { SafetyNarrativeResolution } from "../llm/safety-narrative";
import { forbiddenColumns, parseCsv, cohenKappa, rawAgreement, assignFamilySplit, familyOverlap, findExactDuplicates, findNearDuplicates, findLeakage, adjudicate } from "../llm/query-routing-data/routing-data-tools";

const REPO = path.resolve(__dirname, "../../../../..");
const INDEP = path.join(REPO, "data/eval/query-routing-independent");

const narrative = (o: Partial<SafetyNarrativeResolution> = {}): SafetyNarrativeResolution => ({
  level: "NONE", personal: false, general: false, signals: [], eventSignals: [], symptomSignals: [], temporalSignals: [], functionalSignals: [],
  expectedTrainingResponse: false, reasons: [], finalSafetyAction: "NORMAL_RAG", ...o,
});
const sig = (cls: SafetySignalResolution["signals"][number]["cls"], level: "CAUTION" | "HIGH_RISK", matched = "") => ({ cls, level, matched });
const res = (level: SafetySignalResolution["level"], o: { personal?: boolean; signals?: SafetySignalResolution["signals"]; n?: Partial<SafetyNarrativeResolution> } = {}): SafetySignalResolution => ({
  level, signals: o.signals ?? [], namedCondition: false, personal: !!o.personal, reasons: [], narrative: narrative({ personal: !!o.personal, ...o.n }),
});

// ── frozen policy (structured inputs: product-policy tests, not medical truth) ──
test("4.7R6A policy 2.1: expected training response -> NORMAL; unclear localised pain -> GENERAL_INFO_ONLY; red-flag pain -> SAFE_ABSTAIN", () => {
  assert.equal(evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true, n: { expectedTrainingResponse: true } }) }).action, "ALLOW_NORMAL_FITNESS");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true, signals: [sig("LOW_RISK_EXERCISE_DISCOMFORT", "CAUTION")], n: { expectedTrainingResponse: true } }) }).action, "ALLOW_NORMAL_FITNESS");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true, signals: [sig("LOCALISED_PAIN", "CAUTION", "localised pain")] }) }).action, "GENERAL_INFORMATION_ONLY");
  // "expected response" claimed, but a LOCALISED_PAIN class is present => not clearly expected
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true, signals: [sig("LOCALISED_PAIN", "CAUTION")], n: { expectedTrainingResponse: true } }) }).action, "GENERAL_INFORMATION_ONLY");
  for (const cls of ["ACUTE_TRAUMA_EVENT", "RADIATING_PAIN", "NEUROLOGICAL_SYMPTOM"] as const)
    assert.equal(evaluateSafetyEnvelope({ resolution: res("HIGH_RISK", { personal: true, signals: [sig(cls, "HIGH_RISK")] }) }).action, "SAFE_ABSTAIN", cls);
});

test("4.7R6A policy 2.2: one-off transient dizziness -> GENERAL_INFO_ONLY; near-fainting -> SAFE_ABSTAIN", () => {
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true, signals: [sig("LOCALISED_PAIN", "CAUTION", "uncertain personal symptom: chóng mặt")] }) }).action, "GENERAL_INFORMATION_ONLY");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("HIGH_RISK", { personal: true, signals: [sig("SEVERE_DIZZINESS_OR_FAINTING", "HIGH_RISK")] }) }).action, "SAFE_ABSTAIN");
});

test("4.7R6A policy 2.3: recent procedure -> SAFE_ABSTAIN; remote history-only is not abstained by itself (no numeric threshold)", () => {
  const proc = res("HIGH_RISK", { personal: true, signals: [sig("POST_SURGICAL_STATE", "HIGH_RISK")] });
  assert.equal(evaluateSafetyEnvelope({ resolution: proc }).action, "SAFE_ABSTAIN");
  const hist = evaluateSafetyEnvelope({ resolution: proc, procedureHistoryOnly: true });
  assert.equal(hist.action, "ALLOW_NORMAL_FITNESS");
  assert.ok(hist.reasons.includes("PROCEDURE_HISTORY_ONLY"));
  // history flag must never relax a procedure that comes with another signal
  const mixed = res("HIGH_RISK", { personal: true, signals: [sig("POST_SURGICAL_STATE", "HIGH_RISK"), sig("NEUROLOGICAL_SYMPTOM", "HIGH_RISK")] });
  assert.equal(evaluateSafetyEnvelope({ resolution: mixed, procedureHistoryOnly: true }).action, "SAFE_ABSTAIN");
});

test("4.7R6A policy 2.4: a first-person pronoun alone does not trigger; general health knowledge -> GENERAL_INFO_ONLY", () => {
  assert.equal(evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true }) }).action, "ALLOW_NORMAL_FITNESS");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { n: { general: true }, signals: [sig("CHEST_OR_CARDIO_RED_FLAG", "CAUTION")] }) }).action, "GENERAL_INFORMATION_ONLY");
});

test("4.7R6A policy 2.5: controlled chronic condition never auto-NORMAL; educational -> GENERAL_INFO_ONLY; personal/current -> SAFE_ABSTAIN", () => {
  const named = [sig("NAMED_CONDITION", "CAUTION", "hypertension")];
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { signals: named, n: { general: true } }) }).action, "GENERAL_INFORMATION_ONLY");
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true, signals: named }) }).action, "SAFE_ABSTAIN");
  const withSymptom = [...named, sig("NEUROLOGICAL_SYMPTOM", "HIGH_RISK")];
  assert.equal(evaluateSafetyEnvelope({ resolution: res("HIGH_RISK", { personal: true, signals: withSymptom }) }).action, "SAFE_ABSTAIN");
  // an injury/symptom concept tagged NAMED_CONDITION is NOT a chronic condition
  assert.equal(evaluateSafetyEnvelope({ resolution: res("CAUTION", { personal: true, signals: [sig("NAMED_CONDITION", "CAUTION", "injury_pain"), sig("LOCALISED_PAIN", "CAUTION")] }) }).action, "GENERAL_INFORMATION_ONLY");
});

// ── hard boundaries ─────────────────────────────────────────────────────────
const PERSONALISING: AnswerKind[] = ["PERSONALIZED_RECOMMENDATION", "LOAD_PROGRESSION", "PROGRAM_MUTATION", "SAFE_FOR_USER_CLAIM", "FITNESS_ACTION_MUTATION", "PROGRAMMING", "STRENGTH", "HYPERTROPHY", "CATALOG"];

test("4.7R6A boundary: GENERAL_INFORMATION_ONLY authorises general sourced explanation only", () => {
  for (const k of PERSONALISING) assert.equal(answerKindAllowed("GENERAL_INFORMATION_ONLY", k), false, k);
  assert.equal(answerKindAllowed("GENERAL_INFORMATION_ONLY", "GENERAL_EDUCATION"), true);
});

test("4.7R6A boundary: SAFE_ABSTAIN blocks every personalising / catalog / programming kind and general answers", () => {
  for (const k of [...PERSONALISING, "GENERAL_EDUCATION" as AnswerKind]) assert.equal(answerKindAllowed("SAFE_ABSTAIN", k), false, k);
  assert.equal(answerKindAllowed("SAFE_ABSTAIN", "SAFETY_ABSTENTION"), true);
});

test("4.7R6A boundary: a classifier can escalate, never downgrade GENERAL_INFO_ONLY or SAFE_ABSTAIN", () => {
  const gio = res("CAUTION", { personal: true, signals: [sig("LOCALISED_PAIN", "CAUTION")] });
  const abst = res("HIGH_RISK", { personal: true, signals: [sig("SEVERE_DIZZINESS_OR_FAINTING", "HIGH_RISK")] });
  for (const r of [gio, abst]) {
    const base = evaluateSafetyEnvelope({ resolution: r });
    const down = evaluateSafetyEnvelope({ resolution: r, classifierSaysNormal: true });
    assert.equal(down.action, base.action);
    assert.notEqual(down.action, "ALLOW_NORMAL_FITNESS");
  }
  assert.equal(evaluateSafetyEnvelope({ resolution: res("NONE", { personal: true }), classifierEscalates: true }).action, "SAFE_ABSTAIN");
});

// ── characterization of the CURRENT deterministic layer against frozen policy (no tuning; gaps are reported) ──
test("4.7R6A characterization: current resolver + envelope on policy-shaped utterances", () => {
  const act = (q: string) => evaluateSafetyEnvelope({ resolution: resolveSafetySignals(q) }).action;
  assert.equal(act("DOMS nhẹ ở ngực sau buổi đẩy, có bình thường không"), "ALLOW_NORMAL_FITNESS");
  assert.equal(act("tập xong mình suýt ngất phải ngồi xuống"), "SAFE_ABSTAIN");
  assert.equal(act("tuần trước mình vừa mổ ruột thừa, tập lại được chưa"), "SAFE_ABSTAIN");
  assert.equal(act("đánh trống ngực là gì"), "GENERAL_INFORMATION_ONLY");
  assert.equal(act("mình muốn tăng cơ và tập 4 buổi một tuần"), "ALLOW_NORMAL_FITNESS");
  // KNOWN GAPS vs policy (conservative direction, documented, not tuned in R6A):
  //  - remote resolved surgery history is still HIGH_RISK/POST_SURGICAL_STATE (policy 2.3 wants no trigger by itself)
  assert.equal(act("năm 2015 mình có mổ ruột thừa nhưng giờ hoàn toàn bình thường, tập chân thế nào"), "SAFE_ABSTAIN");
  //  - "mình bị huyết áp cao đang kiểm soát tốt, huyết áp cao là gì" is educational (policy 2.5 => GENERAL_INFO_ONLY) but is not recognised as general
  assert.equal(act("mình bị huyết áp cao đang kiểm soát tốt, huyết áp cao là gì"), "SAFE_ABSTAIN");
});

// ── privacy ─────────────────────────────────────────────────────────────────
test("4.7R6A privacy: forbidden personal-data columns are detected (case / separator insensitive)", () => {
  assert.deepEqual(forbiddenColumns(["id", "text", "Email", "User ID", "full-name", "account_id", "phone"]).sort(), ["Email", "User ID", "account_id", "full-name", "phone"].sort());
  assert.deepEqual(forbiddenColumns(["id", "text", "annotator", "safetyLabel"]), []);
});

// ── frozen guideline integrity + handoff package ────────────────────────────
test("4.7R6A guideline: ANNOTATION_GUIDELINES_V1 hash matches its freeze record; draft is superseded", () => {
  const freeze = JSON.parse(fs.readFileSync(path.join(INDEP, "ANNOTATION_GUIDELINES_V1.freeze.json"), "utf8"));
  const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(INDEP, "ANNOTATION_GUIDELINES_V1.md"))).digest("hex");
  assert.equal(freeze.sha256, sha);
  assert.equal(freeze.version, "ANNOTATION_GUIDELINES_V1");
  assert.match(fs.readFileSync(path.join(INDEP, "annotation_guidelines.md"), "utf8"), /SUPERSEDED/);
  for (const k of ["2.1", "2.2", "2.3", "2.4", "2.5"]) assert.ok(freeze.policyDecisions[k]);
});

test("4.7R6A handoff: package files exist; pilot cards are scenarios only (30-50 cards, no personal data, no labels)", () => {
  for (const f of ["README.md", "HANDOFF.md", "ANNOTATION_GUIDELINES_V1.md", "pilot_scenario_cards.csv", "annotation_schema.json", "annotation_batch_template.csv", "adjudication_template.csv"])
    assert.ok(fs.existsSync(path.join(INDEP, f)), f);
  const [head, ...cards] = parseCsv(fs.readFileSync(path.join(INDEP, "pilot_scenario_cards.csv"), "utf8"));
  assert.deepEqual(head, ["cardId", "track", "scenario", "examplesToWrite"]);
  assert.ok(cards.length >= 30 && cards.length <= 50, String(cards.length));
  const s = cards.filter((c) => c[1] === "safety").length, p = cards.filter((c) => c[1] === "programming").length;
  assert.ok(s >= 20 && s <= 30 && p >= 10 && p <= 20, `${s}/${p}`);
  assert.deepEqual(forbiddenColumns(head), []);
});

// ── tooling end-to-end on DUMMY fixture data only (not real annotations) ────
test("4.7R6A tooling e2e (DUMMY data): audit -> blind export -> agreement -> adjudication -> split; forbidden column rejected", () => {
  const tool = path.join(__dirname, "../scripts/routingAnnotationTool.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r6a-dummy-"));
  const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", tool, ...a], { encoding: "utf8", cwd: path.resolve(__dirname, "../..") });

  const cand = path.join(dir, "cand.csv");
  fs.writeFileSync(cand, "id,familyId,text\nD1,FA,dummy alpha question about squats\nD2,FB,dummy beta question about sleep\nD3,FC,dummy gamma question about protein\n");
  const audit = run("audit", `--in=${cand}`);
  assert.equal(audit.status, 0, audit.stderr);
  assert.deepEqual(JSON.parse(audit.stdout).exactDuplicates, []);

  const blind = path.join(dir, "blind.csv");
  assert.equal(run("export-blind", `--in=${cand}`, `--out=${blind}`).status, 0);
  assert.deepEqual(parseCsv(fs.readFileSync(blind, "utf8"))[0], ["id", "text"]);

  const a = path.join(dir, "a.csv"), b = path.join(dir, "b.csv");
  const hdr = "id,text,annotator,safetyLabel,programmingLabel,domain,tags,uncertain,comment,timestamp\n";
  fs.writeFileSync(a, hdr + "D1,x,A01,NORMAL_FITNESS,PROGRAMMING,,,false,,t\nD2,x,A01,NORMAL_FITNESS,NOT_PROGRAMMING,,,false,,t\nD3,x,A01,SAFE_ABSTAIN,NOT_PROGRAMMING,,,false,,t\n");
  fs.writeFileSync(b, hdr + "D1,x,A02,NORMAL_FITNESS,PROGRAMMING,,,false,,t\nD2,x,A02,GENERAL_INFORMATION_ONLY,NOT_PROGRAMMING,,,false,,t\nD3,x,A02,SAFE_ABSTAIN,NOT_PROGRAMMING,,,false,,t\n");
  const ag = JSON.parse(run("agreement", `--a=${a}`, `--b=${b}`, "--column=safetyLabel").stdout);
  assert.equal(ag.n, 3);
  assert.ok(Math.abs(ag.rawAgreement - 2 / 3) < 1e-9);
  assert.equal(ag.cohenKappa, cohenKappa(["NORMAL_FITNESS", "NORMAL_FITNESS", "SAFE_ABSTAIN"], ["NORMAL_FITNESS", "GENERAL_INFORMATION_ONLY", "SAFE_ABSTAIN"]));
  assert.equal(rawAgreement(["a"], ["a"]), 1);

  const adj = adjudicate({ D1: "NORMAL_FITNESS", D2: "NORMAL_FITNESS", D3: "SAFE_ABSTAIN" }, { D1: "NORMAL_FITNESS", D2: "GENERAL_INFORMATION_ONLY", D3: "SAFE_ABSTAIN" },
    [{ id: "D2", finalLabel: "GENERAL_INFORMATION_ONLY", reasonClass: "GUIDELINE_AMBIGUITY", adjudicator: "J01" }]);
  assert.deepEqual(adj.disagreements, ["D2"]);
  assert.equal(adj.final.D2, "GENERAL_INFORMATION_ONLY");

  const split = assignFamilySplit(["FA", "FB", "FC", "FD", "FE", "FF", "FG", "FH", "FI", "FJ"]);
  assert.deepEqual(familyOverlap(Object.entries(split).map(([familyId, s]) => ({ familyId, split: s }))), []);

  const rows = [{ id: "1", familyId: "F", text: "dummy alpha question about squats" }, { id: "2", familyId: "F", text: "Dummy alpha question about squats" }, { id: "3", familyId: "G", text: "dummy alpha question about squats today" }];
  assert.equal(findExactDuplicates(rows).length, 1);
  assert.ok(findNearDuplicates(rows).length >= 1);
  assert.equal(findLeakage(rows, ["dummy alpha question about squats"]).length, 3);

  const bad = path.join(dir, "bad.csv");
  fs.writeFileSync(bad, "id,familyId,text,email\nD1,FA,hello,a@b.com\n");
  const rej = run("audit", `--in=${bad}`);
  assert.notEqual(rej.status, 0);
  assert.match(rej.stderr, /forbidden personal-data column/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("4.7R6A production: envelope / classifier code remain unreferenced by production modules", () => {
  const root = path.resolve(__dirname, "..");
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!["__tests__", "node_modules"].includes(e.name)) walk(p); continue; }
      if (!p.endsWith(".ts") || /safety-envelope\.ts$|routing-data-tools\.ts$|routingAnnotationTool.ts$|routingSingleAudit.ts$|trainQueryClassifiers\.ts$/.test(p) || p.includes(`${path.sep}query-classifiers${path.sep}`) || p.includes(`${path.sep}query-routing-data${path.sep}`)) continue;
      if (/safety-envelope|routing-data-tools|query-classifiers\//.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
