// Builds the V1 RC file manifest (read-only on the repo): every ai-service / shared / eval file that differs from HEAD,
// tagged with the workstream it belongs to. Output: rc-manifest.json next to this script.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const REPO = "C:/D_Backup/project_personal/fitness-assistant";
const git = (a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
const AI = "backend/services/ai-service/";
const B4 = new Set(["src/llm/safety_guard.ts", "src/llm/medical-referral.ts", "src/services/exercise-guidance.ts", "src/services/revision/workout-guards.ts", "src/__tests__/coach-b4-regressions.test.ts", "src/llm/intent_router.ts"]);
const MIXED = { "src/llm/safety_guard.ts": "b4 + V1-RC minor policy", "src/llm/intent_router.ts": "b4 hunk + 7-phase + B2-38 routing" };
const RC_ROUND = new Set([
  "src/services/agent-turn-act.ts", "src/services/fitness-agent-intent.ts", "src/services/fitness-agent.service.ts", "src/agent-workflow/orchestrator.ts",
  "src/llm/minor_safety_policy.ts", "src/__tests__/agent-turn-act-gate.test.ts", "src/__tests__/agent-advisory-question-no-mutation.test.ts",
  "src/__tests__/agent-pending-draft-advisory-gate.test.ts", "src/llm/__tests__/minor_safety_policy.test.ts", "src/llm/__tests__/equipment_scope_semantics.test.ts",
  "src/llm/__tests__/context_hallucination_trace.test.ts",
  "src/llm/bmi_claim_guard.ts", "src/llm/intake_claim_guard.ts", "src/llm/output_hygiene.ts", "src/agent-workflow/workflows/create-workout-plan.workflow.ts", "src/services/bedrock.client.ts", "src/services/llm.service.ts", "src/llm/body_composition_rules.ts",
]);
const tracked = git(["diff", "--name-only", "HEAD", "--", `${AI}src`, `${AI}package.json`, `${AI}prisma`, "backend/shared/src", "test/ai-quality-eval", "test/ai-chat-full-verification"]).split("\n").filter(Boolean);
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", `${AI}src`, "test/ai-quality-eval", "test/ai-chat-full-verification"]).split("\n").filter(Boolean);
const rows = [];
for (const [list, state] of [[tracked, "modified"], [untracked, "new"]]) for (const f of list) {
  const rel = f.startsWith(AI) ? f.slice(AI.length) : f;
  let group, include = true, note = "";
  if (/generated\/prisma/.test(f)) { group = "generated-prisma"; include = false; note = "whitespace-only diff vs HEAD (prisma format); regenerate in build, do not hand-commit"; }
  else if (f === "backend/shared/src/fitness-agent.ts") { group = "pre-existing dependency"; note = "SUBSTITUTE_SAVED_EXERCISE enum — HEAD ai-service already uses it; RC is NOT buildable without it"; }
  else if (/\.md$/.test(f)) { group = "docs/report"; include = false; note = "local only (no .md in pushes)"; }
  else if (f.startsWith("test/ai-chat-full-verification/")) { group = "test harness (stack process safety)"; include = /\.mjs$/.test(f) && !/results\//.test(f); }
  else if (f.startsWith("test/ai-quality-eval/")) { group = "eval tooling"; include = /\.(mjs|mts|json)$/.test(f) && !/results\//.test(f); note = include ? "" : "results/reports stay local"; }
  else if (MIXED[rel]) { group = "MIXED"; note = MIXED[rel]; }
  else if (B4.has(rel)) group = "b4";
  else if (RC_ROUND.has(rel)) group = "V1-RC round (2026-11-12)";
  else group = "7-phase / independent-review / stabilization (2026-11-12)";
  rows.push({ file: f, state, group, include, note });
}
const out = path.join(__dirname, "rc-manifest.json");
fs.writeFileSync(out, JSON.stringify({ head: git(["rev-parse", "HEAD"]).trim(), branch: git(["branch", "--show-current"]).trim(), generatedAt: new Date().toISOString(), rows }, null, 2));
const by = {};
for (const r of rows) (by[`${r.group}${r.include ? "" : " (EXCLUDED)"}`] ??= []).push(r.file);
for (const [g, l] of Object.entries(by)) console.log(`${g}: ${l.length}`);
console.log("total", rows.length, "include", rows.filter((r) => r.include).length, "->", out);
