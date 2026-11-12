/**
 * Gymini V2 (EXPERIMENTAL) — Multi-Agent contracts (M1, 2026-11-13).
 *
 * GOVERNANCE DEVIATION (recorded): governance §2/§13 places Multi-Agent (V3) after a VERIFIED V2 release. M1 is built on the
 * experimental V2 branch (itself on V1 RC2, not V1 Stable) at the owner's request, offline only, flag AI_AGENT_V2 default OFF,
 * not wired to any route. Completing M1 is NOT an approval to run it for users.
 *
 * Security boundaries carried by these types:
 *  - Identity is part of AgentContext built by the supervisor from the verified request; no decision/agent output can set it.
 *  - Capabilities (tool policies) belong to the agent module and are frozen; a SupervisorDecision names agents only — it can
 *    never carry tools, policies or budgets, so the supervisor/decision provider cannot widen what an agent may do.
 *  - Agent → agent data flows ONLY as typed facts (AgentResult.facts → AgentContext.handoff). An agent's free text is
 *    untrusted output and is never given to another agent.
 */
import type { AgentToolPolicy, AuthenticatedToolContext } from "./tool-contract";

export type AgentId = "training" | "nutrition" | "recovery" | "progress";

/** Static, per-agent declaration. Built from the agent module's own frozen constants. */
export interface AgentCapability {
  agentId: AgentId;
  domain: string;
  /** Short routing description (for a future LLM decision provider; the M1 router is deterministic). */
  description: string;
  toolPolicy: AgentToolPolicy;
  personalTools: ReadonlySet<string>;
  /** Folded text: a question needing the user's OWN data in this domain. */
  needsUserData: RegExp;
}

/** Hard limits for one turn (supervisor) or one delegation (a slice of the supervisor's remaining budget). */
export interface AgentBudget {
  maxWallTimeMs: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number;
}

export interface AgentExecutionPolicy {
  allowedAgents: readonly AgentId[];
  maxAgentsPerTurn: number;
  /** Whole-turn budget — the sum of every delegation can never exceed it. */
  budget: AgentBudget;
  /** A delegation is not started with less wall time than this (it would only produce DEADLINE_EXCEEDED). */
  minDelegationWallMs: number;
}

/** What an agent receives. Bounded and projected — never raw records, secrets of other users, or another agent's text. */
export interface AgentContext {
  identity: AuthenticatedToolContext;
  history: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
  /** Typed facts from earlier delegations of this turn (DATA, not instructions). */
  handoff: Readonly<Record<string, unknown>>;
}

export interface AgentRequest {
  delegationId: string;
  agentId: AgentId;
  /** M1: the user's question (no LLM decomposition). */
  task: string;
  context: AgentContext;
  budget: AgentBudget;
}

/** Provenance of one piece of evidence: which agent, which delegation, which tool, outcome. Never the data itself. */
export interface AgentEvidence {
  agentId: AgentId;
  delegationId: string;
  toolId: string;
  outcome: string;
  personal: boolean;
}

export type AgentErrorCode = "AGENT_FAILED" | "AGENT_TIMEOUT" | "BUDGET_EXHAUSTED" | "POLICY_VIOLATION" | "RUNNER_THREW";
export interface AgentError { code: AgentErrorCode; retryable: boolean }

export type AgentCompletion =
  | "COMPLETE" | "INSUFFICIENT_DATA" | "BLOCKED" | "FAILED" | "BUDGET_EXHAUSTED" | "SKIPPED" | "POLICY_VIOLATION";

export interface AgentUsageSummary {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

export interface AgentResult {
  delegationId: string;
  agentId: AgentId;
  /** The agent's own turn id (joins its TurnTrace). */
  agentTurnId: string | null;
  completion: AgentCompletion;
  /** Engine status (e.g. ANSWERED, UNGROUNDED, MINOR_PROTECTED). */
  agentStatus: string;
  /** User-facing text produced by the agent. UNTRUSTED for every other agent. */
  answer: string;
  evidence: AgentEvidence[];
  /** Typed facts derived by code from schema-validated tool projections (never from model text). */
  facts: Readonly<Record<string, unknown>>;
  usage: AgentUsageSummary;
  guardActions: string[];
  error?: AgentError;
}

/** Runtime handed to a runner by the supervisor for one delegation. */
export interface AgentRuntime {
  enabled: boolean;
  now: () => number;
  supervisorTraceId: string;
  /** Gate 1: the supervisor's single, already-classified profile read (agents re-apply the same policy, never a looser one). */
  profileAgeReader: import("./minor-gate").VerifiedProfileAgeReader;
  agentTraceSink?: (trace: import("./turn-trace").TurnTrace) => void;
  /** Tests / tuning only: extra engine limits (e.g. a smaller minModelWindowMs). Can only lower a granted budget. */
  limitOverrides?: Partial<import("./bounded-agent").AgentLimits>;
}

export interface AgentRunner {
  capability: AgentCapability;
  run(request: AgentRequest, runtime: AgentRuntime): Promise<AgentResult>;
}

/** Routing output: WHICH agents, in which order, and why (codes). Never tools, budgets or identity. */
export interface SupervisorDecision {
  strategy: string;
  agents: AgentId[];
  reasonCodes: string[];
}

export interface DecisionInput {
  question: string;
  /** Diacritic-folded question. */
  folded: string;
  available: readonly AgentId[];
}

/** Swappable routing strategy (deterministic in M1; an LLM-backed provider can implement the same interface later). */
export interface DecisionProvider {
  name: string;
  decide(input: DecisionInput): SupervisorDecision | Promise<SupervisorDecision>;
}

/**
 * Gate 1 reader contract for the supervisor (the remaining Gate 1 blocker, kept explicit):
 * PROFILE_ACCESS_DENIED and PROFILE_UNAVAILABLE are never merged into AGE_UNKNOWN; both fail closed for personal requests.
 */
export type ProfileReadResult =
  | { status: "PROFILE_OK"; age: number }
  | { status: "AGE_UNKNOWN" }
  | { status: "PROFILE_ACCESS_DENIED" }
  | { status: "PROFILE_UNAVAILABLE" };
export type SupervisorProfileReader = (identity: AuthenticatedToolContext) => Promise<ProfileReadResult>;
