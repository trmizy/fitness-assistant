/**
 * Bounded text-only Nova Pro Converse adapter with MEASURED preflight. No HTTP client, credentials or
 * executable LIVE path. Nova has no CountTokens API, so "count" is a billed Converse call with the exact
 * inference payload and maxTokens=1; its reported usage.inputTokens is the AWS-measured input size.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import type { EvaluationTransport } from "./session";
import { PilotError } from "./config";

export const NOVA_MODEL = "amazon.nova-pro-v1:0";
// In-Region bare model ID on bedrock-runtime (model card: us-east-1 In-Region supported); no inference profile.
export const NOVA_REGION = "us-east-1";
export const NOVA_MEASURE_MAX_TOKENS = 1;
const TextBlock = z.object({ text: z.string().min(1) }).strict();
const Input = z.object({ modelId: z.literal(NOVA_MODEL), system: z.array(TextBlock).min(1).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.array(TextBlock).min(1) }).strict()).min(1),
  inferenceConfig: z.object({ maxTokens: z.number().int().min(1).max(2048), temperature: z.number().min(0).max(1).optional(), topP: z.number().min(0).max(1).optional() }).strict()
    .refine(p => !(p.temperature !== undefined && p.topP !== undefined), "Choose one sampling setting") }).strict();
const hash = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");
export interface NovaWireIdentity {
  protocol: "NOVA_CONVERSE_MEASURED"; modelId: typeof NOVA_MODEL; region: typeof NOVA_REGION;
  tokenPayloadHash: string; measureRequestHash: string; inferenceRequestHash: string;
}
export function serializeNova(value: ConverseCommandInput) {
  const parsed = Input.safeParse(value);
  if (!parsed.success) throw new PilotError("NOVA_UNSUPPORTED_INPUT");
  const p = parsed.data;
  const canonical = { modelId: NOVA_MODEL, ...(p.system ? { system: p.system.map(b => ({ text: b.text })) } : {}),
    messages: p.messages.map(m => ({ role: m.role, content: m.content.map(b => ({ text: b.text })) })) };
  // The measured preflight differs from inference ONLY in maxTokens; every token-bearing field is shared unchanged.
  const inference = { ...canonical, inferenceConfig: { ...p.inferenceConfig } }, measure = { ...canonical, inferenceConfig: { ...p.inferenceConfig, maxTokens: NOVA_MEASURE_MAX_TOKENS } };
  const measureBody = JSON.stringify(measure), inferenceBody = JSON.stringify(inference);
  const identity: NovaWireIdentity = Object.freeze({ protocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION,
    tokenPayloadHash: hash(JSON.stringify(canonical)), measureRequestHash: hash(measureBody), inferenceRequestHash: hash(inferenceBody) });
  return { canonical, measure: measure as ConverseCommandInput, inference: inference as ConverseCommandInput, measureBody, inferenceBody, identity };
}
export interface NovaFakeRequest { operation: "Converse"; region: typeof NOVA_REGION; purpose: "MEASURE" | "INFERENCE"; body: string; identity: NovaWireIdentity }
export interface NovaFakeReply { status: number; body: unknown }
/** Wire seam shared by the FAKE and LIVE adapters; status 0 means the outcome (and any billing) is unknown. */
export interface NovaIo { converse(request: NovaFakeRequest, signal: AbortSignal): Promise<NovaFakeReply> }
export interface NovaFakeIo extends NovaIo { kind: "FAKE" }
const Tokens = z.number().int().nonnegative().safe();
// Converse: inputTokens excludes explicit cache reads/writes. This adapter never sends cachePoint, and AWS documents
// that Nova implicit cache reuse is not reported in the cache fields, so nonzero cache fields are unexpected and fail closed.
const Usage = z.object({ inputTokens: Tokens, outputTokens: Tokens, totalTokens: Tokens, cacheReadInputTokens: Tokens.optional(), cacheWriteInputTokens: Tokens.optional(),
  cacheDetails: z.array(z.unknown()).optional() }).strict();
const Output = z.object({ output: z.object({ message: z.object({ role: z.literal("assistant"), content: z.array(z.object({ text: z.string() }).strict()) }).strict() }).strict(),
  stopReason: z.string(), usage: Usage, metrics: z.object({ latencyMs: Tokens }).passthrough().optional() }).passthrough();

export function createFakeNovaTransport(io: NovaFakeIo): EvaluationTransport {
  if (!io || io.kind !== "FAKE" || typeof io.converse !== "function") throw new PilotError("NOVA_FAKE_IO_REQUIRED");
  return createNovaTransport(io, "FAKE");
}
/** Shared validation for both IO kinds. The LIVE IO is only constructed by the session after every owner gate. */
export function createNovaTransport(io: NovaIo, kind: "FAKE" | "LIVE"): EvaluationTransport {
  if (!io || typeof io.converse !== "function") throw new PilotError("NOVA_IO_REQUIRED");
  async function exchange(input: ConverseCommandInput, purpose: "MEASURE" | "INFERENCE", signal: AbortSignal) {
    const wire = serializeNova(input);
    if (signal.aborted) { const e = new Error("Aborted"); e.name = "AbortError"; throw e; }
    const reply = await io.converse(Object.freeze({ operation: "Converse" as const, region: NOVA_REGION, purpose, body: purpose === "MEASURE" ? wire.measureBody : wire.inferenceBody, identity: wire.identity }), signal);
    const fail = (code: string, unknownUsage = false): never => { throw new PilotError(code, { providerResponse: reply, wire: wire.identity, unknownUsage }); };
    if (!reply || !Number.isInteger(reply.status)) fail("NOVA_INVALID_RESPONSE", true);
    // No HTTP status (network failure after dispatch): the request may have been billed.
    if (reply.status === 0) fail("NOVA_NETWORK_UNKNOWN_OUTCOME", true);
    if (reply.status < 200 || reply.status >= 300) fail(reply.status === 401 || reply.status === 403 ? "NOVA_AUTHORIZATION" : reply.status === 429 ? "NOVA_THROTTLED" : reply.status === 400 ? "NOVA_REQUEST_VALIDATION" : "NOVA_PROVIDER_ERROR");
    const parsed = Output.safeParse(reply.body);
    if (!parsed.success) return fail(Usage.safeParse((reply.body as { usage?: unknown } | null)?.usage).success ? "NOVA_INVALID_RESPONSE" : "NOVA_USAGE_UNKNOWN", true);
    const u = parsed.data.usage;
    if ((u.cacheReadInputTokens ?? 0) !== 0 || (u.cacheWriteInputTokens ?? 0) !== 0) fail("NOVA_UNSUPPORTED_CACHE_USAGE", true);
    if (u.totalTokens !== u.inputTokens + u.outputTokens) fail("NOVA_USAGE_INCONSISTENT", true);
    return { wire, reply, body: parsed.data, usage: u, fail };
  }
  return { kind, protocol: "NOVA_CONVERSE_MEASURED", billedCount: true,
    async count(input, signal) {
      const r = await exchange(input, "MEASURE", signal);
      if (r.usage.outputTokens > NOVA_MEASURE_MAX_TOKENS || !["max_tokens", "end_turn"].includes(r.body.stopReason)) return r.fail("NOVA_MEASURE_INVALID", true);
      return { inputTokens: r.usage.inputTokens, billedUsage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens }, providerResponse: r.reply, wire: r.wire.identity };
    },
    async invoke(input, signal) {
      const r = await exchange(input, "INFERENCE", signal);
      if (r.usage.outputTokens > input.inferenceConfig!.maxTokens!) return r.fail("NOVA_USAGE_OUT_OF_BOUNDS", true);
      // Truncation/refusal/guardrail stops are failures, not answers; usage is known so the reservation reconciles.
      if (r.body.stopReason !== "end_turn") return r.fail("NOVA_STOP_REASON_" + r.body.stopReason.toUpperCase().replace(/[^A-Z_]/g, "_"));
      return { $metadata: {}, output: { message: { role: "assistant", content: r.body.output.message.content.map(b => ({ text: b.text })) } },
        usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, totalTokens: r.usage.totalTokens },
        metrics: { latencyMs: 0 }, stopReason: "end_turn", providerResponse: r.reply, wire: r.wire.identity };
    },
  };
}

/** Existing CLI's default scripted plumbing fixture; these are not model token counts. */
export function createScriptedNovaTransport(outputText: string): EvaluationTransport {
  return createFakeNovaTransport({ kind: "FAKE", async converse(request) {
    const parsed = JSON.parse(request.body), { inferenceConfig: _config, ...tokenBearing } = parsed;
    const inputTokens = Math.ceil(Buffer.byteLength(JSON.stringify(tokenBearing), "utf8") / 4), measure = request.purpose === "MEASURE";
    const outputTokens = measure ? 1 : 100;
    return { status: 200, body: { output: { message: { role: "assistant", content: [{ text: measure ? "{" : outputText }] } }, stopReason: measure ? "max_tokens" : "end_turn",
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, metrics: { latencyMs: 0 } } };
  } });
}
