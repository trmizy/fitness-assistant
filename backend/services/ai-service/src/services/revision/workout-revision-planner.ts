/**
 * Delta planning for an in-place workout-plan revision: decide, per day, how many exercises to ADD or REMOVE to reach the target,
 * size the model calls against the provider's real output limit (with headroom), chunk by day, and merge/verify the result with
 * DETERMINISTIC code. Pure apart from the injected `callLLM` of runDeltaRevision.
 *
 * Why delta: raising a 4x4 plan to 4x7 only needs 3 NEW exercises per day (12 objects), not the whole 28-exercise plan again.
 * The existing exercises are kept byte-for-byte (so nothing the user already likes can be dropped or reworded), the model can
 * only ever choose among catalog candidates, and the final count is checked by code — a model that returns fewer is topped up from
 * the catalog, never silently accepted at the old size, and a plan is NEVER trimmed back to the old size to fit a token limit.
 */
import { MAX_EXERCISES_PER_DAY } from "./workout-adjustment-constraints";

export interface PlanExercise { exerciseId: string; name?: string; order?: number; sets?: number; reps?: string; restSeconds?: number; note?: string; [k: string]: unknown }
export interface PlanDay { day?: string; goal?: string; cardio?: string; exercises: PlanExercise[]; [k: string]: unknown }

export interface TokenBudgetConfig {
  /** Largest completion the provider will return for one call. */
  providerMaxOutputTokens: number;
  /** Multiplier applied on top of the estimate (the estimate is a mean, not a bound). */
  headroom: number;
  baseTokens: number;
  tokensPerExercise: number;
}

/** Defaults mirror the worker's existing clamps (Bedrock/Anthropic 5000, others 4500) and per-exercise costs; env can override. */
export function tokenBudgetConfig(env: NodeJS.ProcessEnv = process.env): TokenBudgetConfig {
  const hosted = env.LLM_PROVIDER === "bedrock" || env.LLM_PROVIDER === "anthropic";
  const int = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
  const float = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? n : d; };
  return {
    providerMaxOutputTokens: int(env.AI_PLAN_MAX_OUTPUT_TOKENS, hosted ? 5000 : 4500),
    headroom: float(env.AI_PLAN_TOKEN_HEADROOM, 1.25),
    baseTokens: int(env.AI_PLAN_DELTA_BASE_TOKENS, 250),
    tokensPerExercise: int(env.AI_PLAN_TOKENS_PER_EXERCISE, hosted ? 140 : 80),
  };
}

export const estimateTokens = (exerciseObjects: number, cfg: TokenBudgetConfig): number =>
  Math.ceil((cfg.baseTokens + exerciseObjects * cfg.tokensPerExercise) * cfg.headroom);

/**
 * Budget check for a revision that must REGENERATE the whole plan (not just add exercises): the same estimate the generation call itself is sized
 * with — 600 base + tokensPerExercise per exercise, NO extra headroom — against the provider's output limit. `totalExercises` is the real size of the
 * regenerated plan (days x exercises per day). Never lowers the target: when it does not fit, the caller refuses.
 */
export function fullRegenerationCheck(totalExercises: number, cfg: TokenBudgetConfig = tokenBudgetConfig()): { ok: boolean; needed: number; limit: number } {
  const needed = estimateTokens(totalExercises, { ...cfg, baseTokens: 600, headroom: 1 });
  return { ok: needed <= cfg.providerMaxOutputTokens, needed, limit: cfg.providerMaxOutputTokens };
}

/**
 * Splits a whole-plan regeneration into groups of DAYS whose output each fits one call (same estimate as fullRegenerationCheck). A plan that fits
 * stays ONE group (unchanged behaviour); a bigger one is generated group by group instead of being refused. The number of exercises is never lowered.
 * A conflict is only possible when a SINGLE day cannot fit the provider limit (impossible with the 10/day maximum on a real model limit).
 */
export function planFullRegenerationChunks(exercisesPerDay: number[], cfg: TokenBudgetConfig = tokenBudgetConfig()): { chunks: number[][]; chunkTokens: number[]; conflict?: { code: "TOKEN_BUDGET"; message: string } } {
  const chunks: number[][] = []; const chunkTokens: number[] = [];
  let cur: number[] = []; let curCount = 0;
  const flush = () => { if (cur.length) { chunks.push(cur); chunkTokens.push(fullRegenerationCheck(curCount, cfg).needed); cur = []; curCount = 0; } };
  for (const [i, n] of exercisesPerDay.entries()) {
    if (!fullRegenerationCheck(n, cfg).ok) {
      return { chunks: [], chunkTokens: [], conflict: { code: "TOKEN_BUDGET", message: `Một buổi ${i + 1} với ${n} bài cần khoảng ${fullRegenerationCheck(n, cfg).needed} token, vượt giới hạn đầu ra ${cfg.providerMaxOutputTokens} của mô hình. Mình không tự giảm số bài — hãy đặt số bài thấp hơn.` } };
    }
    if (cur.length && !fullRegenerationCheck(curCount + n, cfg).ok) flush();
    cur.push(i); curCount += n;
  }
  flush();
  return { chunks, chunkTokens };
}

export interface DayDelta { dayIndex: number; have: number; add: number; remove: number }
export type RevisionConflict = { code: "TOKEN_BUDGET" | "SESSION_TOO_LONG" | "OUT_OF_RANGE" | "NO_DAYS"; message: string };
export interface RevisionWork {
  mode: "NOOP" | "TRIM" | "ADD" | "MIXED";
  days: DayDelta[];
  /** Day indexes needing ADDITIONS, grouped so every model call fits the token budget. */
  chunks: number[][];
  chunkTokens: number[];
  conflict?: RevisionConflict;
}

/** Minutes a day takes: warm-up + per set (~45 s working + rest). Used only as a sanity ceiling, not as a prescription. */
export function estimateSessionMinutes(day: PlanDay, defaultRestSeconds = 75): number {
  const seconds = day.exercises.reduce((sum, e) => sum + (Number(e.sets) || 3) * (45 + (Number(e.restSeconds) || defaultRestSeconds)), 0);
  return Math.round(10 + seconds / 60);
}
export const maxSessionMinutes = (env: NodeJS.ProcessEnv = process.env): number => { const n = Number(env.AI_PLAN_MAX_SESSION_MINUTES); return Number.isFinite(n) && n >= 30 ? n : 120; };

export function planRevisionWork(prev: PlanDay[], target: number, cfg: TokenBudgetConfig = tokenBudgetConfig()): RevisionWork {
  if (!prev.length) return { mode: "NOOP", days: [], chunks: [], chunkTokens: [], conflict: { code: "NO_DAYS", message: "Kế hoạch hiện tại chưa có buổi tập nào để điều chỉnh." } };
  if (!Number.isInteger(target) || target < 1 || target > MAX_EXERCISES_PER_DAY) {
    return { mode: "NOOP", days: [], chunks: [], chunkTokens: [], conflict: { code: "OUT_OF_RANGE", message: `Số bài mỗi buổi phải từ 1 đến ${MAX_EXERCISES_PER_DAY}.` } };
  }
  const days: DayDelta[] = prev.map((d, dayIndex) => {
    const have = d.exercises?.length ?? 0;
    return { dayIndex, have, add: Math.max(0, target - have), remove: Math.max(0, have - target) };
  });
  const adding = days.filter((d) => d.add > 0), removing = days.filter((d) => d.remove > 0);
  const mode: RevisionWork["mode"] = adding.length && removing.length ? "MIXED" : adding.length ? "ADD" : removing.length ? "TRIM" : "NOOP";

  // Chunk the days that need additions: greedy, in day order, as many days per call as the budget allows.
  const chunks: number[][] = [], chunkTokens: number[] = [];
  let cur: DayDelta[] = [];
  const flush = () => { if (cur.length) { chunks.push(cur.map((d) => d.dayIndex)); chunkTokens.push(estimateTokens(cur.reduce((n, d) => n + d.add, 0), cfg)); cur = []; } };
  for (const d of adding) {
    if (estimateTokens(d.add, cfg) > cfg.providerMaxOutputTokens) {
      return { mode, days, chunks: [], chunkTokens: [], conflict: { code: "TOKEN_BUDGET", message: `Thêm ${d.add} bài cho buổi ${d.dayIndex + 1} cần khoảng ${estimateTokens(d.add, cfg)} token, vượt giới hạn đầu ra ${cfg.providerMaxOutputTokens} của mô hình. Mình không tự giảm số bài — hãy đặt số bài thấp hơn hoặc điều chỉnh từng bước.` } };
    }
    if (cur.length && estimateTokens(cur.reduce((n, x) => n + x.add, 0) + d.add, cfg) > cfg.providerMaxOutputTokens) flush();
    cur.push(d);
  }
  flush();

  // Session length sanity (the final plan is checked again after the merge; this refuses early, before paying for a model call).
  const longest = Math.max(...prev.map((d, i) => estimateSessionMinutes({ ...d, exercises: [...d.exercises, ...Array.from({ length: days[i].add }, () => ({ exerciseId: "x", sets: 3 }))].slice(0, Math.max(target, 0)) })));
  if (longest > maxSessionMinutes()) {
    return { mode, days, chunks, chunkTokens, conflict: { code: "SESSION_TOO_LONG", message: `${target} bài mỗi buổi sẽ kéo dài khoảng ${longest} phút, vượt mức tối đa ${maxSessionMinutes()} phút cho một buổi. Mình không tự bỏ bớt bài — hãy chọn số bài thấp hơn.` } };
  }
  return { mode, days, chunks, chunkTokens };
}

export interface CandidateExercise { id: string; exerciseName: string; [k: string]: unknown }

/** Deterministic trim: keep the first `target` exercises by training order (compound lifts come first), drop the tail. */
export function trimDay(day: PlanDay, target: number): PlanDay {
  const sorted = [...day.exercises].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { ...day, exercises: sorted.slice(0, target).map((e, i) => ({ ...e, order: i + 1 })) };
}

export interface DeltaAddition { exerciseId: string; name?: string; sets?: number; reps?: string; restSeconds?: number; note?: string }

export function buildDeltaPrompt(args: {
  goal: string; trainingLocation: string; equipmentPreference: string; adjustmentContext?: string;
  days: Array<{ dayIndex: number; dayGoal: string; existing: Array<{ exerciseId: string; name?: string }>; need: number; candidates: CandidateExercise[] }>;
}): string {
  const lines = args.days.map((d) => [
    `[Day ${d.dayIndex + 1}] ${d.dayGoal} — ADD EXACTLY ${d.need} NEW exercise(s)`,
    `Already in this day (do NOT repeat): ${d.existing.map((e) => `${e.exerciseId}|${e.name ?? ""}`).join("; ") || "none"}`,
    "Candidates (use ONLY these ids):",
    ...d.candidates.map((c) => `${c.id}|${c.exerciseName}`),
  ].join("\n"));
  return [
    "You are a personal trainer extending an existing workout plan. Return ONLY valid compact JSON.",
    `Goal: ${args.goal}`, `Location: ${args.trainingLocation}`, `Equipment: ${args.equipmentPreference}`,
    args.adjustmentContext ? `User request:\n${args.adjustmentContext}` : "",
    "Do NOT rewrite or reorder the existing exercises. Only choose the NEW ones listed below.",
    lines.join("\n\n"),
    'Schema: {"days":[{"dayIndex":0,"add":[{"exerciseId":"<candidate id>","name":"<exact candidate name>","sets":3,"reps":"8-12","restSeconds":75,"note":"<=12 Vietnamese words"}]}]}',
    "Rules: dayIndex is 0-based and matches Day N-1; exactly the requested number of NEW exercises per day; never invent an exerciseId; notes in Vietnamese.",
  ].filter(Boolean).join("\n\n");
}

/** Extract the first balanced JSON object; a TRUNCATED answer (unbalanced) yields null — there is no partial result. */
export function extractJsonObject(raw: string): unknown | null {
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

export function parseDeltaResponse(raw: string): { ok: true; additions: Map<number, DeltaAddition[]> } | { ok: false; reason: string } {
  const obj: any = extractJsonObject(raw);
  if (!obj || !Array.isArray(obj.days)) return { ok: false, reason: "response is not a complete JSON object with a days array (truncated or invalid)" };
  const additions = new Map<number, DeltaAddition[]>();
  for (const d of obj.days) {
    if (!Number.isInteger(d?.dayIndex) || !Array.isArray(d?.add)) return { ok: false, reason: "a day entry is malformed" };
    additions.set(d.dayIndex, d.add.filter((a: any) => a && typeof a.exerciseId === "string").map((a: any) => ({
      exerciseId: a.exerciseId, name: typeof a.name === "string" ? a.name : undefined, sets: Number.isFinite(Number(a.sets)) ? Number(a.sets) : undefined,
      reps: a.reps != null ? String(a.reps) : undefined, restSeconds: Number.isFinite(Number(a.restSeconds)) ? Number(a.restSeconds) : undefined,
      note: typeof a.note === "string" ? a.note.slice(0, 160) : undefined,
    })));
  }
  return { ok: true, additions };
}

export interface MergeResult { days: PlanDay[]; warnings: Array<{ type: string; day: number; detail: string }> }

/**
 * Merge model additions into the previous days. Existing exercises are copied unchanged. Additions are accepted only when the id is a
 * catalog candidate of that day and not already used; anything missing/invalid is topped up from the day's remaining candidates so the
 * day reaches EXACTLY the target (recorded as a warning). Extra additions beyond the need are ignored. Throws if a day cannot reach the
 * target even with the whole candidate pool (the caller reports a conflict — it never lowers the target).
 */
export function mergeDelta(prev: PlanDay[], target: number, additions: Map<number, DeltaAddition[]>, candidatesByDay: Map<number, CandidateExercise[]>, defaults = { sets: 3, reps: "8-12", restSeconds: 75 }): MergeResult {
  const warnings: MergeResult["warnings"] = [];
  const days = prev.map((day, dayIndex): PlanDay => {
    const have = day.exercises.length;
    if (have >= target) return have === target ? day : trimDay(day, target);
    const need = target - have;
    const pool = candidatesByDay.get(dayIndex) ?? [];
    const poolById = new Map(pool.map((c) => [c.id, c]));
    const used = new Set(day.exercises.map((e) => e.exerciseId));
    const added: PlanExercise[] = [];
    for (const a of additions.get(dayIndex) ?? []) {
      if (added.length >= need) break;
      const cand = poolById.get(a.exerciseId);
      if (!cand || used.has(a.exerciseId)) { warnings.push({ type: "delta_invalid_addition", day: dayIndex + 1, detail: a.exerciseId }); continue; }
      used.add(a.exerciseId);
      added.push({ exerciseId: cand.id, name: cand.exerciseName, sets: a.sets ?? defaults.sets, reps: a.reps ?? defaults.reps, restSeconds: a.restSeconds ?? defaults.restSeconds, ...(a.note ? { note: a.note } : {}) });
    }
    if (added.length < need) {
      for (const cand of pool) {
        if (added.length >= need) break;
        if (used.has(cand.id)) continue;
        used.add(cand.id);
        added.push({ exerciseId: cand.id, name: cand.exerciseName, sets: defaults.sets, reps: defaults.reps, restSeconds: defaults.restSeconds, note: "Bổ sung từ thư viện bài tập" });
        warnings.push({ type: "delta_topped_up_from_catalog", day: dayIndex + 1, detail: cand.id });
      }
    }
    if (day.exercises.length + added.length !== target) throw new RevisionShortfallError(dayIndex, target, day.exercises.length + added.length);
    const all = [...day.exercises.map((e) => ({ ...e })), ...added].map((e, i) => ({ ...e, order: i + 1 }));
    return { ...day, exercises: all };
  });
  return { days, warnings };
}

export class RevisionShortfallError extends Error {
  constructor(public readonly dayIndex: number, public readonly target: number, public readonly reached: number) {
    super(`Buổi ${dayIndex + 1} chỉ có thể đạt ${reached}/${target} bài với thư viện bài tập phù hợp hiện có.`);
    this.name = "RevisionShortfallError";
  }
}

/** The final, authoritative check, independent of the model: every day has exactly `target` exercises, ids are catalog ids, no repeats. */
export function verifyFinalDays(days: PlanDay[], target: number, validIds: Set<string>): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  days.forEach((d, i) => {
    if (d.exercises.length !== target) problems.push(`day ${i + 1}: ${d.exercises.length} exercises, expected ${target}`);
    const seen = new Set<string>();
    for (const e of d.exercises) {
      if (!validIds.has(e.exerciseId)) problems.push(`day ${i + 1}: unknown exerciseId ${e.exerciseId}`);
      if (seen.has(e.exerciseId)) problems.push(`day ${i + 1}: duplicate exerciseId ${e.exerciseId}`);
      seen.add(e.exerciseId);
    }
  });
  return problems.length ? { ok: false, problems } : { ok: true };
}

export type DeltaOutcome =
  | { ok: true; days: PlanDay[]; calls: number; warnings: MergeResult["warnings"]; budgets: number[] }
  | { ok: false; reason: string; userMessage: string };

/**
 * Run the whole delta revision: one model call per chunk (each sized to the budget), every response parsed strictly (truncated JSON is a
 * failure, retried once), then ONE deterministic merge + verification. Nothing is returned unless ALL chunks and the final check pass,
 * so a failure at any point leaves the caller with no partial data to persist.
 */
export async function runDeltaRevision(args: {
  prev: PlanDay[]; target: number; work: RevisionWork;
  candidatesByDay: Map<number, CandidateExercise[]>; validIds: Set<string>;
  goal: string; trainingLocation: string; equipmentPreference: string; adjustmentContext?: string;
  callLLM: (prompt: string, opts: { numPredict: number }) => Promise<string>;
  maxAttemptsPerChunk?: number;
}): Promise<DeltaOutcome> {
  const additions = new Map<number, DeltaAddition[]>();
  const budgets: number[] = [];
  let calls = 0;
  for (let c = 0; c < args.work.chunks.length; c += 1) {
    const dayIdxs = args.work.chunks[c];
    const numPredict = Math.min(args.work.chunkTokens[c], tokenBudgetConfig().providerMaxOutputTokens);
    budgets.push(numPredict);
    const prompt = buildDeltaPrompt({
      goal: args.goal, trainingLocation: args.trainingLocation, equipmentPreference: args.equipmentPreference, adjustmentContext: args.adjustmentContext,
      days: dayIdxs.map((i) => ({
        dayIndex: i, dayGoal: String(args.prev[i].goal ?? ""), need: args.work.days[i].add,
        existing: args.prev[i].exercises.map((e) => ({ exerciseId: e.exerciseId, name: e.name })),
        candidates: (args.candidatesByDay.get(i) ?? []).filter((x) => !args.prev[i].exercises.some((e) => e.exerciseId === x.id)).slice(0, 24),
      })),
    });
    let parsed: ReturnType<typeof parseDeltaResponse> = { ok: false, reason: "no attempt" };
    for (let attempt = 0; attempt < (args.maxAttemptsPerChunk ?? 2) && !parsed.ok; attempt += 1) {
      calls += 1;
      try { parsed = parseDeltaResponse(await args.callLLM(prompt, { numPredict })); }
      catch (err) { parsed = { ok: false, reason: `model call failed: ${(err as Error).message}` }; }
    }
    if (!parsed.ok) return { ok: false, reason: `chunk ${c + 1}/${args.work.chunks.length}: ${parsed.reason}`, userMessage: "AI chưa điều chỉnh được kế hoạch lần này. Kế hoạch cũ vẫn giữ nguyên — bạn bấm “Điều chỉnh” lại sau vài giây nhé." };
    for (const [k, v] of parsed.additions) additions.set(k, v);
  }
  try {
    const merged = mergeDelta(args.prev, args.target, additions, args.candidatesByDay);
    const verdict = verifyFinalDays(merged.days, args.target, args.validIds);
    if (!verdict.ok) return { ok: false, reason: `final verification failed: ${verdict.problems.join("; ")}`, userMessage: "Kết quả điều chỉnh chưa hợp lệ nên mình không áp dụng. Kế hoạch cũ vẫn giữ nguyên." };
    return { ok: true, days: merged.days, calls, warnings: merged.warnings, budgets };
  } catch (err) {
    if (err instanceof RevisionShortfallError) return { ok: false, reason: err.message, userMessage: `${err.message} Mình không tự giảm số bài — hãy nới điều kiện (thiết bị, bài cần tránh) hoặc đặt số bài thấp hơn.` };
    throw err;
  }
}
