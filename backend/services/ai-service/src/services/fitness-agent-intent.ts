import { AgentPreferencesSchema, type AgentPreferences } from "@gym-coach/shared";

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

/** Only explicit user constraints are extracted. Missing fields stay missing.
 * Ranking, prescription and action execution are never inferred by a model.
 */
export function parseFitnessAgentIntent(text: string): {
  kind: "PT" | "PROGRAM" | "SELECT" | "EVALUATE" | "REVIEW" | null;
  preferences: Partial<AgentPreferences>;
  candidateNumber?: number;
  /** kind === "REVIEW" only — which pending recommendation and which way. */
  reviewDecision?: "ACCEPT" | "REJECT";
  reviewTarget?: "TRAINING" | "NUTRITION";
} {
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
  const budget = s.match(/(?:duoi|toi da|ngan sach|budget|under|khoang)\s*(\d+(?:[.,]\d+)?)\s*(trieu|tr|m|million|k|nghin)?\b/);
  if (budget) preferences.budgetVnd = Math.round(Number(budget[1].replace(",", ".")) * (/^(trieu|tr|m|million)$/.test(budget[2] ?? "") ? 1e6 : /^(k|nghin)$/.test(budget[2] ?? "") ? 1000 : 1));
  if (/online|truc tuyen/.test(s)) preferences.mode = "ONLINE";
  else if (/offline|truc tiep/.test(s)) preferences.mode = "OFFLINE";
  const select = /\b(chon|dang ky|ap|apply|choose|select)\b/.test(s) && /\b(pt|plan|chuong trinh|huan luyen vien)\b/.test(s);
  const noPt = /khong (?:muon |can )?(?:thue )?pt|tu tap|self.training|without.*trainer/.test(s);

  // Adaptive Cycle Evaluation via chat (docs/agentic-fitness/01_NUTRITION_
  // AGENT_TOOLS_PLAN.md, phase C/D) — checked BEFORE PT/PROGRAM/SELECT so a
  // message like "đánh giá chu kỳ tập của tôi" (which also mentions "tap",
  // close to PT/PROGRAM vocabulary) resolves to EVALUATE, not PROGRAM.
  // `\b` on a still-đ-containing normalized string (normalizeAgentText only
  // maps lowercase đ, not sentence-initial Đ) can miss a match — every
  // pattern below is written to match either spelling.
  const evaluate = /\b(danh gia|đanh gia)\b.*\b(chu ky|cycle)\b|\b(chu ky|cycle)\b.*\b(danh gia|đanh gia|the nao|tien do)\b|\btien do tap luyen\b/.test(s);
  if (evaluate) {
    return { kind: "EVALUATE", preferences: {} };
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
    : /goi y.*(?:plan|chuong trinh)|recommend.*program|self.training/.test(s) ? "PROGRAM" : null;
  // Validate extracted values rather than accepting impossible durations/budgets.
  const valid = AgentPreferencesSchema.partial().safeParse(preferences);
  const numbered = s.match(/(?:so|thu|#)\s*(\d+)/);
  return { kind, preferences: valid.success ? valid.data : {}, candidateNumber: numbered ? Number(numbered[1]) : /dau tien|first/.test(s) ? 1 : undefined };
}
