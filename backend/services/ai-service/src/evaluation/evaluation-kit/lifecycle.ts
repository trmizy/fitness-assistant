import { AnalysisEnvelopeSchema } from "../ai-coach-dev/pipeline";

/** ELIGIBLE is the existing wire name for a released DEV candidate, not scientific approval. */
export function outputLifecycle(status: "GENERATED" | "FAILED", decision: "ELIGIBLE" | "BLOCKED" | "FAILED", candidate: unknown) {
  if (status === "FAILED" && decision !== "FAILED") throw new Error("FailedGenerationCannotHaveGateDecision");
  if (status === "GENERATED" && !AnalysisEnvelopeSchema.safeParse(candidate).success) throw new Error("GeneratedCandidateContractMismatch");
  return { validGenerated: status === "GENERATED", released: status === "GENERATED" && decision === "ELIGIBLE",
    blocked: status === "GENERATED" && decision === "BLOCKED", failed: decision === "FAILED",
    generationFailed: status === "FAILED", postProcessingFailed: status === "GENERATED" && decision === "FAILED" };
}
