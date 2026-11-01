import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { freezeReviewerCase, releaseGenerationBundle } from "../../evaluation/evaluation-kit/annotations";
import { devCases } from "../../evaluation/ai-coach-dev/fixtures";
import { CORPUS_FILES, implementationRoot } from "../../evaluation/bedrock-pilot/pins";
import { digest } from "../../evaluation/evaluation-kit/identity";
export function fixturePilotInput(request = devCases()[0].request, caseKey = "case-pilot-fixture") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-pilot-input-"));
  for (const file of CORPUS_FILES) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(implementationRoot, file), target); }
  fs.mkdirSync(path.join(root, "backend/services/ai-service/src"), { recursive: true });
  fs.writeFileSync(path.join(root, "backend/services/ai-service/src/fixture.ts"), "// TEST FIXTURE CODE ONLY\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "private/\npublic/\ncases.json\nrun/\nledger/\n");
  const c = { version: "reviewer-case-v1", caseKey, split: "REVIEWED_DEV", author: { pseudonym: "FIXTURE_NOT_INDEPENDENT", role: "INDEPENDENT_REVIEWER", independenceAttested: true }, request,
    labels: { expectedOutcomeScope: ["ESTIMATED_STRENGTH"], expectedAssessment: "NO_OBSERVED_CHANGE", referenceSupport: [], safety: "NORMAL", appropriateAbstention: false, rationale: "PRIVATE_GOLD_FIXTURE_MUST_NOT_LEAK" } };
  const manifest = freezeReviewerCase(c, path.join(root, "public"), path.join(root, "private"));
  const sealed = JSON.parse(fs.readFileSync(path.join(root, "private/" + caseKey + ".json"), "utf8"));
  const receipt = { ownerPseudonym: "TEST_OWNER", manifestHash: digest(manifest), purpose: "CONTROLLED_EVALUATION", releaseHeldOut: false, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const bundle = releaseGenerationBundle(sealed, manifest, receipt), casesFile = path.join(root, "cases.json");
  fs.writeFileSync(casesFile, JSON.stringify({ version: "released-pilot-input-v1", scope: "OWNER_REVIEWED_NON_SAFETY_CASES_ONLY", released: [bundle], expectedManifests: [manifest], ownerReceiptHashes: [digest(receipt)] }));
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "pipe" });
  git(["init", "-q"]); git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "TEST FIXTURE"]);
  return { root, casesFile, request };
}
