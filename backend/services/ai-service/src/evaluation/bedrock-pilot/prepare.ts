/** Produces frozen generation prompts only; never constructs a live session. */
import { ARMS, prepareDevSlice, type PolicyVariant, type Arm, type Prompt } from "../ai-coach-dev/pipeline";
import type { Passage } from "../ai-coach-dev/retrieval";
import type { V2Io } from "../../llm/retrieval-v2";
import { validateGenerationBundle } from "../evaluation-kit/annotations";
import { digest } from "../evaluation-kit/identity";
import { EvaluationDesignSchema, type EvaluationDesign } from "./design";
import { prepareClaimPilot } from "./claim-adapter";
import type { ClaimRegistry } from "../ai-coach-claim-dev/retrieval";
import type { ClaimContext } from "../ai-coach-claim-dev/context";
import type { AdvisoryInput } from "../advisory-progress/experiment";
type PreparedRow = { caseKey: string; arm: Arm; policy: PolicyVariant; repeatIndex: number; requestHash: string; promptHash: string; prompt: Prompt;
  verificationContext: { input: AdvisoryInput; evidence: { passages: Passage[] } }; claimContext?: ClaimContext;
  contextSize: { utf8Bytes: number; characters: number; modelInputTokens: null } };
export async function prepareReleasedPilot(released: unknown[], expectedManifests: unknown[], ownerReceiptHashes: string[], deps: { corpus: Passage[]; io: V2Io }, policy: PolicyVariant = "MINIMAL", design?: EvaluationDesign, claimRegistry?: ClaimRegistry) {
  if (!released.length || released.length !== expectedManifests.length || released.length !== ownerReceiptHashes.length) throw new Error("ReleasedCasePinsRequired");
  const bundles = released.map((b, i) => validateGenerationBundle(b, expectedManifests[i], ownerReceiptHashes[i]));
  if (new Set(bundles.map((b) => b.freeze.caseKey)).size !== bundles.length) throw new Error("DuplicateFrozenCase");
  const rows: PreparedRow[] = [], routed = [];
  const selected = EvaluationDesignSchema.parse(design ?? { repeats: 1, arms: [...ARMS], policies: [policy] });
  if (claimRegistry && (selected.arms.some(a => !["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"].includes(a)) || selected.policies.some(p => p !== "MINIMAL"))) throw new Error("UnsupportedClaimPilotDesign");
  for (const bundle of bundles) for (const policy of selected.policies) for (const arm of selected.arms) {
    const p = claimRegistry ? prepareClaimPilot(bundle.request, claimRegistry, arm, policy) : await prepareDevSlice(bundle.request, arm, deps, { policy });
    for (let repeatIndex = 0; repeatIndex < selected.repeats; repeatIndex++) {
    if (p.safetyHandling.action !== "NORMAL") { routed.push({ caseKey: bundle.freeze.caseKey, arm, policy, repeatIndex, disposition: p.safetyHandling }); continue; }
    rows.push({ caseKey: bundle.freeze.caseKey, arm, policy, repeatIndex, requestHash: bundle.freeze.requestHash, promptHash: digest({ system: p.prompt.system, user: p.prompt.user }), prompt: p.prompt, verificationContext: { input: p.input, evidence: p.evidence },
      ...("claimContext" in p ? { claimContext: p.claimContext } : {}),
      contextSize: { utf8Bytes: Buffer.byteLength(p.prompt.user, "utf8"), characters: [...p.prompt.user].length, modelInputTokens: null } });
    }
  }
  return { status: "PREPARED_NOT_EXECUTED", modelCalls: 0, pins: { cases: digest(expectedManifests), corpus: digest(deps.corpus), promptHashes: rows.map((r) => r.promptHash) }, rows, routed };
}
