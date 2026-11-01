/** DEV evaluation only. No live transport is created without validated approval. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ConverseCommand, CountTokensCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { BEDROCK_REGION, bedrockRuntimeDeps, buildConverseTextInput, parseConverseText } from "../../services/bedrock.client";
import { AnalysisEnvelopeSchema, type Prompt } from "../ai-coach-dev/pipeline";
import { digest } from "../evaluation-kit/identity";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Pricing = z.object({ authority: z.enum(["FAKE_TEST_ONLY", "OWNER_CONFIRMED_AWS"]), sourceUrl: z.literal("https://aws.amazon.com/bedrock/pricing/"), version: z.string().min(1), checkedAt: z.string().datetime(), expiresAt: z.string().datetime(), modelId: z.string(), region: z.string(), inputUsdPerMillion: z.number().finite().nonnegative(), outputUsdPerMillion: z.number().finite().nonnegative(), confirmedBy: z.string().min(1), evidenceHash: Hash }).strict();
export const SessionConfigSchema = z.object({
  mode: z.enum(["FAKE", "LIVE"]).default("FAKE"), liveOptIn: z.boolean().default(false),
  dataClass: z.literal("SYNTHETIC_EVALUATION_ONLY"), modelId: z.literal("amazon.nova-pro-v1:0"), inferenceProfile: z.string().min(1).nullable(), region: z.string().min(1), profileModelConfirmed: z.boolean(),
  parameters: z.object({ maxTokens: z.number().int().positive().max(5000), temperature: z.number().min(0.00001).max(1).optional(), topP: z.number().min(0).max(1).optional(), retries: z.literal(0), timeoutMs: z.number().int().min(1).max(300000) }).strict().refine((p) => !(p.temperature !== undefined && p.topP !== undefined), "Choose temperature or topP"),
  pins: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), code: Hash, corpus: Hash, cases: Hash, promptHashes: z.array(Hash).min(1) }).strict(),
  budget: z.object({ maxCalls: z.number().int().positive(), maxInputTokensPerCall: z.number().int().positive(), maxInputTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(), maxEstimatedUsd: z.number().finite().positive(), maxFailures: z.number().int().positive() }).strict(),
  pricing: Pricing,
  approval: z.object({ approvedBy: z.string().min(1), scope: z.literal("BEDROCK_EVALUATION_PILOT"), configHash: Hash, expiresAt: z.string().datetime() }).strict().nullable(),
}).strict();
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export function approvedConfigurationHash(c: SessionConfig) { const { approval: _approval, ...body } = c; return digest(body); }
export interface EvaluationTransport {
  kind: "FAKE" | "LIVE";
  count(input: ConverseCommandInput, signal: AbortSignal): Promise<number>;
  invoke(input: ConverseCommandInput, signal: AbortSignal): Promise<ConverseCommandOutput>;
}
function liveTransport(config: SessionConfig): EvaluationTransport {
  if (config.region !== BEDROCK_REGION) throw new Error("ClientRegionMismatch");
  return { kind: "LIVE",
    async count(input, abortSignal) {
      // Existing transport sends SDK commands generically; its public union predates CountTokens.
      const command = new CountTokensCommand({ modelId: config.modelId, input: { converse: { messages: input.messages, system: input.system } } });
      const response = await bedrockRuntimeDeps.send(command as unknown as Parameters<typeof bedrockRuntimeDeps.send>[0], { abortSignal, maxAttempts: 1 }) as { inputTokens?: number };
      if (!Number.isInteger(response.inputTokens) || response.inputTokens! < 0) throw new Error("TokenCountUnavailable");
      return response.inputTokens!;
    },
    async invoke(input, abortSignal) { return await bedrockRuntimeDeps.send(new ConverseCommand(input), { abortSignal, maxAttempts: 1 }) as ConverseCommandOutput; },
  };
}
function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]").replace(/((?:api[_-]?key|secret(?:accesskey)?|sessiontoken|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /credential|api.?key|secret|password|sessiontoken/i.test(k) ? "[REDACTED]" : redact(v)]));
  return value;
}
function category(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /Throttl/.test(name) ? "THROTTLED" : /AccessDenied|UnrecognizedClient/.test(name) ? "AUTHORIZATION" : /Validation/.test(name) ? "REQUEST_VALIDATION" : /Timeout|Abort/.test(name) ? "TIMEOUT" : "PROVIDER_ERROR";
}
async function deadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timer: NodeJS.Timeout | undefined;
  const request = work(controller.signal); request.catch(() => undefined);
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); const e = new Error("Deadline"); e.name = "TimeoutError"; reject(e); }, ms); })]); }
  finally { clearTimeout(timer); }
}
export function openEvaluationSession(value: unknown, directory: string, fake?: EvaluationTransport) {
  const config = SessionConfigSchema.parse(value), configHash = approvedConfigurationHash(config), now = Date.now();
  if (config.pricing.modelId !== config.modelId || config.pricing.region !== config.region || Date.parse(config.pricing.expiresAt) <= now || Date.parse(config.pricing.checkedAt) > now) throw new Error("PricingNotValid");
  if (config.mode === "LIVE" && (!config.liveOptIn || !config.profileModelConfirmed || config.pricing.authority !== "OWNER_CONFIRMED_AWS" || !config.approval || config.approval.configHash !== configHash || Date.parse(config.approval.expiresAt) <= now)) throw new Error("LiveNotApproved");
  if (config.mode === "FAKE" && (!fake || fake.kind !== "FAKE")) throw new Error("FakeTransportRequired");
  if (config.mode === "LIVE" && fake) throw new Error("LiveTransportCannotBeOverridden");
  const transport = config.mode === "FAKE" ? fake! : liveTransport(config);
  // New run only; a restart cannot reset budgets by appending to an old session.
  fs.mkdirSync(directory, { recursive: false });
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(redact({ version: "bedrock-evaluation-v1", createdAt: new Date().toISOString(), mode: config.mode, configHash, config, status: "OPEN", pricingAuthority: config.pricing.authority }), null, 2), { flag: "wx" });
  const file = path.join(directory, "results.jsonl"); fs.writeFileSync(file, "", { flag: "wx" });
  const state = { attempts: 0, inferenceCalls: 0, countCalls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, failures: 0, stopped: false };
  let seq = 0, chain: Promise<unknown> = Promise.resolve();
  const tokenCounts = new Map<string, number>();
  const authorizationCurrent = () => Date.parse(config.pricing.expiresAt) > Date.now() && (config.mode !== "LIVE" || !!config.approval && Date.parse(config.approval.expiresAt) > Date.now());
  const append = (record: unknown) => { try { fs.appendFileSync(file, JSON.stringify(redact({ sequence: ++seq, record })) + "\n", { flag: "a" }); } catch { state.stopped = true; throw new Error("PersistenceFailure"); } };
  // Conservative nanodollar ceiling; recompute on total reserved tokens rather
  // than accumulating floating refunds across attempts.
  const cost = (i: number, o: number) => Math.ceil((i * config.pricing.inputUsdPerMillion + o * config.pricing.outputUsdPerMillion) * 1000) / 1e9;
  async function attempt(prompt: Prompt) {
    const promptHash = digest({ system: prompt.system, user: prompt.user });
    if (!authorizationCurrent()) { state.stopped = true; append({ event: "REJECTED", reason: "AUTHORIZATION_OR_PRICING_EXPIRED", promptHash }); throw new Error("AuthorizationOrPricingExpired"); }
    if (config.mode === "LIVE" && config.pins.promptHashes.some((h) => !tokenCounts.has(h))) { append({ event: "REJECTED", reason: "BATCH_TOKEN_PREFLIGHT_REQUIRED", promptHash }); throw new Error("BatchTokenPreflightRequired"); }
    if (state.stopped || state.failures >= config.budget.maxFailures || state.attempts >= config.budget.maxCalls) { append({ event: "REJECTED", reason: "BUDGET_OR_FAILURE_STOP", promptHash }); throw new Error("BudgetStopped"); }
    if (!config.pins.promptHashes.includes(promptHash)) { append({ event: "REJECTED", reason: "PROMPT_NOT_FROZEN", promptHash }); throw new Error("PromptNotFrozen"); }
    state.attempts++;
    const input = buildConverseTextInput({ system: prompt.system, userText: prompt.user, modelId: config.inferenceProfile ?? config.modelId, maxTokens: config.parameters.maxTokens, temperature: config.parameters.temperature });
    if (config.parameters.topP !== undefined) input.inferenceConfig!.topP = config.parameters.topP;
    const started = Date.now(); let rawText: string | null = null, parsedCandidate: unknown = null, parseError: string | null = null, stopReason: string | null = null;
    let countLatencyMs: number | null = null, inferenceLatencyMs: number | null = null;
    let inputTokens: number | null = null, outputTokens: number | null = null, providerError: string | null = null, reserved = false, reservationReconciled = false, reserveOutput = 0;
    append({ event: "ATTEMPT_STARTED", attempt: state.attempts, promptHash, configHash });
    try {
      const countStarted = Date.now(); let count: number;
      try {
        if (tokenCounts.has(promptHash)) count = tokenCounts.get(promptHash)!;
        else {
          if (state.countCalls >= config.budget.maxCalls) throw new Error("CountApiBudgetStopped");
          state.countCalls++; count = await deadline(config.parameters.timeoutMs, (signal) => transport.count(input, signal));
          if (Number.isInteger(count) && count >= 0) tokenCounts.set(promptHash, count);
        }
      } finally { countLatencyMs = Date.now() - countStarted; }
      reserveOutput = config.parameters.maxTokens;
      if (!authorizationCurrent()) { state.stopped = true; providerError = "AUTHORIZATION_OR_PRICING_EXPIRED"; }
      else if (!Number.isInteger(count) || count < 0 || count > config.budget.maxInputTokensPerCall || state.inputTokens + count > config.budget.maxInputTokens || state.outputTokens + reserveOutput > config.budget.maxOutputTokens || cost(state.inputTokens + count, state.outputTokens + reserveOutput) > config.budget.maxEstimatedUsd) { state.stopped = true; providerError = "BUDGET_REJECTED"; }
      else {
        state.inputTokens += count; state.outputTokens += reserveOutput; state.estimatedUsd = cost(state.inputTokens, state.outputTokens); reserved = true;
        append({ event: "INFERENCE_RESERVED", promptHash, inputTokens: count, outputTokenCap: reserveOutput, maximumEstimatedUsd: cost(count, reserveOutput) });
        state.inferenceCalls++;
        const inferenceStarted = Date.now(); let response: ConverseCommandOutput;
        try { response = await deadline(config.parameters.timeoutMs, (signal) => transport.invoke(input, signal)); } finally { inferenceLatencyMs = Date.now() - inferenceStarted; }
        stopReason = response.stopReason ?? null;
        rawText = (response.output?.message?.content ?? []).map((b) => "text" in b ? b.text ?? "" : "").join("");
        inputTokens = response.usage?.inputTokens ?? null; outputTokens = response.usage?.outputTokens ?? null;
        if (inputTokens !== count || !Number.isInteger(outputTokens) || outputTokens! < 0 || outputTokens! > reserveOutput) { state.stopped = true; providerError = "USAGE_MISMATCH_OR_UNKNOWN"; }
        else {
          state.outputTokens -= reserveOutput - outputTokens!; state.estimatedUsd = cost(state.inputTokens, state.outputTokens); reservationReconciled = true;
          try { parseConverseText(response); } catch { providerError = "MODEL_REFUSAL"; }
          if (!providerError) {
            try { parsedCandidate = JSON.parse(rawText); } catch { parseError = "INVALID_JSON"; }
            if (!parseError && !AnalysisEnvelopeSchema.safeParse(parsedCandidate).success) parseError = "SCHEMA_INVALID";
          }
        }
      }
    } catch (error) { providerError = category(error); }
    if (providerError || parseError) state.failures++;
    if (state.failures >= config.budget.maxFailures) state.stopped = true;
    const result = { event: "ATTEMPT_FINISHED", executionMode: config.mode, attempt: state.attempts, promptHash, configHash, modelId: config.modelId, inferenceProfile: config.inferenceProfile, region: config.region,
      rawText, parsedCandidate, parseError, inputTokens, outputTokens, latencyMs: Date.now() - started, countLatencyMs, inferenceLatencyMs, stopReason, providerError,
      estimatedUsd: inputTokens !== null && outputTokens !== null && !providerError ? cost(inputTokens, outputTokens) : null,
      conservativeReservationRetained: reserved && !reservationReconciled, rawTextHash: rawText === null ? null : digest(rawText), state: { ...state } };
    append(result);
    return result;
  }
  async function preview(prompts: Prompt[]) {
    const receipts = [];
    for (const prompt of prompts) {
      const promptHash = digest({ system: prompt.system, user: prompt.user });
      if (state.stopped || !authorizationCurrent() || !config.pins.promptHashes.includes(promptHash)) throw new Error("PreflightNotAuthorized");
      const input = buildConverseTextInput({ system: prompt.system, userText: prompt.user, modelId: config.inferenceProfile ?? config.modelId, maxTokens: config.parameters.maxTokens, temperature: config.parameters.temperature });
      if (config.parameters.topP !== undefined) input.inferenceConfig!.topP = config.parameters.topP;
      if (!tokenCounts.has(promptHash)) {
        if (state.countCalls >= config.budget.maxCalls) throw new Error("CountApiBudgetStopped");
        state.countCalls++;
        try {
          const count = await deadline(config.parameters.timeoutMs, (signal) => transport.count(input, signal));
          if (!Number.isInteger(count) || count < 0 || count > config.budget.maxInputTokensPerCall) throw new Error("InputTokenPreflightFailed");
          tokenCounts.set(promptHash, count);
        } catch (e) { state.stopped = true; state.failures++; append({ event: "TOKEN_PREFLIGHT_FAILED", promptHash, category: category(e) }); throw new Error("TokenPreflightFailed"); }
      }
      const receipt = { promptHash, modelId: config.modelId, inputTokens: tokenCounts.get(promptHash)!, inferenceCalls: 0 };
      append({ event: "TOKEN_PREFLIGHT", ...receipt }); receipts.push(receipt);
    }
    return receipts;
  }
  return { configHash, state: () => ({ ...state }), previewTokenCounts(prompts: Prompt[]) {
    const next = chain.then(() => preview(prompts)); chain = next.catch(() => undefined); return next;
  }, evaluate(prompt: Prompt) {
    // Serialized admission prevents concurrent calls oversubscribing the same ledger.
    const next = chain.then(() => attempt(prompt)); chain = next.catch(() => undefined); return next;
  } };
}
