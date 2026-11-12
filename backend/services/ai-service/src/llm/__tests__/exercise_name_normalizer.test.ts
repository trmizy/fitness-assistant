import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeExerciseNames as n,
  findExerciseMentions,
  exerciseCatalogRows,
  buildExerciseTerms,
} from "../exercise_name_normalizer";
import { labelLocalizer } from "../label_localizer";

// Confirmed defects from the 200-question coach eval (2026-11-11, selfjudge run): each line is input → required output.
const CONFIRMED: Array<[string, string]> = [
  ["Bạn nên tập Overhead Press 3 hiệp.", "Bạn nên tập Overhead Press 3 hiệp."],
  ["Bài Seated Cable Row cho lưng.", "Bài Seated Cable Row cho lưng."],
  ["Thêm Ab Wheel Rollout cho bụng.", "Thêm Ab Wheel Rollout cho bụng."],
  ["Tập RDL (Romanian Deadlift) cho đùi sau.", "Tập Romanian Deadlift cho đùi sau."],
  ["Tập Romanian Deadlift (RDL) cho đùi sau.", "Tập Romanian Deadlift cho đùi sau."],
  ["Cable row cho lưng giữa.", "Cable row cho lưng giữa."],
  ["Lateral raise 3 hiệp × 15.", "Lateral raise 3 hiệp × 15."],
  ["Shoulder press với tạ đơn.", "Shoulder press với tạ đơn."],
];

test("normalizer: confirmed eval defects are fixed (no doubling, no generic→specific rewrite)", () => {
  for (const [input, expected] of CONFIRMED) assert.equal(n(input), expected, input);
});

test("normalizer: Vietnamese aliases still map to the canonical English name", () => {
  const out = labelLocalizer.localize("Đẩy cáp tay sau và Duỗi tay sau tạ đơn 1 tay", "vi");
  assert.match(out, /Cable Triceps Pushdown/);
  assert.match(out, /One-Arm Dumbbell Overhead Triceps Extension/);
});

test("normalizer: ambiguous aliases (several catalog variants) are never rewritten", () => {
  // "đẩy ngực tạ đòn" = flat / incline / decline barbell bench press in the catalog
  assert.equal(n("Tuần này tập đẩy ngực tạ đòn 4 hiệp."), "Tuần này tập đẩy ngực tạ đòn 4 hiệp.");
});

test("normalizer: behaves the same on English and Vietnamese text (old version ran only with diacritics)", () => {
  assert.equal(n("Do RDL for hamstrings."), "Do Romanian Deadlift for hamstrings.");
  assert.equal(n("Tập RDL cho đùi sau."), "Tập Romanian Deadlift cho đùi sau.");
});

test("normalizer: word boundaries — a term never matches inside a longer word", () => {
  assert.equal(n("Bạn có thể throw bóng hoặc dùng prowler."), "Bạn có thể throw bóng hoặc dùng prowler.");
  assert.equal(n("rdlx không phải tên bài"), "rdlx không phải tên bài");
});

test("normalizer: idempotent on every canonical name and every alias in the catalog", () => {
  const rows = exerciseCatalogRows();
  assert.ok(rows.length > 100, "catalog loaded");
  for (const row of rows) {
    for (const s of [`Tập ${row.nameEn} 3 hiệp.`, `Tập ${row.nameVi} 3 hiệp.`, `Bài **${row.nameEn}** (${row.nameVi}).`]) {
      const once = n(s);
      assert.equal(n(once), once, `not idempotent: ${s}`);
      assert.doesNotMatch(once, /\b(\p{L}{3,}) \1\b/u, `word doubled: ${s} -> ${once}`);
    }
    // a canonical name is never changed
    assert.equal(n(`Tập ${row.nameEn} 3 hiệp.`), `Tập ${row.nameEn} 3 hiệp.`, row.nameEn);
  }
});

test("buildExerciseTerms: ambiguity and containment rules", () => {
  const row = (catalogId: string, nameEn: string, nameVi: string) => ({ catalogId, nameEn, nameVi, equipment: [], difficulty: "beginner" });
  const rows = [row("A", "Seated Cable Row", "Kéo cáp ngồi"), row("B", "Standing Barbell Overhead Press", "Đẩy vai đứng"), row("C", "Seated Barbell Overhead Press", "Đẩy vai ngồi")];
  const aliases = new Map([["A", ["cable row", "kéo cáp"]], ["B", ["overhead press"]], ["C", ["overhead press"]]]);
  const t = new Map(buildExerciseTerms(rows, aliases).map((x) => [x.term, x]));
  assert.equal(t.get("cable row"), undefined, "contained alias dropped");
  assert.equal(t.get("overhead press"), undefined, "ambiguous alias dropped");
  assert.equal(t.get("kéo cáp")?.exercise.nameEn, "Seated Cable Row");
  assert.equal(t.get("seated cable row")?.kind, "canonical");
});

test("findExerciseMentions: returns catalog rows with equipment/difficulty for deterministic checks", () => {
  const found = findExerciseMentions("Tập Romanian Deadlift và Plank, thêm Overhead Press.");
  const names = found.map((e) => e.nameEn);
  assert.ok(names.includes("Romanian Deadlift"));
  assert.ok(names.includes("Plank"));
  assert.ok(!names.some((x) => /Smith Machine Overhead/.test(x)), "generic 'Overhead Press' is not resolved to a variant");
  assert.ok(found.every((e) => Array.isArray(e.equipment) && typeof e.difficulty === "string"));
});
