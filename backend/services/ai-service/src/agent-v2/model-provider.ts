/**
 * Gymini V2 (EXPERIMENTAL) — model provider abstraction for the Training Agent.
 *
 * The controller (training-agent.ts) only ever talks to this interface. P2 is tested with mock providers; the Bedrock
 * Converse adapter (bedrock-converse-adapter.ts) implements it for P3/P4 and is exercised offline with an injected
 * transport. One `converse` call = one model round = exactly one provider request attempt (the adapter disables SDK
 * retries; the controller never retries).
 */

export type AgentRole = "user" | "assistant";

export type AgentBlock =
  | { type: "text"; text: string }
  | { type: "toolUse"; toolUseId: string; name: string; input: unknown }
  | { type: "toolResult"; toolUseId: string; status: "success" | "error"; json: unknown };

export interface AgentMessage {
  role: AgentRole;
  content: AgentBlock[];
}

/** Tool offered to the model. `name` is the provider-safe name ([a-zA-Z0-9_-]{1,64}); the controller maps it back to a tool id. */
export interface AgentToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Normalised stop reasons. Anything the provider returns outside this list becomes "unsupported". */
export type AgentStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | "content_filtered"
  | "guardrail_intervened"
  | "malformed_tool_use"
  | "malformed_model_output"
  | "model_context_window_exceeded"
  | "unsupported";

export interface AgentModelRequest {
  system: string;
  messages: AgentMessage[];
  tools: AgentToolSpec[];
  maxOutputTokens: number;
  temperature: number;
  /** Aborted when the turn's deadline passes; providers that support it cancel the in-flight request. */
  signal: AbortSignal;
}

export interface AgentModelResponse {
  stopReason: AgentStopReason;
  /** Provider's raw stop reason (for traces only). */
  rawStopReason: string | null;
  content: AgentBlock[];
  /** Provider-reported usage; null when the provider did not report it (the controller then counts its own estimate). */
  usage: { inputTokens: number; outputTokens: number } | null;
}

export type ProviderErrorKind = "throttled" | "timeout" | "aborted" | "access_denied" | "validation" | "server" | "invalid_response" | "unknown";

/** Thrown by providers. Never carries prompt text, credentials or raw provider payloads. */
export class AgentProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "AgentProviderError";
  }
}

export interface AgentModelProvider {
  /** Identifier for traces/pricing (e.g. "apac.amazon.nova-pro-v1:0" or "mock"). */
  readonly modelId: string;
  /** Whether `signal` actually cancels the underlying request (if false, an aborted request may still complete server-side). */
  readonly supportsCancellation: boolean;
  converse(request: AgentModelRequest): Promise<AgentModelResponse>;
}
