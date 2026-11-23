/**
 * CODE AUDIT (source guard) - the segmental InBody diagram must not rate a region against one fixed kg value for everybody.
 * Run: npx tsx --test src/app/utils/__tests__/inbodySegmentalNoFixedNorms.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const diagram = read("../../components/InBodySegmentalDiagram.tsx");
const module_ = read("../../pages/client/InBodyModule.tsx");

describe("InBody segmental diagram: measured numbers only, verdict only with the person's own range", () => {
  it("InBodyModule passes no population constant as `norms`", () => {
    assert.doesNotMatch(module_, /norms=\{\{/);
    assert.doesNotMatch(module_, /arm:\s*3\.2|trunk:\s*24(\.0)?|leg:\s*9\.5|arm:\s*1\.0|trunk:\s*8(\.0)?|leg:\s*2\.3/);
  });
  it("the diagram's `norms` prop is optional and every region is optional", () => {
    assert.match(diagram, /norms\?: SegmentalNorms/);
    assert.match(diagram, /arm\?: number;\s*trunk\?: number;\s*leg\?: number;/);
  });
  it("a verdict needs a norm: no value or no norm gives no percentage and no label", () => {
    assert.match(diagram, /if \(!value \|\| !norm\) return \{ pct: null as number \| null, label: "--" \}/);
    assert.match(diagram, /\{pct != null && \(/);
  });
  it("the page says it shows measured numbers and does not rate the regions", () => {
    assert.match(module_, /data-testid="inbody-segmental-note"/);
    assert.match(module_, /không đánh giá Thấp, Bình thường hay Cao cho từng vùng/);
  });
});
