import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../exercise_constraint_guard";
import { exerciseCatalogRows, type CatalogExercise } from "../exercise_name_normalizer";
import type { TurnFacts } from "../turn_facts";

/**
 * P1-03 review fixes for exercise_constraint_guard.ts. Every expected value below is written from the catalog CSV
 * (data/catalog/plans/gym_exercises.csv: exercise_id ; equipment ; difficulty), NOT from calling the guard:
 *   EX00079 Walking Lunge        dumbbell                 intermediate
 *   EX00077 Forward Lunge        bodyweight               beginner
 *   EX00100 Seated Calf Raise    machine                  beginner
 *   EX00099 Standing Calf Raise  machine                  beginner   (data-quality override: doable bodyweight)
 *   EX00136 Machine Chest Press  machine                  beginner
 *   EX00013 Push-Up              bodyweight               beginner
 *   EX00104 Plank                bodyweight               beginner
 *   EX00071 Goblet Squat         dumbbell                 beginner
 *   EX00069 Back Squat           barbell                  intermediate
 *   EX00001 Flat Barbell Bench Press   barbell|bench      intermediate
 *   EX00002 Flat Dumbbell Bench Press  dumbbell|bench     intermediate
 *   EX00070 Front Squat          barbell                  advanced
 *   EX00189 Nordic Ham Curl      bodyweight               advanced
 *   EX00049 Seated Cable Row     cable                    beginner
 *   EX00057/58 Wide/Close-Grip Lat Pulldown  cable        beginner
 *   EX00074 Leg Press, EX00073 Hack Squat    machine      beginner
 * TurnFacts are built BY HAND (no dependency on the extraction code).
 */

type Eq = string[];
const fact = <T>(value: T, status?: string) => ({ value, source: "message" as const, ...(status ? { status } : {}) });
const facts = (o: { equipment?: Eq; experience?: string; equipmentStatus?: string }): TurnFacts =>
  ({
    conflicts: [],
    ...(o.equipment ? { equipment: fact(o.equipment, o.equipmentStatus) } : {}),
    ...(o.experience ? { experience: fact(o.experience) } : {}),
  }) as unknown as TurnFacts;

const NO_EQUIP = facts({ equipment: ["bodyweight"] });
const BARBELL_ONLY = facts({ equipment: ["barbell"] });
const BEGINNER = facts({ experience: "beginner" });
const pairs = (v: G.ExerciseViolation[]) => v.map((x) => [x.exercise.catalogId, x.reason, x.detail]);

const mk = (over: Partial<CatalogExercise>): CatalogExercise => ({ catalogId: "T0", nameEn: "Test Move", nameVi: "Bài thử", equipment: ["bodyweight"], difficulty: "beginner", ...over });

// ---------------------------------------------------------------------------------------------------------------------
// Equipment: decided per catalog row, never by name
// ---------------------------------------------------------------------------------------------------------------------
test("no equipment + Walking Lunge: flagged per its OWN catalog row (EX00079 dumbbell), not exempted by the word 'lunge'", () => {
  assert.deepEqual(pairs(G.findExerciseViolations("- Walking Lunge 3×12", NO_EQUIP)), [["EX00079", "equipment", "dumbbell"]]);
});

test("no equipment + Seated Calf Raise: flagged (EX00100 machine)", () => {
  assert.deepEqual(pairs(G.findExerciseViolations("- Seated Calf Raise 3×15", NO_EQUIP)), [["EX00100", "equipment", "machine"]]);
});

test("no equipment + bodyweight rows (Forward Lunge, Push-Up, Plank, Standing Calf Raise override) are not flagged", () => {
  const a = "- Forward Lunge 3×10\n- Push-Up 3×8\n- Plank 3×20 giây\n- Standing Calf Raise 3×15\nBodyweight Squat 2×10 cũng ổn.";
  assert.deepEqual(G.findExerciseViolations(a, NO_EQUIP), []);
});

test("no equipment + Machine Chest Press: flagged (EX00136 machine)", () => {
  assert.deepEqual(pairs(G.findExerciseViolations("- Machine Chest Press 3×10", NO_EQUIP)), [["EX00136", "equipment", "machine"]]);
});

test("barbell-only: a dumbbell-only exercise is flagged, a barbell exercise is not; 'any of' lists are honoured", () => {
  assert.deepEqual(pairs(G.findExerciseViolations("- Goblet Squat 3×10", BARBELL_ONLY)), [["EX00071", "equipment", "dumbbell"]]);
  assert.deepEqual(G.findExerciseViolations("- Back Squat 3×5", BARBELL_ONLY), []);
  // barbell|bench: the user has a barbell -> one listed option is available -> doable
  assert.deepEqual(G.findExerciseViolations("- Flat Barbell Bench Press 3×8", BARBELL_ONLY), []);
  // dumbbell|bench: neither is available
  assert.deepEqual(pairs(G.findExerciseViolations("- Flat Dumbbell Bench Press 3×8", BARBELL_ONLY)), [["EX00002", "equipment", "dumbbell,bench"]]);
});

test("a gym user (equipment includes 'gym') has no equipment restriction", () => {
  assert.deepEqual(G.findExerciseViolations("- Seated Cable Row 3×10\n- Leg Press 3×10", facts({ equipment: ["gym"] })), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------------------------------------------------
test("beginner / never + advanced catalog exercise stays a difficulty violation; intermediate user / non-advanced row do not", () => {
  assert.deepEqual(pairs(G.findExerciseViolations("- Front Squat 3×5", BEGINNER)), [["EX00070", "difficulty", "advanced"]]);
  assert.deepEqual(pairs(G.findExerciseViolations("- Nordic Ham Curl 3×5", facts({ experience: "never" }))), [["EX00189", "difficulty", "advanced"]]);
  assert.deepEqual(G.findExerciseViolations("- Front Squat 3×5", facts({ experience: "intermediate" })), []);
  assert.deepEqual(G.findExerciseViolations("- Back Squat 3×5", BEGINNER), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Recommended vs mentioned-to-avoid
// ---------------------------------------------------------------------------------------------------------------------
const AVOID_EXAMPLE = "Ví dụ KHÔNG nên tập:\n- Seated Cable Row (cần máy cáp, hãy tránh)\nTập plank thay thế.";

test("an 'avoid' example is neither removed nor flagged (answer byte-identical, no note appended)", () => {
  const out = G.enforceExerciseConstraints(AVOID_EXAMPLE, NO_EQUIP);
  assert.equal(out.answer, AVOID_EXAMPLE);
  assert.deepEqual(out.violations, []);
  assert.equal(out.removedLines, 0);
});

test("avoidance framing: header + list (blank line between), 'thay vì', English 'avoid' / 'instead of' / 'if you have'", () => {
  const cases = [
    "Các bài nên tránh:\n\n- Leg Press 3×10\n- Hack Squat 3×10\n\nBài nên làm: Push-Up 3×8",
    "Hãy tập Plank 3×20 giây thay vì Lat Pulldown.",
    "Plank 3×30s, đừng chọn Machine Chest Press khi chưa có máy.",
    "Avoid Leg Press at home. Do Push-Up instead.",
    "Do Push-Up 3×8 instead of Machine Chest Press 3×10.",
    "If you have a cable stack, Seated Cable Row 3×10 works well. Otherwise do Push-Up.",
    "**Không nên tập:**\n- Hack Squat\n- Leg Press\nHôm nay tập Push-Up.",
  ];
  for (const a of cases) {
    const out = G.enforceExerciseConstraints(a, NO_EQUIP);
    assert.deepEqual(out.violations, [], a);
    assert.equal(out.answer, a, a);
  }
});

test("negative control: the same exercise as a plain recommendation IS flagged and removed (the avoid cue is what changes it)", () => {
  const a = "Gợi ý tuần đầu:\n- Seated Cable Row 3×12\n- Plank 3×20 giây\n- Push-Up 3×8";
  const out = G.enforceExerciseConstraints(a, NO_EQUIP);
  assert.deepEqual(out.violations.map((v) => v.exercise.catalogId), ["EX00049"]);
  assert.doesNotMatch(out.answer, /^- Seated Cable Row/m);
  assert.match(out.answer, /- Plank 3×20 giây\n- Push-Up 3×8/);
  assert.equal(out.removedLines, 1);
  assert.match(out.answer, /⚠️ Mình đã bỏ Seated Cable Row \(cần dụng cụ bạn chưa có\)/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Generic names: violate only if ALL variants violate
// ---------------------------------------------------------------------------------------------------------------------
test("generic 'Lat Pulldown' (Wide-Grip EX00057 + Close-Grip EX00058, both cable): flagged without a cable, not with one", () => {
  const v = G.findExerciseViolations("- Lat Pulldown 3×10", NO_EQUIP);
  assert.equal(v.length, 1);
  assert.equal(v[0].name.toLowerCase(), "lat pulldown");
  assert.equal(v[0].reason, "equipment");
  assert.deepEqual(G.findExerciseViolations("- Lat Pulldown 3×10", facts({ equipment: ["cable"] })), []);
});

test("generic 'Overhead Press' (barbell/dumbbell/machine/smith variants): flagged only when ALL variants violate", () => {
  assert.equal(G.findExerciseViolations("- Overhead Press 3×8", facts({ equipment: ["resistance_band"] })).length, 1);
  assert.deepEqual(G.findExerciseViolations("- Overhead Press 3×8", facts({ equipment: ["dumbbell"] })), []);
});

test("generic name with hand-built variants: one doable variant clears it; a specific variant is judged by its own row", () => {
  const machine = mk({ catalogId: "H1", nameEn: "Hand Machine Fly", equipment: ["machine"] });
  const body = mk({ catalogId: "H2", nameEn: "Hand Floor Fly", equipment: ["bodyweight"] });
  const cable = mk({ catalogId: "H3", nameEn: "Hand Cable Fly", equipment: ["cable"] });
  const resolver = (variants: CatalogExercise[]) => ({
    exact: () => [] as CatalogExercise[],
    generic: (t: string) => (t.includes("Hand Fly") ? [{ term: "Hand Fly", index: t.indexOf("Hand Fly"), variants }] : []),
  });
  assert.deepEqual(G.findExerciseViolations("- Hand Fly 3×10", NO_EQUIP, resolver([machine, body]) as any), []);
  const v = G.findExerciseViolations("- Hand Fly 3×10", NO_EQUIP, resolver([machine, cable]) as any);
  assert.equal(v.length, 1);
  assert.equal(v[0].reason, "equipment");
});

// ---------------------------------------------------------------------------------------------------------------------
// Missing / contradictory metadata -> "unverified", never removed, never silently OK
// ---------------------------------------------------------------------------------------------------------------------
test("assessExercise: empty equipment list and unknown equipment token are 'unverified' under an equipment restriction", () => {
  assert.equal(G.assessExercise(mk({ equipment: [] }), NO_EQUIP).status, "unverified");
  assert.equal(G.assessExercise(mk({ equipment: ["trampoline"] }), NO_EQUIP).status, "unverified");
  assert.equal(G.assessExercise(mk({ equipment: ["trampoline", "machine"] }), NO_EQUIP).status, "unverified");
  assert.equal(G.assessExercise(mk({ equipment: ["trampoline", "bodyweight"] }), NO_EQUIP).status, "ok");
  assert.equal(G.assessExercise(mk({ equipment: ["machine"] }), NO_EQUIP).status, "violation");
  // no restriction -> metadata is irrelevant
  assert.equal(G.assessExercise(mk({ equipment: [] }), facts({})).status, "ok");
  // novice + difficulty missing -> unverified; known non-advanced -> ok
  assert.equal(G.assessExercise(mk({ difficulty: "" }), BEGINNER).status, "unverified");
  assert.equal(G.assessExercise(mk({ difficulty: "intermediate" }), BEGINNER).status, "ok");
});

test("an exercise with missing metadata is reported as unverified and its line is NOT removed", () => {
  const mystery = mk({ catalogId: "T1", nameEn: "Mystery Move", equipment: [] });
  const resolver = { exact: (t: string) => (t.includes("Mystery Move") ? [mystery] : []), generic: () => [] };
  const a = "Gợi ý:\n- Mystery Move 3×10\n- Plank 3×20 giây";
  const out = G.enforceExerciseConstraints(a, NO_EQUIP, resolver as any);
  assert.equal(out.answer, a);
  assert.deepEqual(out.violations, []);
  assert.equal(out.removedLines, 0);
  assert.equal(out.unverified.length, 1);
  assert.equal(out.unverified[0].exercise.catalogId, "T1");
});

// ---------------------------------------------------------------------------------------------------------------------
// Non-destructive repair
// ---------------------------------------------------------------------------------------------------------------------
test("a correct answer comes out byte-identical", () => {
  const a = "Tuần đầu, ở nhà:\n- Push-Up 3×8\n- Plank 3×20 giây\n- Forward Lunge 3×10\nĐi bộ 30 phút mỗi ngày.";
  const out = G.enforceExerciseConstraints(a, NO_EQUIP);
  assert.equal(out.answer, a);
  assert.deepEqual(out.violations, []);
  assert.equal(out.removedLines, 0);
  assert.equal(out.unverified.length, 0);
});

test("removal never empties the answer: when EVERY exercise recommendation violates, text is kept and only the note is appended", () => {
  const a = "Gợi ý tuần đầu:\n- Leg Press 3×10\n- Hack Squat 3×10";
  const out = G.enforceExerciseConstraints(a, NO_EQUIP);
  assert.equal(out.violations.length, 2);
  assert.equal(out.removedLines, 0);
  assert.ok(out.answer.startsWith(a));
  assert.match(out.answer, /⚠️ Lưu ý: chưa nên chọn Leg Press, Hack Squat \(cần dụng cụ bạn chưa có\)/);
});

test("removal is bounded: it does not drop more than half of the answer", () => {
  const long = "Phần giải thích dài ".repeat(2) + "\n- Leg Press 3×10 với rất nhiều ghi chú kỹ thuật chi tiết cho người tập mới bắt đầu ở nhà\n- Plank 3×20";
  const out = G.enforceExerciseConstraints(long, NO_EQUIP);
  assert.ok(out.answer.length >= long.length * 0.5);
  assert.match(out.answer, /Plank 3×20/);
});

test("a line that also recommends a non-violating exercise is kept (not deleted wholesale); the note still names the violation", () => {
  const a = "Tuần đầu:\n- Plank hoặc Seated Cable Row 3×10\n- Push-Up 3×8\n- Forward Lunge 3×10";
  const out = G.enforceExerciseConstraints(a, NO_EQUIP);
  assert.equal(out.removedLines, 0);
  assert.ok(out.answer.startsWith(a));
  assert.match(out.answer, /Lưu ý: chưa nên chọn Seated Cable Row/);
});

test("a removed list item takes its indented sub-bullets with it; siblings stay", () => {
  const a = "Tuần đầu:\n- Lat Pulldown 3×10\n  - kéo thanh xuống ngực\n  - giữ lưng thẳng\n- Plank 3×20 giây\n- Push-Up 3×8\nNghỉ 60-90 giây giữa các hiệp và uống đủ nước trong suốt buổi tập, ngủ đủ giấc để phục hồi tốt hơn.";
  const out = G.enforceExerciseConstraints(a, NO_EQUIP);
  const body = out.answer.split("\n\n⚠️")[0]; // the note itself legitimately names the exercise
  assert.doesNotMatch(body, /Lat Pulldown|kéo thanh xuống|giữ lưng thẳng/);
  assert.match(out.answer, /- Plank 3×20 giây\n- Push-Up 3×8/);
  assert.equal(out.removedLines, 3);
});

test("a Markdown table row of a violating exercise is removed; header, separator and other rows stay", () => {
  const a = "| Bài | Set |\n|---|---|\n| Leg Press | 3×10 |\n| Plank | 3×20s |\n| Push-Up | 3×8 |";
  const out = G.enforceExerciseConstraints(a, NO_EQUIP);
  assert.doesNotMatch(out.answer, /Leg Press \|/);
  assert.match(out.answer, /\| Bài \| Set \|\n\|---\|---\|\n\| Plank \| 3×20s \|\n\| Push-Up \| 3×8 \|/);
  assert.equal(out.removedLines, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Fact status contract (ASSERTED / HYPOTHETICAL apply; NEGATED / UNKNOWN are ignored)
// ---------------------------------------------------------------------------------------------------------------------
test("fact status: absent/ASSERTED/HYPOTHETICAL constrain, NEGATED/UNKNOWN do not", () => {
  const a = "- Leg Press 3×10";
  for (const s of [undefined, "ASSERTED", "HYPOTHETICAL"]) assert.equal(G.findExerciseViolations(a, facts({ equipment: ["bodyweight"], equipmentStatus: s })).length, 1, String(s));
  for (const s of ["NEGATED", "UNKNOWN"]) assert.equal(G.findExerciseViolations(a, facts({ equipment: ["bodyweight"], equipmentStatus: s })).length, 0, s);
});

// ---------------------------------------------------------------------------------------------------------------------
// Data-quality overrides are keyed by catalogId, documented, and bound to the row name
// ---------------------------------------------------------------------------------------------------------------------
test("equipment overrides: every entry has a reason, matches a real catalog row id AND name, and is not a name regex", () => {
  const rows = new Map(exerciseCatalogRows().map((r) => [r.catalogId, r]));
  const entries = Object.entries(G.CATALOG_EQUIPMENT_OVERRIDES);
  assert.ok(entries.length > 0 && entries.length <= 5, "override table must stay small");
  for (const [id, o] of entries) {
    assert.ok(/^EX\d{5}$/.test(id), id);
    assert.equal(rows.get(id)?.nameEn, o.nameEn, id);
    assert.ok(o.reason.length > 20, id);
  }
  // the override binds to the row: a different row with the same catalogId but another name gets no exemption
  const imposter = mk({ catalogId: "EX00099", nameEn: "Something Else", equipment: ["machine"] });
  assert.equal(G.assessExercise(imposter, NO_EQUIP).status, "violation");
});
