import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nextTabIndex, tabProps } from "../shared/tablistKeys.ts";

/* B10 — a11y / motion guards. Source-reading tests (the project's tsx --test has no DOM). */
const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** sRGB relative luminance contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("b10 tablist keyboard (WAI-ARIA tabs)", () => {
  it("ArrowRight/ArrowLeft wrap, Home/End jump, other keys are ignored", () => {
    assert.equal(nextTabIndex("ArrowRight", 0, 4), 1);
    assert.equal(nextTabIndex("ArrowRight", 3, 4), 0);
    assert.equal(nextTabIndex("ArrowLeft", 0, 4), 3);
    assert.equal(nextTabIndex("ArrowLeft", 2, 4), 1);
    assert.equal(nextTabIndex("Home", 2, 4), 0);
    assert.equal(nextTabIndex("End", 1, 4), 3);
    assert.equal(nextTabIndex("Enter", 1, 4), null);
    assert.equal(nextTabIndex("ArrowDown", 1, 4), null);
  });
  it("no focused tab / empty list -> null (the handler does nothing)", () => {
    assert.equal(nextTabIndex("ArrowRight", -1, 4), null);
    assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
    assert.equal(nextTabIndex("ArrowRight", 4, 4), null);
  });
  it("only the selected tab is in the Tab order (roving tabindex)", () => {
    assert.deepEqual(tabProps(true), { role: "tab", "aria-selected": true, tabIndex: 0 });
    assert.deepEqual(tabProps(false), { role: "tab", "aria-selected": false, tabIndex: -1 });
  });
  it("every role=tablist in the admin pages (except the dispute workstream) has the arrow-key handler and no bare role=tab", () => {
    const files = walk(join(ROOT, "pages", "admin")).filter((f) => !/AdminDisputes/.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const lists = src.match(/role="tablist"[^>]*/g) ?? [];
      for (const l of lists) if (!l.includes("onKeyDown={onTablistKeyDown}")) offenders.push(`${f}: tablist without onKeyDown`);
      if (/role="tab"/.test(src)) offenders.push(`${f}: bare role="tab" (use {...tabProps(selected)})`);
    }
    assert.deepEqual(offenders, []);
  });
});

describe("b10 reduced motion (admin only)", () => {
  const css = read("components/layout/admin/adminA11y.css");
  const shell = read("components/layout/admin/AdminShell.tsx");
  it("the rule lives under prefers-reduced-motion and is scoped to html[data-admin-shell]", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*html\[data-admin-shell\]/);
    assert.match(css, /animation: none !important/);
    assert.match(css, /transition-duration: 0s !important/);
  });
  it("AdminShell loads the css and sets/removes the attribute", () => {
    assert.match(shell, /import "\.\/adminA11y\.css"/);
    assert.match(shell, /setAttribute\("data-admin-shell", ""\)/);
    assert.match(shell, /removeAttribute\("data-admin-shell"\)/);
  });
  it("nothing outside the admin shell imports the css", () => {
    const users = walk(ROOT).filter((f) => readFileSync(f, "utf8").includes("adminA11y.css")).map((f) => f.replace(ROOT, ""));
    assert.deepEqual(users.map((u) => u.replace(/\\/g, "/")), ["/components/layout/admin/AdminShell.tsx"]);
  });
  it("the page transition honours reduced motion (duration 0)", () => {
    assert.match(shell, /duration: reducedMotion \? 0 : 0\.16/);
  });
});

describe("b10 ConfirmDialog non-danger button contrast", () => {
  const dlg = read("components/ui/ConfirmDialog.tsx");
  const theme = read("../styles/theme.css").replace(/\r/g, "");
  // First token declaration after the Nth `:root[data-theme="light"] {` opener, up to its closing brace.
  const lightBlock = (n: number) => {
    let at = -1;
    for (let i = 0; i < n; i++) at = theme.indexOf(':root[data-theme="light"] {', at + 1);
    return theme.slice(at, theme.indexOf("}", at));
  };
  it("light confirm button = --st-success on --primary-foreground, and that pair is >= 4.5:1", () => {
    assert.match(dlg, /bg-\[var\(--st-success\)\] text-\[var\(--primary-foreground\)\]/);
    const st = /--st-success:\s*(#[0-9a-fA-F]{6})/.exec(lightBlock(3))?.[1];
    const fg = /--primary-foreground:\s*(#[0-9a-fA-F]{6})/.exec(lightBlock(1))?.[1];
    assert.ok(st && fg, "tokens found");
    assert.ok(contrast(st!, fg!) >= 4.5, `contrast ${contrast(st!, fg!)}`);
  });
  it("dark keeps the original --button-bg / --button-text pair; danger is untouched", () => {
    assert.match(dlg, /dark:bg-\[var\(--button-bg\)\] dark:text-\[var\(--button-text\)\]/);
    assert.match(dlg, /className=\{danger \? undefined : CONFIRM_CLASS\}/);
  });
  it("the old emerald-600 pair really failed AA (regression anchor)", () => {
    assert.ok(contrast("#059669", "#ffffff") < 4.5);
  });
});

describe("b10 skeleton height reservation (no layout shift on money tiles)", () => {
  it("StatTile has a loading-only class hook and Today / Finance overview money tiles use it", () => {
    const tile = read("pages/admin/shared/StatTile.tsx");
    assert.match(tile, /loadingClassName/);
    assert.match(tile, /className=\{`\$\{frame\} \$\{loadingClassName\}`\}/);
    const today = read("pages/admin/AdminDashboard.tsx");
    assert.equal((today.match(/loadingClassName=\{MONEY_TILE_LOADING\}/g) ?? []).length, 4);
    const fin = read("pages/admin/AdminFinanceOverviewTab.tsx");
    assert.equal((fin.match(/loadingClassName="lg:min-h-\[226px\]"/g) ?? []).length, 3);
    assert.equal((fin.match(/loadingClassName="lg:min-h-\[146px\]"/g) ?? []).length, 3);
  });
});
