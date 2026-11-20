import test from "node:test";
import assert from "node:assert/strict";
import {
  CARDIO_REQUESTED, DEFAULT_CARDIO, DEFAULT_EXERCISE_NOTE, DEFAULT_NUTRITION_SUMMARY, DEFAULT_PROGRESSION_NOTES,
  canonicalBoilerplate, classifyDayLabel, guardPlanVietnameseText, hasImpossibleToneMarks, isCleanDayLabel,
} from "../services/revision/vietnamese-text-guard";

/**
 * Fixtures marked REAL are VERBATIM strings the real Amazon Nova Pro returned on 2026-11-20 (docs/ai/nova-evidence/raw/call-5-NP06.txt, NP03).
 * Policy (approved 2026-11-20): preserve user / PT / personalised content; change only (a) known muscle-group words with wrong marks, (b) RECOGNISED
 * boilerplate, (c) provably invalid Vietnamese. Pure unit tests (no DB, no model).
 */
const REAL_GARBLED_LABELS = ["Tế cố ngữể, vai, tay sau", "Tập cố lủng, tay trữc̣", "Tập cố chán, mông", "Tập cả vai, tay trữc̣, tay sau", "Tập cố ngữểc, vai, tay sau"];
const REAL_GARBLED_NOTES = ["Tập ngữể dày.", "Tập cố ngắội", "Khởi động nhể nếu cần"];
const CLEAN_LABELS = ["Tập cơ ngực, vai, tay sau", "Tập cơ lưng, tay trước", "Tập cơ chân, mông", "Ngực + Vai + Tay sau", "Lưng + Tay trước B", "Chân + Mông + Core", "Toàn thân", "Cardio + Core"];

test("day labels: clean stay clean; known words with wrong marks are RESTORED to the canonical words; impossible text is 'corrupt'; custom text is 'unknown' (never rewritten)", () => {
  for (const l of CLEAN_LABELS) assert.equal(classifyDayLabel(l).kind, "clean", l);
  assert.deepEqual(classifyDayLabel("Tập cố chán, mông"), { kind: "fixed", value: "Tập cơ chân, mông" }, "real single-tone garble is restored");
  assert.equal(classifyDayLabel("TAP CO NGUC + VAI").kind, "fixed", "unaccented known words are restored too");
  // every REAL garbled label is either restored (known words only) or rejected as corrupt — none is accepted as-is
  for (const l of REAL_GARBLED_LABELS) assert.ok(["fixed", "corrupt"].includes(classifyDayLabel(l).kind), l);
  for (const l of ["Tế cố ngữể, vai, tay sau", "Tập cố lủng, tay trữc̣", "Tập cả vai, tay trữc̣, tay sau", "Tập cố ngữểc, vai, tay sau"]) assert.equal(classifyDayLabel(l).kind, "corrupt", l);
  assert.equal(classifyDayLabel("Buổi vai khỏe của Minh").kind, "unknown");
  assert.equal(classifyDayLabel("Ngày PT Hùng giao").kind, "unknown");
  assert.equal(isCleanDayLabel("Chân + Mông"), true); assert.equal(isCleanDayLabel("Tập cố chán, mông"), false);
});

test("two tone marks on one syllable is impossible Vietnamese; real words with one mark are fine; the check is weak by design (REAL notes: 2 of 3 caught)", () => {
  for (const w of ["ngữể", "ngắội", "trữc̣", "trứớc"]) assert.equal(hasImpossibleToneMarks(w), true, w);
  for (const w of ["ngực", "lưng", "trước", "cơ", "Tập cơ ngực, vai, tay sau", "nhẹ nếu cần"]) assert.equal(hasImpossibleToneMarks(w), false, w);
  assert.deepEqual(REAL_GARBLED_NOTES.map((n) => hasImpossibleToneMarks(n)), [true, true, false]);
});

test("boilerplate is recognised by its letters (any diacritics) and restored; personalised text that merely resembles it is NOT touched", () => {
  assert.equal(canonicalBoilerplate("Khởi động nhể nếu cần"), "Khởi động nhẹ nếu cần", "REAL garble of the cardio hint");
  assert.equal(canonicalBoilerplate("Khoi dong nhe neu can"), "Khởi động nhẹ nếu cần", "the ASCII schema example");
  assert.equal(canonicalBoilerplate("Ghi chu ngan"), "Ghi chú ngắn");
  assert.equal(canonicalBoilerplate("Khởi động 10 phút vì đau vai trái"), null);
  assert.equal(canonicalBoilerplate("Ngủ đủ 8 tiếng, tránh cà phê sau 3 giờ chiều"), null);
});

const plan = (goals: string[], opts: Partial<{ note: string; cardio: string }> = {}) => ({
  goal: "MUSCLE_GAIN", daysPerWeek: goals.length, exercisesPerDay: 2,
  weeklySchedule: goals.map((g, d) => ({ day: `Day ${d + 1}`, goal: g, cardio: opts.cardio ?? "Khởi động nhẹ nếu cần", exercises: [1, 2].map((i) => ({ exerciseId: `e${d}${i}`, order: i, name: `Ex ${d}${i}`, sets: 3, reps: "8-12", restSeconds: 75, note: opts.note ?? "ok" })) })),
  progressionNotes: ["Tăng dần"], recoveryNotes: ["Ngủ đủ"], nutritionSummary: "Đủ protein",
});

test("PRESERVATION on a revision: custom day labels, personalised exercise notes, personalised plan-level text, user/PT notes and unknown keys survive VERBATIM while the model returns the REAL corrupted text", () => {
  const previous: any = plan(["Buổi vai khỏe của Minh", "Tập cơ lưng, tay trước"], { cardio: "Khởi động 10 phút vì đau vai trái" });
  previous.weeklySchedule[0].exercises[0].note = "Giảm tạ 20% vì đau vai trái (PT Hùng dặn).";
  previous.weeklySchedule[1].exercises[0].note = "Siết bả vai khi kéo.";
  previous.progressionNotes = ["Tăng 2.5kg mỗi tuần nếu đủ 3x12, theo lời PT."]; previous.recoveryNotes = ["Ngủ trước 23h, tránh cà phê sau 3 giờ chiều."];
  previous.nutritionSummary = "Ăn 2g đạm/kg, bổ sung whey sau tập (theo tư vấn PT)."; previous._metadata = { userNote: "Tôi chỉ tập được 3 buổi", ptNote: "Chú ý vai trái", revision: { previousPlanId: "p" } };
  previous.userNotes = ["Nhớ khởi động kỹ"]; previous.ptNote = "OK";
  const revised: any = plan(["Tế cố ngữể, vai, tay sau", "Tập cố lủng, tay trữc̣"], { note: "Tập ngữể dày.", cardio: "Khởi động nhể nếu cần" });
  revised.weeklySchedule[0].exercises.push({ exerciseId: "NEW", order: 3, name: "New", sets: 3, reps: "10", restSeconds: 60, note: "Tập cố ngắội" });
  revised.progressionNotes = ["Tập luyện tập dềp dài"]; revised.nutritionSummary = "Tâm tật ngân"; revised._metadata = previous._metadata; revised.userNotes = previous.userNotes; revised.ptNote = previous.ptNote;
  const before = JSON.stringify({ meta: previous._metadata, userNotes: previous.userNotes, ptNote: previous.ptNote });
  guardPlanVietnameseText({ content: revised, previous, fallbackDayLabels: ["Ngực + Vai + Tay sau", "Lưng + Tay trước"] });
  assert.equal(revised.weeklySchedule[0].goal, "Buổi vai khỏe của Minh", "the CUSTOM stored label is kept (the model's corrupt label is not used)");
  assert.equal(revised.weeklySchedule[1].goal, "Tập cơ lưng, tay trước");
  assert.equal(revised.weeklySchedule[0].cardio, "Khởi động 10 phút vì đau vai trái", "personalised cardio hint kept");
  assert.equal(revised.weeklySchedule[0].exercises[0].note, "Giảm tạ 20% vì đau vai trái (PT Hùng dặn).", "personalised/PT-derived exercise note kept");
  assert.equal(revised.weeklySchedule[1].exercises[0].note, "Siết bả vai khi kéo.");
  assert.equal(revised.weeklySchedule[0].exercises.find((e: any) => e.exerciseId === "NEW").note, DEFAULT_EXERCISE_NOTE, "a NEW exercise gets the neutral note (model prose not trusted)");
  assert.deepEqual(revised.progressionNotes, previous.progressionNotes); assert.deepEqual(revised.recoveryNotes, previous.recoveryNotes); assert.equal(revised.nutritionSummary, previous.nutritionSummary);
  assert.equal(JSON.stringify({ meta: revised._metadata, userNotes: revised.userNotes, ptNote: revised.ptNote }), before, "user notes / PT notes / unknown keys are untouched");
});

test("CORRUPTED STORED content (from earlier revisions) is cleaned only where it is recognisable: label with known words, boilerplate cardio/notes, provably invalid text; unrecognisable-but-valid text stays", () => {
  const previous: any = plan(["Tập cố chán, mông", "Tế cố ngữể, vai, tay sau"], { cardio: "Khởi động nhể nếu cần", note: "Tập ngữể dày." });
  previous.progressionNotes = ["Tập luyện tập dềp dài"]; previous.recoveryNotes = ["Nghề tới đa, ngụ đươc."]; previous.nutritionSummary = "Tâm tật ngân";
  const revised: any = plan(["Tập cố chán, mông", "Tế cố ngữể, vai, tay sau"]);
  const report = guardPlanVietnameseText({ content: revised, previous, fallbackDayLabels: ["Chân + Mông", "Ngực + Vai + Tay sau"] });
  assert.equal(revised.weeklySchedule[0].goal, "Tập cơ chân, mông", "known words restored");
  assert.equal(revised.weeklySchedule[1].goal, "Ngực + Vai + Tay sau", "corrupt label with no verifiable content -> deterministic template");
  assert.ok(revised.weeklySchedule.every((d: any) => d.cardio === "Khởi động nhẹ nếu cần"), "recognised boilerplate restored");
  assert.ok(revised.weeklySchedule.every((d: any) => d.exercises.every((e: any) => e.note === DEFAULT_EXERCISE_NOTE)), "provably invalid stored note replaced by the neutral phrase");
  // limits, stated: single-tone garble that matches no known phrase is NOT guessed away
  assert.deepEqual(revised.progressionNotes, ["Tập luyện tập dềp dài"]);
  assert.deepEqual(revised.recoveryNotes, ["Nghề tới đa, ngụ đươc."], "also kept: each syllable has at most one mark, nothing proves it wrong");
  assert.ok(report.daysRelabelled >= 1 && report.boilerplateFixed >= 1 && report.invalidReplaced >= 1);
});

test("the guard is idempotent (successive revisions never degrade or drift)", () => {
  const previous: any = plan(["Tập cơ ngực, vai, tay sau"], { cardio: "Khởi động nhể nếu cần" });
  const a: any = plan(["Tế cố ngữể, vai, tay sau"], { note: "Tập ngữể dày." });
  guardPlanVietnameseText({ content: a, previous, fallbackDayLabels: ["Ngực + Vai + Tay sau"] });
  const once = JSON.stringify(a);
  guardPlanVietnameseText({ content: a, previous: JSON.parse(once), fallbackDayLabels: ["Ngực + Vai + Tay sau"] });
  assert.equal(JSON.stringify(a), once);
});

test("first generation: a clean model note is kept, impossible text and boilerplate garble are fixed; the worker's own Vietnamese repair notes are never touched; no previous => template label", () => {
  const p: any = plan(["Tập cố chán, mông"], { note: "Siết cơ ngực ở đỉnh động tác.", cardio: "Khoi dong nhe neu can" });
  p.weeklySchedule[0].exercises[1].note = "Tập ngữể dày.";
  p.weeklySchedule[0].exercises.push({ exerciseId: "r", order: 3, name: "R", sets: 3, reps: "10", restSeconds: 60, note: "Đã tự động chọn từ danh mục bài tập hợp lệ." });
  guardPlanVietnameseText({ content: p, previous: null, fallbackDayLabels: ["Chân + Mông"] });
  assert.equal(p.weeklySchedule[0].goal, "Tập cơ chân, mông");
  assert.equal(p.weeklySchedule[0].cardio, "Khởi động nhẹ nếu cần");
  assert.deepEqual(p.weeklySchedule[0].exercises.map((e: any) => e.note), ["Siết cơ ngực ở đỉnh động tác.", DEFAULT_EXERCISE_NOTE, "Đã tự động chọn từ danh mục bài tập hợp lệ."]);
  const q: any = plan(["Tế cố ngữể, vai, tay sau"]);
  guardPlanVietnameseText({ content: q, previous: null, fallbackDayLabels: ["Ngực + Vai + Tay sau"] });
  assert.equal(q.weeklySchedule[0].goal, "Ngực + Vai + Tay sau");
});

test("user asked for cardio on every day: boilerplate hints become the standard cardio phrase, a personalised hint is kept", () => {
  const previous: any = plan(["Chân + Mông", "Ngực + Vai"], { cardio: "Khởi động nhẹ nếu cần" });
  previous.weeklySchedule[1].cardio = "Đi bộ dốc 15 phút (theo PT)";
  const revised: any = plan(["Chân + Mông", "Ngực + Vai"]);
  guardPlanVietnameseText({ content: revised, previous, fallbackDayLabels: ["Chân + Mông", "Ngực + Vai"], cardioRequested: true });
  assert.equal(revised.weeklySchedule[0].cardio, CARDIO_REQUESTED);
  assert.equal(revised.weeklySchedule[1].cardio, "Đi bộ dốc 15 phút (theo PT)");
  assert.ok(DEFAULT_CARDIO && DEFAULT_PROGRESSION_NOTES.length && DEFAULT_NUTRITION_SUMMARY);
});
