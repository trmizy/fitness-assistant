/** Produces frozen generation prompts only; never constructs a live session. */
import { ARMS, prepareDevSlice, type PolicyVariant } from "../ai-coach-dev/pipeline";
import type { Passage } from "../ai-coach-dev/retrieval";
import type { V2Io } from "../../llm/retrieval-v2";
import { validateGenerationBundle } from "../evaluation-kit/annotations";
import { digest } from "../evaluation-kit/identity";
export async function prepareReleasedPilot(released: unknown[], expectedManifests: unknown[], ownerReceiptHashes: string[], deps: { corpus: Passage[]; io: V2Io }, policy: PolicyVariant = "MINIMAL") {
  if (!released.length || released.length !== expectedManifests.length || released.length !== ownerReceiptHashes.length) throw new Error("ReleasedCasePinsRequired");
  const bundles = released.map((b, i) => validateGenerationBundle(b, expectedManifests[i], ownerReceiptHashes[i]));
  if (new Set(bundles.map((b) => b.freeze.caseKey)).size !== bundles.length) throw new Error("DuplicateFrozenCase");
  const rows = [], routed = [];
  for (const bundle of bundles) for (const arm of ARMS) {
    const p = await prepareDevSlice(bundle.request, arm, deps, { policy });
    if (p.safetyHandling.action !== "NORMAL") { routed.push({ caseKey: bundle.freeze.caseKey, arm, disposition: p.safetyHandling }); continue; }
    rows.push({ caseKey: bundle.freeze.caseKey, arm, policy, requestHash: bundle.freeze.requestHash, promptHash: digest({ system: p.prompt.system, user: p.prompt.user }), prompt: p.prompt, verificationContext: { input: p.input, evidence: p.evidence },
      contextSize: { utf8Bytes: Buffer.byteLength(p.prompt.user, "utf8"), characters: [...p.prompt.user].length, modelInputTokens: null } });
  }
  return { status: "PREPARED_NOT_EXECUTED", modelCalls: 0, pins: { cases: digest(expectedManifests), corpus: digest(deps.corpus), promptHashes: rows.map((r) => r.promptHash) }, rows, routed };
}
