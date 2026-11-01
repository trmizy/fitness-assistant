/** DEV fixture boundary. These snapshots are not real authenticated service reads. */
import { z } from "zod";
import type { Fact } from "../advisory-progress/experiment";

const FactSchema = z.object({
  id: z.string().regex(/^DEV_F_[A-Z0-9_]+$/),
  evidence: z.object({
    domain: z.enum(["BODY", "TRAINING", "NUTRITION"]), kind: z.string().min(1).max(100),
    value: z.record(z.union([z.number().finite(), z.string().max(300), z.boolean(), z.null()])),
    quality: z.enum(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]),
    provenance: z.enum(["MEASURED_INBODY", "TRAINING_LOGS", "NUTRITION_LOGS"]),
    window: z.object({ days: z.number().int().positive().max(365) }).strict().nullable(),
    claimBoundary: z.literal("DESCRIPTIVE_ONLY"),
  }).strict(),
}).strict();
export const DevRequestSchema = z.object({
  dataClass: z.literal("SYNTHETIC_DEV"), caseId: z.string().regex(/^dev-[a-z0-9-]+$/),
  subjectId: z.string().regex(/^synthetic-[a-z0-9-]+$/),
  question: z.string().min(1).max(3000),
  profile: z.object({ owner: z.literal("user-service"), goal: z.string().max(200).nullable() }).strict(),
  snapshots: z.array(z.object({
    subjectId: z.string(), namespace: z.enum(["MEASUREMENTS", "TRAINING", "NUTRITION"]),
    owner: z.literal("fitness-service"), recordedAt: z.string().datetime(), facts: z.array(FactSchema).max(20),
  }).strict()).max(3),
  conversation: z.array(z.object({ subjectId: z.string(), role: z.enum(["user", "assistant"]), text: z.string().max(2000) }).strict()).max(6),
}).strict().superRefine((r, ctx) => {
  const ids = new Set<string>(), namespaces = new Set<string>();
  for (const s of r.snapshots) {
    if (s.subjectId !== r.subjectId) ctx.addIssue({ code: "custom", message: "cross_subject_snapshot" });
    if (namespaces.has(s.namespace)) ctx.addIssue({ code: "custom", message: "duplicate_namespace" });
    namespaces.add(s.namespace);
    const [domain, provenance] = { MEASUREMENTS: ["BODY", "MEASURED_INBODY"], TRAINING: ["TRAINING", "TRAINING_LOGS"], NUTRITION: ["NUTRITION", "NUTRITION_LOGS"] }[s.namespace];
    for (const f of s.facts) {
      if (ids.has(f.id)) ctx.addIssue({ code: "custom", message: "duplicate_fact_id" });
      ids.add(f.id);
      if (f.evidence.domain !== domain || f.evidence.provenance !== provenance) ctx.addIssue({ code: "custom", message: "namespace_provenance_mismatch" });
    }
  }
  if (r.conversation.some((c) => c.subjectId !== r.subjectId)) ctx.addIssue({ code: "custom", message: "cross_subject_conversation" });
});
export type DevRequest = z.infer<typeof DevRequestSchema>;

export function buildDevContext(value: unknown) {
  const r = DevRequestSchema.parse(value); // parse creates a request-local copy
  const facts: Fact[] = r.snapshots.flatMap((s) => s.facts);
  return {
    request: r, facts,
    personal: {
      verification: "FIXTURE_SCHEMA_CHECKED_NOT_REAL_SERVICE_VERIFIED" as const,
      profile: r.profile,
      factProvenance: facts.map((f) => ({ factId: f.id, classification: ["NO_DATA", "STALE", "INSUFFICIENT_HISTORY"].includes(f.evidence.quality)
        ? "MISSING_OR_UNVERIFIED" : f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? "DERIVED_ESTIMATE"
        : f.evidence.kind === "DIRECT_1RM_CHANGE" || f.evidence.kind === "SCHEDULED_ADHERENCE" ? "DIRECT_LOG_OBSERVATION" : "OWNER_PROJECTION_METHOD_NOT_VALIDATED" })),
      namespaces: r.snapshots.map((s) => ({ namespace: s.namespace, owner: s.owner, recordedAt: s.recordedAt, factIds: s.facts.map((f) => f.id) })),
      conversation: { trust: "UNVERIFIED_STATEMENTS_NOT_PERSONAL_FACTS", messages: r.conversation.map(({ subjectId: _subject, ...c }) => c) },
      absentNamespaces: ["MEASUREMENTS", "TRAINING", "NUTRITION"].filter((ns) => !r.snapshots.some((s) => s.namespace === ns && s.facts.length)),
      notAssessedByThisSlice: ["sleep", "recovery", "program_load_history", "measurement_protocol"],
    },
  };
}
