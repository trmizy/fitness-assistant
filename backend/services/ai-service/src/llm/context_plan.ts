import { foldVi } from "./speech_act";

/**
 * Context-on-demand: which prompt blocks a turn needs, with a token budget per block and a ContextManifest for debugging.
 *
 * Before (eval 2026-11-11, 175 LLM answers): every LLM turn carried InBody/workout/nutrition history, all memories, the
 * programs, the body-composition analysis, the full CoachContext JSON and a second evidence retrieval shaped by the PROFILE
 * (not the question) — p50 ≈ 5.750 input tokens even for "Plank nên giữ bao lâu?". Now the intent and a few question
 * signals decide. The rules block, the question, the stated constraints (TurnFacts) and the deterministic "nguồn sự thật"
 * notes (weight conflict, macro check, TDEE) are always kept: they are small and correctness-critical.
 */
export type ContextBlock =
  | "profile"
  | "turn_facts"
  | "chat_history"
  | "session_state"
  | "memories"
  | "inbody_history"
  | "workout_history"
  | "nutrition_history"
  | "programs"
  | "body_composition"
  | "coach_context"
  | "recommendation"
  | "retrieval"
  | "body_comp_evidence";

/** Approximate token budget per block (Vietnamese ≈ 3.5 chars/token). A block over budget is cut at item boundaries. */
export const CONTEXT_TOKEN_BUDGET: Record<ContextBlock, number> = {
  profile: 150,
  turn_facts: 200,
  chat_history: 900,
  session_state: 80,
  memories: 200,
  inbody_history: 500,
  workout_history: 700,
  nutrition_history: 500,
  programs: 500,
  body_composition: 700,
  coach_context: 1500,
  recommendation: 600,
  retrieval: 1100,
  body_comp_evidence: 600,
};

export interface ContextPlan {
  blocks: Set<ContextBlock>;
  reasons: Partial<Record<ContextBlock, string>>;
}

export interface ContextPlanInput {
  intent: string;
  question: string;
  personalQuestion: boolean;
  bodyCompositionQuestion: boolean;
  mentionsInjury: boolean;
  hasSessionHistory: boolean;
}

const NUTRITION_INTENTS = new Set(["meal_plan_request", "nutrient_timing_request", "combined_plan_request", "body_recomposition_request"]);
const TRAINING_INTENTS = new Set([
  "workout_plan_request", "frequency_change_request", "muscle_group_routine_request", "specific_exercise_request",
  "schedule_specific_day_request", "combined_plan_request", "body_recomposition_request",
]);
const PROGRESS = /\b(tien do|tien bo|tien trien|so voi|xu huong|thay doi|da giam|da tang|giam duoc|tang duoc|ket qua|progress|trend)\b/;
const MY_TRAINING = /\b(lich (tap )?cua (toi|em|minh)|chuong trinh (cua|hien tai)|buoi tap (cua|truoc|gan)|toi da tap|em da tap|bai toi dang tap)\b/;
const MY_NUTRITION = /\b(toi da an|em da an|nhat ky an|an uong cua (toi|em|minh)|thuc don (cua|hien tai))\b/;

export function planContext(input: ContextPlanInput): ContextPlan {
  const blocks = new Set<ContextBlock>(["profile", "turn_facts", "memories", "retrieval"]);
  const reasons: ContextPlan["reasons"] = {
    profile: "always (compact demographics)",
    turn_facts: "always (constraints the user stated)",
    memories: "filtered by memory_selection (domain-relevant, trusted)",
    retrieval: "question-based RAG",
  };
  const add = (b: ContextBlock, why: string) => { if (!blocks.has(b)) { blocks.add(b); reasons[b] = why; } };
  const q = foldVi(input.question);

  if (input.hasSessionHistory) { add("chat_history", "same-session follow-up context"); add("session_state", "same-session concerns"); }

  if (NUTRITION_INTENTS.has(input.intent)) {
    add("nutrition_history", "nutrition intent");
    add("coach_context", "nutrition intent needs goal/targets");
    add("recommendation", "deterministic targets are the source of truth");
    add("programs", "active nutrition program");
  }
  if (TRAINING_INTENTS.has(input.intent)) {
    add("workout_history", "training intent");
    add("programs", "active workout program");
    add("recommendation", "deterministic plan constraints");
    add("coach_context", "training state");
  }
  if (input.bodyCompositionQuestion) {
    add("inbody_history", "body-composition question");
    add("body_composition", "body-composition question");
    add("coach_context", "body-composition question");
    add("body_comp_evidence", "body-composition question");
  }
  if (input.intent === "body_recomposition_request") { add("body_composition", "recomposition"); add("body_comp_evidence", "recomposition"); }
  if (PROGRESS.test(q)) {
    add("inbody_history", "progress question");
    add("coach_context", "progress question");
    add("workout_history", "progress question");
    add("nutrition_history", "progress question");
  }
  if (MY_TRAINING.test(q)) { add("workout_history", "asks about own training"); add("programs", "asks about own training"); }
  if (MY_NUTRITION.test(q)) { add("nutrition_history", "asks about own nutrition"); add("programs", "asks about own nutrition"); }
  if (input.personalQuestion && input.intent === "general_fitness_knowledge") {
    add("coach_context", "personal knowledge question");
    add("body_composition", "personal knowledge question");
  }
  if (input.mentionsInjury) add("workout_history", "injury: what the user has been training");
  return { blocks, reasons };
}

export const estimateTokens = (text: string): number => Math.ceil((text ?? "").length / 3.5);

/** Cuts a block to its budget at a line boundary (never mid-sentence); returns the text unchanged when within budget. */
export function fitToBudget(text: string, block: ContextBlock): string {
  const budget = CONTEXT_TOKEN_BUDGET[block];
  if (estimateTokens(text) <= budget) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (estimateTokens([...out, line].join("\n")) > budget) break;
    out.push(line);
  }
  return out.length ? `${out.join("\n")}\n…` : "";
}

/**
 * Whole-prompt budget (estimated tokens). Per-block budgets above cut lists at line boundaries; this one is a GUARD RAIL:
 * exceeding it is reported (manifest.overBudget + a warn log in the orchestrator), never fixed by cutting structured data
 * (CoachContext JSON is never truncated by string slicing — a cut JSON would silently drop fields).
 */
export const PROMPT_TOKEN_BUDGET = 4500;

export interface ContextManifestEntry { block: ContextBlock | "rules" | "question" | "notes"; tokens: number; reason: string }
export interface ContextManifest { intent: string; entries: ContextManifestEntry[]; skipped: ContextBlock[]; totalTokens: number; promptTokens: number; budget: number; overBudget: boolean }

/** Names and token counts only — never the text itself (safe to log). `fullPrompt` is only measured, not stored. */
export function buildManifest(intent: string, plan: ContextPlan, sizes: Partial<Record<ContextManifestEntry["block"], string>>, fullPrompt?: string): ContextManifest {
  const entries: ContextManifestEntry[] = [];
  for (const [block, text] of Object.entries(sizes) as Array<[ContextManifestEntry["block"], string]>) {
    if (!text) continue;
    entries.push({ block, tokens: estimateTokens(text), reason: (plan.reasons as any)[block] ?? (block === "rules" || block === "question" || block === "notes" ? "always" : "") });
  }
  const all: ContextBlock[] = Object.keys(CONTEXT_TOKEN_BUDGET) as ContextBlock[];
  const present = new Set(entries.map((e) => e.block));
  const totalTokens = entries.reduce((a, e) => a + e.tokens, 0);
  const promptTokens = fullPrompt ? estimateTokens(fullPrompt) : totalTokens;
  return {
    intent,
    entries,
    // "skipped" = not selected by the plan, or selected but with nothing to show (e.g. no InBody history yet)
    skipped: all.filter((b) => !plan.blocks.has(b) || (!present.has(b) && b !== "memories" && b !== "turn_facts")),
    totalTokens,
    promptTokens,
    budget: PROMPT_TOKEN_BUDGET,
    overBudget: promptTokens > PROMPT_TOKEN_BUDGET,
  };
}
