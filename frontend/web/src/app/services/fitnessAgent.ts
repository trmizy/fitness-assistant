import { api } from "./api";

export type ImageChatResult =
  | { type: "EQUIPMENT"; equipmentName: string; targetMuscles: string[]; howToUse: string; safetyNote: string; answer: string }
  | { type: "WORKOUT_SCHEDULE"; summary: string; days: Array<{ label: string; exercises: string[] }>; answer: string }
  | { type: "GENERAL"; answer: string };

export type SubstituteCandidate = { mealId?: string; label?: string; itemName: string; [key: string]: any };
export type CycleEvaluationResult = {
  id: string; cycleId: string;
  decision: string | null; aiSummary: string | null; userDecision: string;
  nutritionDecision: string | null; nutritionAiHeadline: string | null; nutritionAiExplanation: string | null; nutritionUserDecision: string;
};

export interface AgentChatBlock {
  type: "PT_RECOMMENDATIONS" | "PROGRAM_RECOMMENDATIONS" | "ACTION_CONFIRMATION" | "ACTION_RESULT" | "GOAL_ANALYSIS" | "IMAGE_CHAT" | "SUBSTITUTE_RESULT" | "CYCLE_EVALUATION_RESULT" | "WORKFLOW_MISSING_DATA" | "PROFILE_UPDATE_CONFIRMATION" | "WORKOUT_PLAN_PREVIEW" | "NUTRITION_PLAN_PREVIEW";
  recommendationId?: string; actionId?: string; kind?: string; title?: string; note?: string; expiresAt?: string;
  risk?: "LOW" | "MEDIUM" | "HIGH";
  // PT_RECOMMENDATIONS/PROGRAM_RECOMMENDATIONS: PT/program candidate cards (id/name/compatibility/...).
  // SUBSTITUTE_RESULT: a *different* shape — SubstituteCandidate[] (mealId/label/itemName) — rendered
  // in its own branch below, never through the generic PT/program candidate-card renderer.
  candidates?: Array<any>; evidence?: Array<{ id: string; title: string; sourceUrl: string; finding: string; evidenceLevel: string }>;
  warnings?: string[]; summary?: Record<string, any>; attributes?: Record<string, any>;
  result?: ImageChatResult;
  message?: string; steps?: string[];
  nextUrl?: string; goalConfirmed?: boolean; status?: string;
  // CYCLE_EVALUATION_RESULT (tryEvaluateCycle) — real fields spread onto the block; see CycleEvaluationResult.
  decision?: string | null; aiSummary?: string | null; userDecision?: string;
  nutritionDecision?: string | null; nutritionAiHeadline?: string | null; nutritionAiExplanation?: string | null; nutritionUserDecision?: string;
  // WORKFLOW_MISSING_DATA (agent-workflow/orchestrator.ts) — "known so far" vs "still missing" slot summary.
  workflowId?: string; workflowType?: string; known?: string[]; missing?: string[];
  // PROFILE_UPDATE_CONFIRMATION — proposed profile field changes awaiting explicit user confirmation.
  changes?: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
  // Codex Conversational AI Coach Evaluation #1 — server-computed from slot
  // persistence metadata (never hardcoded per field): whether "Chỉ dùng cho
  // lần này" is a valid choice for this batch. Always false today (every
  // reachable PROFILE_UPDATE_CONFIRMATION batch is PROFILE_FACT, which has
  // no legitimate use-once mode), reserved true for a future
  // PERSISTABLE_PREFERENCE slot.
  allowUseOnce?: boolean;
  // WORKOUT_PLAN_PREVIEW (fitness-agent.service.ts::proposeWorkoutPlan/
  // tryReviseWorkoutPlanDraft) — a draft-only generated workout, revised
  // in place via free-text chat before the SAME actionId/confirm() flow
  // every other ACTION_CONFIRMATION-style block already uses.
  goal?: string | null; daysPerWeek?: number; sessionMinutes?: number;
  days?: Array<{ day: string; goal: string; firstDate?: string | null; exercises: Array<{ name: string; sets: number; reps: string; restSeconds: number }> }>;
  // NUTRITION_PLAN_PREVIEW (fitness-agent.service.ts::proposeNutritionPlan/
  // tryPollOrReviseNutritionPlanDraft) — reuses `days`'s slot on this same
  // interface with a different, nutrition-shaped element type (a real
  // AgentChatBlock is only ever ONE of these two shapes per `type`, never
  // both at once).
  targetNote?: string; excludedFoods?: string[]; softPreferences?: string[];
  mealsPerDay?: number; dailyCaloriesTarget?: number; proteinTargetGrams?: number; carbTargetGrams?: number; fatTargetGrams?: number;
  nutritionDays?: Array<{ dayNumber: number; title: string; totalCalories: number; meals: Array<{ mealType: string; title: string; calories: number; protein: number; carbs: number; fat: number; items: Array<{ name: string; quantity: number; unit: string; calories: number }> }> }>;
}
export interface AgentReply { sessionId: string; conversationId: string; block: AgentChatBlock }
async function post(url: string, body: unknown): Promise<AgentReply> {
  const { data } = await api.post(url, body, { timeout: 60000 });
  return data.data;
}
export const fitnessAgentService = {
  choose: (id: string, candidateId: string, packageId?: string) => post(`/ai/agent/recommendations/${id}/choose`, { candidateId, packageId }),
  confirm: (id: string) => post(`/ai/agent/actions/${id}/confirm`, { confirmed: true }),
  // Cancels a workout/nutrition DRAFT server-side ("Bỏ qua bản này") — distinct from confirm.
  dismiss: (id: string) => post(`/ai/agent/actions/${id}/dismiss`, {}),
  confirmGoal: (sessionId: string, goal: unknown) => post("/ai/agent/goal/confirm", { sessionId, goal }),
  async image(file: File, sessionId?: string) {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error("Chọn ảnh JPEG/PNG dưới 4 MB.");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file);
    });
    return post("/ai/agent/goal-image", { image: { mediaType: file.type, base64 }, sessionId });
  },
  async imageChat(file: File, question: string, sessionId?: string) {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error("Chọn ảnh JPEG/PNG dưới 4 MB.");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file);
    });
    return post("/ai/agent/image-chat", { image: { mediaType: file.type, base64 }, question: question.trim() || undefined, sessionId });
  },
};
