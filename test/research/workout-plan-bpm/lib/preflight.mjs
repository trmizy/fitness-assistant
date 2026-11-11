// Preflight for the workout-BPM research run. Read-only with respect to the repository: it hashes the design package,
// verifies mandatory test paths/globs, parses real FR/EX/AC counts from the documents, and records the initial git
// state WITHOUT normalizing it. It never connects to a database and never prints environment values.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const REQUIRED_DOCS = [
  "README.md", "00-scope-and-research-question.md", "01-business-scenario.md", "02-as-is-process.md", "03-to-be-bpm.md",
  "04-functional-requirements.md", "05-exception-catalogue.md", "06-acceptance-criteria.md", "07-context-model.md",
  "08-agent-input-output.md", "09-domain-knowledge-hitl.md", "10-traceability-matrix.md", "11-qwen3-4b-evaluation-plan.md",
  "12-gap-analysis-and-next-implementation.md",
];
export const REQUIRED_PATHS = [
  "test/conversational-intelligence/x4-t10-repro.mjs", "test/conversational-intelligence/codex-final-confirmation-followup.mjs",
  "test/conversational-intelligence/x4-confirmation-matrix.mjs", "test/conversational-intelligence/live-golden.mjs",
  "test/conversational-intelligence/live-global.mjs", "test/conversational-intelligence/codex-security-http.mjs",
  "test/ai-chat-full-verification/lib.mjs",
  "backend/services/ai-service/src/__tests__/codex-remediation-boundary.test.ts",
  "backend/services/ai-service/src/__tests__/codex-x4-resolution-independent.test.ts",
  "backend/services/ai-service/src/__tests__/x4-confirmation-followup.test.ts",
  "backend/services/ai-service/src/__tests__/x4-event-ordering.test.ts",
];
export const REQUIRED_GLOBS = [
  { dir: "backend/services/ai-service/src/__tests__", prefix: "conversational-intelligence-", suffix: ".test.ts" },
  { dir: "backend/services/ai-service/src/__tests__", prefix: "agent-workflow-", suffix: ".test.ts" },
  { dir: "backend/services/ai-service/src/__tests__", prefix: "fitness-agent-", suffix: ".test.ts" },
];

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Counts FR/EX/AC identifiers that are DEFINED (headings or table rows), parsed from the documents themselves. */
export function countDefinitions(docDir) {
  const read = (f) => fs.readFileSync(path.join(docDir, f), "utf8");
  const ids = (text, re) => [...new Set([...text.matchAll(re)].map((m) => m[1]))];
  const fr = ids(read("04-functional-requirements.md"), /^\|\s*(FR\d{2})\s*\|/gm);
  const ex = ids(read("05-exception-catalogue.md"), /^###\s+(EX\d{2})\b/gm);
  const ac = ids(read("06-acceptance-criteria.md"), /^- \*\*(AC\d{2})\*\*:/gm);
  return { functionalRequirements: fr.length, exceptions: ex.length, acceptanceCriteria: ac.length, frIds: fr, exIds: ex, acIds: ac };
}

export function gitState(repoRoot) {
  const run = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  const porcelain = run(["status", "--porcelain"]);
  return {
    head: run(["rev-parse", "HEAD"]).trim(),
    branch: run(["branch", "--show-current"]).trim(),
    porcelainLineCount: porcelain.split("\n").filter(Boolean).length,
    porcelainSha256: sha256(Buffer.from(porcelain)),
    porcelain, // full list kept in the run dir (not printed), so the initial dirty state is recorded exactly
  };
}

export function runPreflight(repoRoot) {
  const problems = [];
  const docDir = path.join(repoRoot, "docs/research/workout-plan-bpm");
  for (const f of REQUIRED_DOCS) if (!fs.existsSync(path.join(docDir, f))) problems.push({ code: "MISSING_REQUIRED_PATH", path: `docs/research/workout-plan-bpm/${f}` });
  for (const p of REQUIRED_PATHS) if (!fs.existsSync(path.join(repoRoot, p))) problems.push({ code: "MISSING_REQUIRED_PATH", path: p });
  const globCounts = REQUIRED_GLOBS.map((g) => {
    const dir = path.join(repoRoot, g.dir);
    const n = fs.readdirSync(dir).filter((f) => f.startsWith(g.prefix) && f.endsWith(g.suffix)).length;
    if (n === 0) problems.push({ code: "MISSING_REQUIRED_PATH", path: `${g.dir}/${g.prefix}*${g.suffix}` });
    return { glob: `${g.prefix}*${g.suffix}`, matches: n };
  });
  const docs = REQUIRED_DOCS.map((f) => {
    const p = path.join(docDir, f);
    const st = fs.statSync(p);
    return { relativePath: `docs/research/workout-plan-bpm/${f}`, sha256: sha256(fs.readFileSync(p)), bytes: st.size, mtime: st.mtime.toISOString(), role: f === "README.md" ? "supervisor-summary" : "design-document" };
  });
  return { problems, globCounts, docs, counts: problems.length ? null : countDefinitions(docDir), git: gitState(repoRoot) };
}
