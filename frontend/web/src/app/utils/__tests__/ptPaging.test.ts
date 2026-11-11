/** Run: npx tsx --test src/app/utils/__tests__/ptPaging.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PT_PAGE_SIZE, mergePtPages, mergeUniquePages, nextCursorParam, nextPtPage } from "../ptPaging";

const mk = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ userId: `u${from + i}` }));

describe("ptPaging", () => {
  it("next page only when the last page is full", () => {
    assert.equal(nextPtPage({ pts: mk(PT_PAGE_SIZE) }, 1), 2);
    assert.equal(nextPtPage({ pts: mk(PT_PAGE_SIZE) }, 2), 3);
    assert.equal(nextPtPage({ pts: mk(PT_PAGE_SIZE - 1) }, 2), undefined);
    assert.equal(nextPtPage({ pts: [] }, 1), undefined);
    assert.equal(nextPtPage(undefined, 1), undefined);
  });
  it("merges pages and drops duplicates", () => {
    const merged = mergePtPages([{ pts: mk(3) }, { pts: mk(3, 2) }]);
    assert.deepEqual(merged.map((p) => p.userId), ["u0", "u1", "u2", "u3", "u4"]);
    assert.deepEqual(mergePtPages(undefined), []);
  });
  it("extracts next cursor only when hasMore is true and merges cursor pages cleanly", () => {
    assert.equal(nextCursorParam({ hasMore: true, nextCursor: "c1" }), "c1");
    assert.equal(nextCursorParam({ hasMore: false, nextCursor: "c1" }), undefined);
    assert.equal(nextCursorParam({ hasMore: true, nextCursor: null }), undefined);
    const gyms = mergeUniquePages(
      [{ gyms: [{ id: "g1" }, { id: "g2" }] }, { gyms: [{ id: "g2" }, { id: "g3" }] }],
      (p) => p.gyms,
      (g) => g.id,
    );
    assert.deepEqual(gyms.map((g) => g.id), ["g1", "g2", "g3"]);
  });
});
