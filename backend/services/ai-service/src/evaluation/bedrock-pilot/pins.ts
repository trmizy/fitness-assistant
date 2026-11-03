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
import { loadConfiguredClaimRegistry, readConfiguredClaimInputs } from "../../knowledge/scientific-claim-map-v3/load";
import { IntakeFakeFileSchema } from "../case-intake/converter";
import { validateIntakeAdmission } from "../case-intake/admission";

export const implementationRoot = path.resolve(__dirname, "../../../../../..");
export const CORPUS_FILES = ["data/eval/advisory-progress-dev/evidence-pack.json", "data/eval/advisory-progress-dev/evidence-claim-map-v2.json", "data/eval/ai-coach-dev/corpus-supplement.json", "data/eval/ai-coach-dev/source-registry.json"];
const ReleasedFileSchema = z.union([z.object({ version: z.literal("released-pilot-input-v1"), scope: z.literal("OWNER_REVIEWED_NON_SAFETY_CASES_ONLY"), released: z.array(z.unknown()).min(1), expectedManifests: z.array(z.unknown()).min(1), ownerReceiptHashes: z.array(z.string()).min(1) }).strict(), IntakeFakeFileSchema]);
function git(root: string, args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim(); }
export function assertCleanWorkingTree(root: string) {
  if (git(root, ["status", "--porcelain", "--untracked-files=all"])) throw new PilotError("WORKING_TREE_DIRTY");
}
function bytes(file: string) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
type ClaimSources = Pick<NonNullable<SessionConfig["sources"]>, "claimRegistryConfigFile" | "protocolDecisionsFile" | "intakeSidecarFile">;
function claimSnapshot(sources?: ClaimSources) {
  if (!sources?.claimRegistryConfigFile) return null;
  const { config } = readConfiguredClaimInputs(sources.claimRegistryConfigFile);
  return { adapter: "claim-pilot-v1", config: bytes(sources.claimRegistryConfigFile), bundle: bytes(config.inputBundleFile),
    map: bytes(config.claimMapFile), currentOwner: bytes(config.currentOwnerDecisionsFile),
    protocolDecisions: sources.protocolDecisionsFile ? bytes(sources.protocolDecisionsFile) : null,
    ...(sources.intakeSidecarFile ? {intakeSidecar:bytes(sources.intakeSidecarFile)} : {}) };
}
function snapshot(rootValue: string, casesFile: string, claimSources?: ClaimSources) {
  const root = fs.realpathSync(rootValue);
  if (path.resolve(git(root, ["rev-parse", "--show-toplevel"])).toLowerCase() !== path.resolve(root).toLowerCase()) throw new PilotError("WORKSPACE_ROOT_MISMATCH");
  const files = git(root, ["ls-files", "-z", "--", "backend/services/ai-service", "backend/tsconfig.base.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json"]).split("\0").filter(Boolean).sort();
  if (!files.some((f) => f.endsWith(".ts"))) throw new PilotError("CODE_SOURCES_MISSING");
  const claims = claimSnapshot(claimSources);
  // E2 pins include the executing adapter, including new uncommitted TS files in FAKE development.
  const execution = claims ? git(implementationRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "backend/services/ai-service/src", "backend/services/ai-service/package.json"]).split("\0").filter(Boolean).sort().map(f => [f, bytes(path.join(implementationRoot, f))]) : null;
  return { commit: git(root, ["rev-parse", "HEAD"]), dirty: git(root, ["status", "--porcelain", "--untracked-files=all"]).length > 0,
    code: claims ? digest({ workspace: files.map(f => [f, bytes(path.join(root, f))]), execution }) : digest(files.map((f) => [f, bytes(path.join(root, f))])),
    corpus: claims ? digest(claims) : digest(CORPUS_FILES.map((f) => [f, bytes(path.join(root, f))])), cases: bytes(casesFile) };
}
export async function loadPilotPreparation(root: string, casesFile: string, design?: EvaluationDesign, claimSources?: ClaimSources) {
  const input = ReleasedFileSchema.parse(JSON.parse(fs.readFileSync(casesFile, "utf8")));
  if (input.version === "released-intake-fake-input-v1" && !claimSources?.claimRegistryConfigFile) throw new PilotError("INTAKE_REQUIRES_CLAIM_REGISTRY");
  if (input.version === "released-intake-fake-input-v1") {
    if(!claimSources?.intakeSidecarFile)throw new PilotError("INTAKE_PRIVATE_SIDECAR_REQUIRED");
    validateIntakeAdmission(input,JSON.parse(fs.readFileSync(claimSources.intakeSidecarFile,"utf8")));
  }
  if (claimSources?.claimRegistryConfigFile) {
    const { registry } = loadConfiguredClaimRegistry(claimSources.claimRegistryConfigFile);
    // No legacy corpus/vector IO is read or called by the claim arm.
    const io = { embed: async () => { throw new Error("LegacyRetrievalForbiddenInClaimPilot"); }, search: async () => { throw new Error("LegacyRetrievalForbiddenInClaimPilot"); }, toDoc: () => { throw new Error("LegacyRetrievalForbiddenInClaimPilot"); } };
    return prepareReleasedPilot(input.released, input.expectedManifests, input.ownerReceiptHashes, { corpus: [], io }, "MINIMAL", design, registry);
  }
  const read = (i: number) => JSON.parse(fs.readFileSync(path.join(root, CORPUS_FILES[i]), "utf8"));
  const corpus = prepareCorpus(read(0), read(1), read(2));
  const preparation = await prepareReleasedPilot(input.released, input.expectedManifests, input.ownerReceiptHashes, { corpus, io: createFixtureIo(corpus).io }, "MINIMAL", design);
  return preparation;
}
export async function calculatePilotPins(root: string, casesFile: string, design?: EvaluationDesign, claimSources?: ClaimSources) {
  const before = snapshot(root, casesFile, claimSources), preparation = await loadPilotPreparation(root, casesFile, design, claimSources), after = snapshot(root, casesFile, claimSources);
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
  // Intake confirmation is not an independent review or LIVE release. Keep this new input scope FAKE-only.
  if (JSON.parse(fs.readFileSync(config.sources.casesFile, "utf8")).version === "released-intake-fake-input-v1") {
    if (config.mode !== "FAKE") throw new PilotError("INTAKE_INPUT_FAKE_ONLY");
    if (config.outputContract !== "CLAIM_MAP_V3" || config.reviewerMode !== "OWNER_ONLY_EXPLORATORY") throw new PilotError("INTAKE_REQUIRES_CLAIM_CONTRACT_AND_OWNER_ONLY");
  }
  if (config.mode === "LIVE" && fs.realpathSync(config.sources.workspaceRoot).toLowerCase() !== fs.realpathSync(implementationRoot).toLowerCase()) throw new PilotError("LOADED_IMPLEMENTATION_ROOT_MISMATCH");
  if ((config.outputContract === "CLAIM_MAP_V3") !== !!config.sources.claimRegistryConfigFile) throw new PilotError("ClaimContractSourcesRequired");
  const result = await calculatePilotPins(config.sources.workspaceRoot, config.sources.casesFile, config.design, config.sources);
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
  const now = snapshot(value.sources.workspaceRoot, value.sources.casesFile, value.sources);
  if (value.strict) assertCleanWorkingTree(value.sources.workspaceRoot);
  for (const key of ["commit", "code", "corpus", "cases"] as const) match(now[key], value.pins[key], key);
  match(config.pins.promptHashes, value.pins.promptHashes, "promptHashes");
}
