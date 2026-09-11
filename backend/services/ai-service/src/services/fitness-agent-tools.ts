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

async function domain<T>(identity: AgentIdentity, service: "user" | "fitness", method: "GET" | "POST", route: string, body: unknown, schema: z.ZodType<T>, timeoutMs = 20000): Promise<T> {
  const started = Date.now();
  const baseURL = service === "user" ? process.env.USER_SERVICE_URL ?? "http://localhost:3004" : process.env.FITNESS_SERVICE_URL ?? "http://localhost:3002";
  try {
    const response = await axios.request({ baseURL, url: route, method, data: body, timeout: timeoutMs,
      // x-internal-token (in addition to x-gateway-secret) — some domain
      // routes are guarded by internalAuthMiddleware specifically, which
      // checks this exact header name (not x-gateway-secret's own
      // readGatewayVerifiedUser mechanism). Harmless extra header for every
      // other route here, which never looks at it.
      headers: { ...(identity.authorizationHeader ? { Authorization: identity.authorizationHeader } : {}),
        "x-gateway-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-internal-token": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-user-id": identity.userId, "x-user-role": "CUSTOMER" } });
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
  // Agent automation (chat "hãy tạo và gán lộ trình/plan tập/dinh dưỡng vào
  // hệ thống") — all four calls below reuse EXISTING, already-shipped
  // fitness-service endpoints verbatim (the same ones GuidedRoadmapWizard.tsx
  // and the onboarding flow already call) via the same trusted domain()
  // helper every other tool here uses. No new roadmap/nutrition creation
  // logic — this only wires the agent up to what already exists and works.
  getRoadmapDiagnosis(identity: AgentIdentity, input: unknown) {
    return domain(identity, "fitness", "POST", "/fitness-roadmaps/diagnosis", input, z.record(z.unknown()));
  },
  generateRoadmapDraft(identity: AgentIdentity, input: unknown) {
    // Longer timeout: this is a multi-phase LLM generation (with per-phase
    // retries on JSON-parse failure) that routinely takes 20-90s — the
    // default 20s timeout here was firing client-side while the server kept
    // working, making this call intermittently fail with a spurious
    // "Domain service unavailable" (confirmed live: two runs timed out at
    // exactly ~20.0s while a third finished successfully at 19.4s).
    return domain(identity, "fitness", "POST", "/fitness-roadmaps/ai-draft", input, z.record(z.unknown()), 120000);
  },
  acceptRoadmapDraft(identity: AgentIdentity, payload: unknown) {
    return domain(identity, "fitness", "POST", "/fitness-roadmaps/ai-draft/accept", payload,
      z.object({ roadmap: z.object({ id: z.string() }).passthrough() }).passthrough());
  },
  activateRoadmap(identity: AgentIdentity, roadmapId: string) {
    return domain(identity, "fitness", "POST", `/fitness-roadmaps/${z.string().min(1).parse(roadmapId)}/activate`, {},
      z.record(z.unknown()));
  },
  // Roadmap management via chat for an EXISTING roadmap (as opposed to
  // CREATE_PLAN_BUNDLE, which only ever creates+activates a brand new one).
  // All five reuse the exact same real endpoints GuidedRoadmapWizard.tsx /
  // RoadmapJourneyPage.tsx already call — no new roadmap logic here either.
  // Response shape confirmed live: { roadmap, phases, activePhase,
  // activeCycle, pendingRebuild, finalSummary, trainingReadiness,
  // nutritionReadiness } — phases/activePhase/activeCycle are SIBLINGS of
  // roadmap, not nested inside it (roadmap itself only has its own scalar
  // columns). Kept as one object so callers get all of it, not just the
  // roadmap row.
  getCurrentRoadmap(identity: AgentIdentity) {
    return domain(identity, "fitness", "GET", "/fitness-roadmaps/current", undefined,
      z.object({ roadmap: z.record(z.unknown()), phases: z.array(z.record(z.unknown())) }).passthrough());
  },
  getCurrentDraftRoadmap(identity: AgentIdentity) {
    return domain(identity, "fitness", "GET", "/fitness-roadmaps/draft/current", undefined,
      z.object({ roadmap: z.record(z.unknown()), phases: z.array(z.record(z.unknown())) }).passthrough());
  },
  getCurrentRoadmapForecast(identity: AgentIdentity) {
    return domain(identity, "fitness", "GET", "/fitness-roadmaps/current/forecast", undefined, z.record(z.unknown()));
  },
  advanceRoadmapPhase(identity: AgentIdentity, roadmapId: string) {
    return domain(identity, "fitness", "POST", `/fitness-roadmaps/${z.string().min(1).parse(roadmapId)}/advance`, {},
      z.record(z.unknown()));
  },
  previewRoadmapRebuild(identity: AgentIdentity, roadmapId: string) {
    return domain(identity, "fitness", "POST", `/fitness-roadmaps/${z.string().min(1).parse(roadmapId)}/rebuild/preview`, {},
      z.object({ assessmentId: z.string() }).passthrough());
  },
  applyRoadmapRebuild(identity: AgentIdentity, roadmapId: string, assessmentId: string) {
    return domain(identity, "fitness", "POST", `/fitness-roadmaps/${z.string().min(1).parse(roadmapId)}/rebuild/apply`,
      { assessmentId }, z.record(z.unknown()));
  },
  archiveRoadmap(identity: AgentIdentity, roadmapId: string) {
    return domain(identity, "fitness", "POST", `/fitness-roadmaps/${z.string().min(1).parse(roadmapId)}/archive`, {},
      z.record(z.unknown()));
  },
  // Same real endpoint user-service calls right after onboarding
  // (nutrition-onboarding-bootstrap.service.ts) — idempotent: returns
  // already_initialized if a goal already exists, insufficient_data if the
  // profile is missing required fields, never a silent duplicate.
  bootstrapNutrition(identity: AgentIdentity) {
    return domain(identity, "fitness", "POST", "/internal/onboarding/bootstrap-nutrition", {},
      z.object({ success: z.boolean(), data: z.record(z.unknown()) }));
  },
  // Same real endpoint plan.controller.ts's savePlanToWorkoutLog calls —
  // takes a COMPLETED WorkoutPlan's weeklySchedule and creates a real
  // WorkoutProgram + WorkoutSchedule from it. Used by SAVE_GENERATED_PLAN
  // so "gán lịch tập này" persists the EXACT plan already shown in chat,
  // not a different one re-matched from the static template catalog.
  importAiPlanToSchedule(identity: AgentIdentity, payload: unknown) {
    return domain(identity, "fitness", "POST", "/workouts/from-ai-plan", payload, z.record(z.unknown()));
  },
  // /workouts/from-ai-plan requires a real exerciseId per exercise (Zod:
  // "Exercise ID is required") — the deterministic recommendation_engine.ts
  // template only has free-text exercise NAMES, so SAVE_GENERATED_PLAN
  // resolves each name against the real catalog via the same public search
  // the exercise-picker UI already uses, before ever calling from-ai-plan.
  // Confirmed live gaps between recommendation_engine.ts's exercise names
  // and the real catalog's own terminology for the same movement — the
  // catalog has no "Overhead Press"/"Back Squat" entries at all, only
  // "Military Press"/"Barbell Squat". Small and evidence-based: add an
  // entry here only after confirming (via a real DB query) the catalog
  // truly has no substring/plural/qualifier-dropped match.
  async searchExerciseByName(identity: AgentIdentity, name: string): Promise<{ id: string; exerciseName: string } | null> {
    const SYNONYMS: Record<string, string> = {
      "overhead press": "military press",
      "back squat": "barbell squat",
    };
    const search = async (term: string) => {
      const result = await domain(identity, "fitness", "GET",
        `/exercises?search=${encodeURIComponent(term)}&limit=20`, undefined,
        z.object({ success: z.boolean(), data: z.object({ exercises: z.array(z.object({ id: z.string(), exerciseName: z.string() }).passthrough()) }).passthrough() }));
      return result.data.exercises;
    };
    const pick = (exercises: { id: string; exerciseName: string }[], term: string) => {
      if (!exercises.length) return null;
      const normalized = term.trim().toLowerCase();
      const exact = exercises.find(e => e.exerciseName.trim().toLowerCase() === normalized);
      if (exact) return exact;
      // No exact match — prefer the shortest name over the DB's default
      // (alphabetical) order. Confirmed live: a plain "Deadlift" search
      // picked "Axle Deadlift" first alphabetically (a specialty-equipment
      // variant most users don't own) over the plain "Deadlift" everyone
      // has, which then failed equipment validation.
      return [...exercises].sort((a, b) => a.exerciseName.length - b.exerciseName.length)[0];
    };

    const trimmed = name.trim();
    let exercises = await search(trimmed);
    if (exercises.length) return pick(exercises, trimmed);

    // Fallback 1: plural -> singular ("Walking Lunges" -> "Walking Lunge").
    const singular = trimmed.replace(/s\b/i, "");
    if (singular !== trimmed) {
      exercises = await search(singular);
      if (exercises.length) return pick(exercises, singular);
    }

    // Fallback 2: drop the leading qualifier word ("Bulgarian Split Squat"
    // -> "Split Squat", "Cable Lateral Raise" -> "Lateral Raise"). Never
    // drops below 2 words — a single leftover word like "Squat" or "Press"
    // is too generic and risks matching an obscure numbered variant.
    const words = trimmed.split(/\s+/);
    if (words.length > 2) {
      const dropped = words.slice(1).join(" ");
      exercises = await search(dropped);
      if (exercises.length) return pick(exercises, dropped);
    }

    // Fallback 3: known catalog terminology differences.
    const synonym = SYNONYMS[trimmed.toLowerCase()];
    if (synonym) {
      exercises = await search(synonym);
      if (exercises.length) return pick(exercises, synonym);
    }

    return null;
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
