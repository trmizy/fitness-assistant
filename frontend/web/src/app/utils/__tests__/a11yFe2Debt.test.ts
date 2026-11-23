/**
 * CODE AUDIT (source guards) for the a11y debt named in the Frontend 2.0 handoff: Profile edit form (label / select-name / button-name),
 * Nutrition goal form (label), PT contracts (nested-interactive), PT schedule (bg-blue-500 under white text).
 * The browser proof (axe-core) is in fe2-final-results.json; these only stop a regression from coming back unnoticed.
 * Run: npx tsx --test src/app/utils/__tests__/a11yFe2Debt.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("Profile edit form", () => {
  const t = read("../../pages/client/ProfilePage.tsx");
  it("no bare <label> sibling of a control is left: labels are FieldLabel (htmlFor) and every control has the matching id", () => {
    assert.equal((t.match(/<label className="text-xs text-zinc-600/g) ?? []).length, 0);
    for (const k of ["dob", "height", "weight", "gender", "activity", "exp", "diet", "injuries"]) {
      assert.ok(t.includes("`${fid}-" + k + "` : undefined}"), `label for ${k}`);
      assert.ok(t.includes("id={`${fid}-" + k + "`}"), `id for ${k}`);
    }
  });
  it("the icon-only camera button has a name and is a real button type", () => {
    assert.match(t, /type="button"\s+aria-label="Đổi ảnh đại diện"/);
  });
});

describe("Nutrition goal form", () => {
  const t = read("../../pages/client/NutritionPage.tsx");
  it("each macro field is a labelled control", () => {
    assert.match(t, /htmlFor=\{`nutrition-goal-\$\{key\}`\}/);
    assert.match(t, /id=\{`nutrition-goal-\$\{key\}`\}/);
  });
  it("the icon-only close button of the goal form has a name (axe button-name, found in the browser)", () => {
    assert.ok(t.includes('aria-label="Đóng"
                onClick={() => setShowGoalModal(false)}'));
  });
});

describe("PT contracts row", () => {
  const t = read("../../pages/pt/PTContractsPage.tsx");
  it("the row is no longer role=button around real buttons; the toggle is one real <button aria-expanded>", () => {
    assert.doesNotMatch(t, /role="button"\s+tabIndex=\{0\}\s+aria-expanded/);
    assert.match(t, /data-testid="pt-contract-toggle"/);
    assert.match(t, /relative z-10 flex gap-2 order-last/);
  });
});

describe("PT schedule", () => {
  const t = read("../../pages/pt/PTSchedulePage.tsx");
  it("white text never sits on bg-blue-500 (3.7:1); blue-600 is 5.2:1", () => {
    assert.doesNotMatch(t, /bg-blue-500[^/"\s]*\s[^"]*text-white|text-white[^"]*\sbg-blue-500(?![/\d])/);
    assert.equal((t.match(/\bbg-blue-500\b(?!\/)/g) ?? []).length, 0);
  });
});
