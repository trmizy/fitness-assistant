/**
 * A11Y-3: form controls flagged by axe (select-name / label) are named — by their VISIBLE label where one exists
 * (htmlFor/id, aria-labelledby), otherwise by a name that says what the filter does.
 * Run: npx tsx --test src/app/utils/__tests__/a11yFormLabels.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("A11Y-3 form controls are labelled", () => {
  it("PT application: every <select> is bound to its visible <label>", () => {
    const s = read("pages/client/PTApplicationPage.tsx");
    const selects = s.match(/<select\b[^>]*>/g) ?? [];
    assert.ok(selects.length >= 5);
    for (const tag of selects) {
      const id = /id=(\{`[^`]+`\}|"[^"]+")/.exec(tag)?.[1];
      assert.ok(id, `select without id: ${tag}`);
      assert.ok(s.includes(`htmlFor=${id}`), `no <label htmlFor=${id}>`);
    }
  });
  it("library filters say what they filter", () => {
    const ex = read("pages/client/library/ExerciseLibraryPage.tsx");
    for (const n of ["Lọc theo vùng cơ thể", "Lọc theo thiết bị", "Lọc theo loại hoạt động", "Lọc theo mức độ", "Lọc theo cách ghi bài tập"]) assert.ok(ex.includes(`aria-label="${n}"`), n);
    const fd = read("pages/client/library/FoodLibraryPage.tsx");
    for (const n of ["Lọc theo nguồn dữ liệu", "Lọc theo dạng thực phẩm"]) assert.ok(fd.includes(`aria-label="${n}"`), n);
  });
  it("default rest input is labelled by its visible title and described by help text + unit", () => {
    const s = read("pages/client/settings/WorkoutSection.tsx");
    assert.match(s, /aria-labelledby="settings-default-rest-label"/);
    assert.match(s, /aria-describedby="settings-default-rest-desc settings-default-rest-unit"/);
    assert.match(s, /id="settings-default-rest-unit"/);
  });
  it("CSV import file input is named", () => {
    assert.match(read("pages/client/ImportWorkoutsPage.tsx"), /aria-label="Chọn tệp CSV để nhập lịch sử tập"/);
  });
});
