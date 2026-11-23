/**
 * A11Y-4 guard: display-only BodyChart must not leave focusable role="button" paths inside its aria-hidden SVG,
 * and the single role="img" must carry the descriptive name. node:test, no DOM library — a minimal fake container.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeBodyChartStatic, listVi } from "./bodyChartA11y";

function fakeEl(attrs: Record<string, string>) {
  const a = new Map(Object.entries(attrs));
  return {
    attrs: a,
    setAttribute: (k: string, v: string) => void a.set(k, v),
    removeAttribute: (k: string) => void a.delete(k),
  };
}

test("makeBodyChartStatic strips button role/tabindex from every muscle path and names the image", () => {
  const img = fakeEl({ role: "img", "aria-label": "Body chart" });
  const paths = [fakeEl({ role: "button", tabindex: "0" }), fakeEl({ role: "button", tabindex: "0" })];
  const container = {
    querySelector: (s: string) => (s === '[role="img"]' ? img : null),
    querySelectorAll: (s: string) => (s === ".body-chart-muscle" ? paths : []),
  } as unknown as HTMLElement;
  makeBodyChartStatic(container, "Sơ đồ nhóm cơ của bài tập, mặt trước. cơ chính: Ngực");
  assert.equal(img.attrs.get("aria-label"), "Sơ đồ nhóm cơ của bài tập, mặt trước. cơ chính: Ngực");
  for (const p of paths) {
    assert.equal(p.attrs.has("role"), false);
    assert.equal(p.attrs.has("tabindex"), false);
    assert.equal(p.attrs.get("focusable"), "false");
  }
  assert.doesNotThrow(() => makeBodyChartStatic(null, "x"));
});

test("listVi joins Vietnamese-style, dedupes, drops blanks and caps", () => {
  assert.equal(listVi([]), "");
  assert.equal(listVi(["Ngực", null, " ", "Ngực"]), "Ngực");
  assert.equal(listVi(["Ngực", "Vai", "Tay sau"]), "Ngực, Vai và Tay sau");
  assert.equal(listVi(["A", "B", "C", "D"], 2), "A và B (và 2 nhóm khác)");
});

test("every BodyChart usage in the app goes through makeBodyChartStatic", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f.name) && !f.name.endsWith(".test.ts") && f.name !== "bodyChartA11y.ts") {
        const s = fs.readFileSync(p, "utf8");
        if (/new BodyChart\(/.test(s)) hits.push(p);
        if (/onMuscleClick/.test(s)) assert.fail(`${p} makes muscles interactive — revisit A11Y-4 (paths need real buttons then)`);
      }
    }
  };
  walk(root);
  assert.ok(hits.length >= 3, "expected the 3 known BodyChart usages");
  for (const p of hits) assert.match(fs.readFileSync(p, "utf8"), /makeBodyChartStatic\(/, `${p} builds a BodyChart without makeBodyChartStatic`);
});
