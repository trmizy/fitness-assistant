/**
 * Gymini V2 Multi-Agent — composition root (M7-P1, LOCAL INTEGRATION ONLY; owner-approved governance exception
 * 2026-11-13: this file and routes/ai-v2.routes.ts are the only V1-side files allowed to reach src/agent-v2).
 *
 * Loaded ONLY by routes/ai-v2.routes.ts through a dynamic import() after the flag check, so with the V2 flag OFF no
 * agent-v2 runtime module is even loaded. It assembles what already exists — it adds no supervisor, agent, tool or rule:
 *   identity        the caller of ask() passes the authenticated context (req.context) — never a body/header user id
 *   profile reader  agent-v2/profile-reader.ts (4 states) over the V1 service client (requestService: HTTP locally,
 *                   Lambda Invoke on AWS) — not profileExtractor
 *   domain READs    agent-v2/agent-catalog.ts with V1-transport deps (M7-P2, defaultDomainDeps): Training / Nutrition and
 *                   Progress cycle / assessment / forecast → fitnessAgentTools (V1 domain client over requestService);
 *                   Recovery + Progress body/training-window → domain-read-transport.ts (same endpoints over requestService,
 *                   typed errors) instead of the HTTP-only enterprise-data readers; /internal Training READs need the secret
 *   model           AgentModelProvider; default Bedrock Converse adapter (created lazily, no call until a turn needs one)
 *   session         M7-P3 resolveSessionStore(): AGENT_V2_SESSION_STORE=memory (local default, one process only) or
 *                   redis (AGENT_V2_SESSION_REDIS_URL; versioned compare-and-set store shared by instances). On
 *                   NODE_ENV=production persistence is REQUIRED: no in-memory fallback, a missing config is a 503.
 *   minor safety    M8-A2 resolveMinorRestrictionStore(): the self-reported "under 18" restriction is USER-scoped (authenticated userId,
 *                   independent of sessionId and of the session store). Only an in-memory store exists → outside production it is
 *                   used; on NODE_ENV=production the runtime is refused (503) until a persistent implementation exists.
 *   routing         M7-P4.3: deterministic intent-v1.3 by default; selective / always = agent-v2/hybrid-router.ts over the same
 *                   Bedrock adapter (one bounded call per turn inside the global budget), chosen by server configuration
 *                   only (agent-v2/flag.ts resolveRoutingConfig — invalid value → 503, production needs its own approval)
 *   budget/policy   the supervisor's defaults (SUPERVISOR_BUDGET, DEFAULT_EXECUTION_POLICY) — not overridden
 *   tracing         the supervisor / engine / registry default sinks (structured logs, codes and counts only)
 * Everything is injectable for offline tests (multiAgentRuntimeSeam).
 */
import { requestService } from "../clients/service-lambda.client";
import { createProfileReader, type ProfileServiceGet } from "../agent-v2/profile-reader";
import { createAgentRunners, type AgentDomainDeps } from "../agent-v2/agent-catalog";
import { DEFAULT_EXECUTION_POLICY, runSupervisorTurn, type SupervisorResult, type SupervisorTrace } from "../agent-v2/supervisor";
import { resolveRoutingConfig, isAgentV2HttpEnabled } from "../agent-v2/flag";
import { V2NotStartedError, type V2Executor } from "../services/coach-v2-bridge";
import { createHybridDecisionProvider } from "../agent-v2/hybrid-router";
import { createInMemorySessionStore, type AnySessionStore } from "../agent-v2/session-context";
import { createInMemoryMinorRestrictionStore, type MinorRestrictionStore } from "../agent-v2/minor-restriction";
import { createNodeRedisSessionClient, createRedisSessionStore, type SessionRedisClient } from "./redis-session-store";
import { createDynamoSessionSend, createDynamoSessionStore, type DynamoSend } from "./dynamodb-session-store";
import { ApiError } from "../errors/api-error";
import { createBedrockConverseProvider } from "../agent-v2/bedrock-converse-adapter";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { AgentModelProvider } from "../agent-v2/model-provider";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { ToolTraceEvent } from "../agent-v2/tool-registry";
import { fitnessAgentTools } from "../services/fitness-agent-tools";
import { createDomainReadTransport, requireInternalSecret, type ServiceRequester } from "./domain-read-transport";

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
  /** Absent → defaultDomainDeps() (V1 transport). */
  deps?: AgentDomainDeps;
  /** Transport for the default Recovery / Progress READs (tests inject a mock; default requestService). */
  readRequest?: ServiceRequester;
  profileGet?: ProfileServiceGet;
  /** Absent → resolveSessionStore(process.env). */
  sessionStore?: AnySessionStore;
  /** M8-A2: the USER-scoped minor-restriction store. Absent → resolveMinorRestrictionStore(env): in-memory outside production, a 503 on production (no persistent implementation exists yet). */
  restrictionStore?: MinorRestrictionStore;
  now?: () => number;
  traceSink?: (trace: SupervisorTrace) => void;
  agentTraceSink?: (trace: TurnTrace) => void;
  toolTraceSink?: (event: ToolTraceEvent) => void;
  /** M7-P4.3: where the routing configuration is read from (absent → process.env). Server configuration only. */
  env?: Record<string, string | undefined>;
  /** M7-P4.3: the routing model for selective / always (absent → the Bedrock Converse adapter). Never created in deterministic mode. */
  routingModelFactory?: () => AgentModelProvider;
}

export function createMultiAgentRuntime(o: MultiAgentRuntimeOptions = {}): MultiAgentRuntime {
  // M7-P4.3 routing mode (agent-v2/flag.ts resolveRoutingConfig): deterministic by default; an invalid value refuses the
  // runtime (503) instead of guessing; a model-assisted mode on production needs its own approval or stays deterministic
  const routing = resolveRoutingConfig(o.env ?? process.env);
  if (!routing.ok) throw new ApiError("SERVICE_UNAVAILABLE", "The assistant's routing is not configured", 503);
  let shared: AgentModelProvider | null = null;
  const providerFor = o.providerFor ?? (() => (shared ??= createBedrockConverseProvider()));
  const now = o.now ?? Date.now;
  const runners = createAgentRunners({ providerFor, deps: o.deps ?? defaultDomainDeps({ request: o.readRequest }), now, toolTraceSink: o.toolTraceSink });
  const profileReader = createProfileReader({ get: o.profileGet ?? ((req) => requestService(req)), now });
  const sessionStore = o.sessionStore ?? resolveSessionStore();
  // M8-A2: the self-reported minor restriction is user-scoped and ALWAYS present (never a silent "no store")
  const restrictionStore = o.restrictionStore ?? resolveMinorRestrictionStore(o.env ?? process.env);
  // deterministic: no routing model exists at all (the supervisor's default intent-v1.3 provider is used)
  const decisionProvider = routing.effective === "deterministic" ? null : createHybridDecisionProvider({
    model: (o.routingModelFactory ?? (() => createBedrockConverseProvider()))(),
    maxAgents: DEFAULT_EXECUTION_POLICY.maxAgentsPerTurn, mode: routing.effective, now,
  });
  const routingMode = { requested: routing.requested, effective: routing.effective, reason: routing.reason };
  return {
    ask: ({ question, identity, sessionId }) => runSupervisorTurn(
      { question, context: { userId: identity.userId, ...(identity.authorizationHeader ? { authorizationHeader: identity.authorizationHeader } : {}) }, ...(sessionId ? { sessionId } : {}) },
      {
        runners, profileReader, sessionStore, restrictionStore, now, routingMode, ...(decisionProvider ? { decisionProvider } : {}),
        ...(o.traceSink ? { traceSink: o.traceSink } : {}), ...(o.agentTraceSink ? { agentTraceSink: o.agentTraceSink } : {}),
      },
    ),
  };
}

/**
 * M7-P3: which session store this process uses. Config names avoid the flag's name on purpose (only agent-v2 reads it).
 *   AGENT_V2_SESSION_STORE = "memory" | "redis" | "dynamodb"   (unset → "memory" outside production; production REQUIRES
 *                                                               "redis" or "dynamodb" — never memory, never a fallback)
 *   AGENT_V2_SESSION_REDIS_URL                     (required for "redis"; never hardcoded, never traced)
 *   AGENT_V2_SESSION_TABLE + AGENT_V2_SESSION_REGION (required for "dynamodb"; validated; no default table or region)
 * Anything else, or "redis" without a URL, is a configuration error — never a silent fallback to memory.
 */
export function resolveSessionStore(env: Record<string, string | undefined> = process.env, createClient: (url: string) => SessionRedisClient = createNodeRedisSessionClient,
  createDynamoSend: (region: string) => DynamoSend = createDynamoSessionSend): AnySessionStore {
  const production = env.NODE_ENV === "production";
  const mode = (env.AGENT_V2_SESSION_STORE ?? (production ? "" : "memory")).trim().toLowerCase();
  const fail = () => new ApiError("SERVICE_UNAVAILABLE", "The assistant's session storage is not configured", 503);
  if (mode === "memory" && !production) return createInMemorySessionStore();
  if (mode === "redis") {
    const url = (env.AGENT_V2_SESSION_REDIS_URL ?? "").trim();
    if (!/^rediss?:\/\/\S+$/.test(url)) throw fail();
    return createRedisSessionStore({ client: createClient(url) });
  }
  if (mode === "dynamodb") {
    const table = (env.AGENT_V2_SESSION_TABLE ?? "").trim();
    const region = (env.AGENT_V2_SESSION_REGION ?? "").trim();
    if (!/^[A-Za-z0-9_.-]{3,255}$/.test(table) || !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) throw fail();
    return createDynamoSessionStore({ tableName: table, send: createDynamoSend(region) });
  }
  throw fail();
}

/**
 * M8-A2: which USER-scoped minor-restriction store this process uses. Only an in-memory implementation exists (ONE process, lost on
 * restart). Outside production it is used (local / tests). On NODE_ENV=production there is NO acceptable implementation yet
 * (the Redis / DynamoDB SESSION adapters do not implement MinorRestrictionStore) → a configuration error (503), never an
 * in-memory fallback and never "no store": the runtime refuses to start rather than run without the cross-session restriction.
 */
export function resolveMinorRestrictionStore(env: Record<string, string | undefined> = process.env): MinorRestrictionStore {
  if (env.NODE_ENV === "production") throw new ApiError("SERVICE_UNAVAILABLE", "The assistant's safety storage is not configured", 503);
  return createInMemoryMinorRestrictionStore();
}

/**
 * M7-P2: the READ deps the four agents get by default. Every one goes through requestService (HTTP locally, Lambda Invoke
 * when <SERVICE>_LAMBDA_NAME is set) with the user's own bearer. Read-only functions only — no WRITE function is in any
 * deps object (the registries also refuse WRITE contracts independently).
 */
export function defaultDomainDeps(o: { request?: ServiceRequester } = {}): Required<AgentDomainDeps> {
  const reads = createDomainReadTransport(o.request ? { request: o.request } : {});
  const t = fitnessAgentTools;
  return {
    training: {
      getUserFitnessContext: t.getUserFitnessContext, getCurrentProgram: t.getCurrentProgram, getTodaySchedule: t.getTodaySchedule,
      searchExerciseByName: t.searchExerciseByName, listExercises: t.listExercises, getExerciseSubstitute: t.getExerciseSubstitute,
      getExerciseMuscleProfiles: requireInternalSecret(t.getExerciseMuscleProfiles), validatePlanEquipment: requireInternalSecret(t.validatePlanEquipment),
      getActiveCycle: t.getActiveCycle, getLatestAssessment: t.getLatestAssessment, getScientificEvidence: t.getScientificEvidence,
    },
    nutrition: { getNutritionTargetPreview: t.getNutritionTargetPreview, getNutritionActiveState: t.getNutritionActiveState, searchFood: t.searchFood },
    recovery: { getTrainingAnalytics: reads.getTrainingAnalytics, getRecentWorkoutHistory: reads.getRecentWorkoutHistory },
    progress: {
      getBodyGoalState: reads.getBodyGoalState, getTrainingAnalytics: reads.getTrainingAnalytics,
      getActiveCycle: t.getActiveCycle, getLatestAssessment: t.getLatestAssessment, getCurrentRoadmapForecast: t.getCurrentRoadmapForecast,
    },
  };
}

/**
 * M9.2-T3: the V2Executor the AI Coach bridge (services/coach-v2-bridge.ts) runs a turn through. It adds no supervisor, agent,
 * router or tool: it only calls the SAME runtime POST /ai/v2/ask uses, with the SAME gates:
 *   - V2's own HTTP gate (flag + the production second approval). Closed → V2NotStartedError: nothing was processed, the bridge
 *     hands the request to V1 (this is how the production second approval of V2 also holds for the bridge).
 *   - the runtime is created lazily; a failure to create it (routing / session / minor-store configuration) is NOT "not started":
 *     it propagates, and the bridge treats it as a final V2 failure — never a V1 retry (required safety state may be missing).
 *   - identity is the verified (userId, bearer) the bridge forwards; the body of a V2 turn is only { question, sessionId? }.
 * Loaded only through a dynamic import() from routes/ai-v2.routes.ts, after the bridge's own gates passed.
 */
export function createCoachV2Executor(o: { runtime?: () => MultiAgentRuntime; env?: Record<string, string | undefined> } = {}): V2Executor {
  return {
    async ask({ question, sessionId, userId, authorizationHeader }) {
      if (!isAgentV2HttpEnabled(o.env ?? process.env)) throw new V2NotStartedError("V2 is not enabled");
      const runtime = (o.runtime ?? getMultiAgentRuntime)();
      return runtime.ask({
        question,
        identity: { userId, ...(authorizationHeader ? { authorizationHeader } : {}) },
        ...(sessionId ? { sessionId } : {}),
      });
    },
  };
}

/** Test seam: a factory replacing the default runtime (offline tests inject mock models / domain deps / profile client). */
export const multiAgentRuntimeSeam: { factory: (() => MultiAgentRuntime) | null } = { factory: null };
let defaultRuntime: MultiAgentRuntime | null = null;

export function getMultiAgentRuntime(): MultiAgentRuntime {
  if (multiAgentRuntimeSeam.factory) return multiAgentRuntimeSeam.factory();
  return (defaultRuntime ??= createMultiAgentRuntime());
}
