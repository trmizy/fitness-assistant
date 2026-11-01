/** Offline CLI. No --live option, provider configuration or model dependency. */
import fs from "node:fs";
import path from "node:path";
import { EvidencePackSchema } from "./experiment";
import { scenarios } from "./scenarios";
import { prepareSourceAblations, prepareSyntheticDependencies } from "./source-ablation-v3";
import { reviewFrozenV2Content } from "./frozen-v2-integrity";

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !arg.startsWith("--artifact-dir="))) throw new Error("OfflineOnly_ExpectedOptionalArtifactDir");
  if (args.length > 1) throw new Error("DuplicateArgument");
  const root = [process.cwd(), path.resolve(process.cwd(), "../../..")].find((p) => fs.existsSync(path.join(p, "data/eval/advisory-progress-dev/evidence-pack.json")));
  if (!root) throw new Error("RepositoryDataNotFound");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(root, "data/eval/advisory-progress-dev", name), "utf8"));
  const pack = EvidencePackSchema.parse(read("evidence-pack.json"));
  const input = scenarios(pack.sources).find((s) => s.id === "strength-increasing")!.input;
  const ablations = prepareSourceAblations(read("source-ablation-review-protocol.json"), input, pack, read("evidence-claim-map-v2.json"));
  const synthetic = prepareSyntheticDependencies(read("source-ablation-review-protocol.json"));
  const review = reviewFrozenV2Content(root, args[0]?.slice("--artifact-dir=".length));
  console.log(JSON.stringify({ status: "OFFLINE_PREPARATION_NOT_MODEL_VALIDATION", modelCalls: 0, ablationInputs: ablations.length, syntheticInputs: synthetic.length,
    modelGroundingUnderAblation: "NOT_RUN", independentScientificValidation: "NOT_RUN", frozenIntegrity: review.integrity,
    legacyReview: { rows: review.rows.length, blocked: review.rows.filter((r) => r.contentGate === "BLOCKED").map((r) => `${r.id}:${r.variant}`),
      flagged: review.rows.filter((r) => r.contentGate === "FLAGGED_FOR_REVIEW").length,
      noRuleMatchNotContentPass: review.rows.filter((r) => r.contentGate === "NO_RULE_MATCH_NOT_CONTENT_PASS").length } }, null, 2));
  if (review.integrity.status === "INTEGRITY_MISMATCH") process.exitCode = 1;
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "OfflinePreparationError"); process.exitCode = 1; }
