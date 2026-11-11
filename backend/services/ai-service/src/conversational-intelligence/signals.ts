import { normalizeAgentText } from "../services/fitness-agent-intent";
import type { EntityType, Goal, GoalSignal, ReferenceKind, SemanticCorrection, SemanticEntity, SemanticNegation, SemanticReference } from "./schema";

/**
 * Semantic SIGNALS of a turn that are not numbers: goal language, correction / negation, "please suggest for me",
 * references to something the assistant said before, "why?". Each detector is a small pattern FAMILY over
 * diacritic-stripped text (not a list of test sentences) and only returns evidence — the policy layer decides what to do.
 */

// ── goal signals ──
const LOSS_EXPLICIT = /(giam mo|giam can|xuong can|bot mo|giam beo|lose (fat|weight)|\bcut(ting)?\b|\bfat ?loss\b|gon hon|siet can|sieu gon|muon gay)/;
const LOSS_IMPLICIT = /(qua (nang|map|beo|to)|kha (map|beo|nang)|dang (map|beo|thua can)|thua can|beo qua|bung to)/;
const GAIN_EXPLICIT = /(tang co|len co|xay co|\bbulk(ing)?\b|gain muscle|nang co|to co)/;
const GAIN_IMPLICIT = /(tang can|len can|tang kg|qua gay|kha gay|dang gay)/;
const MAINT_EXPLICIT = /(duy tri|giu (nguyen )?can|giu dang|maintain|giu form)/;
const ATHLETE_EXPLICIT = /(hieu suat|suc ben|suc manh|performance|thi dau|marathon|chay bo)/;

const NEG_GOAL = /(khong|dung|het|bo)\s+(can\s+)?(tang co|tang can|len co|len can|bulk|giam mo|giam can|xuong can|cut)(\s+nua)?/;

export function detectGoalSignals(s: string): GoalSignal[] {
  const out: GoalSignal[] = [];
  const add = (goal: Goal, strength: "EXPLICIT" | "IMPLICIT", src: string, negatesGoal = false) => out.push({ goal, strength, sourceText: src, negatesGoal: negatesGoal || undefined });

  // "không tăng cơ nữa" — dropping a goal is a NEGATION of that goal, not a statement of the goal.
  const neg = NEG_GOAL.exec(s);
  const negatedGoal: Goal | null = neg ? (/giam|xuong|cut/.test(neg[0]) ? "WEIGHT_LOSS" : "MUSCLE_GAIN") : null;
  if (negatedGoal) add(negatedGoal, "EXPLICIT", neg![0], true);

  const scrub = neg ? s.replace(neg[0], " ") : s; // do not read the negated phrase again as an assertion
  let m: RegExpExecArray | null;
  if ((m = LOSS_EXPLICIT.exec(scrub))) add("WEIGHT_LOSS", "EXPLICIT", m[0]);
  else if ((m = LOSS_IMPLICIT.exec(scrub))) add("WEIGHT_LOSS", "IMPLICIT", m[0]);
  if ((m = GAIN_EXPLICIT.exec(scrub))) add("MUSCLE_GAIN", "EXPLICIT", m[0]);
  else if ((m = GAIN_IMPLICIT.exec(scrub))) add("MUSCLE_GAIN", "IMPLICIT", m[0]);
  if ((m = MAINT_EXPLICIT.exec(scrub))) add("MAINTENANCE", "EXPLICIT", m[0]);
  if ((m = ATHLETE_EXPLICIT.exec(scrub))) add("ATHLETIC_PERFORMANCE", "EXPLICIT", m[0]);
  // "giảm mỡ nhưng giữ cơ": the muscle-keeping clause is a modifier of the loss goal, not a competing goal.
  return out;
}

// ── corrections ──
const CORRECTION_CUE = /(a khong|khong phai|y toi la|toi doi y|doi y|\bkhoan\b|luc nay (toi )?(noi |nhap |ghi )?(sai|nham)|noi sai|nham roi|thay vi|sua lai|doi thanh|doi sang|chu khong phai|dung hon la|thuc ra|that ra|thuc te la|that su la|sai roi|sai het|nham|khong tang co nua|khong .{0,12} nua\b|thoi\b.*\bdoi\b)/;

export function hasCorrectionCue(s: string): boolean {
  return CORRECTION_CUE.test(s);
}

/**
 * Corrections are only reported when the message both carries a correction cue and gives a NEW value/goal:
 *  - "không phải 74, là 72"           → previous 74, new 72 (target weight when that slot/role is clear)
 *  - "à không, tôi tập 5 buổi"        → SESSIONS_PER_WEEK := 5
 *  - "không tăng cơ nữa, muốn giảm mỡ" → GOAL := WEIGHT_LOSS
 */
export function detectCorrections(s: string, entities: SemanticEntity[], goalSignals: GoalSignal[], expectedSlot?: string | null): SemanticCorrection[] {
  if (!hasCorrectionCue(s)) return [];
  const out: SemanticCorrection[] = [];

  const rejected = entities.filter((e) => e.negated);
  const asserted = entities.filter((e) => !e.negated);
  const pair = /(\d{2,3}(?:[.,]\d)?)\s*(?:kg|ky)?\s*(?:nhung|ma|chu)\s*(?:that ra|thuc ra|thuc te|that su)\s*(?:la)?\s*(\d{2,3}(?:[.,]\d)?)/.exec(s) ?? /khong phai\s*(\d{2,3}(?:[.,]\d)?)[^\d]{0,14}?(?:la|ma la|ma|thi|ma la)\s*(\d{2,3}(?:[.,]\d)?)/.exec(s) ?? /thay vi\s*(\d{2,3}(?:[.,]\d)?)[^\d]{0,10}?(?:thi|la)?\s*(\d{2,3}(?:[.,]\d)?)/.exec(s);
  const slotField = (e: SemanticEntity): EntityType => {
    if (e.type === "WEIGHT_UNLABELED") return expectedSlot === "currentWeightKg" ? "WEIGHT_KG" : "TARGET_WEIGHT_KG";
    return e.type;
  };
  if (pair) {
    const prev = Number(pair[1].replace(",", "."));
    const next = Number(pair[2].replace(",", "."));
    const field: EntityType = expectedSlot === "currentWeightKg" ? "WEIGHT_KG" : "TARGET_WEIGHT_KG";
    out.push({ field, previousValue: prev, newValue: next, confidence: 0.9 });
  } else {
    for (const e of asserted) {
      if (e.type === "GENDER") continue;
      out.push({ field: slotField(e), previousValue: rejected.length === 1 ? (rejected[0].value as number) : undefined, newValue: e.value, confidence: e.confidence * 0.95 });
    }
  }
  for (const g of goalSignals.filter((x) => !x.negatesGoal)) {
    out.push({ field: "GOAL", newValue: g.goal, previousValue: goalSignals.find((x) => x.negatesGoal)?.goal, confidence: g.strength === "EXPLICIT" ? 0.9 : 0.6 });
  }
  return out;
}

// ── negations that are not values ──
export function detectNegations(s: string, entities: SemanticEntity[]): SemanticNegation[] {
  const out: SemanticNegation[] = [];
  for (const e of entities.filter((x) => x.negated)) out.push({ target: e.type, value: e.value, sourceText: e.sourceText });
  let m: RegExpExecArray | null;
  if ((m = /(dung|khong (can|muon)?)\s*(doi|thay) (muc tieu|goal)/.exec(s))) out.push({ target: "GOAL", sourceText: m[0] });
  if ((m = /(khong (can|muon|thue|lay)|dung) (pt|huan luyen vien|hlv)\b/.exec(s))) out.push({ target: "ACTION", value: "HIRE_PT", sourceText: m[0] });
  if ((m = /^\s*(khong luu|dung luu|chua luu|khong (can )?xac nhan)\b/.exec(s))) out.push({ target: "ACTION", value: "SAVE", sourceText: m[0] });
  return out;
}

// ── "you decide / suggest for me" ──
const RECOMMEND_CUE =
  /(de xuat|goi y|tu chon|chon (giup|dum|cho)|ban (chon|quyet|tu|thay|nghi|tinh)|theo ban|muc nao (hop ly|phu hop|tot)|(nen|dat|chon) (bao nhieu|la bao nhieu|may|muc nao|cai nao)|khong (biet|ro|chac) (nen|phai|dat|chon|tap|an)|loi khuyen|tu van (cho|giup)|bao nhieu (thi )?(hop ly|phu hop|la duoc|la vua)|hop ly (la )?bao nhieu|tinh (giup|dum|cho) (toi|minh|t)|tu (de xuat|quyet|tinh)|nen (cut|bulk|giam|tang) (hay|khong)|(cut|bulk) hay (bulk|cut)|muc tieu nao (hop|phu hop)|nen tap may)/;

export function detectRecommendationRequest(s: string): boolean {
  return RECOMMEND_CUE.test(s);
}

// ── references ──
export function detectReferences(s: string): SemanticReference[] {
  const out: SemanticReference[] = [];
  const add = (kind: ReferenceKind, re: RegExp) => {
    const m = re.exec(s);
    if (m) out.push({ kind, sourceText: m[0] });
  };
  add("ACCEPT_PROPOSAL", /(de xuat (do|nay|tren|vua roi)|theo (de xuat|goi y)|muc (do|nay|ban (de xuat|goi y|vua noi))|theo muc ban|dung muc (do|nay|ban)|lay muc (do|nay)|\d{2,3}\s*(kg)?\s*do\b|cai do (di|nhe)?|ok muc do|dong y muc)/);
  add("LOWER_OPTION", /(muc thap hon|muc thap|lay (muc )?thap|so thap hon|muc nho hon|cai (thap|nho) hon)/);
  add("HIGHER_OPTION", /(muc cao hon|muc cao\b|lay (muc )?cao|so cao hon|cai (cao|lon) hon)/);
  add("MIDDLE_OPTION", /(muc giua|muc o giua|muc trung binh)/);
  add("FIRST_ITEM", /(dau tien|thu nhat|so 1\b|\b1st\b|dau danh sach)/);
  add("THIS_ITEM", /(\b(pt|plan|chuong trinh|thuc don|lich tap|nguoi|goi) (nay|do|kia)\b|nguoi do)/);
  add("PREVIOUS_STATE", /(giu cai cu|cai vua roi|cai luc nay|nhu cu|ban truoc)/);
  // Phase 3 Batch 4 — ordinal position N>=2 ("thứ hai/thu 2/so 2"). N=1 stays FIRST_ITEM above,
  // untouched. Word-ordinals only go up to "bay" (7), matching the real max candidate list length
  // (recommend() slices to top 5) with headroom; anything higher falls through unresolved (never guessed).
  const ORDINAL_WORDS: Record<string, number> = { hai: 2, ba: 3, tu: 4, nam: 5, sau: 6, bay: 7 };
  const ordinalMatch = s.match(/\bthu\s*(\d+|hai|ba|tu|nam|sau|bay)\b/) ?? s.match(/\bso\s*(\d+)\b/);
  if (ordinalMatch) {
    const raw = ordinalMatch[1];
    const ordinal = /^\d+$/.test(raw) ? Number(raw) : ORDINAL_WORDS[raw];
    if (ordinal && ordinal >= 2) out.push({ kind: "ORDINAL_ITEM", sourceText: ordinalMatch[0], ordinal });
  }
  return out;
}

export function detectWhy(s: string): boolean {
  return /(vi sao|tai sao|sao (lai|phai|ban)|why|ly do)/.test(s);
}

export function isQuestionForm(s: string, raw: string): boolean {
  return /\?\s*$/.test(raw.trim()) || /(la gi|nhu the nao|the nao|co (nen|the|phai|tot|can)|bao lau|bao nhieu (calo|kg)|khac (gi|nhau))/.test(s);
}

export const normalizeForSignals = normalizeAgentText;
