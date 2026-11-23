/**
 * FE2-FIX: the React Bits SpotlightCard (Commons Clause licence) is gone and nothing references it.
 * Evidence label: CODE AUDIT. Run: npx tsx --test src/app/utils/__tests__/noSpotlightCard.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(n) && !/noSpotlightCard\.test\.ts$/.test(n)) out.push(p);
  }
  return out;
}

describe("SpotlightCard removed", () => {
  it("the component folder no longer exists", () => {
    assert.equal(existsSync(join(SRC, "app/components/reactbits/SpotlightCard")), false);
  });
  it("no source file mentions SpotlightCard or spotlight-card vars", () => {
    const hits = walk(SRC).filter((f) => /SpotlightCard|spotlight-card/i.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits.map((f) => f.replace(SRC, "")), []);
  });
  it("the dashboard hero keeps its glass surface and heading landmark", () => {
    const s = readFileSync(join(SRC, "app/components/dashboard/BodyAnalysis.tsx"), "utf8");
    assert.match(s, /className="ob-glass ob-hero relative isolate overflow-hidden"/);
    assert.match(s, /aria-labelledby="ob-body-h"/);
  });
});
