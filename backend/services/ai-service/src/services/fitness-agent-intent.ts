import { AgentPreferencesSchema, type AgentPreferences } from "@gym-coach/shared";
import { classifyAgentTurnAct, mayStartMutation, type AgentTurnAct } from "./agent-turn-act";

export function normalizeAgentText(text: string): string {
  // Found 2026-09-07 (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md,
  // phases C/D): the old `/đ/g` (lowercase-only) replace ran BEFORE
  // .toLowerCase(), so a sentence-initial capital "Đ" (e.g. "Đánh giá...",
  // "Đồng ý...") was still "Đ" at replace time, survived untouched, and
  // only became lowercase "đ" afterwards — never "d". Every \b-bounded
  // pattern anywhere in this file that expects a plain ASCII "d" then
  // silently failed to match at that position — the same class of bug
  // found and fixed in food-substitution-extractor.ts (JS regex \b only
  // recognizes ASCII [A-Za-z0-9_] as "word" characters; "đ"/"Đ" aren't).
  // /đ/gi (case-insensitive) catches both; .toLowerCase() right after
  // makes the replacement value's own case moot.
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
}

const MONEY_MIN_VND = 10_000, MONEY_MAX_VND = 100_000_000;
const MONEY_PREFIX = "(?:duoi|toi da|ngan sach|budget|under|khoang|max)";
const MONEY_UNIT_MULTIPLIER = (unit: string | undefined): number => /^(trieu|tr|m|million)$/.test(unit ?? "") ? 1e6 : /^(k|nghin|ngan)$/.test(unit ?? "") ? 1000 : 1;

function moneyVnd(amount: string, unit: string | undefined): number | undefined {
  // "1.500.000" is Vietnamese thousands grouping, never a decimal.
  const grouped = /^\d{1,3}(?:[.,]\d{3}){2,}$/.test(amount);
  const value = Number(grouped ? amount.replace(/[.,]/g, "") : amount.replace(",", "."));
  if (!Number.isFinite(value)) return undefined;
  const vnd = Math.round(value * MONEY_UNIT_MULTIPLIER(unit));
  // A bare small number ("khoang 60" of "khoang 60 phut") is never a budget.
  return vnd >= MONEY_MIN_VND && vnd <= MONEY_MAX_VND ? vnd : undefined;
}

/** VND budget from an already-normalized (accent-free, lowercase) sentence. Accepts "duoi 2 trieu" / "ngan sach 1.5tr"
 * (prefix form) AND a bare amount with an explicit money unit: "5 trieu", "5tr", "2,5 trieu", "500k", "500 nghin", "1.5m",
 * "1tr5". Never "70 kg", "60 phut", "5 buoi" (no money unit). */
export function parseBudgetFromText(s: string): number | undefined {
  // "1tr5" = 1.5 trieu, "1tr500" = 1.5 trieu
  const shorthand = s.match(/(?<![\d.,])(\d+)\s*(?:tr|trieu)\s*(\d{1,3})\b/);
  if (shorthand) {
    const extra = shorthand[2].length === 1 ? Number(shorthand[2]) * 100_000 : Number(shorthand[2]) * 1_000;
    return moneyVnd(String(Number(shorthand[1]) * 1_000_000 + extra), undefined);
  }
  const prefixed = s.match(new RegExp(MONEY_PREFIX + String.raw`\s*(?:la\s*)?(\d+(?:[.,]\d+)*)\s*(trieu|tr|million|nghin|ngan|k|m)?\b`));
  if (prefixed) { const v = moneyVnd(prefixed[1], prefixed[2]); if (v !== undefined) return v; }
  const spaced = s.match(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(trieu|tr|million|nghin|k)\b/);
  if (spaced) return moneyVnd(spaced[1], spaced[2]);
  // "1.5m" ("1m70" is a height: no word boundary after the m)
  const attachedM = s.match(/(?<![\d.,])(\d+(?:[.,]\d+)?)(m)\b/);
  if (attachedM) return moneyVnd(attachedM[1], attachedM[2]);
  return undefined;
}

const PLACE_TRIGGER = new Set(["o", "gan", "tai", "quanh"]);
const PLACE_FIRST_REJECT = new Set(["gym", "nha", "phong", "day", "do", "dau", "kia", "toi", "minh", "em", "anh", "chi", "ban", "sao", "vi", "the", "nay",
  "trung", "cac", "may", "mot", "nhieu", "online", "offline", "truc", "pt", "cho", "san"]);
const PLACE_STOP = new Set(["voi", "de", "cho", "ma", "va", "nhe", "nha", "nhi", "khong", "gia", "ngan", "duoi", "khoang", "tu", "vao", "giam", "tang", "tap",
  "pt", "huan", "online", "offline", "truc", "buoi", "phut", "trieu", "tr", "k", "nghin", "luc", "sang", "chieu", "toi", "thi", "la", "can", "muon", "tim", "budget",
  "under", "hoac", "hay", "duoc", "co", "nao", "gym", "phong", "tuan", "ngay", "gio", "thang", "cn", "t2", "t3", "t4", "t5", "t6", "t7"]);
const PLACE_ALIAS: Record<string, string> = { hcm: "ho chi minh", tphcm: "ho chi minh", "tp hcm": "ho chi minh", "sai gon": "ho chi minh", sg: "ho chi minh", hn: "ha noi", dn: "da nang" };

/** A place the client named in a PT search ("tìm PT ở Gò Vấp", "gần Thủ Đức", "ở quận 7") — returned accent-free, never a guess:
 * generic words ("ở gym", "gần nhà", "tại phòng gym") are NOT places. user-service resolves it against the admin ward table and
 * ignores a phrase it cannot resolve. Call it only for a PT search (a free-text "ở …" in other chat is not a location). */
export function parsePlacePhrase(text: string): string | undefined {
  const tokens = normalizeAgentText(text).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!PLACE_TRIGGER.has(tokens[i])) continue;
    let start = i + 1;
    if (tokens[start] === "khu" && tokens[start + 1] === "vuc") start += 2;
    else if (tokens[start] === "khu") start += 1;
    const first = tokens[start];
    if (!first || PLACE_FIRST_REJECT.has(first)) continue;
    const taken: string[] = [];
    for (let j = start; j < tokens.length && taken.length < 4; j++) {
      const t = tokens[j];
      if (PLACE_STOP.has(t) || (t === "thu" && /^(?:[2-7]|hai|ba|tu|nam|sau|bay)$/.test(tokens[j + 1] ?? ""))) break;
      if (/^[0-9]+$/.test(t)) { if (/^(?:quan|q|phuong|p)$/.test(taken[taken.length - 1] ?? "")) taken.push(t); break; }
      taken.push(t);
    }
    while (taken.length && /^(?:quan|q|phuong|p|huyen)$/.test(taken[taken.length - 1])) taken.pop(); // a dangling "quan"
    if (!taken.length) continue;
    const place = taken.join(" ");
    const aliased = PLACE_ALIAS[place] ?? place;
    if (aliased.length >= 2 && aliased.length <= 60) return aliased;
  }
  return undefined;
}

/** Only explicit user constraints are extracted (goal/days/sessionMinutes/budgetVnd/mode). Missing
 * fields stay missing — never inferred/guessed. Factored out of parseFitnessAgentIntent (Phase 3
 * Batch 4) so the new revision module (services/revision/*) can extract a budget/day refinement from
 * a follow-up turn without duplicating these regexes. */
export function parseConstraintPhrase(text: string): Partial<AgentPreferences> {
  const s = normalizeAgentText(text);
  const preferences: Partial<AgentPreferences> = {};
  if (/giam (mo|can)|fat loss|lose weight/.test(s)) preferences.goal = "WEIGHT_LOSS";
  else if (/tang co|muscle gain|hypertrophy/.test(s)) preferences.goal = "MUSCLE_GAIN";
  else if (/duy tri|maintenance/.test(s)) preferences.goal = "MAINTENANCE";
  else if (/thanh tich|athletic|strength/.test(s)) preferences.goal = "ATHLETIC_PERFORMANCE";
  const days = [...s.matchAll(/(?:\bt|thu\s*)([2-7])\b/g)].map(m => Number(m[1]) - 1);
  if (/chu nhat|\bcn\b/.test(s)) days.push(7);
  if (days.length) preferences.days = [...new Set(days)];
  const minutes = s.match(/\b(\d{2,3})\s*(?:phut|minutes|min)\b/);
  if (minutes) preferences.sessionMinutes = Number(minutes[1]);
  const budgetVnd = parseBudgetFromText(s);
  if (budgetVnd !== undefined) preferences.budgetVnd = budgetVnd;
  if (/online|truc tuyen/.test(s)) preferences.mode = "ONLINE";
  else if (/offline|truc tiep|\btai phong (?:gym|tap)\b|\bo (?:phong )?gym\b|\btai gym\b|\bgan nha\b|\bgan toi\b/.test(s)) preferences.mode = "OFFLINE";
  return preferences;
}

export type FitnessAgentIntentKind = "PT" | "PROGRAM" | "SELECT" | "EVALUATE" | "REVIEW" | "CREATE_PLAN_BUNDLE" | "SAVE_GENERATED_PLAN"
  | "CREATE_WORKOUT_PLAN" | "CREATE_NUTRITION_PLAN"
  | "ROADMAP_STATUS" | "ROADMAP_ADVANCE" | "ROADMAP_REBUILD" | "ROADMAP_ARCHIVE"
  | "CYCLE_COMPLETE" | "CYCLE_CANCEL"
  | "WORKOUT_START" | "WORKOUT_SKIP" | "WORKOUT_CANCEL"
  | "SEND_PLAN_TO_PT_REVIEW";

export interface FitnessAgentIntent {
  kind: FitnessAgentIntentKind | null;
  preferences: Partial<AgentPreferences>;
  candidateNumber?: number;
  /** kind === "REVIEW" only — which pending recommendation and which way. */
  reviewDecision?: "ACCEPT" | "REJECT";
  reviewTarget?: "TRAINING" | "NUTRITION";
  /** Set when the text names a data-changing intent but the turn only ASKS about it (see agent-turn-act.ts). */
  advisory?: { act: AgentTurnAct; about: FitnessAgentIntentKind };
}

/**
 * Intents that start creating/changing the user's data (each ends in a preview + explicit confirmation). Read-only intents
 * (PT/PROGRAM search, EVALUATE, ROADMAP_STATUS) and SELECT (only shows a confirmation card) are not gated: a question is exactly
 * how those are asked.
 */
const MUTATING_KINDS = new Set<FitnessAgentIntentKind>([
  "CREATE_PLAN_BUNDLE", "SAVE_GENERATED_PLAN", "CREATE_WORKOUT_PLAN", "CREATE_NUTRITION_PLAN",
  "ROADMAP_ADVANCE", "ROADMAP_REBUILD", "ROADMAP_ARCHIVE", "CYCLE_COMPLETE", "CYCLE_CANCEL",
  "WORKOUT_START", "WORKOUT_SKIP", "WORKOUT_CANCEL", "REVIEW", "SEND_PLAN_TO_PT_REVIEW",
]);

/**
 * Speech-act gate (V1 stabilization 2026-11-12, B1-13): the agent runs before the chat router, so this parser is where a
 * QUESTION or HYPOTHETICAL about a plan change ("Đổi lên 5 buổi được không?", "Nếu tập 5 buổi thì sao?") must be told apart
 * from a COMMAND/REQUEST to make it. Advisory turns return kind null — the normal chat path answers them. Every caller of this
 * parser (fitness-agent tryTurn, the CI-V2 router, the interpreter) gets the same gate.
 */
export function parseFitnessAgentIntent(text: string): FitnessAgentIntent {
  const parsed = parseFitnessAgentIntentUngated(text);
  if (parsed.kind && MUTATING_KINDS.has(parsed.kind)) {
    const act = classifyAgentTurnAct(text);
    if (!mayStartMutation(act)) return { kind: null, preferences: parsed.preferences, advisory: { act, about: parsed.kind } };
  }
  return parsed;
}

function parseFitnessAgentIntentUngated(text: string): FitnessAgentIntent {
  const s = normalizeAgentText(text);
  const preferences: Partial<AgentPreferences> = parseConstraintPhrase(text);
  const select = (/\b(chon|dang ky|ap|apply|choose|select)\b/.test(s) && /\b(pt|plan|chuong trinh|huan luyen vien)\b/.test(s))
    // "thuê PT này / PT thứ 2 / PT số 1": hiring a SPECIFIC recommended PT is a selection (which still goes through the
    // draft + explicit confirmations); a bare "thuê PT" / "tôi muốn thuê PT" stays a PT search.
    || (/\b(thue|hire)\b/.test(s) && /\b(pt|huan luyen vien)\b/.test(s) && /\b(nay|do|kia|thu\s+(?:nhat|hai|ba|bon|tu|nam|\d+)|so\s*\d+|dau tien|first)\b/.test(s));
  // "tu tap" is "tự tập" (train by myself) but accent-stripping also turns "từ tập" (FROM training machines…) into it:
  // "Tôi muốn đổi từ tập máy sang tạ tự do thì nên bắt đầu thế nào?" was read as "I want a self-training program" and the
  // agent asked which days to train (eval B2-15, 2026-11-11). Accented "từ tập" or a transition verb before it is not "tự tập".
  const selfTrain = /tu tap/.test(s) && !/từ tập/.test(text.toLowerCase()) && !/\b(?:doi|chuyen|thay|bat dau|bo) tu tap/.test(s);
  const noPt = /khong (?:muon |can )?(?:thue )?pt|self.training|without.*trainer/.test(s) || selfTrain;

  // Adaptive Cycle Evaluation via chat (docs/agentic-fitness/01_NUTRITION_
  // AGENT_TOOLS_PLAN.md, phase C/D) — checked BEFORE PT/PROGRAM/SELECT so a
  // message like "đánh giá chu kỳ tập của tôi" (which also mentions "tap",
  // close to PT/PROGRAM vocabulary) resolves to EVALUATE, not PROGRAM.
  // `\b` on a still-đ-containing normalized string (normalizeAgentText only
  // maps lowercase đ, not sentence-initial Đ) can miss a match — every
  // pattern below is written to match either spelling.
  const evaluate = /\b(danh gia|đanh gia)\b.*\b(chu ky|cycle)\b|\b(chu ky|cycle)\b.*\b(danh gia|đanh gia|the nao|tien do)\b|\btien do tap luyen\b/.test(s);
  // "Nên chia chu kỳ thế nào?" asks HOW TO PLAN cycles (periodization), not for an assessment of the user's own cycle.
  const planningCycles = /\b(chia|lap|xay dung|len|thiet ke|bo tri|sap xep|periodi[sz]ation|peaking|taper|mesocycle|macrocycle)\b/.test(s);
  if (evaluate && !planningCycles) {
    return { kind: "EVALUATE", preferences: {} };
  }

  // "gửi plan [hiện tại] cho PT xem/duyệt" — the CLIENT sends their own program to their PT (direction matters: "PT gửi plan cho
  // tôi" is the opposite and must NOT match, so the PT has to be the RECIPIENT: "cho/đến/tới PT"). Checked before the plan-creation
  // and PT-search rules, which would otherwise claim the same words. Only ever opens a preview + explicit confirmation.
  const toPt = "(?:cho|den|toi|to)\\s+(?:pt|huan luyen vien|hlv|coach|trainer)\\b";
  const planWord = "(?:plan|ke hoach|lich tap|chuong trinh(?: tap)?|giao an)";
  const sendVerb = "(?:gui|chia se|nop|send|share|submit)";
  const sendPlanToPt = new RegExp(`\\b${sendVerb}\\b[^.?!]{0,50}?\\b${planWord}\\b[^.?!]{0,40}?\\b${toPt}`).test(s)
    || new RegExp(`\\b${sendVerb}\\s+${toPt}[^.?!]{0,50}?\\b${planWord}\\b`).test(s);
  if (sendPlanToPt) {
    return { kind: "SEND_PLAN_TO_PT_REVIEW", preferences: {} };
  }

  // Agent automation — "hãy tạo/gán lộ trình + plan tập + dinh dưỡng vào hệ
  // thống" style requests. Checked before REVIEW/PT/PROGRAM so it isn't
  // mistaken for a training-program search ("tạo... chương trình tập" also
  // matches PROGRAM's own looser "goi y...chuong trinh" pattern). Two ways
  // to trigger: explicitly mentioning "vào hệ thống" with a create/assign
  // verb, or asking to create a lộ trình together with a plan/nutrition
  // component in the same message.
  const mentionsSystemAssign = /\bhe thong\b/.test(s) && /\b(gan|tao|luu|kich hoat|assign|apply|dang ky)\b/.test(s);
  const mentionsCreateBundle = /\blo trinh\b/.test(s) && /\b(tao|len|xay|kich hoat)\b/.test(s)
    && /\bplan\b|\bke hoach\b|\bdinh duong\b|\bchuong trinh tap\b/.test(s);
  if (mentionsSystemAssign || mentionsCreateBundle) {
    return { kind: "CREATE_PLAN_BUNDLE", preferences: {} };
  }

  // "gán/lưu/áp dụng lịch tập [này/vừa tạo] cho tôi" — the natural way a
  // user actually asks to persist the specific workout plan the AI just
  // generated in this conversation (POST /plans/workout/generate), as
  // opposed to CREATE_PLAN_BUNDLE above (which regenerates a fresh
  // roadmap+workout+nutrition bundle from scratch). Found live: this exact
  // phrase has neither "he thong" nor "lo trinh", so it fell through to the
  // read-only workout_schedule_context lookup and surfaced an unrelated
  // already-active program instead of saving what was just discussed.
  const mentionsSaveGeneratedPlan = /\b(gan|luu|ap dung|apply|save)\b/.test(s)
    && /\b(lich tap|ke hoach tap|chuong trinh tap|plan)\b/.test(s);
  if (mentionsSaveGeneratedPlan) {
    return { kind: "SAVE_GENERATED_PLAN", preferences: {} };
  }

  // AI Coach product capability expansion — standalone "tạo lịch tập cho
  // tôi" / "tạo kế hoạch dinh dưỡng cho tôi", self-contained requests that
  // don't reference an existing roadmap or a plan already shown earlier in
  // the conversation. Checked AFTER CREATE_PLAN_BUNDLE/SAVE_GENERATED_PLAN
  // (both already returned above) so a "lộ trình" or save-verb request
  // always keeps its existing, more specific meaning.
  // "lên" is the verb "lên lịch" only when no number follows: in "từ 3 buổi lên 5 buổi" it means "up to" (B1-13, 2026-11-12).
  const mentionsCreateWorkoutPlan = (/\b(tao|xay|thiet ke)\b|\blen\b(?!\s*\d)/.test(s)
    && /\b(lich tap|chuong trinh tap|ke hoach tap|plan tap|workout plan|training plan|workout program)\b|\blich\s+\d+\s*buoi\b/.test(s))
    // "đổi/chuyển giúp tôi sang lịch upper/lower 4 buổi": switching to a differently-shaped schedule = a new draft to review.
    || /\b(doi|chuyen|lam lai)\b.{0,20}\b(sang|thanh|qua)\b.{0,10}\blich\b/.test(s)
    // "đổi lịch của tôi lên 5 buổi": a different weekly frequency is also a new draft to review (never an in-place write).
    || /\b(doi|chuyen|tang|giam)\b.{0,30}\blich\b.{0,30}\b(len|xuong|thanh|sang|con)\s*\d+\s*buoi\b/.test(s);
  if (mentionsCreateWorkoutPlan) {
    return { kind: "CREATE_WORKOUT_PLAN", preferences: {} };
  }
  const mentionsCreateNutritionPlan = (/\b(tao|thiet ke)\b|\blen\b(?!\s*\d)/.test(s)
    && /\b(thuc don|ke hoach dinh duong|meal plan)\b/.test(s))
    // a menu request that states how many meals it should have ("thực đơn giảm mỡ 4 bữa") is a creation request; lookups
    // ("thực đơn hôm nay", "thực đơn của tôi") and questions never state a meal count.
    || (/\b(thuc don|meal plan)\b/.test(s) && /\b[2-6]\s*bua\b/.test(s)
      && !/\b(cua toi|hom nay|hien tai|dang|la gi|tai sao|vi sao|sao)\b/.test(s));
  if (mentionsCreateNutritionPlan) {
    return { kind: "CREATE_NUTRITION_PLAN", preferences: {} };
  }

  // Roadmap management for an EXISTING roadmap — distinct from
  // CREATE_PLAN_BUNDLE above (which only ever creates+activates a brand
  // NEW one). All four require "lo trinh" plus a distinguishing verb, so
  // none of these ever fire on a plain "lộ trình của tôi có gì" question
  // (that stays ROADMAP_STATUS) or collide with CREATE_PLAN_BUNDLE (which
  // additionally requires a plan/nutrition mention in the same message).
  if (/\blo trinh\b/.test(s)) {
    if (/\b(lam lai|xay lai|rebuild|thiet ke lai|tao lai)\b/.test(s)) {
      return { kind: "ROADMAP_REBUILD", preferences: {} };
    }
    // "dung" deliberately excluded — "dùng" (use) and "dừng" (stop) both
    // normalize to the same ASCII string, so it's too ambiguous to trigger
    // an archive on its own.
    if (/\b(huy|luu tru|archive|xoa)\b/.test(s)) {
      return { kind: "ROADMAP_ARCHIVE", preferences: {} };
    }
    if (/\badvance\b/.test(s) || (/\b(chuyen|qua|sang)\b/.test(s) && /\b(giai doan|phase)\b/.test(s))) {
      return { kind: "ROADMAP_ADVANCE", preferences: {} };
    }
    if (/\b(hien tai|the nao|ra sao|tien do|giai doan|xem|kiem tra)\b/.test(s)) {
      return { kind: "ROADMAP_STATUS", preferences: {} };
    }
  }

  // Roadmap-only creation ("tạo lộ trình giảm mỡ cho tôi", "lên roadmap cut"). Deliberately AFTER the roadmap-management
  // verbs above (rebuild/archive/advance/status keep their meaning) so it only claims phrasing that previously reached
  // no agent at all, and it is skipped for how-to/definition questions. It opens the SAME create workflow (missing-slot
  // questions, then a preview that still needs an explicit confirmation); nothing is written by routing alone.
  if (/\b(lo trinh|roadmap)\b/.test(s) && /\b(tao|len|xay|lap|thiet ke|create|build)\b/.test(s)
    && !/\b(la gi|nhu the nao|cach|tai sao|vi sao|how|what)\b/.test(s)) {
    return { kind: "CREATE_PLAN_BUNDLE", preferences: {} };
  }

  // Training-cycle management for the currently ACTIVE cycle. The
  // EVALUATE check above already owns "chu kỳ ... thế nào/tiến độ" (a
  // read-only status/progress check), so these two only fire on an
  // explicit close/cancel verb and never collide with it.
  if (/\b(chu ky|cycle)\b/.test(s)) {
    if (/\b(hoan thanh|ket thuc|dong)\b/.test(s)) {
      return { kind: "CYCLE_COMPLETE", preferences: {} };
    }
    if (/\b(huy|bo|cancel)\b/.test(s)) {
      return { kind: "CYCLE_CANCEL", preferences: {} };
    }
  }

  // Today's scheduled workout session — start/skip/cancel only. Scoped
  // this narrowly deliberately: per-exercise/per-set completion during an
  // active session needs real-time state, not a one-shot chat confirm.
  if (/\b(buoi tap|session)\b/.test(s)) {
    if (/\b(bat dau|start)\b/.test(s)) return { kind: "WORKOUT_START", preferences: {} };
    if (/\b(bo qua|skip)\b/.test(s)) return { kind: "WORKOUT_SKIP", preferences: {} };
    if (/\b(huy|cancel)\b/.test(s)) return { kind: "WORKOUT_CANCEL", preferences: {} };
  }

  const reviewVerb = /\b(chap nhan|đong y|dong y|ok|approve|accept)\b/.test(s)
    ? "ACCEPT" as const
    : /\b(tu choi|khong đong y|khong dong y|reject)\b/.test(s)
      ? "REJECT" as const
      : null;
  if (reviewVerb) {
    const target = /\b(dinh duong|nutrition|calo|calorie|dinh dương)\b/.test(s)
      ? "NUTRITION" as const
      : /\b(tap luyen|training|workout|chuong trinh tap)\b/.test(s)
        ? "TRAINING" as const
        : undefined;
    return { kind: "REVIEW", preferences: {}, reviewDecision: reviewVerb, reviewTarget: target };
  }

  const kind = select ? "SELECT" : noPt ? "PROGRAM" : /\bpt\b|personal trainer|huan luyen vien/.test(s) ? "PT"
    : /goi y.*(?:plan|chuong trinh)|recommend.*program|self.training/.test(s) ? "PROGRAM"
    // "tìm/kiếm/đề xuất chương trình tập", "có chương trình tập nào hợp với tôi không": searching existing programs.
    : /\b(tim|kiem|de xuat|giai thieu|find|suggest)\b.*\b(chuong trinh tap|giao an|program)\b|^\s*co (chuong trinh tap|giao an)\b.*\b(nao|khong)\b/.test(s) ? "PROGRAM"
    : null;
  // Validate extracted values rather than accepting impossible durations/budgets.
  // Only a PT search carries a named place; it is resolved server-side (user-service) and never guessed here.
  if (kind === "PT") {
    const placeText = parsePlacePhrase(text);
    if (placeText) preferences.placeText = placeText;
  }
  const valid = AgentPreferencesSchema.partial().safeParse(preferences);
  const numbered = s.match(/(?:so|thu|#)\s*(\d+)/);
  return { kind, preferences: valid.success ? valid.data : {}, candidateNumber: numbered ? Number(numbered[1]) : /dau tien|first/.test(s) ? 1 : undefined };
}
