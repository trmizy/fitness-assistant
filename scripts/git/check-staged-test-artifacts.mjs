#!/usr/bin/env node
// Pre-commit check: refuse to commit test data (run outputs, rater sheets, screenshots, archives, personal photos,
// .md reports). .gitignore only stops NEW files; this also catches files that were tracked before the 2026-11-08 rules,
// so a modified run-output file cannot ride along in a commit either.
// Enable once per clone:  git config core.hooksPath .githooks
// One-off override:       ALLOW_TEST_ARTIFACTS=1 git commit ...
import { execSync } from "node:child_process";

export const BLOCKED = [
  [/^results\//, "run outputs (results/)"],
  [/^test\/(.+\/)?results\//, "test run outputs (test/**/results/)"],
  [/^test\/(.+\/)?human-review\//, "human rater sheets"],
  [/^test\/(.+\/)?screenshots(-[^/]*)?\//, "screenshots"],
  [/^test\/[^/]+\.(jpe?g|png)$/i, "photos in test/"],
  [/^test\/InBody[^/]*\//i, "personal InBody photos"],
  [/^test\/.+\.(rar|zip)$/i, "archives in test/"],
  [/^\.tmp-stack\//, "local test-stack state"],
  [/(^|\/)docs\//, "docs/ reports (kept local)"],
  [/\.md$/i, ".md reports (only README.md is pushed)"],
];
const ALLOWED = [/^README\.md$/i];

export function blockedReason(file) {
  if (ALLOWED.some((re) => re.test(file))) return null;
  for (const [re, why] of BLOCKED) if (re.test(file)) return why;
  return null;
}

function main() {
  if (process.env.ALLOW_TEST_ARTIFACTS === "1") return;
  // --diff-filter excludes deletions: removing a tracked artifact from git (git rm --cached) must stay possible
  const staged = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const hits = staged.map((f) => [f, blockedReason(f)]).filter(([, why]) => why);
  if (!hits.length) return;
  console.error("\n✖ Commit chặn: các file sau là dữ liệu test / báo cáo, không đưa lên GitHub:\n");
  for (const [f, why] of hits) console.error(`  - ${f}   (${why})`);
  console.error("\nBỏ chúng khỏi commit:  git restore --staged -- <file>");
  console.error("Nếu thật sự cần (một lần):  ALLOW_TEST_ARTIFACTS=1 git commit ...\n");
  process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) main();
