/**
 * V2 Multi-Agent — integrated LOCAL candidate identity (M7-P1). The M6 Local RC (b8e595dd) stays the frozen, benchmarked
 * baseline; this candidate is M6 + M7-P0 profile reader + MG-1 + user calendar + M7-P1 local integration. It is NOT the
 * benchmarked M6 RC, NOT live-verified and NOT production-ready. Offline: git + file reads only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { WORKTREE } from "./m5-benchmark/run-m6";
import { heldoutIntegrity, plannerSha, RUN_FILE } from "./m5-benchmark/run-m51";
import { readFileSync } from "node:fs";
import { isAgentV2Enabled, isAgentV2HttpEnabled } from "../agent-v2/flag";
import { V3_RUN_FILE, v3Integrity } from "./m7-benchmark/run-v3";
import { V4_RUN_FILE, v4Integrity } from "./m7-benchmark/run-v4";
import { createHash } from "node:crypto";

export const INTEGRATED_CANDIDATE = Object.freeze({
  id: "gymini-multi-agent-local-candidate-m7p1",
  baseM6Rc: "b8e595ddb98b5b218ad77c8e910d161b7c476dbc",
  includes: Object.freeze(["M7-P0 profile reader 35699390", "MG-1 minor output a7f18a7c", "user calendar 004ca887", "M7-P1 local application integration 5d9bc3ed", "M7-P2 cross-service READ transport ed1508a7", "M7-P3 persistent session context 6686d7f4", "M7-P3.1 DynamoDB session adapter 329ff0be", "M7-P4 routing intent-v1.2 (KD-1/KD-2) + benchmark v3 0f529657", "M7-P4.1 benchmark v4 freeze e000497d", "M7-P4.1 routing intent-v1.3 + heldout v4 scoring"]),
  status: "LOCAL CANDIDATE — not benchmarked as M6, not live-verified, not production-ready, deployment on hold",
});
const AI_SRC = "backend/services/ai-service/src";
const git = (...a: string[]) => execFileSync("git", a, { cwd: WORKTREE, encoding: "utf8" }).trim();
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
/** Paths changed since the M6 RC: committed + uncommitted tracked + untracked. */
const changedSinceRc = (...paths: string[]) => [...new Set([
  ...lines(git("diff", "--name-only", INTEGRATED_CANDIDATE.baseM6Rc, "--", ...paths)),
  ...lines(git("ls-files", "--others", "--exclude-standard", "--", ...paths)),
])].sort();
const V1_PATHS = [AI_SRC, `:(exclude)${AI_SRC}/agent-v2`, `:(exclude)${AI_SRC}/__tests__`, `:(exclude)${AI_SRC}/generated`];
/** The approved integration layer (M7-P1 + M7-P2): composition root, READ transport, the flag-gated route and its mount. */
const ALLOWED_V1 = [`${AI_SRC}/agent-v2-integration/domain-read-transport.ts`, `${AI_SRC}/agent-v2-integration/dynamodb-session-store.ts`, `${AI_SRC}/agent-v2-integration/multi-agent-runtime.ts`, `${AI_SRC}/agent-v2-integration/redis-session-store.ts`, `${AI_SRC}/app.ts`, `${AI_SRC}/routes/ai-v2.routes.ts`];

test("RI-1 the frozen M6 RC is an ancestor; the post-M6 commits are on top of it (never re-labelled as M6)", () => {
  assert.equal(git("merge-base", "--is-ancestor", INTEGRATED_CANDIDATE.baseM6Rc, "HEAD") === "", true);
  for (const c of ["35699390", "a7f18a7c", "004ca887", "5d9bc3ed", "ed1508a7", "6686d7f4", "329ff0be", "0f69ec88", "0f529657", "e000497d"]) execFileSync("git", ["merge-base", "--is-ancestor", c, "HEAD"], { cwd: WORKTREE });
  assert.notEqual(git("rev-parse", "HEAD"), INTEGRATED_CANDIDATE.baseM6Rc);
});

test("RI-2 V1-side changes since the M6 RC are exactly the approved integration files; nothing outside ai-service changed", () => {
  assert.deepEqual(changedSinceRc(...V1_PATHS), ALLOWED_V1);
  assert.deepEqual(changedSinceRc(".", `:(exclude)${AI_SRC}`, ":(exclude)docs/ai-v2"), []);
  // app.ts: additions only (the route import + the mount + its comment), nothing removed or edited
  const diff = git("diff", INTEGRATED_CANDIDATE.baseM6Rc, "--", `${AI_SRC}/app.ts`).split("\n").filter((l) => /^[+-][^+-]/.test(l));
  assert.ok(diff.every((l) => l.startsWith("+")), diff.join("\n"));
  assert.ok(diff.every((l) => /aiV2Routes|^\+\s*\/\//.test(l)), diff.join("\n"));
});

test("RI-3 the router changed ONLY to the heldout-v4-scored candidate (M7-P4.1); heldout v2/v3 keep their candidates; M5/M5.1/M6 benchmark code unchanged", () => {
  // M7-P4.1: routing-planner.ts is now intent-v1.3, bound to heldout v4; heldout v3 stays bound to intent-v1.2 (0f529657),
  // heldout v2 to the M5.1 candidate
  const v2 = JSON.parse(readFileSync(RUN_FILE, "utf8")) as { plannerSha256: string };
  const v3 = JSON.parse(readFileSync(V3_RUN_FILE, "utf8")) as { plannerSha256: string };
  const v4 = JSON.parse(readFileSync(V4_RUN_FILE, "utf8")) as { plannerSha256: string };
  const m7p4 = execFileSync("git", ["show", "0f529657:backend/services/ai-service/src/agent-v2/routing-planner.ts"], { cwd: WORKTREE, encoding: "utf8" });
  assert.equal(createHash("sha256").update(m7p4.replace(/\r\n/g, "\n")).digest("hex"), v3.plannerSha256);
  assert.equal(v4.plannerSha256, plannerSha()); assert.notEqual(v3.plannerSha256, plannerSha()); assert.notEqual(v2.plannerSha256, plannerSha());
  assert.ok(v3Integrity().ok); assert.ok(v4Integrity().ok);
  assert.deepEqual(changedSinceRc(`${AI_SRC}/__tests__/m5-benchmark`), []);
  assert.ok(heldoutIntegrity().ok);
});

test("RI-4 the candidate is not switched on anywhere by default: flag OFF, endpoint OFF, production needs a second explicit approval", () => {
  assert.equal(isAgentV2Enabled({}), false); assert.equal(isAgentV2HttpEnabled({}), false);
  assert.equal(isAgentV2HttpEnabled({ AI_AGENT_V2: "on", NODE_ENV: "production" }), false);
  assert.equal(isAgentV2HttpEnabled({ AI_AGENT_V2: "on", NODE_ENV: "production", AI_AGENT_V2_PRODUCTION_APPROVED: "true" }), false);
  assert.equal(isAgentV2HttpEnabled({ AI_AGENT_V2: "on", NODE_ENV: "development" }), true);
  assert.match(INTEGRATED_CANDIDATE.status, /not production-ready/);
});
