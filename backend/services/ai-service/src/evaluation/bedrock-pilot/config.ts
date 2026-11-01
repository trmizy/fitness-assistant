import { z } from "zod";
import path from "node:path";
import { digest } from "../evaluation-kit/identity";
import { EvaluationDesignSchema } from "./design";

export class PilotError extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown> = {}) { super(code); this.name = "PilotError"; }
}
export const Hash = z.string().regex(/^[a-f0-9]{64}$/).refine((s) => !/^0+$/.test(s), "PlaceholderHashForbidden");
export const ApprovalSchema = z.object({ approvalId: z.string().uuid(), issuer: z.string().min(1), approvedBy: z.string().min(1), scope: z.literal("BEDROCK_EVALUATION_PILOT"), configHash: Hash, expiresAt: z.string().datetime(), signature: z.string().min(1) }).strict();
export const SessionConfigSchema = z.object({
  mode: z.enum(["FAKE", "LIVE"]).default("FAKE"), liveOptIn: z.boolean().default(false),
  dataClass: z.literal("SYNTHETIC_EVALUATION_ONLY"), modelId: z.literal("amazon.nova-pro-v1:0"), inferenceProfile: z.string().min(1).nullable(), region: z.string().min(1), profileModelConfirmed: z.boolean(),
  design: EvaluationDesignSchema.optional(),
  parameters: z.object({ maxTokens: z.number().int().positive().max(5000), temperature: z.number().min(0.00001).max(1).optional(), topP: z.number().min(0).max(1).optional(), retries: z.literal(0), timeoutMs: z.number().int().min(1).max(300000) }).strict().refine((p) => !(p.temperature !== undefined && p.topP !== undefined), "Choose temperature or topP"),
  pins: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/).refine((s) => !/^0+$/.test(s)), code: Hash, corpus: Hash, cases: Hash, promptHashes: z.array(Hash) }).strict(),
  sources: z.object({ workspaceRoot: z.string().refine(path.isAbsolute), casesFile: z.string().refine(path.isAbsolute) }).strict().optional(),
  budget: z.object({ maxCalls: z.number().int().positive(), maxInputTokensPerCall: z.number().int().positive(), maxInputTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(), maxEstimatedUsd: z.number().finite().positive(), maxFailures: z.number().int().positive() }).strict(),
  pricing: z.object({ authority: z.enum(["FAKE_TEST_ONLY", "OWNER_CONFIRMED_AWS"]), sourceUrl: z.literal("https://aws.amazon.com/bedrock/pricing/"), tokenUnit: z.literal("USD_PER_MILLION_TOKENS"), version: z.string().min(1), checkedAt: z.string().datetime(), expiresAt: z.string().datetime(), modelId: z.string(), inferenceProfile: z.string().nullable(), region: z.string(), inputUsdPerMillion: z.number().finite().positive(), outputUsdPerMillion: z.number().finite().positive(), confirmedBy: z.string().min(1), evidenceHash: Hash }).strict(),
  approval: ApprovalSchema.nullable(),
}).strict();
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export function approvedConfigurationHash(c: SessionConfig) { const { approval: _approval, ...body } = c; return digest(body); }
export function parseConfiguration(value: unknown): SessionConfig {
  const parsed = SessionConfigSchema.safeParse(value);
  if (!parsed.success) throw new PilotError("CONFIG_INVALID", { paths: parsed.error.issues.map((i) => i.path.join(".")) });
  const c = parsed.data;
  assertCurrentAuthorization(c);
  return c;
}
export function assertCurrentAuthorization(c: SessionConfig) {
  const now = Date.now(), p = c.pricing;
  if (p.modelId !== c.modelId || p.inferenceProfile !== c.inferenceProfile || p.region !== c.region || Date.parse(p.expiresAt) <= now || Date.parse(p.checkedAt) > now || Date.parse(p.expiresAt) <= Date.parse(p.checkedAt)) throw new PilotError("PricingNotValid");
  if (c.mode === "LIVE" && (!c.liveOptIn || !c.profileModelConfirmed || p.authority !== "OWNER_CONFIRMED_AWS" || !c.approval || c.approval.configHash !== approvedConfigurationHash(c) || Date.parse(c.approval.expiresAt) <= now)) throw new PilotError("LiveNotApproved");
}
export function estimatedCost(c: SessionConfig, input: number, output: number) {
  const cost = Math.ceil((input * c.pricing.inputUsdPerMillion + output * c.pricing.outputUsdPerMillion) * 1000) / 1e9;
  if (!Number.isFinite(cost)) throw new PilotError("COST_NOT_FINITE");
  return cost;
}
