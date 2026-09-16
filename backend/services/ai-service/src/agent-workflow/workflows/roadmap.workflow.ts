import type { SlotDefinition, WorkflowContext, WorkflowDefinition } from "../types";
import { parseAge, parseGender, parseGoal, parseHeightCm, parseWeightKg } from "../slot-values";
import { assessTargetWeightSafety } from "../target-weight-safety";
import { normalizeAgentText } from "../../services/fitness-agent-intent";

/**
 * CREATE_ROADMAP — realized as the existing "CREATE_PLAN_BUNDLE" action
 * (fitness-agent.service.ts::proposePlanBundle/execute). This is a
 * deliberate mapping, not an invented duplicate workflow
 * (docs/conversational-ai-coach-workflow-audit.md: `CREATE_PLAN_BUNDLE` is
 * the only real chat-reachable roadmap-CREATION entry point that exists —
 * there is no separate "roadmap only" creation path in the domain layer to
 * wrap instead). ROADMAP_STATUS/ADVANCE/REBUILD/ARCHIVE (managing an
 * EXISTING roadmap) are separate, already-working intents this workflow
 * does not touch.
 *
 * Required slots mirror `proposePlanBundle`'s own existing pre-check
 * exactly (fitness-agent.service.ts, the `missing: string[]` block) —
 * goal/age/heightCm/currentWeightKg/gender — plus `targetWeight`, added
 * here as a genuine product-level requirement (not invented: the field is
 * real, `UserProfile.targetWeight`, and `fitness-roadmap.service.ts::
 * generateAiRoadmapDraft` genuinely reads and uses it when present — see
 * docs/conversational-ai-coach-workflow-audit.md §5). `targetWeight` is
 * only REQUIRED when the goal is body-composition-directional
 * (WEIGHT_LOSS/MUSCLE_GAIN) — a MAINTENANCE or ATHLETIC_PERFORMANCE roadmap
 * doesn't need one, and the underlying service itself never hard-requires
 * it (it degrades gracefully to `targetWeightKg: null`), so this pass does
 * not invent a hard requirement the real service doesn't have — it adds a
 * PRODUCT-level one, disclosed here.
 *
 * goal/age/heightCm/currentWeight/gender/targetWeight are ALL PROFILE_FACT
 * (not WORKFLOW_ONLY), deliberately: `proposePlanBundle` (the function this
 * workflow gates) independently re-checks these exact fields against the
 * REAL profile via profileExtractor after this workflow resumes, and
 * fitness-service's `generateAiRoadmapDraft` route has no override
 * mechanism for age/height/currentWeight/gender (only targetWeightKg/
 * targetBodyFatPercent/trainingDaysPerWeek — see fitness-roadmap.models.ts).
 * A genuinely-missing field collected via chat but left WORKFLOW_ONLY would
 * never reach the real profile, so `proposePlanBundle`'s post-resume
 * re-check would still see it as missing and silently re-ask — exactly the
 * "never make the user repeat themselves" failure this design avoids. Each
 * of these four is a single unambiguous scalar with an identical name/unit/
 * range in both profile.models.ts and slot-values.ts's parsers — no
 * cross-system convention risk like preferredTrainingDays has (see
 * fitness-agent-tools.ts's agentUpdatableProfileFieldsSchema comment).
 */

function profileNumber(ctx: WorkflowContext, key: string): number | undefined {
  const v = (ctx.enterpriseContext.profile as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}
function profileString(ctx: WorkflowContext, key: string): string | undefined {
  const v = (ctx.enterpriseContext.profile as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

const goalSlot: SlotDefinition<"WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE"> = {
  key: "goal", label: "mục tiêu (giảm mỡ/tăng cơ/duy trì/hiệu suất)",
  source: "USER_PROFILE", persistence: "PROFILE_FACT", profileField: "goal", required: true,
  readFromContext: (ctx) => profileString(ctx, "goal") as any,
  parse: parseGoal,
  question: () => "Mục tiêu của bạn là giảm mỡ, tăng cơ, duy trì hay hiệu suất thể thao?",
  format: (v) => ({ WEIGHT_LOSS: "Giảm mỡ", MUSCLE_GAIN: "Tăng cơ", MAINTENANCE: "Duy trì", ATHLETIC_PERFORMANCE: "Hiệu suất thể thao" }[v] ?? v),
};
const ageSlot: SlotDefinition<number> = {
  key: "age", label: "tuổi", source: "USER_PROFILE", persistence: "PROFILE_FACT", profileField: "age", required: true,
  readFromContext: (ctx) => profileNumber(ctx, "age"),
  parse: parseAge, question: () => "Bạn bao nhiêu tuổi?", format: (v) => `${v} tuổi`,
};
const heightSlot: SlotDefinition<number> = {
  key: "heightCm", label: "chiều cao", source: "USER_PROFILE", persistence: "PROFILE_FACT", profileField: "heightCm", required: true,
  readFromContext: (ctx) => profileNumber(ctx, "heightCm"),
  parse: parseHeightCm, question: () => "Chiều cao của bạn khoảng bao nhiêu cm?", format: (v) => `${v} cm`,
};
const currentWeightSlot: SlotDefinition<number> = {
  key: "currentWeightKg", label: "cân nặng hiện tại", source: "USER_PROFILE", persistence: "PROFILE_FACT", profileField: "currentWeight", required: true,
  // Real EnterpriseContext field AND real profileSchema field are both
  // `currentWeight`, not `currentWeightKg` (agentic-fitness.service.ts::
  // context — `currentWeight: p.currentWeight`; profile.models.ts —
  // `currentWeight: z.number().positive()`). The slot's own `key` is an
  // internal workflow identifier only and stays `currentWeightKg` for
  // clarity/consistency with its unit; `profileField` above carries the
  // real wire/persistence field name.
  readFromContext: (ctx) => profileNumber(ctx, "currentWeight"),
  parse: parseWeightKg, question: () => "Cân nặng hiện tại của bạn khoảng bao nhiêu kg?", format: (v) => `${v} kg`,
};
const genderSlot: SlotDefinition<"MALE" | "FEMALE" | "OTHER"> = {
  key: "gender", label: "giới tính", source: "USER_PROFILE", persistence: "PROFILE_FACT", profileField: "gender", required: true,
  readFromContext: (ctx) => profileString(ctx, "gender") as any,
  parse: parseGender, question: () => "Bạn là nam, nữ hay khác?", format: (v) => ({ MALE: "Nam", FEMALE: "Nữ", OTHER: "Khác" }[v] ?? v),
};
function resolvedGoal(ctx: WorkflowContext): string | undefined {
  return (ctx.known.goal as string | undefined) ?? profileString(ctx, "goal");
}
function resolvedHeightCm(ctx: WorkflowContext): number | undefined {
  return (ctx.known.heightCm as number | undefined) ?? profileNumber(ctx, "heightCm");
}
function resolvedCurrentWeightKg(ctx: WorkflowContext): number | undefined {
  return (ctx.known.currentWeightKg as number | undefined) ?? profileNumber(ctx, "currentWeight");
}

const targetWeightSlot: SlotDefinition<number> = {
  key: "targetWeight", label: "cân nặng mục tiêu", source: "USER_PROFILE", persistence: "PROFILE_FACT", profileField: "targetWeight",
  required: (ctx) => {
    const goal = resolvedGoal(ctx);
    return goal === "WEIGHT_LOSS" || goal === "MUSCLE_GAIN";
  },
  readFromContext: (ctx) => profileNumber(ctx, "targetWeight"),
  parse: parseWeightKg,
  // Codex Evaluation #1 HIGH finding — a 30kg target for a 180cm/80kg
  // profile passed the absolute 25-300kg range check with no contextual
  // gate. This runs AFTER parse() (which only validates syntax) and is
  // itself invoked twice by the orchestrator (docs/conversational-ai-coach-
  // remediation-1.md §14): once when this slot is answered, and again
  // immediately before the actual profile write using freshly reloaded
  // context. Skips the check entirely (returns ok:true) when height/
  // current-weight/goal aren't yet resolvable — never blocks on missing
  // data, only on data that IS known and contextually unsafe.
  validateContext: (value, ctx) => {
    const heightCm = resolvedHeightCm(ctx);
    const currentWeightKg = resolvedCurrentWeightKg(ctx);
    const goal = resolvedGoal(ctx);
    if (heightCm == null || currentWeightKg == null || goal == null) return { ok: true };
    if (goal !== "WEIGHT_LOSS" && goal !== "MUSCLE_GAIN" && goal !== "MAINTENANCE" && goal !== "ATHLETIC_PERFORMANCE") return { ok: true };
    const result = assessTargetWeightSafety({ heightCm, currentWeightKg, targetWeightKg: value, goal });
    if (result.verdict === "UNSAFE") return { ok: false, clarifyingQuestion: result.clarifyingQuestion };
    return { ok: true };
  },
  question: (ctx) => {
    const goal = resolvedGoal(ctx);
    return goal === "MUSCLE_GAIN"
      ? "Để xây lộ trình phù hợp, bạn muốn tăng lên khoảng bao nhiêu kg?"
      : "Để xây lộ trình phù hợp, bạn muốn giảm xuống khoảng bao nhiêu kg?";
  },
  format: (v) => `${v} kg`,
};

export const createRoadmapSlots: SlotDefinition<any>[] = [goalSlot, ageSlot, heightSlot, currentWeightSlot, genderSlot, targetWeightSlot];

// Codex Evaluation #1 §12/§19 — a rich initiating message ("Tôi muốn giảm
// mỡ, 25 tuổi, cao 175cm, 80kg, mục tiêu 72kg.") was fully ignored;
// startWorkflow() only ever consulted EnterpriseContext. Deterministic-
// first, bounded pattern matching only — never an LLM. Age/height use a
// specific cue-anchored pattern ("N tuổi", "cao Ncm") rather than "the
// first number in range" to avoid misreading one field's number as
// another's (e.g. mistaking "175cm" for an age). Gender is deliberately
// NOT extracted here — "nam" false-positives inside ordinary phrases like
// "ở Việt Nam", and gender is not in this workflow's required-minimum
// extraction set.
function extractAgeFromMessage(s: string): number | undefined {
  const m = s.match(/(\d{1,3})\s*tuoi/);
  if (!m) return undefined;
  const v = Number(m[1]);
  return v >= 13 && v <= 100 ? v : undefined;
}
function extractHeightFromMessage(s: string): number | undefined {
  const meters = s.match(/(\d)\s*m\s*(\d{2})/); // "1m75"
  if (meters) {
    const v = Number(meters[1]) * 100 + Number(meters[2]);
    if (v >= 100 && v <= 250) return v;
  }
  const m = s.match(/cao\s*(\d{2,3})\s*cm?/) ?? s.match(/(\d{2,3})\s*cm\b/);
  if (!m) return undefined;
  const v = Number(m[1]);
  return v >= 100 && v <= 250 ? v : undefined;
}
// Disambiguates "hiện 80kg và muốn xuống 72kg" / "80kg, mục tiêu 72kg" —
// current-weight and target-weight are the SAME shape (a bare kg number),
// so plain regex can't tell them apart without looking at surrounding cue
// words. Only assigns a number when a cue clearly labels it, OR (when
// exactly two weight-shaped numbers are present and only one carries a
// cue) by elimination for the other. Never guesses when there is no cue at
// all — an unlabeled "80, 72" stays fully unresolved, exactly matching the
// "ambiguous input must never be guessed" rule (docs/conversational-ai-
// coach-workflow-design.md §Ambiguous value).
// Deliberately specific phrases only — a bare `\bmuon\b`/`\btarget\b` would
// also match an EARLIER, unrelated "muốn" in the same message (e.g. "tôi
// MUỐN tạo lộ trình... MỤC TIÊU 72kg" — the first "muốn" is about the
// request itself, not the number), which was a real false-positive caught
// while building this (it misassigned "25" from "25 tuổi" as the target
// weight because "muốn" appeared ~15 chars earlier in the same sentence).
const CURRENT_WEIGHT_CUE_RE = /(hien tai|hien nay|\bhien\b|\bdang\b|can nang hien tai)/;
const TARGET_WEIGHT_CUE_RE = /(muc tieu|muon xuong|muon len|muon giam|muon tang|xuong con|len den)/;
function extractWeightPairFromMessage(s: string): { currentWeightKg?: number; targetWeightKg?: number } {
  const weightMatches = [...s.matchAll(/(\d{2,3}(?:[.,]\d)?)(kg|ky|can)?\b/g)]
    .map((m) => ({ value: Number(m[1].replace(",", ".")), index: m.index ?? 0, matchedLength: m[0].length }))
    .filter((m) => Number.isFinite(m.value) && m.value >= 25 && m.value <= 300)
    // Exclude numbers that are obviously age/height, not weight, even
    // though they fall in a numerically weight-plausible range (e.g. "25
    // tuổi", "175cm") — otherwise they pollute the "exactly 2 weight
    // numbers -> assign the other by elimination" heuristic below.
    .filter((m) => !/^\s*(tuoi|cm)\b/.test(s.slice(m.index + m.matchedLength, m.index + m.matchedLength + 6)));
  if (weightMatches.length === 0) return {};

  function cueBefore(index: number, re: RegExp): boolean {
    return re.test(s.slice(Math.max(0, index - 15), index));
  }

  let current: number | undefined;
  let target: number | undefined;
  const cued = new Set<number>();
  for (const m of weightMatches) {
    if (cueBefore(m.index, TARGET_WEIGHT_CUE_RE)) { target = target ?? m.value; cued.add(m.index); }
    else if (cueBefore(m.index, CURRENT_WEIGHT_CUE_RE)) { current = current ?? m.value; cued.add(m.index); }
  }
  if (weightMatches.length === 2) {
    const uncued = weightMatches.filter((m) => !cued.has(m.index));
    if (target !== undefined && current === undefined && uncued.length === 1) current = uncued[0].value;
    else if (current !== undefined && target === undefined && uncued.length === 1) target = uncued[0].value;
  }
  return { currentWeightKg: current, targetWeightKg: target };
}

export function extractRoadmapSlotsFromMessage(message: string): Record<string, unknown> {
  const s = normalizeAgentText(message);
  const known: Record<string, unknown> = {};
  const goalResult = parseGoal(message);
  if (goalResult.ok) known.goal = goalResult.value;
  const age = extractAgeFromMessage(s);
  if (age !== undefined) known.age = age;
  const height = extractHeightFromMessage(s);
  if (height !== undefined) known.heightCm = height;
  const { currentWeightKg, targetWeightKg } = extractWeightPairFromMessage(s);
  if (currentWeightKg !== undefined) known.currentWeightKg = currentWeightKg;
  if (targetWeightKg !== undefined) known.targetWeight = targetWeightKg;
  return known;
}

export const createRoadmapWorkflow: WorkflowDefinition = {
  type: "CREATE_ROADMAP",
  gatesIntentKind: "CREATE_PLAN_BUNDLE",
  slots: createRoadmapSlots,
  extractFromMessage: (message) => extractRoadmapSlotsFromMessage(message),
};
