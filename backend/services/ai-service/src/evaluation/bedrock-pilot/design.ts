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
/**
 * Nova V4 warmup inference order (owner engineering decision E3_NOVA_V4_SCHEDULE_INTERLEAVE_APPROVED_FOR_IMPLEMENTATION_ONLY).
 * With A/B = the two released cases in prepared order: repeat 0 = A/Context, B/RAG, A/RAG, B/Context; repeat 1 = the same
 * four in reverse. A pure reordering of the existing 8 rows (each case × arm exactly once per repeat): nothing is added,
 * dropped or retried, and rows/attempt identities are untouched. Any other design shape is refused.
 */
export function interleaveNovaWarmupRows<T extends { caseKey: string; arm: string; policy: string; repeatIndex: number }>(rows: readonly T[]): T[] {
  const cases = [...new Set(rows.map((r) => r.caseKey))];
  if (rows.length !== 8 || cases.length !== 2 || rows.some((r) => !["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"].includes(r.arm) || r.policy !== "MINIMAL" || ![0, 1].includes(r.repeatIndex))) throw new Error("NOVA_INTERLEAVE_SHAPE");
  const [a, b] = cases, repeat0 = [[a, "LAYERED_CONTEXT"], [b, "LAYERED_CONTEXT_RAG"], [a, "LAYERED_CONTEXT_RAG"], [b, "LAYERED_CONTEXT"]] as const;
  const order = [...repeat0.map(([caseKey, arm]) => ({ caseKey, arm, repeatIndex: 0 })), ...[...repeat0].reverse().map(([caseKey, arm]) => ({ caseKey, arm, repeatIndex: 1 }))];
  return order.map((o) => {
    const match = rows.filter((r) => r.caseKey === o.caseKey && r.arm === o.arm && r.repeatIndex === o.repeatIndex);
    if (match.length !== 1) throw new Error("NOVA_INTERLEAVE_SHAPE");
    return match[0];
  });
}
