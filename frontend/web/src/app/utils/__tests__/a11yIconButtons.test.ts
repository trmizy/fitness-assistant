/**
 * A11Y-2: icon-only buttons found by axe (button-name) carry an accessible name that says what they do; the
 * meal disclosure also exposes its state; the dead "share" control is no longer a button.
 * Run: npx tsx --test src/app/utils/__tests__/a11yIconButtons.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("A11Y-2 icon-only buttons are named", () => {
  it("Nutrition: day + month navigation, meal disclosure with state", () => {
    const s = read("pages/client/NutritionPage.tsx");
    for (const l of ["Ngày trước", "Ngày sau", "Tháng trước", "Tháng sau"]) assert.match(s, new RegExp(`aria-label="${l}"`));
    assert.match(s, /onClick=\{\(\) => toggleMeal\(meal\)\}\s+aria-expanded=\{expanded\}\s+aria-label=/);
  });
  it("PT schedule + activity heatmap month navigation", () => {
    for (const f of ["pages/pt/PTSchedulePage.tsx", "pages/client/ActivityHeatmapPage.tsx"]) {
      const s = read(f);
      assert.match(s, /aria-label="Tháng trước"/, f);
      assert.match(s, /aria-label="Tháng sau"/, f);
    }
  });
  it("back buttons and the AI Coach send button", () => {
    assert.match(read("pages/client/PTApplicationPage.tsx"), /aria-label="Quay lại hồ sơ"/);
    assert.match(read("pages/client/TrainingEquipmentSettingsPage.tsx"), /aria-label="Quay lại hồ sơ"/);
    assert.match(read("pages/client/AICoachPage.tsx"), /aria-label=\{aiLoading \|\| imageChatBusy \? "Đang gửi" : "Gửi tin nhắn"\}/);
  });
  it("the action-less share control is decorative, not a button", () => {
    const s = read("pages/client/WorkoutLogPage.tsx");
    assert.doesNotMatch(s, /<button className="absolute top-4 left-4 w-10 h-10[^>]*>\s*<Share2/);
  });
});
