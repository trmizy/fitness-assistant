/**
 * Gymini V2 Multi-Agent — composition root (M7-P1, LOCAL INTEGRATION ONLY; owner-approved governance exception
 * 2026-11-13: this file and routes/ai-v2.routes.ts are the only V1-side files allowed to reach src/agent-v2).
 *
 * Loaded ONLY by routes/ai-v2.routes.ts through a dynamic import() after the flag check, so with the V2 flag OFF no
 * agent-v2 runtime module is even loaded. It assembles what already exists — it adds no supervisor, agent, tool or rule:
 *   identity        the caller of ask() passes the authenticated context (req.context) — never a body/header user id
 *   profile reader  agent-v2/profile-reader.ts (4 states) over the V1 service client (requestService: HTTP locally,
 *                   Lambda Invoke on AWS) — not profileExtractor
 *   domain READs    agent-v2/agent-catalog.ts → each registry's V1 READ clients (fitnessAgentTools, enterprise-data)
 *   model           AgentModelProvider; default Bedrock Converse adapter (created lazily, no call until a turn needs one)
 *   session         SessionContextStore; default process-local in-memory (LOCAL ONLY — not persistent, not shared
 *                   between Lambda instances, not production-ready)
 *   budget/policy   the supervisor's defaults (SUPERVISOR_BUDGET, DEFAULT_EXECUTION_POLICY) — not overridden
 *   tracing         the supervisor / engine / registry default sinks (structured logs, codes and counts only)
 * Everything is injectable for offline tests (multiAgentRuntimeSeam).
 */
import { requestService } from "../clients/service-lambda.client";
import { createProfileReader, type ProfileServiceGet } from "../agent-v2/profile-reader";
import { createAgentRunners, type AgentDomainDeps } from "../agent-v2/agent-catalog";
import { runSupervisorTurn, type SupervisorResult, type SupervisorTrace } from "../agent-v2/supervisor";
import { createInMemorySessionStore, type SessionContextStore } from "../agent-v2/session-context";
import { createBedrockConverseProvider } from "../agent-v2/bedrock-converse-adapter";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { AgentModelProvider } from "../agent-v2/model-provider";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { ToolTraceEvent } from "../agent-v2/tool-registry";

export interface MultiAgentAskInput {
  question: string;
  /** From req.context only (requireAuth). */
  identity: { userId: string; authorizationHeader?: string };
  /** A client HINT; the session scope is (authenticated userId, sessionId). */
  sessionId?: string;
}

export interface MultiAgentRuntime {
  ask(input: MultiAgentAskInput): Promise<SupervisorResult>;
}

export interface MultiAgentRuntimeOptions {
  providerFor?: (agent: AgentId) => AgentModelProvider;
  deps?: AgentDomainDeps;
  profileGet?: ProfileServiceGet;
  sessionStore?: SessionContextStore;
  now?: () => number;
  traceSink?: (trace: SupervisorTrace) => void;
  agentTraceSink?: (trace: TurnTrace) => void;
  toolTraceSink?: (event: ToolTraceEvent) => void;
}

export function createMultiAgentRuntime(o: MultiAgentRuntimeOptions = {}): MultiAgentRuntime {
  let shared: AgentModelProvider | null = null;
  const providerFor = o.providerFor ?? (() => (shared ??= createBedrockConverseProvider()));
  const now = o.now ?? Date.now;
  const runners = createAgentRunners({ providerFor, deps: o.deps, now, toolTraceSink: o.toolTraceSink });
  const profileReader = createProfileReader({ get: o.profileGet ?? ((req) => requestService(req)), now });
  const sessionStore = o.sessionStore ?? createInMemorySessionStore();
  return {
    ask: ({ question, identity, sessionId }) => runSupervisorTurn(
      { question, context: { userId: identity.userId, ...(identity.authorizationHeader ? { authorizationHeader: identity.authorizationHeader } : {}) }, ...(sessionId ? { sessionId } : {}) },
      {
        runners, profileReader, sessionStore, now,
        ...(o.traceSink ? { traceSink: o.traceSink } : {}), ...(o.agentTraceSink ? { agentTraceSink: o.agentTraceSink } : {}),
      },
    ),
  };
}

/** Test seam: a factory replacing the default runtime (offline tests inject mock models / domain deps / profile client). */
export const multiAgentRuntimeSeam: { factory: (() => MultiAgentRuntime) | null } = { factory: null };
let defaultRuntime: MultiAgentRuntime | null = null;

export function getMultiAgentRuntime(): MultiAgentRuntime {
  if (multiAgentRuntimeSeam.factory) return multiAgentRuntimeSeam.factory();
  return (defaultRuntime ??= createMultiAgentRuntime());
}
