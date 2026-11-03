/** Bounded text-only Mantle wire adapter. No HTTP client, credentials or executable LIVE path. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import type { EvaluationTransport } from "./session";
import { PilotError } from "./config";

export const MANTLE_MODEL = "anthropic.claude-haiku-4-5";
export const MANTLE_REGION = "us-east-2";
export const MANTLE_BASE = "https://bedrock-mantle.us-east-2.api.aws/anthropic/v1/messages";
const TextBlock = z.object({ text: z.string().min(1) }).strict();
const Input = z.object({ modelId: z.literal(MANTLE_MODEL), system: z.array(TextBlock).min(1).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.array(TextBlock).min(1) }).strict()).min(1),
  inferenceConfig: z.object({ maxTokens: z.number().int().min(1).max(2048), temperature: z.number().min(0).max(1).optional(), topP: z.number().min(0).max(1).optional() }).strict()
    .refine(p => !(p.temperature !== undefined && p.topP !== undefined), "Choose one sampling setting") }).strict();
const hash = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");
export interface MantleWireIdentity {
  protocol: "MANTLE_MESSAGES"; modelId: typeof MANTLE_MODEL; region: typeof MANTLE_REGION;
  tokenPayloadHash: string; countBodyHash: string; inferenceBodyHash: string;
}
export function serializeMantle(value: ConverseCommandInput) {
  // Converse-shaped input is an internal DTO only. Nothing is sent to Runtime/Converse.
  const parsed = Input.safeParse(value);
  if (!parsed.success) throw new PilotError("MANTLE_UNSUPPORTED_INPUT");
  const p = parsed.data;
  const canonical = { model: MANTLE_MODEL,
    ...(p.system ? { system: p.system.map(b => ({ type: "text" as const, text: b.text })) } : {}),
    messages: p.messages.map(m => ({ role: m.role, content: m.content.map(b => ({ type: "text" as const, text: b.text })) })) };
  // CountTokens excludes generation-only fields. Every token-bearing field is shared unchanged.
  const countBody = JSON.stringify(canonical), inferenceBody = JSON.stringify({ ...canonical, max_tokens: p.inferenceConfig.maxTokens,
    ...(p.inferenceConfig.temperature !== undefined ? { temperature: p.inferenceConfig.temperature } : {}),
    ...(p.inferenceConfig.topP !== undefined ? { top_p: p.inferenceConfig.topP } : {}) });
  const identity: MantleWireIdentity = Object.freeze({ protocol: "MANTLE_MESSAGES", modelId: MANTLE_MODEL, region: MANTLE_REGION,
    tokenPayloadHash: hash(countBody), countBodyHash: hash(countBody), inferenceBodyHash: hash(inferenceBody) });
  return { canonical, countBody, inferenceBody, identity };
}
export interface MantleFakeRequest {
  url: string; method: "POST"; headers: Record<string, string>; body: string; identity: MantleWireIdentity;
}
export interface MantleFakeReply { status: number; body: unknown; headers?: Record<string, string> }
export interface MantleFakeIo { kind: "FAKE"; post(request: MantleFakeRequest, signal: AbortSignal): Promise<MantleFakeReply> }
const Tokens = z.number().int().nonnegative().safe();
const Count = z.object({ input_tokens: Tokens }).passthrough();
const Usage = z.object({ input_tokens: Tokens, output_tokens: Tokens,
  cache_read_input_tokens: Tokens.optional(), cache_creation_input_tokens: Tokens.optional(),
  cache_creation: z.record(Tokens).nullable().optional(), service_tier: z.enum(["standard", "default"]).optional() }).strict();
const Native = z.object({ id: z.string().min(1), type: z.literal("message"), role: z.literal("assistant"),
  model: z.enum([MANTLE_MODEL, "claude-haiku-4-5-20251001", "anthropic.claude-haiku-4-5-20251001-v1:0"]),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).passthrough()).min(1),
  stop_reason: z.literal("end_turn"), stop_sequence: z.null().optional(), usage: Usage }).passthrough();

export function createFakeMantleTransport(io: MantleFakeIo): EvaluationTransport {
  if (!io || io.kind !== "FAKE" || typeof io.post !== "function") throw new PilotError("MANTLE_FAKE_IO_REQUIRED");
  async function exchange(input: ConverseCommandInput, counting: boolean, signal: AbortSignal) {
    const wire = serializeMantle(input);
    if (signal.aborted) { const e = new Error("Aborted"); e.name = "AbortError"; throw e; }
    const reply = await io.post(Object.freeze({ url: MANTLE_BASE + (counting ? "/count_tokens" : ""), method: "POST" as const,
      headers: Object.freeze({ "content-type": "application/json", "anthropic-version": "2023-06-01" }), body: counting ? wire.countBody : wire.inferenceBody, identity: wire.identity }), signal);
    const fail = (code: string, unknownUsage = false): never => { throw new PilotError(code, { providerResponse: reply, wire: wire.identity, unknownUsage }); };
    if (!reply || !Number.isInteger(reply.status)) fail("MANTLE_INVALID_RESPONSE", !counting);
    if (reply.status < 200 || reply.status >= 300) fail(reply.status === 401 || reply.status === 403 ? "MANTLE_AUTHORIZATION" : reply.status === 429 ? "MANTLE_THROTTLED" : reply.status === 400 ? "MANTLE_REQUEST_VALIDATION" : "MANTLE_PROVIDER_ERROR");
    let body = reply.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { fail("MANTLE_INVALID_JSON_RESPONSE", !counting); } }
    return { wire, reply, body, fail };
  }
  return { kind: "FAKE", protocol: "MANTLE_MESSAGES",
    async count(input, signal) {
      const r = await exchange(input, true, signal), parsed = Count.safeParse(r.body);
      if (!parsed.success) return r.fail("MANTLE_COUNT_UNAVAILABLE");
      return { inputTokens: parsed.data.input_tokens, providerResponse: r.reply, wire: r.wire.identity };
    },
    async invoke(input, signal) {
      const r = await exchange(input, false, signal), body = r.body as Record<string, unknown> | null;
      const usage = Usage.safeParse(body && typeof body === "object" ? body.usage : undefined);
      if (!usage.success) return r.fail("MANTLE_USAGE_UNKNOWN", true);
      const u = usage.data;
      if ((u.cache_read_input_tokens ?? 0) !== 0 || (u.cache_creation_input_tokens ?? 0) !== 0 || Object.values(u.cache_creation ?? {}).some(v => v !== 0)) return r.fail("MANTLE_UNSUPPORTED_CACHE_USAGE", true);
      if (u.output_tokens > input.inferenceConfig!.maxTokens!) return r.fail("MANTLE_USAGE_OUT_OF_BOUNDS", true);
      const parsed = Native.safeParse(r.body);
      if (!parsed.success) return r.fail("MANTLE_INVALID_RESPONSE");
      const b = parsed.data;
      return { $metadata: {}, output: { message: { role: "assistant", content: b.content.map(block => ({ text: block.text })) } },
        usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.input_tokens + u.output_tokens },
        metrics: { latencyMs: 0 }, stopReason: "end_turn", providerResponse: r.reply, wire: r.wire.identity };
    },
  };
}

/** Existing CLI's default scripted plumbing fixture; these are not model token counts. */
export function createScriptedMantleTransport(outputText: string): EvaluationTransport {
  return createFakeMantleTransport({ kind: "FAKE", async post(request) {
    const parsed = JSON.parse(request.body), { max_tokens: _max, temperature: _temp, top_p: _topP, ...tokenBearing } = parsed;
    const input_tokens = Math.ceil(Buffer.byteLength(JSON.stringify(tokenBearing), "utf8") / 4);
    return request.url.endsWith("/count_tokens") ? { status: 200, body: { input_tokens } } : { status: 200,
      body: { id: "msg_fake_mantle", type: "message", role: "assistant", model: MANTLE_MODEL, content: [{ type: "text", text: outputText }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens, output_tokens: 100 } } };
  } });
}
