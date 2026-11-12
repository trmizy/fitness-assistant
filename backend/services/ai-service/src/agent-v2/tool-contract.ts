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
  domain: "training";
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
  | "TOOL_TIMEOUT"
  | "OUTPUT_INVALID"
  | "SYSTEM_ERROR";

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
