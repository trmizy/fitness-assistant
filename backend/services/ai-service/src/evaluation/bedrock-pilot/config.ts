import { z } from "zod";
import path from "node:path";
import { digest } from "../evaluation-kit/identity";
import { EvaluationDesignSchema } from "./design";

export class PilotError extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown> = {}) { super(code); this.name = "PilotError"; }
}
export const Hash = z.string().regex(/^[a-f0-9]{64}$/).refine((s) => !/^0+$/.test(s), "PlaceholderHashForbidden");
export const ApprovalSchema = z.object({ approvalId: z.string().uuid(), issuer: z.string().min(1), approvedBy: z.string().min(1), scope: z.literal("BEDROCK_EVALUATION_PILOT"), configHash: Hash, expiresAt: z.string().datetime(), signature: z.string().min(1) }).strict();
/** Owner acknowledgements recorded inside the signed configuration; PENDING_OWNER keeps Nova LIVE blocked. */
export const NOVA_ACCEPTED = { pricing: "PUBLIC_PLANNING_RATES_ACCEPTED_NOT_INVOICE", retentionLogging: "SYNTHETIC_ONLY_INVOCATION_LOGGING_OFF_NO_NEW_TRAIL_ACCEPTED" } as const;
export const NOVA_APPROVAL_MAX_LIFETIME_MS = 72 * 3600 * 1000;
export const NOVA_TWO_PHASE = "MEASURE_THEN_OWNER_RELEASE" as const;
// Signed Nova execution scope: the exact owner-approved token-bearing payloads, call counts and AWS profile.
// Absent = no Nova LIVE (default locked). A named shared-config profile may be an STS role profile.
export const NovaScopeSchema = z.object({
  tokenPayloadHashes: z.array(Hash).min(1).max(4).refine((a) => new Set(a).size === a.length, "DuplicatePayloadHash"),
  measureCalls: z.number().int().min(1).max(4), inferenceCalls: z.number().int().min(1).max(8),
  awsProfile: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).refine((p) => p !== "default", "DefaultProfileForbidden"),
  ownerAcknowledgements: z.object({ pricing: z.enum(["PENDING_OWNER", NOVA_ACCEPTED.pricing]), retentionLogging: z.enum(["PENDING_OWNER", NOVA_ACCEPTED.retentionLogging]) }).strict(),
  // Two-phase LIVE (owner decision E3_NOVA_V4_1_TWO_PHASE_OPTION_A): a measure-only run, then inference only after a
  // separate owner-signed inference release bound to the recorded measurements. Absent = historical one-shot run.
  phases: z.literal(NOVA_TWO_PHASE).optional(),
}).strict();
export const SessionConfigSchema = z.object({
  mode: z.enum(["FAKE", "LIVE"]).default("FAKE"), liveOptIn: z.boolean().default(false),
  dataClass: z.literal("SYNTHETIC_EVALUATION_ONLY"), modelId: z.enum(["amazon.nova-pro-v1:0", "anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-haiku-4-5"]), inferenceProfile: z.string().min(1).nullable(), region: z.string().min(1), profileModelConfirmed: z.boolean(),
  transportProtocol: z.enum(["MANTLE_MESSAGES", "NOVA_CONVERSE_MEASURED"]).optional(),
  // Model-facing claim prompt projection; absent = CLAIM_PROMPT_V1 (historical E2/E3 prompts stay byte-identical).
  promptVersion: z.enum(["CLAIM_PROMPT_V1", "CLAIM_PROMPT_V2", "CLAIM_PROMPT_V3", "CLAIM_PROMPT_V4", "CLAIM_PROMPT_V4_1"]).optional(),
  outputContract: z.enum(["LEGACY_V3", "CLAIM_MAP_V3"]).optional(),
  reviewerMode: z.enum(["TWO_RATER", "OWNER_ONLY_EXPLORATORY"]).optional(),
  design: EvaluationDesignSchema.optional(),
  parameters: z.object({ maxTokens: z.number().int().positive().max(5000), temperature: z.number().min(0.00001).max(1).optional(), topP: z.number().min(0).max(1).optional(), retries: z.literal(0), timeoutMs: z.number().int().min(1).max(300000) }).strict().refine((p) => !(p.temperature !== undefined && p.topP !== undefined), "Choose temperature or topP"),
  pins: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/).refine((s) => !/^0+$/.test(s)), code: Hash, corpus: Hash, cases: Hash, promptHashes: z.array(Hash) }).strict(),
  sources: z.object({ workspaceRoot: z.string().refine(path.isAbsolute), casesFile: z.string().refine(path.isAbsolute), claimRegistryConfigFile: z.string().refine(path.isAbsolute).optional(), protocolDecisionsFile: z.string().refine(path.isAbsolute).optional(), intakeSidecarFile: z.string().refine(path.isAbsolute).optional() }).strict().optional(),
  budget: z.object({ maxCalls: z.number().int().positive(), maxInputTokensPerCall: z.number().int().positive(), maxInputTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(), maxEstimatedUsd: z.number().finite().positive(), maxFailures: z.number().int().positive() }).strict(),
  pricing: z.object({ authority: z.enum(["FAKE_TEST_ONLY", "OWNER_CONFIRMED_AWS"]), sourceUrl: z.literal("https://aws.amazon.com/bedrock/pricing/"), tokenUnit: z.literal("USD_PER_MILLION_TOKENS"), version: z.string().min(1), checkedAt: z.string().datetime(), expiresAt: z.string().datetime(), modelId: z.string(), inferenceProfile: z.string().nullable(), region: z.string(), inputUsdPerMillion: z.number().finite().positive(), outputUsdPerMillion: z.number().finite().positive(), confirmedBy: z.string().min(1), evidenceHash: Hash }).strict(),
  approval: ApprovalSchema.nullable(),
  novaScope: NovaScopeSchema.optional(),
}).strict();
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export function approvedConfigurationHash(c: SessionConfig) { const { approval: _approval, ...body } = c; return digest(body); }
export function parseConfiguration(value: unknown): SessionConfig {
  const parsed = SessionConfigSchema.safeParse(value);
  if (!parsed.success) throw new PilotError("CONFIG_INVALID", { paths: parsed.error.issues.map((i) => i.path.join(".")) });
  const c = parsed.data;
  if ((c.outputContract === "CLAIM_MAP_V3") !== !!c.sources?.claimRegistryConfigFile) throw new PilotError("ClaimContractSourcesRequired");
  if (c.promptVersion && c.outputContract !== "CLAIM_MAP_V3") throw new PilotError("PROMPT_VERSION_REQUIRES_CLAIM_CONTRACT");
  assertCurrentAuthorization(c);
  return c;
}
export function assertCurrentAuthorization(c: SessionConfig) {
  const now = Date.now();
  if (c.novaScope && c.transportProtocol !== "NOVA_CONVERSE_MEASURED") throw new PilotError("NOVA_SCOPE_PROTOCOL_MISMATCH");
  if (c.promptVersion === "CLAIM_PROMPT_V3" && c.transportProtocol !== "NOVA_CONVERSE_MEASURED") throw new PilotError("NOVA_V3_PROMPT_ONLY");
  if (c.promptVersion === "CLAIM_PROMPT_V4" && c.transportProtocol !== "NOVA_CONVERSE_MEASURED") throw new PilotError("NOVA_V4_PROMPT_ONLY");
  if (c.promptVersion === "CLAIM_PROMPT_V4_1" && c.transportProtocol !== "NOVA_CONVERSE_MEASURED") throw new PilotError("NOVA_V4_1_PROMPT_ONLY");
  if (c.transportProtocol === "MANTLE_MESSAGES" || c.modelId === "anthropic.claude-haiku-4-5") {
    if (c.mode !== "FAKE" || c.liveOptIn) throw new PilotError("MANTLE_LIVE_LOCKED");
    if (c.transportProtocol !== "MANTLE_MESSAGES" || c.modelId !== "anthropic.claude-haiku-4-5" || c.region !== "us-east-2" || c.inferenceProfile !== null) throw new PilotError("MANTLE_TARGET_MISMATCH");
    if (c.outputContract !== "CLAIM_MAP_V3" || c.reviewerMode !== "OWNER_ONLY_EXPLORATORY" || c.pricing.authority !== "FAKE_TEST_ONLY" || c.approval !== null) throw new PilotError("MANTLE_FAKE_CLAIM_SCOPE_REQUIRED");
    const b = c.budget, d = c.design;
    if (c.parameters.maxTokens > 2048 || b.maxCalls > 8 || b.maxInputTokensPerCall > 12000 || b.maxInputTokens > 96000 || b.maxOutputTokens > 16384 || b.maxEstimatedUsd > 1 || b.maxFailures > 2 || !d || d.repeats !== 2 || d.arms.length !== 2 || !d.arms.includes("LAYERED_CONTEXT") || !d.arms.includes("LAYERED_CONTEXT_RAG") || d.policies.length !== 1 || d.policies[0] !== "MINIMAL") throw new PilotError("MANTLE_WARMUP_LIMIT_EXCEEDED");
  }
  if (c.transportProtocol === "NOVA_CONVERSE_MEASURED") {
    // FAKE can never opt in. LIVE parses only with the full signed-approval conditions checked below; the session
    // still stops it with NOVA_LIVE_LOCKED after the trust/ledger gates.
    if (c.mode === "FAKE" && c.liveOptIn) throw new PilotError("NOVA_LIVE_LOCKED");
    if (c.modelId !== "amazon.nova-pro-v1:0" || c.region !== "us-east-1" || c.inferenceProfile !== null) throw new PilotError("NOVA_TARGET_MISMATCH");
    // Explicit V2/V3/V4 remain available for historical replay; each version requires its own pins and approval, never fallback.
    if (c.promptVersion !== "CLAIM_PROMPT_V2" && c.promptVersion !== "CLAIM_PROMPT_V3" && c.promptVersion !== "CLAIM_PROMPT_V4" && c.promptVersion !== "CLAIM_PROMPT_V4_1") throw new PilotError("NOVA_PROMPT_VERSION_REQUIRED");
    if (c.outputContract !== "CLAIM_MAP_V3" || c.reviewerMode !== "OWNER_ONLY_EXPLORATORY") throw new PilotError("NOVA_CLAIM_SCOPE_REQUIRED");
    if (c.mode === "FAKE" && (c.pricing.authority !== "FAKE_TEST_ONLY" || c.approval !== null)) throw new PilotError("NOVA_FAKE_CLAIM_SCOPE_REQUIRED");
    if (c.mode === "LIVE" && (!c.sources?.claimRegistryConfigFile || c.parameters.retries !== 0)) throw new PilotError("NOVA_LIVE_SCOPE_REQUIRED");
    // 8 inference calls plus at most 4 billed measured preflights (one per unique prompt, maxTokens=1), each <=12,000 input.
    const b = c.budget, d = c.design;
    if (c.parameters.maxTokens > 2048 || b.maxCalls > 8 || b.maxInputTokensPerCall > 12000 || b.maxInputTokens > 144000 || b.maxOutputTokens > 16388 || b.maxEstimatedUsd > 1 || b.maxFailures > 2 || !d || d.repeats !== 2 || d.arms.length !== 2 || !d.arms.includes("LAYERED_CONTEXT") || !d.arms.includes("LAYERED_CONTEXT_RAG") || d.policies.length !== 1 || d.policies[0] !== "MINIMAL") throw new PilotError("NOVA_WARMUP_LIMIT_EXCEEDED");
    const s = c.novaScope;
    if (s && (s.measureCalls !== s.tokenPayloadHashes.length || s.inferenceCalls > b.maxCalls)) throw new PilotError("NOVA_SCOPE_INVALID");
    // The inference release is verified against the installed owner trust root, which only LIVE has.
    if (s?.phases && c.mode !== "LIVE") throw new PilotError("NOVA_TWO_PHASE_LIVE_ONLY");
    if (c.mode === "LIVE") {
      // LIVE runs only the full owner-approved warmup: 4 approved payloads, 4 measures, 8 inferences.
      if (!s || s.tokenPayloadHashes.length !== 4 || s.measureCalls !== 4 || s.inferenceCalls !== 8 || b.maxCalls !== 8) throw new PilotError("NOVA_LIVE_SCOPE_REQUIRED");
      if (s.ownerAcknowledgements.pricing !== NOVA_ACCEPTED.pricing || s.ownerAcknowledgements.retentionLogging !== NOVA_ACCEPTED.retentionLogging) throw new PilotError("NOVA_OWNER_ACKNOWLEDGEMENT_REQUIRED");
      if (c.approval && Date.parse(c.approval.expiresAt) > now + NOVA_APPROVAL_MAX_LIFETIME_MS) throw new PilotError("NOVA_APPROVAL_LIFETIME_EXCEEDED");
    }
  }
  const p = c.pricing;
  if (p.modelId !== c.modelId || p.inferenceProfile !== c.inferenceProfile || p.region !== c.region || Date.parse(p.expiresAt) <= now || Date.parse(p.checkedAt) > now || Date.parse(p.expiresAt) <= Date.parse(p.checkedAt)) throw new PilotError("PricingNotValid");
  if (c.mode === "LIVE" && (!c.liveOptIn || !c.profileModelConfirmed || p.authority !== "OWNER_CONFIRMED_AWS" || !c.approval || c.approval.configHash !== approvedConfigurationHash(c) || Date.parse(c.approval.expiresAt) <= now)) throw new PilotError("LiveNotApproved");
}
export function estimatedCost(c: SessionConfig, input: number, output: number) {
  const cost = Math.ceil((input * c.pricing.inputUsdPerMillion + output * c.pricing.outputUsdPerMillion) * 1000) / 1e9;
  if (!Number.isFinite(cost)) throw new PilotError("COST_NOT_FINITE");
  return cost;
}
