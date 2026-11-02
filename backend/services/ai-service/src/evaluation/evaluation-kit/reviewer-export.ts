/** Reviewer directory contains only allowlisted, sealed packets, never run metadata. */
import { z } from "zod";
import { digest } from "./identity";
import type { ReviewerPacket } from "./annotations";

const blockedKeys = /^(arm|policy|repeat|repeatIndex|expected.*|labels|gateDecision|postGate|verification|diagnostics|trace|retrievalTrace|ownerLinkage|attemptKey|configHash|promptHash|caseKey|split)$/i;
const armNames = /\b(?:FLAT_LAYOUT|LAYERED_CONTEXT_WRONG_EXCERPT|LAYERED_CONTEXT_PLACEBO|LAYERED_CONTEXT_RAG|LAYERED_CONTEXT|LAYERED|GROUNDED_OFFLINE|V2_BASELINE|FIVE_LAYER_ONLY|FIVE_LAYER_CONTEXT_RAG|FIVE_LAYER_CONTEXT)\b/;
function assertBlind(value: unknown): void {
  if (typeof value === "string" && (armNames.test(value) || ["MINIMAL", "FULL"].includes(value))) throw new Error("ReviewerTreatmentLeak");
  if (Array.isArray(value)) value.forEach(assertBlind);
  else if (value && typeof value === "object") for (const [key, v] of Object.entries(value)) {
    if (blockedKeys.test(key) || armNames.test(key) || ["MINIMAL", "FULL"].includes(key)) throw new Error("ReviewerTreatmentLeak");
    assertBlind(v);
  }
}
const ExportSchema = z.object({ version: z.literal("blind-review-v1"), opaqueId: z.string().uuid(), packetHash: z.string().regex(/^[a-f0-9]{64}$/), reviewerSlot: z.enum(["R1", "R2"]),
  body: z.object({ question: z.string(), facts: z.unknown(), evidence: z.array(z.unknown()), units: z.array(z.unknown()) }).strict(),
}).strict();
export function reviewerExport(packet: ReviewerPacket): { artifact: z.infer<typeof ExportSchema>; hash: string } {
  if (digest(packet.body) !== packet.packetHash) throw new Error("PacketIntegrityFailed");
  const b = packet.body;
  const artifact = ExportSchema.parse({ version: "blind-review-v1", opaqueId: b.instanceId, packetHash: packet.packetHash, reviewerSlot: packet.reviewerSlot,
    body: { question: b.question, facts: b.facts, evidence: b.evidence, units: b.units } });
  assertBlind(artifact.body);
  return { artifact, hash: digest(artifact) };
}
export function verifyReviewerExport(value: unknown, expectedHash: string) {
  const artifact = ExportSchema.parse(value); assertBlind(artifact.body);
  if (digest(artifact) !== expectedHash) throw new Error("ReviewerExportIntegrityFailed");
  return artifact;
}
