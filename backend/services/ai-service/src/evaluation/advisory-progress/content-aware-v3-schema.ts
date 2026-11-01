/** Experimental output only. Does not alter the frozen V2 contract. */
import { z } from "zod";
import { AnswerSchema } from "./experiment";

export const CONTENT_V3_VERSION = "content-aware-v3";
export const ClaimTypeSchema = z.enum([
  "OBSERVATION", "GENERAL_PRINCIPLE", "MEASUREMENT_LIMITATION",
  "PERSONAL_HYPOTHESIS", "PERSONAL_RECOMMENDATION",
]);
export const MissingInformationV3Schema = AnswerSchema.shape.missingInformation.element;
const references = z.array(z.string().min(1).max(100)).max(32);
export const ClaimV3Schema = z.object({
  claimType: ClaimTypeSchema,
  text: z.string().min(1).max(1000),
  factIds: references,
  evidenceIds: references,
  needsConfirmation: z.boolean().optional(),
  missingToConfirm: z.array(MissingInformationV3Schema).max(4).optional(),
  deltaAssertion: z.object({ factId: z.string().min(1), unit: z.enum(["KG", "PERCENT"]), change: z.number().finite() }).strict().optional(),
  /** Copy an existing projection, never recompute the owning service's e1RM. */
  metricAssertion: z.object({
    factId: z.string().min(1),
    measurement: z.enum(["ESTIMATED_1RM", "DIRECT_1RM"]),
    baselineKg: z.number().finite(), currentKg: z.number().finite(), changePct: z.number().finite(),
  }).strict().optional(),
}).strict();

export const AnswerV3Schema = z.object({
  version: z.literal(CONTENT_V3_VERSION),
  assessment: AnswerSchema.shape.assessment,
  assessmentBasis: z.object({
    outcome: z.enum(["ESTIMATED_STRENGTH", "MUSCLE_SIZE", "UNSPECIFIED"]),
    factIds: references,
  }).strict(),
  claims: z.array(ClaimV3Schema).max(12),
  missingInformation: z.array(MissingInformationV3Schema).max(4),
  rationaleSummary: z.string().min(10).max(1000),
  proposedAction: z.null(),
}).strict().superRefine((answer, ctx) => {
  answer.claims.forEach((claim, i) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: ["claims", i, field], message });
    if (claim.claimType === "OBSERVATION" && !claim.factIds.length) issue("factIds", "observation_requires_personal_fact");
    if (claim.claimType === "GENERAL_PRINCIPLE") {
      if (!claim.evidenceIds.length) issue("evidenceIds", "principle_requires_source");
      if (claim.factIds.length) issue("factIds", "principle_must_not_assert_personal_application");
    }
    if (claim.claimType === "PERSONAL_HYPOTHESIS") {
      if (!claim.factIds.length) issue("factIds", "hypothesis_requires_personal_fact");
      if (!claim.evidenceIds.length) issue("evidenceIds", "hypothesis_requires_source");
      if (claim.needsConfirmation !== true) issue("needsConfirmation", "hypothesis_requires_confirmation");
      if (!claim.missingToConfirm?.length) issue("missingToConfirm", "hypothesis_requires_missing_information");
    }
    if (claim.metricAssertion && claim.claimType !== "OBSERVATION") issue("metricAssertion", "metric_assertion_requires_observation");
    if (claim.deltaAssertion && claim.claimType !== "OBSERVATION") issue("deltaAssertion", "delta_assertion_requires_observation");
    if (new Set(claim.factIds).size !== claim.factIds.length) issue("factIds", "duplicate_reference");
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length) issue("evidenceIds", "duplicate_reference");
  });
});
export type AnswerV3 = z.infer<typeof AnswerV3Schema>;
export type ClaimV3 = z.infer<typeof ClaimV3Schema>;
