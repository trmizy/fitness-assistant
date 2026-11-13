/**
 * Gymini V2 (EXPERIMENTAL, flag AI_AGENT_V2 default OFF) — the one catalog of the four bounded agents (M7-P1).
 *
 * Capability (frozen READ-only policy, personal tools, own-data signal) + runner per agent, built on the existing bounded
 * engine and tool registries. Domain deps default to the V1 READ clients each registry already uses (fitnessAgentTools,
 * enterprise-data readers); tests and the composition root may inject their own. No supervisor here — there is one
 * supervisor (supervisor.ts) and this only feeds it.
 */
import { runTrainingAgentTurn, TRAINING_PERSONAL_TOOLS, TRAINING_NEEDS_USER_DATA } from "./training-agent";
import { createTrainingToolRegistry, TRAINING_AGENT_PILOT_POLICY, type TrainingToolDeps } from "./training-tools";
import { runNutritionAgentTurn, NUTRITION_PERSONAL_TOOLS, NUTRITION_NEEDS_USER_DATA } from "./nutrition-agent";
import { createNutritionToolRegistry, NUTRITION_AGENT_PILOT_POLICY, type NutritionToolDeps } from "./nutrition-tools";
import { runRecoveryAgentTurn, RECOVERY_PERSONAL_TOOLS, RECOVERY_NEEDS_USER_DATA } from "./recovery-agent";
import { createRecoveryToolRegistry, RECOVERY_AGENT_PILOT_POLICY, type RecoveryToolDeps } from "./recovery-tools";
import { runProgressAgentTurn, PROGRESS_PERSONAL_TOOLS, PROGRESS_NEEDS_USER_DATA } from "./progress-agent";
import { createProgressToolRegistry, PROGRESS_AGENT_PILOT_POLICY, type ProgressToolDeps } from "./progress-tools";
import { createBoundedAgentRunner, nutritionFacts, progressFacts, recoveryFacts, trainingFacts } from "./supervisor";
import type { AgentCapability, AgentId, AgentRunner } from "./multi-agent-contracts";
import type { AgentModelProvider } from "./model-provider";
import type { ToolTraceEvent } from "./tool-registry";

export const AGENT_CAPABILITIES: Readonly<Record<AgentId, AgentCapability>> = Object.freeze({
  training: Object.freeze({ agentId: "training", domain: "training", description: "Training plan, today's schedule, exercise catalog", toolPolicy: TRAINING_AGENT_PILOT_POLICY, personalTools: TRAINING_PERSONAL_TOOLS, needsUserData: TRAINING_NEEDS_USER_DATA }),
  nutrition: Object.freeze({ agentId: "nutrition", domain: "nutrition", description: "Nutrition target, plan consistency, food search", toolPolicy: NUTRITION_AGENT_PILOT_POLICY, personalTools: NUTRITION_PERSONAL_TOOLS, needsUserData: NUTRITION_NEEDS_USER_DATA }),
  recovery: Object.freeze({ agentId: "recovery", domain: "recovery", description: "Logged training load and recent sessions", toolPolicy: RECOVERY_AGENT_PILOT_POLICY, personalTools: RECOVERY_PERSONAL_TOOLS, needsUserData: RECOVERY_NEEDS_USER_DATA }),
  progress: Object.freeze({ agentId: "progress", domain: "progress", description: "Measurements, strength trend, cycle status, forecast (scenario)", toolPolicy: PROGRESS_AGENT_PILOT_POLICY, personalTools: PROGRESS_PERSONAL_TOOLS, needsUserData: PROGRESS_NEEDS_USER_DATA }),
}) as Readonly<Record<AgentId, AgentCapability>>;

export interface AgentDomainDeps {
  training?: TrainingToolDeps;
  nutrition?: NutritionToolDeps;
  recovery?: RecoveryToolDeps;
  progress?: ProgressToolDeps;
}

export interface AgentRunnerOptions {
  /** One model provider per agent (they may share one). */
  providerFor: (agent: AgentId) => AgentModelProvider;
  /** Absent → each registry's V1 READ clients. */
  deps?: AgentDomainDeps;
  /** Undefined → each registry reads the flag itself (OFF unless AI_AGENT_V2=on). */
  enabled?: boolean;
  now?: () => number;
  toolTraceSink?: (event: ToolTraceEvent) => void;
}

/** The four runners, in no particular order (the supervisor orders delegations itself). */
export function createAgentRunners(o: AgentRunnerOptions): AgentRunner[] {
  const now = o.now ?? Date.now;
  const common = { ...(o.enabled === undefined ? {} : { enabled: o.enabled }), ...(o.toolTraceSink ? { traceSink: o.toolTraceSink } : {}) };
  return [
    createBoundedAgentRunner(AGENT_CAPABILITIES.training, runTrainingAgentTurn, { provider: o.providerFor("training"), registry: createTrainingToolRegistry({ ...common, ...(o.deps?.training ? { deps: o.deps.training } : {}) }), facts: trainingFacts }),
    createBoundedAgentRunner(AGENT_CAPABILITIES.nutrition, runNutritionAgentTurn, { provider: o.providerFor("nutrition"), registry: createNutritionToolRegistry({ ...common, ...(o.deps?.nutrition ? { deps: o.deps.nutrition } : {}) }), facts: nutritionFacts }),
    createBoundedAgentRunner(AGENT_CAPABILITIES.recovery, runRecoveryAgentTurn, { provider: o.providerFor("recovery"), registry: createRecoveryToolRegistry({ ...common, ...(o.deps?.recovery ? { deps: o.deps.recovery } : {}) }), facts: (i, d) => recoveryFacts(i, d, now()) }),
    createBoundedAgentRunner(AGENT_CAPABILITIES.progress, runProgressAgentTurn, { provider: o.providerFor("progress"), registry: createProgressToolRegistry({ ...common, ...(o.deps?.progress ? { deps: o.deps.progress } : {}) }), facts: progressFacts }),
  ];
}
