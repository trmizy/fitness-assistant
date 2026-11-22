/**
 * A11Y-1: every role="switch" in the client app has an accessible name (aria-labelledby / aria-label) and keeps
 * its state in aria-checked. Source guard over all .tsx files so a new unnamed switch fails CI.
 * Run: npx tsx --test src/app/utils/__tests__/a11ySwitchNames.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === "__tests__" ? [] : walk(p)) : p.endsWith(".tsx") ? [p] : []; });

describe("role=switch accessible names", () => {
  const offenders: string[] = [];
  let count = 0;
  for (const f of walk(ROOT)) {
    const src = readFileSync(f, "utf8");
    // each opening tag that declares role="switch"
    for (const m of src.matchAll(/<button\b[^>]*?role="switch"[^>]*?>/gs)) {
      count++;
      const tag = m[0];
      if (!/aria-labelledby=|aria-label=/.test(tag) || !/aria-checked=/.test(tag)) offenders.push(`${f.slice(ROOT.length)}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  it("finds the switches it guards", () => assert.ok(count >= 2, `found ${count}`));
  it("every switch is named and exposes its state", () => assert.deepEqual(offenders, []));
});
