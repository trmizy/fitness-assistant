/** Exact unsigned COUNT-only request package. Preparation performs no IO or credential resolution. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { Hash, PilotError } from "./config";
import { digest } from "../evaluation-kit/identity";
import { MANTLE_BASE, MANTLE_MODEL, MANTLE_REGION, serializeMantle } from "./mantle-transport";

export const COUNT_ENDPOINT = MANTLE_BASE + "/count_tokens";
/** Owner-selected local AWS CLI profile. Resolved only by the authorized executor, never during preparation. */
export const COUNT_AWS_PROFILE = "divuzha";
export const countBodyHash = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");
export const CountSelectionSchema = z.object({ caseId: z.enum(["CAL01", "CAL06"]), caseKey: z.enum(["case-warmup-cal01", "case-warmup-cal06"]),
  requestCaseId: z.enum(["dev-cal-01", "dev-cal-06"]), arm: z.enum(["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"]), policy: z.literal("MINIMAL"),
  repeatIndex: z.union([z.literal(0), z.literal(1)]), requestHash: Hash, promptHash: Hash }).strict();
export const CountSourcePinsSchema = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), implementationCommit: z.string().regex(/^[a-f0-9]{40}$/),
  code: Hash, corpus: Hash, cases: Hash, ownerAmendments: Hash }).strict();
export const ACCOUNT_CHECKS = ["principal", "project", "modelAccess", "marketplaceEula", "effectiveIamScp", "quotas", "privacyRetentionLogging", "billingProtection", "credentials", "payloadReview"] as const;
// A VERIFIED check must point at a saved evidence file (AWS output, console capture or owner review note) by its SHA-256.
const Check = z.union([z.literal("NOT_VERIFIED"), z.object({ status: z.literal("VERIFIED"), evidenceSha256: Hash, verifiedAt: z.string().datetime() }).strict()]);
export const AccountSchema = z.object({ principalArn: z.string().nullable(), projectArn: z.string().nullable(),
  checks: z.object(Object.fromEntries(ACCOUNT_CHECKS.map(k => [k, Check])) as Record<typeof ACCOUNT_CHECKS[number], typeof Check>).strict() }).strict();
const Probe = z.object({ version: z.literal("mantle-count-only-probe-v2"), authority: z.literal("UNSIGNED_PROPOSAL_NOT_AUTHORIZATION"), purpose: z.literal("COUNT_ONLY_VALIDATION"),
  awsProfile: z.literal(COUNT_AWS_PROFILE), model: z.literal(MANTLE_MODEL), region: z.literal(MANTLE_REGION), service: z.literal("bedrock-mantle"), endpoint: z.literal(COUNT_ENDPOINT),
  preparedAt: z.string().datetime(), expiresAt: z.string().datetime(), timeoutMs: z.number().int().min(1).max(30000), retries: z.literal(0), maxCountRequests: z.literal(1), maxInferenceCalls: z.literal(0),
  maxInputTokens: z.literal(12000), selection: CountSelectionSchema, sourcePins: CountSourcePinsSchema,
  request: z.object({ method: z.literal("POST"), headers: z.object({ "content-type": z.literal("application/json"), "anthropic-version": z.literal("2023-06-01") }).strict(), body: z.string().min(1), sha256: Hash }).strict(),
  privacy: z.object({ selectedCaseLabels: z.literal("STRUCTURED_CASE_LABEL_KEYS_EXCLUDED"), fixedPolicyMetadataPresent: z.boolean(), reviewStatus: z.literal("PENDING_OWNER_PAYLOAD_REVIEW") }).strict(),
  account: AccountSchema }).strict();
export type CountOnlyProbe = z.infer<typeof Probe>;
export type CountAccount = z.infer<typeof AccountSchema>;
const Text = z.object({ type: z.literal("text"), text: z.string().min(1) }).strict();
const CountBody = z.object({ model: z.literal(MANTLE_MODEL), system: z.array(Text).length(1).optional(),
  messages: z.array(z.object({ role: z.literal("user"), content: z.array(Text).length(1) }).strict()).length(1) }).strict();
const labelKeys = new Set(["expectedAssessment", "expectedOutcomeScope", "referenceSupport", "appropriateAbstention", "labelHash", "proposedLabels", "reviewerNotes", "scoringRationale", "relevantClaimIds", "unsupportedConclusions"]);
function rejectStructuredLabels(value: unknown) {
  if (Array.isArray(value)) value.forEach(rejectStructuredLabels);
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (labelKeys.has(key)) throw new PilotError("COUNT_PRIVATE_LABELS_FORBIDDEN");
    rejectStructuredLabels(child);
  }
}
const policyMetadataPresent = (userJson: unknown) => !!userJson && typeof userJson === "object" && "uncertainty" in userJson && /CAL02|CAL03|E07/.test(JSON.stringify((userJson as { uncertainty: unknown }).uncertainty));
export const unverifiedAccount = (): CountAccount => ({ principalArn: null, projectArn: null,
  checks: Object.fromEntries(ACCOUNT_CHECKS.map(k => [k, "NOT_VERIFIED"])) as CountAccount["checks"] });
export function parseCountOnlyProbe(value: unknown, now = Date.now()): CountOnlyProbe {
  const parsed = Probe.safeParse(value);
  if (!parsed.success) throw new PilotError("COUNT_PROBE_INVALID");
  const p = parsed.data, prepared = Date.parse(p.preparedAt), expiry = Date.parse(p.expiresAt);
  if (prepared > now || expiry <= now || expiry <= prepared || expiry - prepared > 86400000) throw new PilotError("COUNT_PROBE_EXPIRED_OR_INVALID_TIME");
  if (Buffer.byteLength(p.request.body, "utf8") > 262144 || countBodyHash(p.request.body) !== p.request.sha256) throw new PilotError("COUNT_PAYLOAD_HASH_MISMATCH");
  let body: z.infer<typeof CountBody>;
  try { body = CountBody.parse(JSON.parse(p.request.body)); } catch { throw new PilotError("COUNT_PAYLOAD_INVALID"); }
  const wire = serializeMantle({ modelId: body.model, system: body.system?.map(b => ({ text: b.text })),
    messages: body.messages.map(m => ({ role: m.role, content: m.content.map(b => ({ text: b.text })) })), inferenceConfig: { maxTokens: 2048 } });
  if (wire.countBody !== p.request.body) throw new PilotError("COUNT_PAYLOAD_NOT_CANONICAL");
  const system = body.system?.[0].text ?? "", user = body.messages[0].content[0].text;
  if (digest({ system, user }) !== p.selection.promptHash) throw new PilotError("COUNT_PROMPT_HASH_MISMATCH");
  const suffix = p.selection.caseId === "CAL01" ? "01" : "06";
  if (p.selection.caseKey !== "case-warmup-cal" + suffix || p.selection.requestCaseId !== "dev-cal-" + suffix) throw new PilotError("COUNT_CASE_SELECTION_MISMATCH");
  let userJson: unknown; try { userJson = JSON.parse(user); } catch { userJson = null; }
  rejectStructuredLabels(userJson);
  if (p.privacy.fixedPolicyMetadataPresent !== policyMetadataPresent(userJson)) throw new PilotError("COUNT_POLICY_METADATA_DECLARATION_MISMATCH");
  for (const c of Object.values(p.account.checks)) if (c !== "NOT_VERIFIED" && Date.parse(c.verifiedAt) > prepared) throw new PilotError("COUNT_ACCOUNT_EVIDENCE_AFTER_PREPARATION");
  return p;
}
export function prepareCountOnlyProbe(value: { input: ConverseCommandInput; selection: z.infer<typeof CountSelectionSchema>; sourcePins: z.infer<typeof CountSourcePinsSchema>; preparedAt: string; expiresAt: string; timeoutMs?: number; account?: CountAccount }) {
  const wire = serializeMantle(value.input), user = wire.canonical.messages[0]?.content[0]?.text ?? "";
  let userJson: unknown; try { userJson = JSON.parse(user); } catch { userJson = null; }
  return parseCountOnlyProbe({ version: "mantle-count-only-probe-v2", authority: "UNSIGNED_PROPOSAL_NOT_AUTHORIZATION", purpose: "COUNT_ONLY_VALIDATION",
    awsProfile: COUNT_AWS_PROFILE, model: MANTLE_MODEL, region: MANTLE_REGION, service: "bedrock-mantle", endpoint: COUNT_ENDPOINT,
    preparedAt: value.preparedAt, expiresAt: value.expiresAt, timeoutMs: value.timeoutMs ?? 10000, retries: 0, maxCountRequests: 1, maxInferenceCalls: 0, maxInputTokens: 12000,
    selection: value.selection, sourcePins: value.sourcePins, request: { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: wire.countBody, sha256: countBodyHash(wire.countBody) },
    privacy: { selectedCaseLabels: "STRUCTURED_CASE_LABEL_KEYS_EXCLUDED", fixedPolicyMetadataPresent: policyMetadataPresent(userJson), reviewStatus: "PENDING_OWNER_PAYLOAD_REVIEW" },
    account: value.account ?? unverifiedAccount() }, Date.parse(value.preparedAt));
}
/** Returns the 12-digit account. Owner attestations must each reference saved evidence; a bare "VERIFIED" claim is not accepted. */
export function assertCountOnlyAccountReady(p: CountOnlyProbe) {
  const account = p.account.projectArn?.match(/^arn:aws:bedrock-mantle:us-east-2:(\d{12}):project\/default$/)?.[1];
  if (!account || !p.account.principalArn?.match(new RegExp(`^arn:aws:(?:iam|sts)::${account}:[^*]+$`)) || Object.values(p.account.checks).some(v => v === "NOT_VERIFIED")) throw new PilotError("COUNT_ACCOUNT_READINESS_BLOCKED");
  return account;
}
