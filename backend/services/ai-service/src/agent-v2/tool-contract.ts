/**
 * Gymini V2 (EXPERIMENTAL) — tool contract types.
 *
 * A tool is declared once as a contract: stable id, kind (READ / DRAFT / WRITE), Zod input schema, a projection that
 * reduces the raw domain result to what the model may see, and a Zod schema for that projection. The registry
 * (tool-registry.ts) is the only place that executes a contract.
 *
 * Identity: the user is NEVER an argument. Handlers receive the authenticated context built from the verified request
 * (same AgentIdentity shape V1 tools use), so a model cannot choose whose data a tool reads.
 */
import type { z } from "zod";

export type ToolKind = "READ" | "DRAFT" | "WRITE";

/** Built by the HTTP boundary from the verified request (gateway / JWT) — never from model output. */
export interface AuthenticatedToolContext {
  userId: string;
  authorizationHeader?: string;
}

export interface ToolContract<I = unknown, R = unknown, O = unknown, D = unknown> {
  /** Stable, namespaced id, e.g. "training.get_current_program". Never reused for a different behavior. */
  id: string;
  title: string;
  /** Shown to the model in P2: what the tool does and when to use it. */
  description: string;
  domain: "training" | "nutrition" | "recovery" | "progress";
  /** READ: reads only. DRAFT: builds a proposal, persists nothing. WRITE: mutates — declared for design, never executable by an agent. */
  kind: ToolKind;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  timeoutMs: number;
  /** Human-readable rule of what may flow back to the model (reviewed with the projection). */
  llmExposure: string;
  /** Calls the existing V1 domain function(s). null for WRITE contracts: there is no executable path. */
  handler: ((ctx: AuthenticatedToolContext, input: I, deps: D) => Promise<R>) | null;
  /** Reduces the raw result to the model-safe shape (data minimisation). */
  project: (raw: R) => O;
}

export type ToolErrorCode =
  | "AGENT_V2_DISABLED"
  | "TOOL_NOT_FOUND"
  | "TOOL_NOT_ALLOWED"
  | "WRITE_NOT_PERMITTED"
  | "DRAFT_NOT_PERMITTED"
  | "UNAUTHENTICATED"
  | "IDENTITY_IN_ARGUMENTS"
  | "VALIDATION_ERROR"
  | "CROSS_USER_DATA"
  | "DOMAIN_ERROR"
  /** M7-P1: the domain service refused the signed-in user (HTTP 401/403) — distinct from "nothing found" / other 4xx. */
  | "DOMAIN_ACCESS_DENIED"
  /** M7-P2: the domain service answered 404 for this read (nothing of that kind exists / unknown resource). */
  | "DOMAIN_NOT_FOUND"
  /** M7-P2: the CALLER is misconfigured (no internal secret for an /internal read, Lambda not found / not permitted, no region…). */
  | "CONFIGURATION_ERROR"
  | "TOOL_TIMEOUT"
  | "OUTPUT_INVALID"
  | "SYSTEM_ERROR";

/**
 * M7-P1: the V1 enterprise-data readers return {status:"error", message} for EVERY failure (their catch keeps only the
 * HTTP client's message). The access decision is recovered from that client's wording ("Request failed with status code 403") so a
 * refused read is not reported as an outage. Anything else stays 503 (unchanged). String-based on purpose: V1 readers are
 * not modified.
 */
export function readErrorStatus(read: unknown): number {
  const m = /status code (\d{3})\b/.exec(String((read as { message?: unknown } | null | undefined)?.message ?? ""));
  const status = m ? Number(m[1]) : NaN;
  return status === 401 || status === 403 ? status : 503;
}

/** Error classes the model may be told about. Messages are fixed strings: no domain text, ids, stack or secrets. */
export const ERROR_CLASS: Record<ToolErrorCode, "policy" | "authorization" | "validation" | "domain" | "system"> = {
  AGENT_V2_DISABLED: "policy",
  TOOL_NOT_FOUND: "policy",
  TOOL_NOT_ALLOWED: "policy",
  WRITE_NOT_PERMITTED: "policy",
  DRAFT_NOT_PERMITTED: "policy",
  UNAUTHENTICATED: "authorization",
  IDENTITY_IN_ARGUMENTS: "authorization",
  CROSS_USER_DATA: "authorization",
  VALIDATION_ERROR: "validation",
  DOMAIN_ERROR: "domain",
  DOMAIN_ACCESS_DENIED: "authorization",
  DOMAIN_NOT_FOUND: "domain",
  CONFIGURATION_ERROR: "system",
  TOOL_TIMEOUT: "system",
  OUTPUT_INVALID: "system",
  SYSTEM_ERROR: "system",
};

export interface ToolError {
  code: ToolErrorCode;
  class: (typeof ERROR_CLASS)[ToolErrorCode];
  message: string;
  retryable: boolean;
}

export type ToolResult<O = unknown> =
  | { ok: true; toolId: string; kind: ToolKind; data: O }
  | { ok: false; toolId: string; error: ToolError };

export interface AgentToolPolicy {
  agentId: string;
  allowedTools: readonly string[];
  /** DRAFT tools also need this explicitly; WRITE tools are never executable whatever a policy says. */
  allowDraft: boolean;
}
