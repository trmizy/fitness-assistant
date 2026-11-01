import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import { digest } from "../evaluation-kit/identity";
import { createFixtureIo, prepareCorpus } from "../ai-coach-dev/retrieval";
import { prepareReleasedPilot } from "./prepare";
import { approvedConfigurationHash, PilotError, type SessionConfig } from "./config";
import type { EvaluationDesign } from "./design";

export const implementationRoot = path.resolve(__dirname, "../../../../../..");
export const CORPUS_FILES = ["data/eval/advisory-progress-dev/evidence-pack.json", "data/eval/advisory-progress-dev/evidence-claim-map-v2.json", "data/eval/ai-coach-dev/corpus-supplement.json", "data/eval/ai-coach-dev/source-registry.json"];
const ReleasedFileSchema = z.object({ version: z.literal("released-pilot-input-v1"), scope: z.literal("OWNER_REVIEWED_NON_SAFETY_CASES_ONLY"), released: z.array(z.unknown()).min(1), expectedManifests: z.array(z.unknown()).min(1), ownerReceiptHashes: z.array(z.string()).min(1) }).strict();
function git(root: string, args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim(); }
export function assertCleanWorkingTree(root: string) {
  if (git(root, ["status", "--porcelain", "--untracked-files=all"])) throw new PilotError("WORKING_TREE_DIRTY");
}
function bytes(file: string) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function snapshot(rootValue: string, casesFile: string) {
  const root = fs.realpathSync(rootValue);
  if (path.resolve(git(root, ["rev-parse", "--show-toplevel"])).toLowerCase() !== path.resolve(root).toLowerCase()) throw new PilotError("WORKSPACE_ROOT_MISMATCH");
  const files = git(root, ["ls-files", "-z", "--", "backend/services/ai-service", "backend/tsconfig.base.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json"]).split("\0").filter(Boolean).sort();
  if (!files.some((f) => f.endsWith(".ts"))) throw new PilotError("CODE_SOURCES_MISSING");
  return { commit: git(root, ["rev-parse", "HEAD"]), dirty: git(root, ["status", "--porcelain", "--untracked-files=all"]).length > 0,
    code: digest(files.map((f) => [f, bytes(path.join(root, f))])), corpus: digest(CORPUS_FILES.map((f) => [f, bytes(path.join(root, f))])), cases: bytes(casesFile) };
}
export async function loadPilotPreparation(root: string, casesFile: string, design?: EvaluationDesign) {
  const input = ReleasedFileSchema.parse(JSON.parse(fs.readFileSync(casesFile, "utf8")));
  const read = (i: number) => JSON.parse(fs.readFileSync(path.join(root, CORPUS_FILES[i]), "utf8"));
  const corpus = prepareCorpus(read(0), read(1), read(2));
  const preparation = await prepareReleasedPilot(input.released, input.expectedManifests, input.ownerReceiptHashes, { corpus, io: createFixtureIo(corpus).io }, "MINIMAL", design);
  return preparation;
}
export async function calculatePilotPins(root: string, casesFile: string, design?: EvaluationDesign) {
  const before = snapshot(root, casesFile), preparation = await loadPilotPreparation(root, casesFile, design), after = snapshot(root, casesFile);
  if (digest(before) !== digest(after)) throw new PilotError("INPUTS_CHANGED_DURING_PREPARATION");
  return { preparation, dirty: after.dirty, pins: { commit: after.commit, code: after.code, corpus: after.corpus, cases: after.cases, promptHashes: preparation.rows.map((r) => r.promptHash) } };
}
export interface VerifiedPins { readonly status: "VERIFIED_FROM_FILES" }
const verified = new WeakMap<VerifiedPins, { configHash: string; pins: SessionConfig["pins"]; sources: NonNullable<SessionConfig["sources"]>; strict: boolean }>();
function match(actual: unknown, expected: unknown, field: string) {
  if (digest(actual) !== digest(expected)) throw new PilotError("PIN_MISMATCH", { field });
}
export async function verifySessionPins(config: SessionConfig): Promise<VerifiedPins> {
  if (!config.sources) throw new PilotError("PIN_SOURCES_REQUIRED");
  if (config.mode === "LIVE" && fs.realpathSync(config.sources.workspaceRoot).toLowerCase() !== fs.realpathSync(implementationRoot).toLowerCase()) throw new PilotError("LOADED_IMPLEMENTATION_ROOT_MISMATCH");
  const result = await calculatePilotPins(config.sources.workspaceRoot, config.sources.casesFile, config.design);
  if (config.mode === "LIVE") assertCleanWorkingTree(config.sources.workspaceRoot);
  for (const key of ["commit", "code", "corpus", "cases", "promptHashes"] as const) match(result.pins[key], config.pins[key], key);
  const receipt: VerifiedPins = Object.freeze({ status: "VERIFIED_FROM_FILES" });
  verified.set(receipt, { configHash: approvedConfigurationHash(config), pins: structuredClone(result.pins), sources: structuredClone(config.sources), strict: config.mode === "LIVE" });
  return receipt;
}
export function assertVerifiedPins(config: SessionConfig, receipt?: VerifiedPins) {
  const value = receipt && verified.get(receipt);
  if (!value) throw new PilotError("VERIFIED_INPUTS_REQUIRED");
  match(approvedConfigurationHash(config), value.configHash, "configHash");
  const now = snapshot(value.sources.workspaceRoot, value.sources.casesFile);
  if (value.strict) assertCleanWorkingTree(value.sources.workspaceRoot);
  for (const key of ["commit", "code", "corpus", "cases"] as const) match(now[key], value.pins[key], key);
  match(config.pins.promptHashes, value.pins.promptHashes, "promptHashes");
}
