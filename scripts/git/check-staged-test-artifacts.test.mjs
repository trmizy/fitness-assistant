import test from "node:test";
import assert from "node:assert/strict";
import { blockedReason } from "./check-staged-test-artifacts.mjs";

test("M9 architecture continuity files are allowed (exact paths only)", () => {
  assert.equal(blockedReason("CLAUDE.md"), null);
  assert.equal(blockedReason("README.md"), null);
  for (const f of ["ARCHITECTURE", "CAPABILITY-MAP", "IMPLEMENTATION-PLAN", "DECISIONS", "CURRENT-STATE"]) {
    assert.equal(blockedReason(`docs/ai-v2/coach-integration/${f}.md`), null, f);
  }
});

test("everything else under docs/ and every other .md stays blocked", () => {
  const blocked = [
    "docs/ai-v2/m7/annotation-pilot/00-index.md",
    "docs/ai-v2/coach-integration/sub/ARCHITECTURE.md", // no sub-directories
    "docs/ai-v2/coach-integration/notes.txt", // not markdown but still docs/
    "docs/ai-v2/coach-integration-extra/X.md",
    "docs/ai-v2/other/ARCHITECTURE.md",
    "docs/README.md",
    "AGENTS.md",
    "backend/CLAUDE.md",
    "claude.md",
    "notes/REPORT.md",
    "docs/ai-v2/coach-integration/../m7/x.md",
    "docs/ai-v2/coach-integration/ARCHITECTURE.md.bak",
  ];
  for (const f of blocked) assert.notEqual(blockedReason(f), null, f);
});

test("pre-existing artifact rules are unchanged", () => {
  for (const f of ["results/run1.json", "test/a/results/x.json", "test/x/human-review/s.csv", "test/p.png", ".tmp-stack/s", "test/InBody1/a.jpg", "test/a.zip"]) {
    assert.notEqual(blockedReason(f), null, f);
  }
  assert.equal(blockedReason("backend/services/ai-service/src/app.ts"), null);
});
