import { classifyMemoryDomain, classifyMemoryFact, type MemoryDomain } from "./memory_policy";
import { foldVi } from "./speech_act";

/**
 * Read-side memory policy: which saved UserMemory rows may reach THIS prompt.
 *
 * Before (eval 2026-11-11, B4-49): every saved row of the user (≤20, all sessions) was injected into every LLM prompt as
 * "Thông tin đã ghi nhớ về user", so a QUESTION saved by the old keyword policy ("Em vừa sinh con được 6 tuần, giờ tập bụng
 * được chưa") made a later, unrelated glute question open with "…sau khi sinh con!".
 *
 * Now, non-destructively (nothing is deleted or rewritten in the database):
 *  1. QUARANTINE — every row is re-checked with the CURRENT write policy (speech act + preference rules). A legacy row that
 *     would not be accepted today (a question, a hypothetical, a mutable number) is never injected. It stays visible and
 *     deletable through /ai/memories.
 *  2. RELEVANCE — a trusted row is injected only when its domain matches what the turn is about.
 *  3. BUDGET — at most MAX_PROMPT_MEMORIES rows, MAX_MEMORY_CHARS each.
 */
export const MAX_PROMPT_MEMORIES = 5;
export const MAX_MEMORY_CHARS = 200;

export interface StoredMemory {
  id?: string;
  content: string;
  category?: string | null;
  createdAt?: Date | string;
}

export interface SelectedMemory extends StoredMemory {
  domain: MemoryDomain;
  provenance: "user_statement" | "legacy_revalidated";
}

export interface MemorySelection {
  selected: SelectedMemory[];
  quarantined: number;
  irrelevant: number;
}

const NUTRITION_INTENTS = new Set(["meal_plan_request", "nutrient_timing_request", "combined_plan_request", "body_recomposition_request"]);
const TRAINING_INTENTS = new Set([
  "workout_plan_request", "frequency_change_request", "muscle_group_routine_request", "specific_exercise_request",
  "schedule_specific_day_request", "combined_plan_request", "body_recomposition_request",
]);
const NUTRITION_WORDS = /\b(an|uong|bua|thuc don|mon|dinh duong|calo|kcal|protein|dam|carb|beo|whey|thuc pham|meal|food|eat|diet)\b/;
const TRAINING_WORDS = /\b(tap|bai|lich|buoi|set|hiep|rep|squat|deadlift|bench|cardio|gym|workout|exercise|training|ta)\b/;
const SCHEDULE_WORDS = /\b(lich|buoi|gio|khung gio|sang|toi|tuan|ngay|schedule|time)\b/;

const KNOWN_DOMAINS: ReadonlySet<string> = new Set(["dietary", "schedule", "exercise_preference", "other"]);

export function relevantMemoryDomains(question: string, intent?: string): Set<MemoryDomain> {
  const q = foldVi(question);
  const domains = new Set<MemoryDomain>();
  const nutrition = (intent && NUTRITION_INTENTS.has(intent)) || NUTRITION_WORDS.test(q);
  const training = (intent && TRAINING_INTENTS.has(intent)) || TRAINING_WORDS.test(q);
  if (nutrition) domains.add("dietary");
  if (training) domains.add("exercise_preference");
  if ((training && SCHEDULE_WORDS.test(q)) || (intent && TRAINING_INTENTS.has(intent))) domains.add("schedule");
  return domains; // "other" is never injected automatically
}

export function selectPromptMemories(memories: StoredMemory[] | undefined, turn: { question: string; intent?: string }): MemorySelection {
  const out: MemorySelection = { selected: [], quarantined: 0, irrelevant: 0 };
  if (!memories?.length) return out;
  const wanted = relevantMemoryDomains(turn.question, turn.intent);
  for (const m of memories) {
    const content = String(m.content ?? "").trim();
    if (!content || content.length > 300 || classifyMemoryFact(content).decision !== "ALLOW") {
      out.quarantined++;
      continue;
    }
    const domain: MemoryDomain = m.category && KNOWN_DOMAINS.has(m.category) ? (m.category as MemoryDomain) : classifyMemoryDomain(content);
    if (!wanted.has(domain)) {
      out.irrelevant++;
      continue;
    }
    if (out.selected.length >= MAX_PROMPT_MEMORIES) break;
    out.selected.push({
      ...m,
      content: content.length > MAX_MEMORY_CHARS ? `${content.slice(0, MAX_MEMORY_CHARS)}…` : content,
      domain,
      provenance: m.category && KNOWN_DOMAINS.has(m.category) ? "user_statement" : "legacy_revalidated",
    });
  }
  return out;
}
