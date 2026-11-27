/**
 * CODE AUDIT (source guard) - the Client dashboard must not paint before the goal-coherence answer is known: its banner is drawn above the header
 * and pushed the whole page down by ~300 px when it arrived late (CLS 0.17 at 1440, 0.38 at 390; layout-shift attribution on a production build).
 * The wait must be ONE-SHOT: an errored query refetches on mount and is "loading" again, so gating on isLoading every time looped forever on a failing endpoint.
 * Run: npx tsx --test src/app/utils/__tests__/obsidianDashboardNoShift.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../pages/client/ObsidianDashboard.tsx", import.meta.url), "utf8");

describe("ObsidianDashboard first paint", () => {
  it("first paint waits once for the goal-coherence answer (ref-latched), so the banner is never inserted above painted content", () => {
    assert.ok(src.includes("const coherenceSettled = useRef(false);"));
    assert.ok(src.includes("if (!coherenceQuery.isLoading) coherenceSettled.current = true;"));
    assert.ok(src.includes("(!coherenceSettled.current && coherenceQuery.isLoading)"));
  });
  it("the gate is NOT a plain isLoading of the coherence query in the core list (that loops on a failing endpoint)", () => {
    assert.ok(!/programQuery, schedulesQuery, coherenceQuery\]/.test(src));
  });
  it("the banner is still the shared component and the verdict input still falls back to 'coherent' without data (no invented value)", () => {
    assert.ok(src.includes("<GoalCoherenceBanner />"));
    assert.ok(src.includes("coherent: coherence ? coherence.coherent !== false : true"));
  });
  it("the D4 cycles query is still NOT awaited (its verdict slot stays reserved)", () => {
    assert.ok(!/const firstLoad = \[[^\]]*cyclesQuery/.test(src));
    assert.ok(src.includes("min-h-[52px] lg:min-h-[34px]"));
  });
});
