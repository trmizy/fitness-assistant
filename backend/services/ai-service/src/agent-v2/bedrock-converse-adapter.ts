/**
 * Gymini V2 (EXPERIMENTAL) — Amazon Bedrock Converse adapter for AgentModelProvider (tool use).
 *
 * Maps AgentMessage/AgentToolSpec ⇄ Converse (system, messages, toolConfig.tools[].toolSpec, toolUse, toolResult,
 * stopReason, usage). Transport is injectable: tests pass a fake `send`; the default reuses V1's
 * bedrockRuntimeDeps.send (same client, same credentials/region config) with maxAttempts = 1, so one converse() is
 * exactly one provider request attempt — no hidden SDK retries. P2 never calls this against AWS.
 *
 * Nothing from the response is trusted here beyond shape: tool names/ids/inputs are passed to the controller, which
 * validates them against the offered tool set and the registry.
 */
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import {
  AgentProviderError, type AgentBlock, type AgentMessage, type AgentModelProvider, type AgentModelRequest, type AgentModelResponse,
  type AgentStopReason,
} from "./model-provider";

export type ConverseTransport = (input: ConverseCommandInput, options: { abortSignal: AbortSignal; maxAttempts: number }) => Promise<unknown>;

const STOP_REASONS = new Set<AgentStopReason>([
  "end_turn", "tool_use", "max_tokens", "stop_sequence", "content_filtered", "guardrail_intervened",
  "malformed_tool_use", "malformed_model_output", "model_context_window_exceeded",
]);

async function defaultTransport(input: ConverseCommandInput, options: { abortSignal: AbortSignal; maxAttempts: number }) {
  // Lazy imports: loading this module (e.g. in tests) never touches the AWS SDK client.
  const [{ ConverseCommand }, { bedrockRuntimeDeps }] = await Promise.all([
    import("@aws-sdk/client-bedrock-runtime"),
    import("../services/bedrock.client"),
  ]);
  return bedrockRuntimeDeps.send(new ConverseCommand(input), options);
}

export function toConverseMessages(messages: AgentMessage[]): ConverseCommandInput["messages"] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === "text") return { text: b.text };
      if (b.type === "toolUse") return { toolUse: { toolUseId: b.toolUseId, name: b.name, input: b.input as any } };
      return { toolResult: { toolUseId: b.toolUseId, status: b.status, content: [{ json: b.json as any }] } };
    }),
  })) as ConverseCommandInput["messages"];
}

export function buildConverseInput(modelId: string, req: Omit<AgentModelRequest, "signal">): ConverseCommandInput {
  return {
    modelId,
    system: [{ text: req.system }],
    messages: toConverseMessages(req.messages),
    ...(req.tools.length ? { toolConfig: { tools: req.tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as any } } })) } } : {}),
    inferenceConfig: { maxTokens: req.maxOutputTokens, temperature: req.temperature },
  };
}

/** Normalises a raw Converse response. Throws invalid_response for anything that is not a Converse-shaped answer. */
export function parseConverseResponse(raw: unknown): AgentModelResponse {
  const r = raw as any;
  const blocks = r?.output?.message?.content;
  if (!r || typeof r !== "object" || !Array.isArray(blocks)) throw new AgentProviderError("invalid_response", "Provider response has no message content");
  const rawStop = typeof r.stopReason === "string" ? r.stopReason : null;
  const stopReason: AgentStopReason = rawStop && STOP_REASONS.has(rawStop as AgentStopReason) ? (rawStop as AgentStopReason) : "unsupported";
  const content: AgentBlock[] = [];
  for (const b of blocks) {
    if (b && typeof b.text === "string") content.push({ type: "text", text: b.text });
    else if (b && b.toolUse && typeof b.toolUse === "object") {
      content.push({ type: "toolUse", toolUseId: String(b.toolUse.toolUseId ?? ""), name: String(b.toolUse.name ?? ""), input: b.toolUse.input });
    }
    // reasoningContent / image / other blocks are ignored (never forwarded to the user)
  }
  const u = r.usage;
  const usage = u && Number.isFinite(u.inputTokens) && Number.isFinite(u.outputTokens) ? { inputTokens: Number(u.inputTokens), outputTokens: Number(u.outputTokens) } : null;
  return { stopReason, rawStopReason: rawStop, content, usage };
}

export function classifyProviderError(err: unknown): AgentProviderError {
  if (err instanceof AgentProviderError) return err;
  const name = String((err as any)?.name ?? "");
  const kind =
    name === "AbortError" ? "aborted"
    : /Throttling|TooManyRequests|ServiceQuotaExceeded/i.test(name) ? "throttled"
    : /AccessDenied|UnrecognizedClient|ExpiredToken/i.test(name) ? "access_denied"
    : /Validation/i.test(name) ? "validation"
    : /Timeout/i.test(name) ? "timeout"
    : /InternalServer|ServiceUnavailable|ModelError|ModelNotReady/i.test(name) ? "server"
    : "unknown";
  // Fixed messages: never the provider's own text (may echo prompt fragments) and never credentials.
  return new AgentProviderError(kind, `Model provider error (${kind})`);
}

export function createBedrockConverseProvider(options: { modelId?: string; transport?: ConverseTransport } = {}): AgentModelProvider {
  const modelId = options.modelId ?? process.env.BEDROCK_CHAT_MODEL ?? "apac.amazon.nova-pro-v1:0";
  const transport = options.transport ?? defaultTransport;
  return {
    modelId,
    supportsCancellation: true,
    async converse(req) {
      if (req.signal.aborted) throw new AgentProviderError("aborted", "Deadline already passed");
      let raw: unknown;
      try {
        raw = await transport(buildConverseInput(modelId, req), { abortSignal: req.signal, maxAttempts: 1 });
      } catch (err) {
        throw classifyProviderError(err);
      }
      return parseConverseResponse(raw);
    },
  };
}
