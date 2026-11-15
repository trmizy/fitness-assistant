/**
 * M8-A5 — kiểm tra công cụ vận hành pilot (near-duplicate, phân bố pilot, bảng phân công, CLI).
 * TEST FIXTURE: mọi câu hỏi ở đây là SYNTHETIC-TRAINING / fixture — không phải dữ liệu pilot, không phải gold, không phải nhãn.
 * Không đọc/in nội dung benchmark: test chỉ khẳng định kết quả có id + độ tương đồng và đầu ra không chứa văn bản benchmark.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { charNgrams, checkDuplicates, historicalBenchmarkSets, RESERVED_ID_PREFIXES, type QItem } from "./m7-benchmark/pilot-ops/near-duplicate";
import { APPROVED_ALLOCATION, checkAllocation, checkPilotQuestions, parseAllocationCsv, parseJsonl, WRITER_SLOTS } from "./m7-benchmark/pilot-ops/pilot-distribution";
import { main } from "./m7-benchmark/pilot-ops/pilot-ops-cli";
import { ROUTING_CASES_V1 } from "./m5-benchmark/dataset-v1";

// 20 câu SYNTHETIC khác hẳn nhau (4 writer x 5). 1 câu không dấu ở mỗi writer (chỉ số % 5 === 0).
const FIXTURE_Q = [
  "xin chao toi muon hoi ve mot thu hoan toan khac", "Lịch tuần này nên sắp xếp ra sao để vừa đi làm vừa đủ ngủ?",
  "Ăn gì trước buổi chạy sáng để không bị đau bụng?", "Khẩu phần cuối tuần của mình có quá nhiều tinh bột không nhỉ?", "Làm sao biết mình đã tiến bộ sau sáu tuần liên tiếp?",
  "dau vai ben phai khi nang ta co nen nghi tap khong", "Thực đơn cho người ăn chay mới bắt đầu tập tạ như thế nào?",
  "Hôm qua ngủ chưa tới năm tiếng, hôm nay có nên giảm tạ?", "Thời tiết hôm nay ở thành phố thế nào, có mưa không?", "Cân nặng đứng yên mãi thì phải đổi điều gì?",
  "toi hay bi chuot rut o bap chan ban dem", "Một tuần tập mấy buổi là hợp lý cho người đi làm văn phòng?",
  "Nên uống nước thế nào khi tập dưới trời nóng?", "Có nên ăn thêm trứng vào bữa phụ chiều hay không?", "Điểm mạnh yếu của mình thể hiện qua các số đo nào?",
  "co can khoi dong ky truoc khi vao bai nang nang khong", "Bài kéo xà có thay thế được bài kéo cáp không?",
  "Đau lưng dưới sau buổi kéo tạ chết người thì xử lý sao?", "Món nào giàu đạm mà ít dầu mỡ cho bữa tối nhanh gọn?", "Tháng này mình bỏ lỡ nhiều buổi, kế hoạch có cần dựng lại?",
];
const AUTH = ["synthetic-writer-a", "synthetic-writer-b", "synthetic-writer-c", "synthetic-writer-d"];
function row(i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  const q = FIXTURE_Q[i];
  return { schemaVersion: "m7-p5a2", id: `PILOT-${String(i + 1).padStart(3, "0")}`, question: q, accented: /[^\u0000-\u007f]/.test(q), tags: [], source: { kind: "synthetic", author: AUTH[Math.floor(i / 5)], note: "SYNTHETIC-TRAINING fixture" }, ...over };
}
const rowsOf = (objs: Record<string, unknown>[]) => objs.map((raw, i) => ({ line: i + 1, raw }));
const base20 = () => Array.from({ length: 20 }, (_, i) => row(i));
const codes = (fs_: { code: string }[]) => fs_.map((f) => f.code);

// ── near-duplicate ────────────────────────────────────────────────────────────────────────────────────────────
test("char n-gram: đối xứng và có viền khoảng trắng", () => {
  assert.ok(charNgrams("ab").size > 0);
  assert.deepEqual([...charNgrams("abc", 3)].sort(), [" ab", "abc", "bc "].sort());
});

test("dup: giống hệt sau chuẩn hoá (bỏ dấu, hoa/thường, khoảng trắng) là EXACT", () => {
  const r = checkDuplicates([{ id: "T-1", question: "Đau vai khi nâng tạ có nên nghỉ không" }, { id: "T-2", question: "  dau VAI  khi nang ta co nen nghi khong " }]);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].verdict, "EXACT");
  assert.equal(r.errors[0].refScope, "CANDIDATE");
});

test("dup: chỉ khác một ký tự gõ sai -> NEAR_DUPLICATE nhờ n-gram ký tự; câu khác hẳn -> sạch", () => {
  const r = checkDuplicates([
    { id: "A", question: "toi nen an bao nhieu protein moi ngay de tang co" },
    { id: "B", question: "toi nen an bao nhieu protein moi ngay de tang coo" },
    { id: "C", question: "Lịch ngủ nào hợp với người hay thức khuya?" },
  ]);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].verdict, "NEAR_DUPLICATE");
  assert.deepEqual(r.clean, ["C"]);
});

test("dup: danh sách cấm PILOT/CAL/TRAIN bắt trùng và trùng id", () => {
  const ban = [{ scope: "BAN:pilot", items: [{ id: "PILOT-001", question: "Đau lưng dưới sau buổi kéo tạ" }] }, { scope: "BAN:train", items: [{ id: "TRAIN-001", question: "SYNTHETIC câu huấn luyện về giấc ngủ" }] }];
  const r = checkDuplicates([{ id: "PILOT-001", question: "dau lung duoi sau buoi keo ta" }, { id: "X", question: "Chủ đề hoàn toàn khác về trà xanh" }], { refSets: ban, forbidReservedIdPrefixes: true });
  assert.ok(r.errors.some((m) => m.refScope === "BAN:pilot" && m.refId === "PILOT-001"));
  assert.ok(r.idProblems.some((p) => p.code === "ID_IN_BAN_LIST"));
  assert.ok(r.idProblems.some((p) => p.code === "RESERVED_ID_PREFIX"));
  assert.deepEqual(r.clean, ["X"]);
  for (const p of RESERVED_ID_PREFIXES) assert.ok(checkDuplicates([{ id: `${p}9`, question: "một câu bất kỳ" }], { forbidReservedIdPrefixes: true }).idProblems.length === 1);
});

test("dup: benchmark — câu trùng benchmark bị bắt; kết quả chỉ có id/tập/độ tương đồng, không chứa văn bản benchmark", () => {
  const b = ROUTING_CASES_V1[0];
  const r = checkDuplicates([{ id: "CAND-1", question: b.q }], { refSets: historicalBenchmarkSets() });
  const hit = r.errors.find((m) => m.refId === b.id);
  assert.ok(hit, "phải bắt được trùng benchmark");
  assert.ok(hit!.refScope.startsWith("BENCH:"));
  assert.equal(hit!.charJaccard, 1);
  assert.ok(!JSON.stringify(r).includes(b.q), "kết quả không được chứa văn bản benchmark");
});

test("dup: các câu fixture khác nhau và không trùng benchmark -> sạch", () => {
  const items: QItem[] = FIXTURE_Q.map((q, i) => ({ id: `SYN-${i + 1}`, question: q }));
  const r = checkDuplicates(items, { refSets: historicalBenchmarkSets() });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});

// ── phân bố pilot ─────────────────────────────────────────────────────────────────────────────────────────────
test("pilot-check: bộ 20 câu hợp lệ -> không lỗi", () => {
  const res = checkPilotQuestions(rowsOf(base20()), { stage: "curated" });
  assert.deepEqual(res.findings, []);
  assert.equal(res.ok, true);
});

test("pilot-check: số dòng, id, tác giả, không dấu, độ dài, tag", () => {
  const some = (mut: (o: Record<string, unknown>[]) => void, code: string, stage: "curated" | "writer" = "curated") => {
    const o = base20(); mut(o);
    assert.ok(codes(checkPilotQuestions(rowsOf(o), { stage }).findings).includes(code), `thiếu ${code}`);
  };
  some((o) => o.pop(), "ROW_COUNT");
  some((o) => { o[3] = row(3, { id: "PILOT-021" }); }, "ID_NOT_PILOT");
  some((o) => { o[3] = row(3, { id: "PILOT-001" }); }, "DUPLICATE_ID");
  some((o) => { o[3] = row(3, { id: "PILOT-001" }); }, "ID_SET");
  some((o) => { o[19] = row(19, { source: { kind: "synthetic", author: AUTH[0], note: "n" } }); }, "AUTHOR_SHARE");
  some((o) => { for (let i = 15; i < 20; i++) o[i] = row(i, { source: { kind: "synthetic", author: AUTH[2], note: "n" } }); }, "AUTHOR_COUNT");
  some((o) => { o[5] = row(5, { question: "Đau vai bên phải khi nâng tạ có nên nghỉ tập không", accented: true }); }, "UNACCENTED_PER_WRITER");
  some((o) => { o[1] = row(1, { question: "a ".repeat(301).trim() + " b", accented: false }); }, "QUESTION_TOO_LONG");
  some((o) => { o[1] = row(1, { tags: ["not_a_tag"] }); }, "TAG_INVALID");
  some((o) => { o[1] = row(1, { tags: ["multi_clause", "multi_clause"] }); }, "TAG_DUPLICATE");
  some((o) => { o[1] = row(1, { tags: ["long_question"] }); }, "TAG_FORBIDDEN_FOR_PILOT");
  some((o) => { o[1] = row(1, { accented: false }); }, "ACCENTED_MISMATCH");
  some((o) => { o[1] = row(1, { final: {} }); }, "UNEXPECTED_KEY");
  some((o) => { o[1] = row(1, { source: { kind: "synthetic", author: "claude-writer", note: "n" } }); }, "AUTHOR_INVALID");
});

test("pilot-check stage writer: đúng 5 dòng, 1 bút danh, tags rỗng, id nháp không mang tiền tố dành riêng", () => {
  const w = [0, 1, 2, 3, 4].map((i) => row(i, { id: `DRAFT-${i + 1}` }));
  assert.deepEqual(checkPilotQuestions(rowsOf(w), { stage: "writer" }).findings, []);
  const bad = [...w.slice(0, 4), row(4, { id: "TRAIN-1", tags: ["review"] })];
  const c = codes(checkPilotQuestions(rowsOf(bad), { stage: "writer" }).findings);
  assert.ok(c.includes("RESERVED_ID_PREFIX") && c.includes("TAGS_NOT_EMPTY"));
});

// ── bảng phân công ────────────────────────────────────────────────────────────────────────────────────────────
function allocCsv(mut?: (r: string[][]) => void): string {
  const intents: string[][] = []; // [slot, intent] theo bảng đã duyệt
  WRITER_SLOTS.forEach((s, si) => (Object.keys(APPROVED_ALLOCATION) as (keyof typeof APPROVED_ALLOCATION)[]).forEach((c) => { for (let k = 0; k < APPROVED_ALLOCATION[c][si]; k++) intents.push([s, c]); }));
  const rows = intents.map(([s, c], i) => [`PILOT-${String(i + 1).padStart(3, "0")}`, s, AUTH[WRITER_SLOTS.indexOf(s as "W1")], c, "", "no"]);
  mut?.(rows);
  return ["question_id,writer_slot,writer_pseudonym,intent,special_type,third_party", ...rows.map((r) => r.join(","))].join("\n");
}

test("allocation: bảng khớp bảng đã duyệt -> không lỗi (bảng tổng = 20, mỗi slot 5)", () => {
  const total = Object.values(APPROVED_ALLOCATION).reduce((s, v) => s + v.reduce((a, b) => a + b, 0), 0);
  assert.equal(total, 20);
  const { rows, findings } = parseAllocationCsv(allocCsv());
  assert.deepEqual(findings, []);
  assert.deepEqual(checkAllocation(rowsOf(base20()), rows), []);
});

test("allocation: lệch số đếm, sai bút danh, loại đặc biệt trùng, ngôi thứ ba > 1 đều bị bắt", () => {
  const run = (mut: (r: string[][]) => void) => { const { rows } = parseAllocationCsv(allocCsv(mut)); return codes(checkAllocation(rowsOf(base20()), rows)); };
  assert.ok(run((r) => { r[0][3] = "MULTI"; }).includes("ALLOC_COUNT"));
  assert.ok(run((r) => { r[0][2] = AUTH[3]; }).includes("ALLOC_AUTHOR_MISMATCH"));
  assert.ok(run((r) => { r[0][4] = "HIGH_RISK"; r[5][4] = "HIGH_RISK"; }).includes("ALLOC_SPECIAL_DUPLICATE"));
  assert.ok(run((r) => { r[0][4] = "HIGH_RISK"; r[1][4] = "SAFETY_BLOCK"; }).includes("ALLOC_SPECIAL_PER_WRITER"));
  assert.ok(run((r) => { r[0][5] = "yes"; r[7][5] = "yes"; }).includes("ALLOC_THIRD_PARTY_MAX"));
  assert.ok(run((r) => { r.pop(); }).includes("ALLOC_MISSING_QUESTION"));
  assert.ok(run((r) => { r[0][1] = "W9"; }).includes("ALLOC_SLOT"));
});

test("allocation: tiêu đề sai / thiếu cột", () => {
  assert.ok(codes(parseAllocationCsv("a,b,c\n").findings).includes("ALLOC_HEADER"));
  assert.ok(codes(parseAllocationCsv("question_id,writer_slot,writer_pseudonym,intent,special_type,third_party\nx,y\n").findings).includes("ALLOC_COLUMNS"));
});

test("parseJsonl: dòng hỏng và khoá lặp thành finding, không ném lỗi", () => {
  const { rows, findings } = parseJsonl('{"a":1}\n{bad\n{"x":1,"x":2}\n');
  assert.equal(rows.length, 1);
  assert.deepEqual(codes(findings).sort(), ["DUPLICATE_JSON_KEY", "MALFORMED_JSON"]);
});

// ── CLI (mã thoát + không in văn bản) ─────────────────────────────────────────────────────────────────────────
function tmpWrite(name: string, content: string): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-ops-")); const p = path.join(d, name); fs.writeFileSync(p, content, "utf8"); return p; }
const jl = (objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
const run = (argv: string[]) => { const lines: string[] = []; const code = main(argv, (s) => lines.push(s)); return { code, text: lines.join("\n") }; };

test("CLI dup-check: sạch = 0; trùng benchmark = 1 và không in văn bản benchmark; REVIEW = 3; sai cú pháp = 2", () => {
  const clean = tmpWrite("c.jsonl", jl([{ id: "SYN-1", question: FIXTURE_Q[1] }, { id: "SYN-2", question: FIXTURE_Q[2] }]));
  assert.equal(run(["dup-check", "--candidates", clean]).code, 0);
  const b = ROUTING_CASES_V1[0];
  const dup = tmpWrite("d.jsonl", jl([{ id: "SYN-9", question: b.q }]));
  const r = run(["dup-check", "--candidates", dup]);
  assert.equal(r.code, 1);
  assert.ok(r.text.includes(b.id) && r.text.includes("BENCH:V1"));
  assert.ok(!r.text.includes(b.q));
  // REVIEW: khác nhau vừa đủ (không chạm ngưỡng lỗi) giữa hai ứng viên
  const rev = tmpWrite("r.jsonl", jl([{ id: "R1", question: "nên ăn gì trước khi tập chân buổi sáng" }, { id: "R2", question: "nên ăn gì sau khi tập chân buổi sáng" }]));
  const rr = run(["dup-check", "--candidates", rev, "--no-benchmark"]);
  assert.equal(rr.code, 3, rr.text);
  assert.equal(run(["dup-check"]).code, 2);
  assert.equal(run(["nope"]).code, 2);
  assert.equal(run(["dup-check", "--candidates", path.join(os.tmpdir(), "khong-ton-tai-pilot-ops.jsonl")]).code, 2);
});

test("CLI dup-check: --ban và --forbid-reserved-ids", () => {
  const ban = tmpWrite("ban.jsonl", jl([{ id: "TRAIN-001", question: "SYNTHETIC-TRAINING câu về trà xanh và giấc ngủ" }]));
  const cand = tmpWrite("cand.jsonl", jl([{ id: "TRAIN-001", question: "Một câu hoàn toàn khác về chạy bộ" }]));
  const r = run(["dup-check", "--candidates", cand, "--ban", ban, "--no-benchmark", "--forbid-reserved-ids"]);
  assert.equal(r.code, 1);
  assert.ok(r.text.includes("ID_IN_BAN_LIST") && r.text.includes("RESERVED_ID_PREFIX"));
});

test("CLI pilot-check: hợp lệ = 0 (có/không bảng phân công); lệch = 1; thiếu stage = 2", () => {
  const q = tmpWrite("q.jsonl", jl(base20()));
  assert.equal(run(["pilot-check", "--questions", q, "--stage", "curated"]).code, 0);
  const a = tmpWrite("a.csv", allocCsv());
  const ok = run(["pilot-check", "--questions", q, "--stage", "curated", "--allocation", a]);
  assert.equal(ok.code, 0, ok.text);
  const bad = tmpWrite("b.csv", allocCsv((r) => { r[0][3] = "OOS"; }));
  assert.equal(run(["pilot-check", "--questions", q, "--stage", "curated", "--allocation", bad]).code, 1);
  assert.equal(run(["pilot-check", "--questions", q]).code, 2);
  assert.equal(run(["pilot-check", "--questions", q, "--stage", "writer", "--allocation", a]).code, 2);
});
