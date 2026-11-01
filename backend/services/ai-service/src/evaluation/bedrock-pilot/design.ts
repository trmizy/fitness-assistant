import { z } from "zod";
import { ARMS, POLICY_VARIANTS } from "../ai-coach-dev/pipeline";
import { digest } from "../evaluation-kit/identity";
export const EvaluationDesignSchema = z.object({
  repeats: z.number().int().min(1).max(50),
  arms: z.array(z.enum(ARMS)).min(1).refine((v) => new Set(v).size === v.length),
  policies: z.array(z.enum(POLICY_VARIANTS)).min(1).refine((v) => new Set(v).size === v.length),
}).strict();
export type EvaluationDesign = z.infer<typeof EvaluationDesignSchema>;
export function attemptIdentity(value: unknown) {
  const metadata = z.object({ caseKey: z.string().regex(/^case-[a-z0-9-]+$/), arm: z.enum(ARMS), policy: z.enum(POLICY_VARIANTS), repeatIndex: z.number().int().min(0).max(49), configHash: z.string().regex(/^[a-f0-9]{64}$/), promptHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value);
  return digest(metadata);
}
