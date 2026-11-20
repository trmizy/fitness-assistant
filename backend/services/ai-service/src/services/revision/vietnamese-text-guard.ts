/**
 * Vietnamese text guard for generated workout plans (v3 — preservation first).
 *
 * Why (REAL Nova Pro, 2026-11-20, evidence in docs/ai/nova-evidence): when a plan is regenerated/adjusted the model returned corrupted Vietnamese —
 * "Tế cố ngữể, vai, tay sau" instead of "Tập cơ ngực, vai, tay sau", notes like "Tập ngữể dày.", "Khởi động nhể nếu cần" — and, because the stored day
 * goals are fed back into the next prompt, every further revision made it worse. The pipeline keeps text byte-for-byte (worker test); the corruption
 * is the model's.
 *
 * What this guard changes — and ONLY this (approved policy 2026-11-20):
 *   1. day labels made of KNOWN muscle-group words with wrong diacritics are restored to the canonical words ("Tập cố chán, mông" -> "Tập cơ chân, mông");
 *      a label that cannot be verified is replaced by the deterministic template label, but a CUSTOM label already stored on the plan
 *      (user/PT/earlier AI, not corrupt) is KEPT;
 *   2. RECOGNISED boilerplate (cardio hint, generic progression/recovery/nutrition lines, schema placeholders) whose letters equal a known phrase once
 *      diacritics are ignored is restored to the canonical phrase ("Khởi động nhể nếu cần" -> "Khởi động nhẹ nếu cần");
 *   3. text that is PROVABLY invalid Vietnamese (a syllable with two tone marks) is replaced by a neutral phrase.
 * Everything else is preserved: personalised notes, user/PT edits, custom labels, unknown keys (_metadata, userNotes, ptNote …). A revision NEVER takes
 * free prose from the model for plan-level fields when the plan already has its own; a NEW exercise on a revision gets the neutral note.
 * Pure functions, no I/O.
 */

const TONE_MARKS = /[̣̀́̃̉]/g; // grave, acute, tilde, hook above, dot below

/** A Vietnamese syllable carries at most ONE tone mark; two or more (e.g. "ngữể", "trữc̣") is never valid orthography. */
export function hasImpossibleToneMarks(text: string): boolean {
  return String(text ?? "").normalize("NFD").split(/[^\p{L}\p{M}]+/u).some((word) => (word.match(TONE_MARKS) ?? []).length >= 2);
}

/** Lower-case, no diacritics, đ -> d, single spaces, no punctuation: the comparison key for "same letters, wrong marks". */
export function foldVietnamese(text: string): string {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9+\-\s]/g, " ").replace(/\s+/g, " ").trim();
}

// ── day labels ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Correctly accented words allowed in a day label, in order of preference when several accented forms share the same letters ("co": cơ before cổ). */
const LABEL_VOCAB = [
  "tập", "cơ", "ngực", "lưng", "vai", "chân", "mông", "tay", "trước", "sau", "bụng", "toàn", "thân", "đùi", "bắp", "cẳng", "cổ", "trên", "dưới",
  "đẩy", "kéo", "nhóm", "cardio", "core", "và", "kết", "hợp", "nhẹ", "nặng", "phục", "hồi", "buổi", "ngày", "full", "body", "push", "pull", "legs", "upper", "lower",
  "xô", "sườn", "hông", "đầu", "gối", "tạ", "đơn", "dây", "kháng", "lực", "sức", "mạnh", "bền", "linh", "hoạt", "giãn", "khởi", "động", "a", "b", "c", "d",
];
const VOCAB_EXACT = new Set(LABEL_VOCAB);
const VOCAB_BY_FOLD = new Map<string, string>();
for (const w of LABEL_VOCAB) if (!VOCAB_BY_FOLD.has(foldVietnamese(w))) VOCAB_BY_FOLD.set(foldVietnamese(w), w);

export type LabelVerdict = { kind: "clean" | "fixed" | "unknown" | "corrupt"; value: string };

/** clean: every word is a known, correctly accented word. fixed: every word is a known word once diacritics are ignored (value = canonical). unknown: custom text. corrupt: provably invalid. */
export function classifyDayLabel(label: unknown): LabelVerdict {
  const text = String(label ?? "").trim();
  if (text.length < 3 || text.length > 80) return { kind: "unknown", value: text };
  const tokens = text.normalize("NFC").split(/([^\p{L}\p{M}0-9]+)/u); // even index = word, odd = separator
  const words = tokens.filter((t, i) => i % 2 === 0 && t);
  if (!words.length) return { kind: "unknown", value: text };
  const known = (w: string) => VOCAB_EXACT.has(w.toLowerCase()) || /^[0-9]+$/.test(w);
  if (words.every(known)) return { kind: "clean", value: text };
  if (words.every((w) => known(w) || VOCAB_BY_FOLD.has(foldVietnamese(w)))) {
    const rebuilt = tokens.map((t, i) => {
      if (i % 2 === 1 || !t || known(t)) return t;
      const canon = VOCAB_BY_FOLD.get(foldVietnamese(t)) ?? t;
      return t[0] === t[0].toUpperCase() && t[0] !== t[0].toLowerCase() ? canon[0].toUpperCase() + canon.slice(1) : canon;
    }).join("");
    return { kind: "fixed", value: rebuilt };
  }
  return { kind: hasImpossibleToneMarks(text) ? "corrupt" : "unknown", value: text };
}

/** The label to show the MODEL in a prompt: restored when only diacritics are wrong, the fallback when corrupt, a custom label as-is (breaks the corrupted-label feedback loop). */
export function promptSafeDayLabel(label: unknown, fallback = ""): string {
  const v = classifyDayLabel(label);
  if (v.kind === "clean" || v.kind === "fixed" || v.kind === "unknown") return v.value;
  return fallback;
}

/** Kept for callers that only need "is this label verified Vietnamese from the closed vocabulary". */
export function isCleanDayLabel(label: unknown): boolean {
  return classifyDayLabel(label).kind === "clean";
}

// ── recognised boilerplate ──────────────────────────────────────────────────────────────────────────────────────────────────
export const DEFAULT_EXERCISE_NOTE = "Giữ kỹ thuật đúng, kiểm soát nhịp tập.";
export const DEFAULT_CARDIO = "Khởi động nhẹ 5-10 phút trước khi tập.";
export const CARDIO_REQUESTED = "Cardio nhẹ 10-15 phút sau buổi tập.";
export const DEFAULT_PROGRESSION_NOTES = ["Tăng dần mức tạ hoặc số lần tập khi bạn hoàn thành tốt các hiệp."];
export const DEFAULT_RECOVERY_NOTES = ["Ngủ đủ giấc và nghỉ ngơi giữa các buổi tập."];
export const DEFAULT_NUTRITION_SUMMARY = "Ăn đủ đạm và năng lượng phù hợp mục tiêu của bạn.";

const BOILERPLATE = [
  "Khởi động nhẹ nếu cần", DEFAULT_CARDIO, CARDIO_REQUESTED, "Tăng dần", ...DEFAULT_PROGRESSION_NOTES, "Ngủ đủ", ...DEFAULT_RECOVERY_NOTES, "Đủ protein",
  DEFAULT_NUTRITION_SUMMARY, "Ghi chú ngắn", "Tóm tắt ngắn", DEFAULT_EXERCISE_NOTE,
];
const BOILERPLATE_BY_FOLD = new Map(BOILERPLATE.map((b) => [foldVietnamese(b), b]));

/** The canonical phrase when `text` is a known boilerplate phrase (same letters, any diacritics), else null. */
export function canonicalBoilerplate(text: unknown): string | null {
  const key = foldVietnamese(String(text ?? ""));
  return key ? (BOILERPLATE_BY_FOLD.get(key) ?? null) : null;
}

// ── the guard ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PlanTextGuardInput {
  /** The plan being produced (mutated in place). */
  content: any;
  /** Previous plan content of a REVISION (null for a first generation). */
  previous?: any | null;
  /** Deterministic day labels (index -> label); used only when a label cannot be verified and no stored custom label exists. */
  fallbackDayLabels: string[];
  /** The user asked for cardio on every day: boilerplate cardio hints become the standard cardio phrase (personalised ones are kept). */
  cardioRequested?: boolean;
}

export interface PlanTextGuardReport { daysRelabelled: number; labelsKept: number; boilerplateFixed: number; invalidReplaced: number; notesKept: number; notesReplaced: number }

export function guardPlanVietnameseText({ content, previous, fallbackDayLabels, cardioRequested }: PlanTextGuardInput): PlanTextGuardReport {
  const report: PlanTextGuardReport = { daysRelabelled: 0, labelsKept: 0, boilerplateFixed: 0, invalidReplaced: 0, notesKept: 0, notesReplaced: 0 };
  const prevDays: any[] = Array.isArray(previous?.weeklySchedule) ? previous.weeklySchedule : [];
  const isRevision = Boolean(previous);
  const days: any[] = Array.isArray(content?.weeklySchedule) ? content.weeklySchedule : [];

  /** Preserve-first decision for one free-text field: stored text wins; only boilerplate is canonicalised; only provably invalid text is replaced. */
  const keepOrFix = (stored: unknown, fallbackText: string): string => {
    const text = typeof stored === "string" ? stored : "";
    if (!text.trim()) return fallbackText;
    const canon = canonicalBoilerplate(text);
    if (canon) { if (canon !== text) report.boilerplateFixed++; return canon; }
    if (hasImpossibleToneMarks(text)) { report.invalidReplaced++; return fallbackText; }
    return text; // personalised / user / PT / earlier AI text is never touched
  };

  days.forEach((day, i) => {
    if (!day || typeof day !== "object") return;
    // 1) day label
    const model = classifyDayLabel(day.goal);
    if (model.kind === "clean" || model.kind === "fixed") {
      if (model.value !== day.goal) { day.goal = model.value; report.boilerplateFixed++; }
    } else {
      const prev = classifyDayLabel(prevDays[i]?.goal);
      if (prev.kind === "clean" || prev.kind === "fixed") day.goal = prev.value;
      else if (prev.kind === "unknown" && String(prevDays[i]?.goal ?? "").trim().length >= 3) { day.goal = prevDays[i].goal; report.labelsKept++; } // custom stored label
      else day.goal = fallbackDayLabels[i] || "Toàn thân";
      report.daysRelabelled++;
    }
    // 2) cardio hint
    const prevCardio = prevDays[i]?.cardio;
    if (isRevision) {
      const stored = typeof prevCardio === "string" && prevCardio.trim() ? prevCardio : null;
      const asBoilerplate = stored ? canonicalBoilerplate(stored) : null;
      if (cardioRequested && (!stored || asBoilerplate)) day.cardio = CARDIO_REQUESTED;
      else if (stored) day.cardio = keepOrFix(stored, DEFAULT_CARDIO);
      else day.cardio = canonicalBoilerplate(day.cardio) ?? DEFAULT_CARDIO; // a NEW day: only a recognised phrase from the model, otherwise the standard one
    } else if (typeof day.cardio === "string") day.cardio = keepOrFix(day.cardio, DEFAULT_CARDIO);
    // 3) exercise notes
    const prevNotes = new Map<string, string>();
    for (const e of prevDays[i]?.exercises ?? []) if (e?.exerciseId && typeof e.note === "string" && e.note.trim()) prevNotes.set(e.exerciseId, e.note);
    for (const e of Array.isArray(day.exercises) ? day.exercises : []) {
      if (!e || typeof e !== "object") continue;
      const stored = prevNotes.get(e.exerciseId);
      if (stored !== undefined) { const fixed = keepOrFix(stored, DEFAULT_EXERCISE_NOTE); if (fixed !== stored) report.notesReplaced++; else report.notesKept++; e.note = fixed; continue; }
      const note = typeof e.note === "string" ? e.note.trim() : "";
      if (/^(Đã tự động|Bài tập đã được tự động)/.test(note)) { report.notesKept++; continue; } // the pipeline's own Vietnamese repair notes
      if (!isRevision && note) { const fixed = keepOrFix(note, DEFAULT_EXERCISE_NOTE); if (fixed !== note) report.notesReplaced++; else report.notesKept++; e.note = fixed; continue; }
      e.note = DEFAULT_EXERCISE_NOTE; report.notesReplaced++; // a NEW exercise on a revision: the model's prose is not trusted
    }
  });

  // 4) plan-level text: a revision keeps the plan's own text; a first generation keeps the model's unless boilerplate/invalid
  const fixList = (stored: unknown, fallback: string[]): string[] => {
    const list = Array.isArray(stored) ? stored.map(String).filter((t) => t.trim()) : [];
    return list.length ? list.map((t) => keepOrFix(t, fallback[0])) : [...fallback];
  };
  for (const key of ["progressionNotes", "recoveryNotes"] as const) {
    const fallback = key === "progressionNotes" ? DEFAULT_PROGRESSION_NOTES : DEFAULT_RECOVERY_NOTES;
    const source = isRevision ? (Array.isArray(previous?.[key]) && previous[key].length ? previous[key] : null) : content?.[key];
    content[key] = fixList(source, fallback);
  }
  const nutritionSource = isRevision ? previous?.nutritionSummary : content?.nutritionSummary;
  content.nutritionSummary = typeof nutritionSource === "string" && nutritionSource.trim() ? keepOrFix(nutritionSource, DEFAULT_NUTRITION_SUMMARY) : DEFAULT_NUTRITION_SUMMARY;
  return report;
}
