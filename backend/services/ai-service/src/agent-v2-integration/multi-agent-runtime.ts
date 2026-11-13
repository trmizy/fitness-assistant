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
  const runners = createAgentRunners({ providerFor, deps: o.deps ?? defaultDomainDeps({ request: o.readRequest }), now, toolTraceSink: o.toolTraceSink });
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

/** Test seam: a factory replacing the default runtime (offline tests inject mock models / domain deps / profile client). */
export const multiAgentRuntimeSeam: { factory: (() => MultiAgentRuntime) | null } = { factory: null };
let defaultRuntime: MultiAgentRuntime | null = null;

export function getMultiAgentRuntime(): MultiAgentRuntime {
  if (multiAgentRuntimeSeam.factory) return multiAgentRuntimeSeam.factory();
  return (defaultRuntime ??= createMultiAgentRuntime());
}
