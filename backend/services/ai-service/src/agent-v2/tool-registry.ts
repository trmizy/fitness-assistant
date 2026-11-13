/**
 * Gymini V2 (EXPERIMENTAL) — tool registry: the ONLY place a tool contract is executed.
 *
 * Order of checks for every call (each refusal happens before any domain call):
 *   flag ON → tool exists → in the agent's allowlist → kind permitted (WRITE never; DRAFT only with allowDraft)
 *   → authenticated context present → no identity-like key anywhere in the arguments → input schema
 *   → handler under a timeout → ownership of the raw result (defence in depth) → projection → output schema.
 * Errors are classified (policy / authorization / validation / domain / system) with fixed messages: no domain text,
 * ids, stack traces or secrets are ever returned to the model. Every call emits exactly one trace event without raw
 * arguments.
 *
 * Deliberately small: one registry, per-agent policies, Training first. No plugin system, no multi-agent routing.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { isAgentV2Enabled } from "./flag";
import {
  ERROR_CLASS, type AgentToolPolicy, type AuthenticatedToolContext, type ToolContract, type ToolError, type ToolErrorCode,
  type ToolKind, type ToolResult,
} from "./tool-contract";

export interface ToolTraceEvent {
  traceId: string;
  /** P3: the agent turn this call belongs to (joins with the TurnTrace); absent for direct registry use. */
  turnId?: string;
  agentId: string;
  toolId: string;
  kind: ToolKind | "UNKNOWN";
  outcome: "ok" | ToolErrorCode;
  durationMs: number;
  /**
   * Shape of the arguments only: sorted key names (any depth) and their count — never values. (P1 used an unkeyed, truncated
   * SHA-256 of the arguments; small value spaces such as exercise names made it reversible by dictionary, removed 2026-11-12.)
   */
  argsShape: { keys: string[]; keyCount: number };
  at: string;
}

export interface ToolRegistryOptions<D = unknown> {
  /** Default: isAgentV2Enabled(process.env) — OFF unless AI_AGENT_V2=on. */
  enabled?: boolean;
  deps?: D;
  traceSink?: (event: ToolTraceEvent) => void;
  /** Tests only: shortens every contract's timeout. */
  timeoutOverrideMs?: number;
}

const MESSAGES: Record<ToolErrorCode, string> = {
  AGENT_V2_DISABLED: "The experimental agent is disabled.",
  TOOL_NOT_FOUND: "Unknown tool.",
  TOOL_NOT_ALLOWED: "This tool is not available to this agent.",
  WRITE_NOT_PERMITTED: "This tool changes saved data and cannot be called by an agent. Use the confirmation flow.",
  DRAFT_NOT_PERMITTED: "This agent may not prepare drafts.",
  UNAUTHENTICATED: "No authenticated user for this request.",
  IDENTITY_IN_ARGUMENTS: "Arguments must not name a user; the signed-in user is always used.",
  VALIDATION_ERROR: "Invalid arguments.",
  CROSS_USER_DATA: "The data returned did not belong to the signed-in user and was withheld.",
  DOMAIN_ERROR: "The request was rejected by the fitness service (for example: nothing found, or invalid).",
  DOMAIN_ACCESS_DENIED: "The fitness service did not allow this read for the signed-in user.",
  DOMAIN_NOT_FOUND: "Nothing of that kind was found for the signed-in user.",
  CONFIGURATION_ERROR: "The data source is not configured for this environment.",
  TOOL_TIMEOUT: "The tool did not answer in time.",
  OUTPUT_INVALID: "The tool returned data in an unexpected format.",
  SYSTEM_ERROR: "The tool failed because of a system error.",
};
const RETRYABLE = new Set<ToolErrorCode>(["TOOL_TIMEOUT", "SYSTEM_ERROR"]);
/** M7-P2: typed read-transport failure kinds (agent-v2-integration/domain-read-transport.ts DomainReadError). */
const KIND_CODE: Readonly<Record<string, ToolErrorCode>> = Object.freeze({
  ACCESS_DENIED: "DOMAIN_ACCESS_DENIED", NOT_FOUND: "DOMAIN_NOT_FOUND", UNAVAILABLE: "SYSTEM_ERROR", TIMEOUT: "TOOL_TIMEOUT",
  INVALID_RESPONSE: "OUTPUT_INVALID", CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
});

/** Keys that would let a caller pick (or a response smuggle) another user. Compared case-insensitively, ignoring _ and -. */
const IDENTITY_KEYS = new Set(["userid", "clientuserid", "owneruserid", "identity", "authorization", "authorizationheader", "xuserid", "token", "accesstoken"]);
const OWNERSHIP_KEYS = new Set(["userid", "clientuserid", "owneruserid"]);
const norm = (k: string) => k.toLowerCase().replace(/[_-]/g, "");

function findKey(value: unknown, keys: Set<string>, depth = 0): Array<{ key: string; value: unknown }> {
  if (depth > 12 || value === null || typeof value !== "object") return [];
  const out: Array<{ key: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(norm(k))) out.push({ key: k, value: v });
    out.push(...findKey(v, keys, depth + 1));
  }
  return out;
}

const contextSchema = z.object({
  userId: z.string().trim().min(1).max(128).regex(/^\S+$/),
  authorizationHeader: z.string().optional(),
});

function argsShape(args: unknown): { keys: string[]; keyCount: number } {
  if (!args || typeof args !== "object") return { keys: [], keyCount: 0 };
  // Key names come from the tool schemas (or are rejected by them); capped so a hostile argument object cannot bloat a log line.
  const keys = Object.keys(flattenKeys(args)).map((k) => k.slice(0, 40)).sort().slice(0, 20);
  return { keys, keyCount: Object.keys(flattenKeys(args)).length };
}
function flattenKeys(o: object, acc: Record<string, true> = {}, depth = 0): Record<string, true> {
  if (depth > 12) return acc;
  for (const [k, v] of Object.entries(o)) { acc[k] = true; if (v && typeof v === "object") flattenKeys(v, acc, depth + 1); }
  return acc;
}

class ToolTimeout extends Error {}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ToolTimeout()), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

export function createToolRegistry<D = unknown>(options: ToolRegistryOptions<D> = {}) {
  const enabled = options.enabled ?? isAgentV2Enabled();
  const contracts = new Map<string, ToolContract<any, any, any, D>>();
  const sink = options.traceSink ?? ((e: ToolTraceEvent) => logger.info(e, "agent_v2_tool_call"));

  function register(contract: ToolContract<any, any, any, D>) {
    if (contracts.has(contract.id)) throw new Error(`duplicate tool id: ${contract.id}`);
    if (contract.kind !== "WRITE" && typeof contract.handler !== "function") throw new Error(`${contract.id}: READ/DRAFT tools need a handler`);
    contracts.set(contract.id, contract);
  }

  /**
   * `callOptions.timeoutMs` (P2): the caller's remaining turn budget. The effective timeout is the smaller of it and the
   * contract's own. The timeout stops WAITING; V1 domain calls take no AbortSignal, so the underlying request may still
   * finish — the caller tracks that as in-flight work and never uses a late result.
   */
  async function execute(policy: AgentToolPolicy, toolId: string, rawArgs: unknown, rawCtx: unknown, callOptions: { timeoutMs?: number; onStart?: () => void; onSettled?: () => void; turnId?: string } = {}): Promise<ToolResult> {
    const started = Date.now();
    const contract = contracts.get(toolId);
    const finish = (outcome: "ok" | ToolErrorCode) => {
      try {
        sink({ traceId: randomUUID(), ...(callOptions.turnId ? { turnId: callOptions.turnId } : {}), agentId: policy.agentId, toolId, kind: contract?.kind ?? "UNKNOWN", outcome,
          durationMs: Date.now() - started, argsShape: argsShape(rawArgs), at: new Date().toISOString() });
      } catch { /* tracing must never break a call */ }
    };
    const fail = (code: ToolErrorCode): ToolResult => {
      finish(code);
      const error: ToolError = { code, class: ERROR_CLASS[code], message: MESSAGES[code], retryable: RETRYABLE.has(code) };
      return { ok: false, toolId, error };
    };

    if (!enabled) return fail("AGENT_V2_DISABLED");
    if (!contract) return fail("TOOL_NOT_FOUND");
    if (!policy.allowedTools.includes(toolId)) return fail("TOOL_NOT_ALLOWED");
    if (contract.kind === "WRITE" || contract.handler === null) return fail("WRITE_NOT_PERMITTED");
    if (contract.kind === "DRAFT" && !policy.allowDraft) return fail("DRAFT_NOT_PERMITTED");

    const ctx = contextSchema.safeParse(rawCtx);
    if (!ctx.success) return fail("UNAUTHENTICATED");
    const identity: AuthenticatedToolContext = { userId: ctx.data.userId, ...(ctx.data.authorizationHeader ? { authorizationHeader: ctx.data.authorizationHeader } : {}) };

    if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) return fail("VALIDATION_ERROR");
    if (findKey(rawArgs, IDENTITY_KEYS).length) return fail("IDENTITY_IN_ARGUMENTS");
    const input = contract.input.safeParse(rawArgs);
    if (!input.success) return fail("VALIDATION_ERROR");

    const timeoutMs = Math.max(1, Math.min(options.timeoutOverrideMs ?? contract.timeoutMs, callOptions.timeoutMs ?? Number.POSITIVE_INFINITY));
    let raw: unknown;
    try {
      callOptions.onStart?.();
      const work = contract.handler(identity, input.data, options.deps as D);
      // settles when the UNDERLYING work ends (even after a timeout) — lets the caller count in-flight work honestly
      work.then(() => callOptions.onSettled?.(), () => callOptions.onSettled?.());
      raw = await withTimeout(work, timeoutMs);
    } catch (err: any) {
      if (err instanceof ToolTimeout) return fail("TOOL_TIMEOUT");
      // M7-P2: a typed kind from the V2 read transport wins; otherwise the transport status (never message text)
      const kind = typeof err?.kind === "string" ? err.kind : null;
      if (kind) return fail(KIND_CODE[kind] ?? "SYSTEM_ERROR");
      const status = Number(err?.status ?? err?.response?.status);
      return fail(status === 401 || status === 403 ? "DOMAIN_ACCESS_DENIED" : status === 404 ? "DOMAIN_NOT_FOUND" : status >= 400 && status < 500 ? "DOMAIN_ERROR" : "SYSTEM_ERROR");
    }

    // Defence in depth: the domain services already scope by the forwarded identity; if a response ever carries another
    // user's ownership id, nothing of it reaches the model.
    if (findKey(raw, OWNERSHIP_KEYS).some((o) => o.value !== null && o.value !== undefined && o.value !== identity.userId)) return fail("CROSS_USER_DATA");

    let projected: unknown;
    try { projected = contract.project(raw); } catch { return fail("OUTPUT_INVALID"); }
    const out = contract.output.safeParse(projected);
    if (!out.success) return fail("OUTPUT_INVALID");

    finish("ok");
    return { ok: true, toolId, kind: contract.kind, data: out.data };
  }

  return {
    enabled,
    register,
    execute,
    has: (id: string) => contracts.has(id),
    /** Contracts an agent may call (for the P2 tool list shown to the model): allowlisted, never WRITE, DRAFT only if allowed. */
    toolsFor: (policy: AgentToolPolicy) => [...contracts.values()].filter((c) =>
      policy.allowedTools.includes(c.id) && c.kind !== "WRITE" && (c.kind === "READ" || policy.allowDraft)),
  };
}

export type ToolRegistry<D = unknown> = ReturnType<typeof createToolRegistry<D>>;
