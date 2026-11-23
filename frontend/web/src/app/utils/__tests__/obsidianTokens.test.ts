/**
 * FE2-FIX group C: ONE token set for the Client/PT workspace (--ob-*). The old --gw-* (gymini-web-ui.css) and
 * --ng-* (night-glass.css) sets are gone; every var(--ob-*) that is read is defined for both themes.
 * theme.css and the Gym Owner --go-* tokens are untouched by this group.
 * Evidence label: CODE AUDIT (static scan of the source tree).
 * Run: npx tsx --test src/app/utils/__tests__/obsidianTokens.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (p: string) => readFileSync(p, "utf8");
const css = (n: string) => read(join(SRC, "styles", n));

describe("token consolidation", () => {
  it("no --gw-* or --ng-* custom property is defined or read anywhere (comments aside)", () => {
    const hits: string[] = [];
    for (const f of files) {
      const stripped = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
      if (/--(gw|ng)-[a-z0-9]/.test(stripped)) hits.push(f.replace(SRC, ""));
    }
    assert.deepEqual(hits, []);
  });

  it("every var(--ob-*) that is read is defined, in the dark block and the light block", () => {
    const ob = css("obsidian.css");
    const dark = ob.slice(ob.indexOf(":root,\n.dark {"), ob.indexOf(".light,\n:root[data-theme"));
    const light = ob.slice(ob.indexOf(".light,\n:root[data-theme"), ob.indexOf("/* ── Dashboard surfaces"));
    const defined = (blk: string) => new Set([...blk.matchAll(/(--ob-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const d = defined(dark), l = defined(light);
    const used = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/var\((--ob-[a-z0-9-]+)/g)) used.add(m[1]);
    const missing = [...used].filter((k) => !d.has(k));
    assert.deepEqual(missing, [], "defined in the dark/base block");
    // colour tokens must also exist for light; theme-independent scales (radii, rows, durations, easing) live once.
    const scales = /^--ob-(r-|row|dur-|ease)/;
    const missingLight = [...used].filter((k) => !scales.test(k) && !l.has(k));
    assert.deepEqual(missingLight, [], "defined in the light block");
  });

  it("the navigation-only values are --ob-nav-* and the scale tokens moved over", () => {
    const ob = css("obsidian.css");
    for (const k of ["--ob-nav-glass", "--ob-nav-glass-strong", "--ob-nav-line", "--ob-nav-line-soft", "--ob-nav-highlight", "--ob-nav-icon", "--ob-nav-pill-line", "--ob-nav-glow", "--ob-nav-shadow", "--ob-hover", "--ob-r-md", "--ob-row", "--ob-dur-hover", "--ob-ease"]) {
      assert.match(ob, new RegExp(`${k}:`), k);
    }
  });

  it("rail accent stays #22C55E (approved) and Gym Owner / theme.css are not part of the set", () => {
    const ob = css("obsidian.css");
    assert.match(ob, /--ob-accent: #22c55e;/);
    assert.match(ob, /--ob-nav-pill-line: rgba\(34, 197, 94, 0\.3\);/);
    assert.doesNotMatch(css("gym-owner.css"), /--ob-/);
  });

  it("no theme draws a halo around the active rail item (the sky-blue one was a Night Glass leftover)", () => {
    const ob = css("obsidian.css");
    const glows = ob.match(/--ob-nav-glow:[^;]*;/g) ?? [];
    assert.equal(glows.length, 2); // dark + light
    for (const g of glows) assert.match(g, /--ob-nav-glow: 0 0 0 0 transparent;/);
    assert.doesNotMatch(ob, /14, 165, 233/);
  });
});
