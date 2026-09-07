import axios from "axios";
import { z } from "zod";
import { logger, AgentPreferencesSchema, type AgentPreferences, type PTCandidate } from "@gym-coach/shared";
import { profileExtractor } from "../llm/profile_extractor";
import { buildCoachContext } from "../coach/coach_context_builder";
import { listLocalEvidenceDocuments } from "../knowledge-pipeline/local-evidence";

export interface AgentIdentity { userId: string; authorizationHeader?: string }
const contextSchema = z.object({ goal: z.string().nullable(), experience: z.string().nullable(),
  days: z.array(z.number()), sessionMinutes: z.number(), budgetVnd: z.number().nullable(),
  reviewRequired: z.boolean(), injuries: z.array(z.string()), equipment: z.array(z.string()),
}).passthrough();
export interface ProgramCandidate {
  id: string; name: string; goal: string; daysPerWeek: number; durationWeeks: number;
  estimatedMinutes: number; experienceLevel: string; focusMuscles: string[];
  fingerprint: string; dataOrigin: string; days: unknown[];
}
const candidateSchema = z.object({ id: z.string().uuid(), name: z.string(), packages: z.array(z.object({
  id: z.string().uuid(), price: z.number().nonnegative(), sessions: z.number().int().positive(),
}).passthrough()), dataOrigin: z.enum(["REAL", "SYNTHETIC"]), history: z.object({ count: z.number().int().nonnegative() }).passthrough() }).passthrough();
const ptResultSchema = z.object({ candidates: z.array(candidateSchema).max(60), preferences: AgentPreferencesSchema,
  historyAuditId: z.string(), truncated: z.boolean() });
const programSchema = z.object({ id: z.string().uuid(), name: z.string(), goal: z.string(), daysPerWeek: z.number(),
  durationWeeks: z.number(), estimatedMinutes: z.number(), experienceLevel: z.string(), focusMuscles: z.array(z.string()),
  fingerprint: z.string(), dataOrigin: z.enum(["REAL", "SYNTHETIC"]), days: z.array(z.unknown()), });

async function domain<T>(identity: AgentIdentity, service: "user" | "fitness", method: "GET" | "POST", route: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const started = Date.now();
  const baseURL = service === "user" ? process.env.USER_SERVICE_URL ?? "http://localhost:3004" : process.env.FITNESS_SERVICE_URL ?? "http://localhost:3002";
  try {
    const response = await axios.request({ baseURL, url: route, method, data: body, timeout: 20000,
      headers: { ...(identity.authorizationHeader ? { Authorization: identity.authorizationHeader } : {}),
        "x-gateway-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-user-id": identity.userId, "x-user-role": "CUSTOMER" } });
    const output = schema.parse(response.data);
    logger.info({ tool: route, latencyMs: Date.now() - started, status: "success" }, "fitness agent tool");
    return output;
  } catch (error: any) {
    logger.warn({ tool: route, latencyMs: Date.now() - started, status: error.response?.status ?? 503 }, "fitness agent tool failed");
    throw Object.assign(new Error(error.response?.status < 500 ? error.response.data?.error ?? "Request rejected" : "Domain service unavailable"), { status: error.response?.status ?? 503 });
  }
}

export const fitnessAgentTools = {
  async getUserFitnessContext(identity: AgentIdentity) {
    const profile = await domain(identity, "user", "GET", "/profile/agent/context", undefined, contextSchema);
    const personal = await profileExtractor.extract(identity.userId, identity.authorizationHeader);
    return { profile, coach: buildCoachContext({ userId: identity.userId, ...personal }) };
  },
  async findPTCandidates(identity: AgentIdentity, preferences: AgentPreferences) {
    const result = await domain(identity, "user", "POST", "/profile/agent/candidates", AgentPreferencesSchema.parse(preferences), ptResultSchema);
    return { ...result, candidates: result.candidates as unknown as PTCandidate[] };
  },
  findTrainingPrograms(identity: AgentIdentity, preferences: AgentPreferences) {
    return domain(identity, "fitness", "POST", "/workouts/agent/candidates", AgentPreferencesSchema.parse(preferences),
      z.object({ programs: z.array(programSchema).max(40), warnings: z.array(z.string()) }));
  },
  createPTContractDraft(identity: AgentIdentity, payload: unknown) {
    return domain(identity, "user", "POST", "/profile/agent/drafts", payload,
      z.object({ id: z.string().uuid(), snapshot: z.record(z.unknown()), expiresAt: z.string(), status: z.string() }));
  },
  confirmPTContract(identity: AgentIdentity, draftId: string) {
    return domain(identity, "user", "POST", `/profile/agent/drafts/${z.string().uuid().parse(draftId)}/confirm`, { confirmed: true },
      z.object({ contractId: z.string().uuid(), status: z.string(), nextUrl: z.literal("/client/contracts") }));
  },
  applyTrainingPlan(identity: AgentIdentity, payload: unknown) {
    return domain(identity, "fitness", "POST", "/workouts/agent/apply", payload,
      z.object({ createdProgramId: z.string().uuid(), nextUrl: z.literal("/client/training") }));
  },
  confirmGoal(identity: AgentIdentity, payload: unknown) {
    return domain(identity, "user", "POST", "/profile/agent/goal", payload, z.record(z.unknown()));
  },
  substituteMealItem(identity: AgentIdentity, payload: {
    currentFoodMention: string; desiredFoodMention?: string | null; mode?: "REPLACE" | "CHEAPER" | "HIGHER_PROTEIN" | "VEGETARIAN";
    mealHint?: string | null; resolvedMealId?: string | null;
  }) {
    return domain(identity, "fitness", "POST", "/nutrition/agent/substitute-meal-item", payload, z.object({
      status: z.enum(["APPLIED", "AMBIGUOUS_MEAL", "AMBIGUOUS_ITEM", "NOT_FOUND", "LOCKED", "NO_ACTIVE_PROGRAM", "NO_CANDIDATE", "INVALID_INPUT"]),
      message: z.string(),
    }).passthrough());
  },
  // Adaptive Cycle Evaluation via chat (docs/agentic-fitness/01_NUTRITION_
  // AGENT_TOOLS_PLAN.md, phase C) — reuses the EXISTING general training-
  // cycle routes verbatim (no bespoke /agent/* route needed: they already
  // return exactly this shape and authMiddleware already accepts the
  // gateway-verified identity domain() sends), unlike the PT/program/
  // substitute tools above, which each needed real new resolution logic.
  async getActiveCycle(identity: AgentIdentity) {
    return domain(identity, "fitness", "GET", "/training-cycles/active", undefined,
      z.object({ cycle: z.object({ id: z.string().uuid() }).passthrough(), summary: z.unknown() }));
  },
  async evaluateCycle(identity: AgentIdentity, cycleId: string) {
    return domain(identity, "fitness", "POST", `/training-cycles/${z.string().uuid().parse(cycleId)}/evaluate`, {},
      z.object({
        id: z.string().uuid(), cycleId: z.string().uuid(),
        decision: z.string().nullable(), aiSummary: z.string().nullable(), userDecision: z.string(),
        nutritionDecision: z.string().nullable(), nutritionAiHeadline: z.string().nullable(),
        nutritionAiExplanation: z.string().nullable(), nutritionUserDecision: z.string(),
      }).passthrough());
  },
  async getLatestAssessment(identity: AgentIdentity, cycleId: string) {
    return domain(identity, "fitness", "GET", `/training-cycles/${z.string().uuid().parse(cycleId)}/assessments/latest`, undefined,
      z.object({
        id: z.string().uuid(), cycleId: z.string().uuid(),
        decision: z.string().nullable(), userDecision: z.string(),
        nutritionDecision: z.string().nullable(), nutritionUserDecision: z.string(),
      }).passthrough());
  },
  reviewRecommendation(identity: AgentIdentity, params: {
    cycleId: string; assessmentId: string; target: "TRAINING" | "NUTRITION"; decision: "ACCEPT" | "REJECT";
  }) {
    const segment = params.target === "NUTRITION" ? "nutrition-recommendation" : "recommendation";
    const verb = params.decision === "ACCEPT" ? "accept" : "reject";
    return domain(identity, "fitness", "POST", `/training-cycles/${z.string().uuid().parse(params.cycleId)}/${segment}/${verb}`,
      { assessmentId: params.assessmentId }, z.record(z.unknown()));
  },
  getScientificEvidence(goal: string) {
    try {
      // Reuse the curated corpus and its stable hashes; no invented citations or stats.
      const terms = goal === "WEIGHT_LOSS" ? /protein|resistance|energy|weight loss/i : /resistance|hypertrophy|volume|frequency/i;
      return listLocalEvidenceDocuments().filter(d => terms.test(d.title)).slice(0, 4).map(d => ({
        id: d.contentHash, title: d.title, sourceUrl: d.url, finding: d.cleanText.slice(0, 500),
        evidenceLevel: d.evidenceLevel ?? "UNSPECIFIED", version: d.contentHash,
      }));
    } catch {
      return [];
    }
  },
};
