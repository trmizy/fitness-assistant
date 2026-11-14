/**
 * M7-P5A2 — tests of the m7-p5a2 annotation CONTRACT (owner decisions Q2–Q10 + κ policy, 2026-11-15): independent rationale per
 * annotator, adjudicator-attributed final rationale (rationaleBy), role separation across the file, tag audit trail (Q3),
 * third-person-minor cap and safety rule (Q5), special-length caps and scoring exclusions (Q6), agreement policy (κ < 0.60),
 * explicit migration behaviour from m7-p5a1, and the frozen policy values that must NOT change.
 *
 * TEST FIXTURE only: every row is invented; no human label exists or is created here. Pure, offline, no network, no model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateRoutingAnnotations, humanTextProblem, hasThirdPartyMarker } from "./m7-benchmark/annotation-validator";
import {
  AGENTS, ANNOTATOR_KEYS, CATEGORIES, DEFAULT_TARGET, GOVERNED_TAGS, LABEL_KEYS, MAX_EXECUTING_AGENTS, MAX_QUESTION_CHARS, PRE_ROUTING_VALUES,
  QUOTAS, ROUTING_QUESTION_CHARS, ROW_KEYS, SAFETY_VALUES, SCHEMA_VERSION, SUPERSEDED_SCHEMA_VERSIONS, TAGS, THIRD_PARTY_MINOR_MARKER,
  expectedRoutingScored, labelerRoleKey, scoringBuckets, stripAnnotator, type CaseLabel, type DomainLabel,
} from "./m7-benchmark/annotation-schema";
import { replayTagAudit } from "./m7-benchmark/annotation-tag-audit";
import { AGREEMENT_POLICY, computeAgreement, evaluateAgreementPolicy, type AgreementReport } from "./m7-benchmark/annotation-agreement";
import { MAX_QUESTION_CHARS as HTTP_LIMIT } from "../llm/safety-limits";
import { QUALITY_GATES_M51 } from "./m5-benchmark/gates";

const FIX = path.join(__dirname, "m7-benchmark", "annotation-fixtures");
const NOTE = "TEST FIXTURE — not evaluation data";
const OPTS = { checkDistribution: false, checkBenchmarkOverlap: false } as const;
type Obj = Record<string, any>;

const R = (agent: DomainLabel["agent"]): DomainLabel => ({ agent, role: "request" });
const lab = (domains: DomainLabel[], primaryAgent: CaseLabel["primaryAgent"], category: CaseLabel["category"], o: Partial<CaseLabel> = {}): CaseLabel =>
  ({ domains, primaryAgent, category, safety: "NONE", expectedPreRouting: "ALLOW", ...o });
const TRAIN = lab([R("training")], "training", "SINGLE");
const NUTR = lab([R("nutrition")], "nutrition", "SINGLE");
const accented = (q: string) => /[̀-ͯ]|đ|Đ/.test(q.normalize("NFD"));

/** A clean m7-p5a2 row (A = B = final). `over` replaces top-level keys. */
function mk(id: string, question: string, label: CaseLabel = TRAIN, over: Obj = {}): Obj {
  return {
    schemaVersion: SCHEMA_VERSION, id, question, accented: accented(question), tags: [],
    source: { kind: "synthetic", author: "F-author-1", note: NOTE },
    annotatorA: { annotatorId: "A01", rationale: "TEST FIXTURE: lý do riêng của A", ...label },
    annotatorB: { annotatorId: "B02", rationale: "TEST FIXTURE: lý do riêng của B", ...label },
    adjudication: { needed: false }, final: label, rationale: "TEST FIXTURE: xác nhận cuối của adjudicator", rationaleBy: "ADJ01",
    routingScored: expectedRoutingScored(label, question), ...over,
  };
}
const Q = [
  "Thanh tạ ở phòng tập gần nhà bị rỉ sét nhẹ, có nên đổi sang phòng khác không?",
  "Tối nay ăn khoai lang luộc thay cơm trắng có ổn không bạn?",
  "Sau buổi chạy dài cuối tuần thì nên giãn cơ bao lâu?",
  "Tháng trước đo InBody thấy mỡ tăng, giờ nên xem chỉ số nào trước?",
];
const text = (...rows: Obj[]) => rows.map((r) => JSON.stringify(r)).join("\n");
const run = (t: string) => validateRoutingAnnotations(t, OPTS);
const codes = (t: string) => run(t).errors.map((e) => e.code);
const at = (t: string, line: number) => run(t).errors.filter((e) => e.line === line).map((e) => e.code);

// ── migration ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("P2-1 schema version is m7-p5a2; m7-p5a1 rows are refused with an explicit migration message and never auto-migrated", () => {
  assert.equal(SCHEMA_VERSION, "m7-p5a2");
  assert.deepEqual([...SUPERSEDED_SCHEMA_VERSIONS], ["m7-p5a1"]);
  const old = mk("M-0001", Q[0], TRAIN, { schemaVersion: "m7-p5a1" });
  const r = run(text(old));
  const sv = r.errors.find((e) => e.code === "SCHEMA_VERSION");
  assert.ok(sv && /NOT migrated automatically/.test(sv.detail) && /OWN rationale/.test(sv.detail), JSON.stringify(r.errors));
  // the historical m7-p5a1 fixtures stay byte-identical to the committed files and every row is refused (no silent upgrade)
  for (const f of ["synthetic-valid-sample.jsonl", "synthetic-invalid.jsonl"]) {
    const rel = `backend/services/ai-service/src/__tests__/m7-benchmark/annotation-fixtures/${f}`;
    const committed = execFileSync("git", ["show", `5afb6854:${rel}`], { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8" });
    assert.equal(fs.readFileSync(path.join(FIX, f), "utf8").replace(/\r\n/g, "\n"), committed.replace(/\r\n/g, "\n"), `${f} unchanged`);
  }
  const legacy = validateRoutingAnnotations(fs.readFileSync(path.join(FIX, "synthetic-valid-sample.jsonl"), "utf8"), OPTS);
  assert.equal(legacy.ok, false);
  for (let line = 1; line <= 9; line++) assert.ok(legacy.errors.some((e) => e.line === line && e.code === "SCHEMA_VERSION"), `line ${line}`);
  assert.equal(legacy.errors.filter((e) => e.code === "MISSING_ANNOTATOR_RATIONALE").length, 18, "a missing rationale is reported, never filled in");
});

test("P2-1b the m7-p5a2 valid fixture is clean and the input text is never mutated", () => {
  const t = fs.readFileSync(path.join(FIX, "synthetic-valid-sample.m7-p5a2.jsonl"), "utf8");
  const copy = `${t}`;
  const r = run(t);
  assert.deepEqual(r.errors, []); assert.deepEqual(r.reviews, []);
  assert.equal(t, copy);
  assert.deepEqual(r.stats.roles, { annotatorA: "A01", annotatorB: "B02", adjudicator: "ADJ01" });
});

// ── Q2: independent rationale ─────────────────────────────────────────────────────────────────────────────────────────
test("P2-2 each annotator has an OWN required rationale; it is not part of the label (agreement ignores it); final carries none", () => {
  assert.deepEqual([...ANNOTATOR_KEYS].slice(0, 2), ["annotatorId", "rationale"]);
  assert.ok(!(LABEL_KEYS as readonly string[]).includes("rationale"));
  assert.ok((ROW_KEYS as readonly string[]).includes("rationaleBy"));
  assert.deepEqual(codes(text(mk("R-0001", Q[0]))), []);
  for (const who of ["annotatorA", "annotatorB"] as const) {
    const noRat = mk("R-0002", Q[0]); delete noRat[who].rationale;
    assert.deepEqual(at(text(noRat), 1), ["MISSING_ANNOTATOR_RATIONALE"], who);
    const blank = mk("R-0003", Q[0]); blank[who].rationale = "   ";
    assert.deepEqual(at(text(blank), 1), ["MISSING_ANNOTATOR_RATIONALE"], who);
  }
  // A and B with DIFFERENT reasons but the same label agree: adjudication stays exactly {needed:false}
  const diff = mk("R-0004", Q[0]); diff.annotatorB.rationale = "TEST FIXTURE: một lý do hoàn toàn khác";
  assert.deepEqual(codes(text(diff)), []);
  // the rationale never leaks into the stripped label used for comparison
  assert.ok(!("rationale" in stripAnnotator(diff.annotatorA)) && !("annotatorId" in stripAnnotator(diff.annotatorA)));
  // final has no rationale of its own: the final reason is the row-level rationale
  assert.ok(codes(text(mk("R-0005", Q[0], TRAIN, { final: { ...TRAIN, rationale: "x" } }))).includes("UNEXPECTED_KEY"));
});

test("P2-2b rationales are stored canonically (trimmed, NFC, no invisible characters; inner line breaks allowed)", () => {
  assert.equal(humanTextProblem("Lý do\nhai dòng"), null);
  for (const bad of [" lý do", "lý do ", "Lý do", "lý​do", "lý do"]) assert.notEqual(humanTextProblem(bad), null, JSON.stringify(bad));
  const a = mk("C-0001", Q[0]); a.annotatorA.rationale = "lý​do";
  assert.deepEqual(at(text(a), 1), ["RATIONALE_NOT_CANONICAL"]);
  assert.deepEqual(at(text(mk("C-0002", Q[0], TRAIN, { rationale: "xác nhận " })), 1), ["RATIONALE_NOT_CANONICAL"]);
  const adj = { needed: true, adjudicatorId: "ADJ01", decision: TRAIN, rationale: "Lý do" };
  const r = mk("C-0003", Q[0], TRAIN, { annotatorB: { annotatorId: "B02", rationale: "TEST FIXTURE B", ...NUTR }, adjudication: adj });
  assert.deepEqual(at(text(r), 1), ["RATIONALE_NOT_CANONICAL"]);
});

test("P2-3 rationaleBy: required, a human pseudonym, = adjudicatorId when adjudicated, never an annotator of the row", () => {
  const miss = mk("J-0001", Q[0]); delete miss.rationaleBy;
  assert.deepEqual(at(text(miss), 1), ["MISSING_RATIONALE_AUTHOR"]);
  assert.deepEqual(at(text(mk("J-0002", Q[0], TRAIN, { rationaleBy: "" })), 1), ["MISSING_RATIONALE_AUTHOR"]);
  assert.deepEqual(at(text(mk("J-0003", Q[0], TRAIN, { rationaleBy: "claude-judge" })), 1), ["INVALID_RATIONALE_AUTHOR"]);
  const disagree = (adjId: string, by = "ADJ01") => mk("J-0004", Q[0], TRAIN, {
    annotatorB: { annotatorId: "B02", rationale: "TEST FIXTURE B", ...NUTR }, rationaleBy: by,
    adjudication: { needed: true, adjudicatorId: adjId, decision: TRAIN, rationale: "TEST FIXTURE: hỏi tập trước" },
  });
  assert.deepEqual(at(text(disagree("ADJ01")), 1), []);
  assert.ok(at(text(disagree("ADJ07")), 1).includes("RATIONALE_AUTHOR_MISMATCH"));
  assert.ok(at(text(disagree("b02", "b02")), 1).includes("ADJUDICATOR_IS_ANNOTATOR"), "adjudicator = annotator B (case-insensitive)");
  assert.ok(at(text(mk("J-0005", Q[0], TRAIN, { rationaleBy: "A01" })), 1).includes("ADJUDICATOR_IS_ANNOTATOR"), "final rationale by annotator A");
});

// ── Q4: role separation across the file ───────────────────────────────────────────────────────────────────────────────
test("P2-4 one id per role across the whole file; cross-role reuse and writer-as-labeler are errors on the rows that carry them", () => {
  const clean = text(mk("G-0001", Q[0]), mk("G-0002", Q[1], NUTR));
  assert.deepEqual(codes(clean), []);
  const r1 = mk("G-0001", Q[0]);
  const aSwap = mk("G-0002", Q[1], NUTR); aSwap.annotatorA.annotatorId = "A09";
  assert.deepEqual(at(text(r1, aSwap), 2), ["ROLE_ID_INCONSISTENT"]);
  assert.deepEqual(at(text(r1, aSwap), 1), [], "the reference row is not blamed");
  const bSwap = mk("G-0002", Q[1], NUTR); bSwap.annotatorB.annotatorId = "B77";
  assert.deepEqual(at(text(r1, bSwap), 2), ["ROLE_ID_INCONSISTENT"]);
  assert.deepEqual(at(text(r1, mk("G-0002", Q[1], NUTR, { rationaleBy: "ADJ02" })), 2), ["ROLE_ID_INCONSISTENT"]);
  // the canonical key is case-insensitive: "a01" is the same person as "A01"
  const caseOnly = mk("G-0002", Q[1], NUTR); caseOnly.annotatorA.annotatorId = "a01";
  assert.deepEqual(codes(text(r1, caseOnly)), []);
  assert.equal(labelerRoleKey(" A01 "), "a01");
  // A on row 2 is B's id (A and B swapped places on one row)
  const swapped = mk("G-0002", Q[1], NUTR); swapped.annotatorA.annotatorId = "B02"; swapped.annotatorB.annotatorId = "A01";
  const c = at(text(r1, swapped), 2);
  assert.ok(c.includes("ROLE_CONFLICT") && c.includes("ROLE_ID_INCONSISTENT"), c.join());
  // the adjudicator of row 2 is annotator A of row 1 → conflict even though no single row repeats an id
  const crossJ = mk("G-0002", Q[1], NUTR, { rationaleBy: "A01" });
  assert.ok(at(text(r1, crossJ), 2).includes("ROLE_CONFLICT"));
  // a writer never labels
  const writer = mk("G-0002", Q[1], NUTR, { source: { kind: "synthetic", author: "adj01", note: NOTE } });
  assert.deepEqual(at(text(r1, writer), 2), ["WRITER_IS_LABELER"]);
  assert.deepEqual(run(clean).stats.roles, { annotatorA: "A01", annotatorB: "B02", adjudicator: "ADJ01" });
});

test("P2-5 missing / empty / invalid reviewer ids are errors; model or tool names are refused in every role", () => {
  const noA = mk("I-0001", Q[0]); noA.annotatorA.annotatorId = null;
  assert.deepEqual(at(text(noA), 1), ["MISSING_ANNOTATOR_ID"]);
  const emptyB = mk("I-0002", Q[0]); emptyB.annotatorB.annotatorId = "";
  assert.deepEqual(at(text(emptyB), 1), ["MISSING_ANNOTATOR_ID"]);
  const gpt = mk("I-0003", Q[0]); gpt.annotatorB.annotatorId = "gpt-4o";
  assert.deepEqual(at(text(gpt), 1), ["INVALID_ANNOTATOR_ID"]);
  assert.deepEqual(at(text(mk("I-0004", Q[0], TRAIN, { rationaleBy: "Nova" })), 1), ["INVALID_RATIONALE_AUTHOR"]);
  const sameAB = mk("I-0005", Q[0]); sameAB.annotatorB.annotatorId = "A01";
  assert.ok(at(text(sameAB), 1).includes("SAME_ANNOTATOR"));
});

// ── Q3: tag audit trail ───────────────────────────────────────────────────────────────────────────────────────────────
const ORIG = new Map<string, string[]>([["T-1", ["multi_clause"]], ["T-2", []]]);
const ROLES = { annotators: ["A01", "B02"], adjudicator: "ADJ01" };
const entry = (o: Obj) => JSON.stringify({ schemaVersion: SCHEMA_VERSION, seq: 1, id: "T-1", from: ["multi_clause"], to: ["multi_clause", "no_keyword"], reason: "TEST FIXTURE: câu không chứa từ khoá", curatorId: "CUR01", ...o });

test("P2-6 tag audit: replayed in order; governed changes need the adjudicator's confirmation; labels can never be edited", () => {
  const snapshot = JSON.stringify([...ORIG]);
  const ok = replayTagAudit(ORIG, entry({}), ROLES);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.tags!.get("T-1"), ["multi_clause", "no_keyword"]);
  assert.deepEqual(ok.tags!.get("T-2"), [], "ids without entries keep their tags");
  assert.equal(JSON.stringify([...ORIG]), snapshot, "input never mutated");
  // chained entries: from must be the state after the previous entry
  const chain = [entry({}), entry({ seq: 2, from: ["multi_clause", "no_keyword"], to: ["no_keyword"], reason: "TEST FIXTURE: một mệnh đề" })].join("\n");
  assert.deepEqual(replayTagAudit(ORIG, chain, ROLES).tags!.get("T-1"), ["no_keyword"]);
  const c = (t: string) => replayTagAudit(ORIG, t, ROLES).errors.map((e) => e.code);
  assert.deepEqual(c(entry({ id: "T-2", from: [], to: ["review"] })), ["TAG_AUDIT_CONFIRMATION_MISSING"], "review is governed (Q5)");
  for (const g of GOVERNED_TAGS) assert.deepEqual(c(entry({ id: "T-2", from: [], to: [g] })), ["TAG_AUDIT_CONFIRMATION_MISSING"], g);
  assert.deepEqual(c(entry({ id: "T-2", from: [], to: ["high_risk"], confirmedBy: "ADJ01" })), []);
  assert.deepEqual(c(entry({ id: "T-2", from: [], to: ["high_risk"], confirmedBy: "A01" })), ["TAG_AUDIT_CONFIRMATION_INVALID"]);
  assert.deepEqual(c(entry({ final: TRAIN })), ["TAG_AUDIT_LABEL_EDIT_FORBIDDEN"]);
  assert.deepEqual(c(entry({ safety: "MINOR" })), ["TAG_AUDIT_LABEL_EDIT_FORBIDDEN"]);
  assert.deepEqual(c(entry({ from: [] })), ["TAG_AUDIT_STALE_FROM"]);
  assert.deepEqual(c(entry({ seq: 2 })), ["TAG_AUDIT_SEQ"]);
  assert.deepEqual(c(entry({ id: "T-404" })), ["TAG_AUDIT_UNKNOWN_ID"]);
  assert.deepEqual(c(entry({ to: ["multi_clause"] })), ["TAG_AUDIT_NO_CHANGE"]);
  assert.deepEqual(c(entry({ reason: "" })), ["TAG_AUDIT_REASON"]);
  assert.deepEqual(c(entry({ curatorId: "a01" })), ["ROLE_CONFLICT"], "an annotator may not curate (annotators never see tags)");
  assert.deepEqual(c(entry({ curatorId: "ADJ01" })), ["ROLE_CONFLICT"]);
  assert.deepEqual(c([entry({}), entry({ seq: 2, from: ["multi_clause", "no_keyword"], to: ["no_keyword"], curatorId: "CUR02" })].join("\n")), ["ROLE_ID_INCONSISTENT"]);
  assert.deepEqual(c(entry({ to: ["not_a_tag"] })), ["TAG_AUDIT_INVALID_TAGS"]);
  assert.deepEqual(c("{oops"), ["MALFORMED_JSON"]);
  assert.equal(replayTagAudit(ORIG, entry({ final: TRAIN }), ROLES).tags, null, "any error: nothing is applied");
  assert.deepEqual(replayTagAudit(ORIG, "", ROLES).tags!.get("T-1"), ["multi_clause"], "empty audit = no change");
});

// ── Q5: third-person minor ───────────────────────────────────────────────────────────────────────────────────────────
const TP_Q = [
  "Con gái tôi mười lăm tuổi muốn tập tạ ở phòng gym thì có nên không?", "Cháu trai em mười sáu tuổi định nhịn ăn tối để giảm cân, có sao không?",
  "Thằng bé nhà mình mười bốn tuổi chơi bóng rổ bị đau gối, cho nghỉ mấy hôm?", "Bé út mười ba tuổi kén ăn rau, bữa phụ nên chuẩn bị món gì?",
  "Em gái mười bảy tuổi muốn chạy bán marathon, lịch chạy thế nào cho an toàn?", "Con tôi học lớp tám muốn uống whey cho to cơ, có nên mua không?",
  "Đứa cháu mười hai tuổi ngủ muộn vì chơi game, sáng tập bơi có mệt quá không?", "Học trò mười lăm tuổi của tôi muốn chống đẩy mỗi ngày trăm cái được chứ?",
  "Con trai mười sáu tuổi đá bóng xong hay chuột rút bắp chân, nên làm gì?", "Bé nhà tôi mười một tuổi thích nhảy dây, mỗi buổi bao lâu là vừa?",
  "Cô con gái mười bảy tuổi muốn đo mỡ cơ thể, có nên cho đi đo không?",
];
const tp = (i: number, o: Partial<CaseLabel> = {}, over: Obj = {}) => {
  const l = lab([R("training")], "training", "SINGLE", o);
  return mk(`P-${String(i + 1).padStart(4, "0")}`, TP_Q[i], l, { tags: ["review"], rationale: `TEST FIXTURE: ngôi thứ ba — phụ huynh hỏi hộ, an toàn theo nội dung`, ...over });
};

test("P2-7 Q5: third-person minor cases — safety by content (never MINOR), tag review → REVIEW item, at most 10", () => {
  assert.equal(THIRD_PARTY_MINOR_MARKER, "ngôi thứ ba"); assert.equal(QUOTAS.thirdPartyMinorMax, 10);
  assert.ok(hasThirdPartyMarker("NGÔI THỨ BA") && hasThirdPartyMarker("ngoi thu ba, hoi ho") && !hasThirdPartyMarker("ngôi thứ nhất"));
  const one = run(text(tp(0)));
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.reviews.map((r) => r.code), ["THIRD_PARTY_MINOR_REVIEW"]);
  assert.equal(one.stats.quotas.thirdPartyMinor.used, 1);
  // a self-declared minor label on a third-person case is refused (the parent is not the minor; ages are never merged)
  const minor = tp(0, { safety: "MINOR" }, { tags: ["review", "minor"] });
  assert.ok(at(text(minor), 1).includes("THIRD_PARTY_MINOR_SAFETY"));
  // content-based HIGH_RISK stays allowed
  assert.deepEqual(at(text(tp(1, { safety: "HIGH_RISK" }, { tags: ["review", "high_risk"] })), 1), []);
  // 11 cases → the 11th is over the cap
  const eleven = run(text(...TP_Q.map((_, i) => tp(i))));
  assert.deepEqual(eleven.errors.map((e) => [e.line, e.code]), [[11, "QUOTA_THIRD_PARTY_MINOR"]]);
  assert.equal(eleven.stats.quotas.thirdPartyMinor.used, 11);
  // the marker without the review tag is never silently counted: a human decides
  const untagged = run(text(tp(0, {}, { tags: [] })));
  assert.deepEqual(untagged.reviews.map((r) => r.code), ["THIRD_PARTY_MARKER_WITHOUT_REVIEW_TAG"]);
  assert.equal(untagged.stats.quotas.thirdPartyMinor.used, 0);
});

// ── Q6: special-length cases ─────────────────────────────────────────────────────────────────────────────────────────
/** Distinct long questions (unique tokens, so the within-dataset similarity check stays quiet). */
const longQ = (i: number, len: number) => {
  let s = `cau hoi dai so ${i} ve lich tap`;
  for (let k = 0; s.length < len; k++) s += ` w${i}k${k}`;
  return s.slice(0, len).trimEnd();
};

test("P2-8 Q6: long_question (601–2000) and over_request_limit (> 2000) are never routing-scored; caps 5 / 3; denominators exclude them", () => {
  assert.deepEqual([QUOTAS.longQuestionMax, QUOTAS.overRequestLimitMax], [5, 3]);
  const lq = longQ(1, 900), oq = longQ(2, 2300);
  assert.equal(expectedRoutingScored(TRAIN, lq), false); assert.equal(expectedRoutingScored(TRAIN, oq), false);
  assert.equal(expectedRoutingScored(TRAIN, longQ(3, ROUTING_QUESTION_CHARS)), true, "600 chars is still scored");
  const rows = [mk("L-0001", Q[0]), mk("L-0002", lq, TRAIN, { tags: ["long_question"] }), mk("L-0003", oq, TRAIN, { tags: ["over_request_limit"] })];
  const r = run(text(...rows));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stats.scoring.excluded, { overRequestLimit: 1, longQuestion: 1, safetyBlock: 0, oosBlock: 0 });
  assert.equal(r.stats.scoring.routingScored, 1); assert.equal(r.stats.scoring.notRoutingScored, 2);
  assert.equal(r.stats.scoring.denominators.g7, 1); assert.equal(r.stats.scoring.denominators.g8, 1);
  assert.equal(r.stats.scoring.denominators.longQuestionGroup, 1); assert.equal(r.stats.scoring.denominators.validationGroup, 1);
  assert.ok(codes(text(mk("L-0004", lq, TRAIN, { tags: ["long_question"], routingScored: true }))).includes("ROUTING_SCORED_MISMATCH"));
  const b = scoringBuckets({ final: TRAIN, routingScored: false, question: lq });
  assert.deepEqual([b.g7, b.g8, b.longQuestion, b.validationGroup], [false, false, true, false]);
  // caps: 6 long → the 6th is over; 4 over-limit → the 4th is over
  const six = run(text(...[0, 1, 2, 3, 4, 5].map((i) => mk(`LL-${i}`, longQ(10 + i, 700 + i), TRAIN, { tags: ["long_question"] }))));
  assert.deepEqual(six.errors.map((e) => [e.line, e.code]), [[6, "QUOTA_LONG_QUESTION"]]);
  assert.equal(six.stats.quotas.longQuestion.used, 6);
  const four = run(text(...[0, 1, 2, 3].map((i) => mk(`OO-${i}`, longQ(20 + i, 2100 + i), TRAIN, { tags: ["over_request_limit"] }))));
  assert.deepEqual(four.errors.map((e) => [e.line, e.code]), [[4, "QUOTA_OVER_REQUEST_LIMIT"]]);
  // the tag must match the length
  assert.ok(codes(text(mk("L-0005", Q[0], TRAIN, { tags: ["long_question"] }))).includes("TAG_LENGTH_MISMATCH"));
  // the HTTP limit is not silently raised
  assert.equal(MAX_QUESTION_CHARS, 2000); assert.equal(HTTP_LIMIT, MAX_QUESTION_CHARS);
});

// ── κ policy ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test("P2-9 agreement policy: primary κ < 0.60 on ORIGINAL A/B labels triggers calibration; undefined κ needs review; never PASS/FAIL", () => {
  assert.equal(AGREEMENT_POLICY.primaryKappaMin, 0.6);
  const pairs = (xs: Array<[CaseLabel, CaseLabel]>) => xs.map(([a, b], i) => ({ id: `K-${i}`, a, b }));
  const perfect = evaluateAgreementPolicy(computeAgreement(pairs([[TRAIN, TRAIN], [NUTR, NUTR]])));
  assert.equal(perfect.status, "NO_CALIBRATION_TRIGGER"); assert.equal(perfect.calibrationRequired, false);
  const chance = evaluateAgreementPolicy(computeAgreement(pairs([[TRAIN, TRAIN], [NUTR, NUTR], [TRAIN, NUTR], [NUTR, TRAIN]])));
  assert.equal(chance.status, "CALIBRATION_REQUIRED"); assert.equal(chance.reviewRequired, true);
  const constant = evaluateAgreementPolicy(computeAgreement(pairs([[TRAIN, TRAIN], [TRAIN, TRAIN]])));
  assert.equal(constant.status, "KAPPA_UNDEFINED_REVIEW"); assert.equal(constant.calibrationRequired, false); assert.equal(constant.reviewRequired, true);
  // boundary, unrounded: exactly 0.6 does not trigger, 0.5999999 does
  const fake = (v: number): AgreementReport => {
    const base = computeAgreement(pairs([[TRAIN, TRAIN], [NUTR, NUTR]]));
    const k = (b: AgreementReport["withAmbiguous"]) => ({ ...b, primary: { ...b.primary, kappa: { ...b.primary.kappa, value: v } } });
    return { ...base, withAmbiguous: k(base.withAmbiguous), excludingAmbiguous: k(base.excludingAmbiguous) };
  };
  assert.equal(evaluateAgreementPolicy(fake(0.6)).status, "NO_CALIBRATION_TRIGGER");
  assert.equal(evaluateAgreementPolicy(fake(0.5999999)).status, "CALIBRATION_REQUIRED");
  for (const r of [perfect, chance, constant]) assert.ok(!/^(PASS|FAIL)$/.test(r.status) && /never makes the dataset PASS or FAIL/.test(r.note));
});

// ── frozen policy values ─────────────────────────────────────────────────────────────────────────────────────────────
test("P2-10 frozen policy: enums, distribution target, agent cap, length limits and G7 / G8 thresholds are unchanged by m7-p5a2", () => {
  assert.deepEqual([...AGENTS], ["training", "nutrition", "recovery", "progress"]);
  assert.deepEqual([...CATEGORIES], ["SINGLE", "TWO", "MULTI", "OOS", "AMBIGUOUS"]);
  assert.deepEqual([...SAFETY_VALUES], ["NONE", "MINOR", "INJECTION", "HIGH_RISK"]);
  assert.deepEqual([...PRE_ROUTING_VALUES], ["ALLOW", "SAFETY_BLOCK", "OOS_BLOCK"]);
  assert.deepEqual([...TAGS], ["multi_clause", "no_keyword", "unaccented", "minor", "prompt_injection", "high_risk", "long_question", "over_request_limit", "review"]);
  assert.equal(MAX_EXECUTING_AGENTS, 2); assert.equal(ROUTING_QUESTION_CHARS, 600);
  assert.deepEqual({ ...DEFAULT_TARGET }, {
    minCases: 300, categoryPct: { SINGLE: 35, TWO: 25, MULTI: 15, OOS: 10, AMBIGUOUS: 15 }, tolerancePts: 5,
    minUnaccentedPct: 25, minMultiClausePct: 20, minNoKeywordPct: 20, minMinor: 20, minInjection: 20, minHighRisk: 20, minSafetyBlock: 20,
    minSingleDomainPct: 15, minAuthors: 3, maxAuthorPct: 40,
  });
  const g = (id: string) => QUALITY_GATES_M51.find((x) => x.id === id)!;
  assert.deepEqual([g("G7").op, g("G7").threshold, g("G8").op, g("G8").threshold], [">=", 90, ">=", 85]);
});
