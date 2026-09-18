import axios from "axios";
import { z } from "zod";
import { logger, AgentPreferencesSchema, type AgentPreferences, type PTCandidate, type TrainingProgramCandidate } from "@gym-coach/shared";
import { profileExtractor } from "../llm/profile_extractor";
import { buildCoachContext } from "../coach/coach_context_builder";
import { listLocalEvidenceDocuments } from "../knowledge-pipeline/local-evidence";

export interface AgentIdentity { userId: string; authorizationHeader?: string }
// goalIntent: closes the Image -> GoalContext -> Recommendation loop
// (docs/ai-agent-implementation-report.md's own named gap, closed in the
// 2026-09-14 hardening pass). user-service's agenticFitnessService.context()
// already returns the confirmed GoalIntentSchema-shaped object (primaryGoal,
// muscularity, relativeLeanness, focusMuscles) as-is via HTTP passthrough —
// it simply was never read on this side. Left as a loose record (not the
// strict GoalIntentSchema, which would reject the two extra fields
// user-service actually stores — version/confirmedAt) since this is
// narration-input grounding, not a validated write; only known-safe
// categorical fields are ever extracted from it downstream.
const contextSchema = z.object({ goal: z.string().nullable(), experience: z.string().nullable(),
  days: z.array(z.number()), sessionMinutes: z.number(), budgetVnd: z.number().nullable(),
  reviewRequired: z.boolean(), injuries: z.array(z.string()), equipment: z.array(z.string()),
  goalIntent: z.record(z.unknown()).nullable().optional(),
}).passthrough();
const candidateSchema = z.object({ id: z.string().uuid(), name: z.string(), packages: z.array(z.object({
  id: z.string().uuid(), price: z.number().nonnegative(), sessions: z.number().int().positive(),
}).passthrough()), dataOrigin: z.enum(["REAL", "SYNTHETIC"]), history: z.object({ count: z.number().int().nonnegative() }).passthrough() }).passthrough();
const ptResultSchema = z.object({ candidates: z.array(candidateSchema).max(60), preferences: AgentPreferencesSchema,
  historyAuditId: z.string(), truncated: z.boolean() });
const programSchema = z.object({ id: z.string().uuid(), name: z.string(), goal: z.string(), daysPerWeek: z.number(),
  durationWeeks: z.number(), estimatedMinutes: z.number(), experienceLevel: z.string(), focusMuscles: z.array(z.string()),
  fingerprint: z.string(), dataOrigin: z.enum(["REAL", "SYNTHETIC"]), days: z.array(z.unknown()), });

// Explicit whitelist for updateProfileFields() below — a strict SUBSET of
// user-service's real profileSchema (profile.models.ts), scoped to exactly
// the fields the AI Coach workflow orchestrator is designed to ask about
// and persist. Anything else in the real profileSchema (photoUrl,
// safetyScreeningStatus, hasCompletedOnboarding, unitSystem, ...) is
// deliberately NOT reachable through this path — a workflow slot can only
// ever target a field that's both listed here AND has a real SlotDefinition
// mapping it (see agent-workflow/workflows/*.ts).
// `preferredTrainingDays` is deliberately EXCLUDED here even though it is a
// real, writable UserProfile field: user-service's own profileSchema
// constrains it to 0-6, while every AgentPreferences-based day array
// elsewhere in this agent system (fitness-agent-intent.ts::parseTrainingDays,
// slot-values.ts::parseTrainingDays, AgentPreferencesSchema) uses a
// DIFFERENT 1-7 convention (matching Vietnamese "Thứ N" numbering,
// confirmed against the frontend's own `d === 7 ? "CN" : "T" + (d + 1)`
// rendering). Writing one convention's values into the other's field
// without an independently-verified conversion would risk silently
// corrupting a real user's schedule — training-day preference therefore
// stays WORKFLOW_ONLY (ephemeral AgentPreferences.days) for this pass,
// exactly like it already is for PT/PROGRAM search today.
// age/gender/heightCm/currentWeight ARE included (unlike
// preferredTrainingDays) — each is a single unambiguous scalar with an
// identical name/unit/range on both sides (profile.models.ts's
// profileSchema and agent-workflow/slot-values.ts's parsers), no
// convention mismatch to risk. This is required for correctness, not just
// completeness: CREATE_ROADMAP's proposePlanBundle re-checks these exact
// fields against the REAL profile after a workflow resume (it has no
// override mechanism of its own — fitness-service's generateAiRoadmapDraft
// route only accepts targetWeightKg/targetBodyFatPercent/
// trainingDaysPerWeek as overrides, never age/height/currentWeight/gender,
// see fitness-roadmap.models.ts). If a genuinely-missing one of these were
// left WORKFLOW_ONLY, resuming after collecting it via chat would silently
// re-hit "missing profile info" and ask the user to repeat themselves —
// exactly the bug this whitelist exists to prevent.
export const agentUpdatableProfileFieldsSchema = z.object({
  goal: z.enum(["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"]).optional(),
  targetWeight: z.number().positive().max(400).optional(),
  age: z.number().int().min(13).max(120).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  heightCm: z.number().positive().max(300).optional(),
  currentWeight: z.number().positive().max(400).optional(),
}).strict();
export type AgentUpdatableProfileFields = z.infer<typeof agentUpdatableProfileFieldsSchema>;

async function domain<T>(identity: AgentIdentity, service: "user" | "fitness", method: "GET" | "POST" | "PUT", route: string, body: unknown, schema: z.ZodType<T>, timeoutMs = 20000): Promise<T> {
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
      z.object({ programs: z.array(programSchema).max(40), warnings: z.array(z.string()) }))
      .then(result => ({ ...result, programs: result.programs as TrainingProgramCandidate[] }));
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
  // Conversational AI Coach workflow orchestration (2026-09-15) —
  // docs/conversational-ai-coach-workflow-audit.md §5: no agent-specific
  // profile-update endpoint exists in user-service; PUT /profile/me
  // (profileSchema, profile.routes.ts) is the real, already-safe,
  // already-validated write path — it just requires the end user's own
  // JWT, which `identity.authorizationHeader` already carries (the same
  // token-forwarding domain() uses for every other tool here). This wraps
  // that exact endpoint with an EXPLICIT field whitelist (never a generic
  // PATCH — see design doc §5/§29) so a slot-filling workflow can only ever
  // set the specific fields it's designed to ask about, never an arbitrary
  // property name an LLM extractor might produce.
  updateProfileFields(identity: AgentIdentity, fields: AgentUpdatableProfileFields) {
    const body = agentUpdatableProfileFieldsSchema.parse(fields);
    return domain(identity, "user", "PUT", "/profile/me", body, z.record(z.unknown()));
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
  // "ghi lại tôi vừa ăn X" — grounds the logged calories/macros in the real
  // Food catalog (same public search the Food Library page uses) instead
  // of ever letting an LLM invent a nutrition number for a logged meal.
  async searchFood(identity: AgentIdentity, name: string): Promise<{ id: string; name: string; calories: number; protein: number; carbs: number; fats: number } | null> {
    const search = async (term: string) => domain(identity, "fitness", "GET", `/food/search?q=${encodeURIComponent(term)}`, undefined,
      z.array(z.object({ id: z.string(), name: z.string(), calories: z.number(), protein: z.number(), carbs: z.number(), fats: z.number() }).passthrough()));
    const pick = (foods: { id: string; name: string; calories: number; protein: number; carbs: number; fats: number }[], term: string) => {
      if (!foods.length) return null;
      const normalized = term.trim().toLowerCase();
      const exact = foods.find(f => f.name.trim().toLowerCase() === normalized);
      if (exact) return exact;
      // Confirmed live: shortest-name-wins (the exercise-catalog heuristic)
      // backfires for food — USDA entries like "..., NS as to cooking
      // method, ..." (NS = Not Specified) are the semantically neutral,
      // no-strong-assumption pick for an unspecified real dish, but they're
      // LONGER strings than an unrelated, much more specific variant
      // ("tenders, breaded, uncooked" for a plain "ức gà luộc" query — a
      // raw breaded cutlet is a materially different food from boiled
      // chicken breast). Prefer "NS as to cooking method" when present.
      const unspecified = foods.find(f => /ns as to cooking method/i.test(f.name));
      return unspecified ?? [...foods].sort((a, b) => a.name.length - b.name.length)[0];
    };
    const trimmed = name.trim();
    let foods = await search(trimmed);
    if (foods.length) return pick(foods, trimmed);

    // Fallback: strip a trailing Vietnamese cooking-method word ("ức gà
    // luộc" -> "ức gà") — the real catalog is USDA-style (simple
    // ingredients), so a compound "ingredient + preparation" phrase from
    // free-text chat often has no direct alias even when the base
    // ingredient does.
    const stripped = trimmed.replace(/\s+(luộc|chiên|xào|nướng|hấp|rang|áp chảo|kho)$/i, "");
    if (stripped !== trimmed) {
      foods = await search(stripped);
      if (foods.length) return pick(foods, stripped);
    }
    return null;
  },
  createNutritionLog(identity: AgentIdentity, payload: unknown) {
    return domain(identity, "fitness", "POST", "/nutrition", payload, z.record(z.unknown()));
  },
  // Today's scheduled workout session — start/skip/cancel via chat, same
  // real endpoints workoutController already exposes to the client UI.
  getTodaySchedule(identity: AgentIdentity) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    return domain(identity, "fitness", "GET", `/workouts/schedules?startDate=${today}&endDate=${today}`, undefined,
      z.array(z.record(z.unknown())));
  },
  startWorkoutSchedule(identity: AgentIdentity, scheduleId: string) {
    return domain(identity, "fitness", "POST", `/workouts/schedules/${z.string().min(1).parse(scheduleId)}/start`, {},
      z.record(z.unknown()));
  },
  skipWorkoutSchedule(identity: AgentIdentity, scheduleId: string) {
    return domain(identity, "fitness", "POST", `/workouts/schedules/${z.string().min(1).parse(scheduleId)}/skip`,
      { notes: "Bỏ qua qua AI Coach" }, z.record(z.unknown()));
  },
  cancelWorkoutSchedule(identity: AgentIdentity, scheduleId: string) {
    return domain(identity, "fitness", "POST", `/workouts/schedules/${z.string().min(1).parse(scheduleId)}/cancel`,
      { reason: "Hủy qua AI Coach" }, z.record(z.unknown()));
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
  // CREATE_WORKOUT_PLAN revision ("Đổi squat", "Tôi không muốn deadlift",
  // "Tôi không có máy cable" when a specific machine-tied exercise can be
  // identified) — wraps the EXISTING, already-signed-off
  // `exerciseSubstitutionService.rankSubstitutes` the "Đổi bài tập" UI
  // already uses during live workout execution (see
  // gymini-ai-workout-grounding skill — this is the SAME engine, not a
  // second implementation). Real-equipment-aware and deterministic — never
  // an LLM guess. Route is `authMiddleware`-guarded (real end-user JWT),
  // which `domain()` already forwards via `identity.authorizationHeader`
  // for every other tool here, so no new auth wiring is needed.
  async getExerciseSubstitute(identity: AgentIdentity, exerciseId: string, excludeExerciseIds: string[] = []): Promise<{ id: string; exerciseName: string } | null> {
    const query = new URLSearchParams();
    if (excludeExerciseIds.length) query.set("excludeExerciseIds", excludeExerciseIds.join(","));
    query.set("limit", "1");
    try {
      const result = await domain(identity, "fitness", "GET",
        `/exercises/${encodeURIComponent(exerciseId)}/substitute?${query.toString()}`, undefined,
        z.object({ success: z.boolean().optional(), substitutes: z.array(z.object({ id: z.string(), exerciseName: z.string() }).passthrough()).optional(),
          substitute: z.object({ id: z.string(), exerciseName: z.string() }).passthrough().optional() }).passthrough());
      const first = result.substitutes?.[0] ?? result.substitute;
      return first ? { id: first.id, exerciseName: first.exerciseName } : null;
    } catch {
      // 404 ("no suitable substitute") is a real, expected outcome here,
      // not a system failure — the caller must treat null as "couldn't
      // swap this one", never fabricate a replacement.
      return null;
    }
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
  // Training-cycle management via chat — reuses the same real endpoints
  // the client UI already calls, same as roadmap advance/rebuild/archive.
  completeCycle(identity: AgentIdentity, cycleId: string) {
    return domain(identity, "fitness", "POST", `/training-cycles/${z.string().min(1).parse(cycleId)}/complete`, {},
      z.record(z.unknown()));
  },
  cancelCycle(identity: AgentIdentity, cycleId: string) {
    return domain(identity, "fitness", "POST", `/training-cycles/${z.string().min(1).parse(cycleId)}/cancel`, {},
      z.record(z.unknown()));
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
