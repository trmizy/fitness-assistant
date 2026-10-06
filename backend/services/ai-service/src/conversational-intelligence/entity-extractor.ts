import { normalizeAgentText } from "../services/fitness-agent-intent";
import type { SemanticAmbiguity, SemanticEntity } from "./schema";

/**
 * Unit-aware, span-consuming entity extraction (deterministic). The core rule: every character of the message is
 * claimed by AT MOST ONE typed entity. A height expression ("1m73") is consumed as HEIGHT_CM first, so its "73" can
 * never resurface as a weight — the root cause of the real "muốn xuống 72kg → 73" failure.
 *
 * Works on diacritic-stripped text (normalizeAgentText), so "không dấu" input behaves the same as accented input.
 */

type Span = [number, number];

export interface ExtractContext {
  /** slot the assistant just asked about ("targetWeight", "currentWeightKg", ...) — lets a bare number take that role. */
  expectedSlot?: string | null;
  /** current weight already known (persisted or stated), used to sanity-check unit-less weight-shaped numbers. */
  currentWeightKg?: number;
}

export interface ExtractionResult {
  normalized: string;
  entities: SemanticEntity[];
  ambiguities: SemanticAmbiguity[];
}

const overlaps = (spans: Span[], a: number, b: number) => spans.some(([s, e]) => a < e && b > s);
const num = (raw: string) => Number(raw.replace(",", "."));

// Words that, right after a number, make it NOT a body weight.
const NON_WEIGHT_UNIT_AFTER = /^\s*(cm|m\b|tuoi|t\b|buoi|bua|phut|p\b|min|gio|h\b|tieng|tuan|thang|nam\b|ngay|%|k\b|tr\b|trieu|d\b|vnd|dong|lan|hiep|set|rep)/;

const TARGET_CUE = /(muc tieu|mong muon|ky vong|hy vong|muon (xuong|giam|len|tang|dat|ve|con)|muon\s*$|xuong|giam (con|xuong)|giam\s*$|len (den|toi)|dat\s*$|target|ve\s*$|con\s*$)/;
const CURRENT_CUE = /(hien tai|hien nay|\bhien\b|\bdang\b|can nang|\bnang\b|\bcan\s*$|\b(toi|minh|em|tui|t|m)\s*$)/;

function clauseBefore(s: string, index: number, max = 30): string {
  const before = s.slice(Math.max(0, index - max), index);
  // a cue only counts back to the previous number or clause break — it must not reach across another value.
  const cut = Math.max(before.search(/\d(?!.*\d)/) + 1, before.lastIndexOf(",") + 1, before.lastIndexOf(";") + 1, before.lastIndexOf(".") + 1);
  return before.slice(Math.max(cut, 0));
}

export function extractGender(s: string): "MALE" | "FEMALE" | undefined {
  if (/(?:^|[,;.]\s*)nam\s*(?:[,;.]|$)|(?:^|[,;.]\s*)nam\s+\d{1,2}\s*tuoi|tuoi\s*,?\s*nam\b(?!\s*(nay|ngoai|truoc|sau|\d))|\b(toi|minh|em|anh|t|m)\s+nam\b(?!\s*(nay|ngoai|truoc|sau|\d|nua))/.test(s)) return "MALE";
  if (/(?:^|[,;.]\s*)nu\s*(?:[,;.]|$)|(?:^|[,;.]\s*)nu\s+\d{1,2}\s*tuoi|tuoi\s*,?\s*nu\b|\b(toi|minh|em|chi|t|m)\s+nu\b/.test(s)) return "FEMALE";
  if (/\bnam gioi\b|gioi tinh\s*(la\s*|:\s*)?nam\b|\b(toi|minh|em|anh|t|m) la (mot )?(nguoi )?nam\b|\bla dan ong\b|\bboy\b/.test(s)) return "MALE";
  if (/\bnu gioi\b|gioi tinh\s*(la\s*|:\s*)?nu\b|\b(toi|minh|em|chi|t|m) la (mot )?(nguoi )?nu\b|\bla phu nu\b|\bgirl\b/.test(s)) return "FEMALE";
  return undefined;
}

export function extractEntities(text: string, ctx: ExtractContext = {}): ExtractionResult {
  const s = normalizeAgentText(text);
  const entities: SemanticEntity[] = [];
  const ambiguities: SemanticAmbiguity[] = [];
  const claimed: Span[] = [];
  const claim = (a: number, b: number) => claimed.push([a, b]);
  const push = (e: SemanticEntity) => entities.push(e);

  // ── role statements: "80 là cân hiện tại, 72 mới là mục tiêu", "1m73 là chiều cao chứ không phải cân nặng" ──
  for (const m of s.matchAll(/(?<![\d.,])(?<!\dm)(\d{1,3}(?:[.,]\d)?)\s*(kg|ky)?\s*(?:moi\s*)?la\s*(?:can nang\s*|so can\s*|can\s*)?(hien tai|muc tieu|chieu cao|tuoi)\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = num(m[1]);
    const role = m[3];
    claim(idx, end);
    if (role === "hien tai") push({ type: "WEIGHT_KG", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.95 });
    else if (role === "muc tieu") push({ type: "TARGET_WEIGHT_KG", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.95 });
    else if (role === "chieu cao" && v >= 100 && v <= 250) push({ type: "HEIGHT_CM", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.95 });
    else if (role === "tuoi" && v >= 10 && v <= 100) push({ type: "AGE", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.95 });
  }

  // ── height: 1m73 · 1m 73 · 1m7 · 1.73m · 1,7m · 173cm · cao 173 ──
  const heightPatterns: Array<{ re: RegExp; cm: (m: RegExpMatchArray) => number; explicit: boolean }> = [
    { re: /(?<![\d.,])(\d)\s*m\s*(\d{2})(?!\d)/g, cm: (m) => Number(m[1]) * 100 + Number(m[2]), explicit: true },
    { re: /(?<![\d.,])(\d)\s*m\s*(\d)(?![\d])/g, cm: (m) => Number(m[1]) * 100 + Number(m[2]) * 10, explicit: true },
    { re: /(?<![\d])(\d)[.,](\d{1,2})\s*m(?![a-z])/g, cm: (m) => Math.round(Number(`${m[1]}.${m[2]}`) * 100), explicit: true },
    { re: /(?<![\d])(\d{3})\s*cm\b/g, cm: (m) => Number(m[1]), explicit: true },
    { re: /\bcao\s*(\d{3})(?![\d.,]|\s*(kg|ky))/g, cm: (m) => Number(m[1]), explicit: false },
  ];
  for (const { re, cm, explicit } of heightPatterns) {
    for (const m of s.matchAll(re)) {
      const idx = m.index ?? 0;
      const end = idx + m[0].length;
      if (overlaps(claimed, idx, end)) continue;
      const v = cm(m);
      if (v < 100 || v > 250) continue;
      claim(idx, end);
      push({ type: "HEIGHT_CM", value: v, sourceText: m[0].trim(), explicit, confidence: explicit ? 0.97 : 0.85 });
    }
  }

  // ── age: "22 tuổi" ──
  for (const m of s.matchAll(/(?<![\d.,])(\d{1,2})\s*tuoi\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Number(m[1]);
    if (v < 10 || v > 100) continue;
    claim(idx, end);
    push({ type: "AGE", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.97 });
  }

  // ── minutes per session: "60 phút", "1 tiếng", "1.5 giờ" ──
  for (const m of s.matchAll(/(?<![\d.,])(\d{2,3})\s*(phut|min|p)\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Number(m[1]);
    if (v < 10 || v > 240) continue;
    claim(idx, end);
    push({ type: "SESSION_MINUTES", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.93 });
  }
  for (const m of s.matchAll(/(?<![\d.,])(\d(?:[.,]\d)?)\s*(tieng|gio)\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Math.round(num(m[1]) * 60);
    if (v < 10 || v > 240) continue;
    claim(idx, end);
    push({ type: "SESSION_MINUTES", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.9 });
  }

  // ── meals per day: "3 bữa", "4 bua/ngay" ──
  for (const m of s.matchAll(/(?<![\d.,])(\d)\s*bua\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Number(m[1]);
    if (v < 2 || v > 8) continue;
    claim(idx, end);
    push({ type: "MEALS_PER_DAY", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.93 });
  }

  // ── sessions per week: "4 buổi một tuần", "tập 5 buổi", "5 buổi/tuần" ──
  for (const m of s.matchAll(/(?<![\d.,])(\d)\s*(?:buoi|lan|ngay)(?:\s*(?:\/|moi|mot|1|trong|cua)?\s*(?:tuan|week))?/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Number(m[1]);
    const perWeek = /tuan|week/.test(m[0]);
    if (v < 1 || v > 7) continue;
    // "60 phút mỗi buổi" was already claimed above; a bare "3 ngày" is only a frequency when a training cue is near.
    if (!perWeek && !/(tap|gym|workout|buoi)/.test(m[0] + s.slice(Math.max(0, idx - 12), idx))) continue;
    claim(idx, end);
    push({ type: "SESSIONS_PER_WEEK", value: v, sourceText: m[0].trim(), explicit: true, confidence: perWeek ? 0.93 : 0.8 });
  }

  // ── budget: "2 triệu", "1.5tr", "500k", "2.000.000đ" ──
  for (const m of s.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(trieu|tr|m)\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Math.round(num(m[1]) * 1_000_000);
    if (v < 100_000 || v > 100_000_000) continue;
    claim(idx, end);
    push({ type: "BUDGET_VND", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.92 });
  }
  for (const m of s.matchAll(/(?<![\d.,])(\d{2,4})\s*k\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Number(m[1]) * 1000;
    if (v < 100_000 || v > 100_000_000) continue;
    claim(idx, end);
    push({ type: "BUDGET_VND", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.85 });
  }
  for (const m of s.matchAll(/(?<![\d])(\d{1,3}(?:[.,]\d{3})+)\s*(d|vnd|dong)?\b/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = Number(m[1].replace(/[.,]/g, ""));
    if (v < 100_000 || v > 100_000_000) continue;
    claim(idx, end);
    push({ type: "BUDGET_VND", value: v, sourceText: m[0].trim(), explicit: true, confidence: 0.9 });
  }

  // ── body weights: anything weight-shaped that is still unclaimed ──
  type W = { value: number; index: number; end: number; hasUnit: boolean; text: string };
  const weights: W[] = [];
  for (const m of s.matchAll(/(?<![\d.,])(\d{2,3}(?:[.,]\d)?)\s*(kg|ky|kí|ki|can)?(?![\d])/g)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (overlaps(claimed, idx, end)) continue;
    const v = num(m[1]);
    if (v < 25 || v > 300) continue;
    if (!m[2] && NON_WEIGHT_UNIT_AFTER.test(s.slice(end, end + 8))) continue;
    weights.push({ value: v, index: idx, end, hasUnit: Boolean(m[2]), text: m[0].trim() });
  }

  // negation: "không phải 74", "tôi không muốn xuống 70", "đừng lấy 70" — the number is REJECTED, not assigned.
  const negatedAt = (w: W) => /(khong phai|khong muon|khong lay|khong dat|dung (lay|dat)|khong (?:xuong|giam|len|tang))(\s+(xuong|giam|len|tang|dat|lay|ve))?(\s+(con|den|toi))?\s*$/.test(s.slice(Math.max(0, w.index - 26), w.index));
  const live: W[] = [];
  for (const w of weights) {
    if (negatedAt(w)) push({ type: "WEIGHT_UNLABELED", value: w.value, sourceText: w.text, explicit: w.hasUnit, confidence: 0.85, negated: true });
    else live.push(w);
  }

  type Role = "TARGET" | "CURRENT" | "NONE";
  const roleOf = (w: W): Role => {
    const before = clauseBefore(s, w.index);
    if (TARGET_CUE.test(before)) return "TARGET";
    if (CURRENT_CUE.test(before)) return "CURRENT";
    return "NONE";
  };
  const roles = live.map((w) => ({ w, role: roleOf(w) }));
  // elimination: exactly one labelled weight + exactly one unlabelled → the unlabelled one takes the other role.
  const unlabeled = roles.filter((r) => r.role === "NONE");
  if (unlabeled.length === 1 && roles.length === 2) {
    const other = roles.find((r) => r.role !== "NONE");
    if (other) unlabeled[0].role = other.role === "TARGET" ? "CURRENT" : "TARGET";
  }
  // a lone unlabelled weight takes the role of the slot the assistant asked about.
  if (roles.length === 1 && roles[0].role === "NONE") {
    if (ctx.expectedSlot === "targetWeight") roles[0].role = "TARGET";
    else if (ctx.expectedSlot === "currentWeightKg") roles[0].role = "CURRENT";
  }
  for (const { w, role } of roles) {
    const unitless = !w.hasUnit;
    // "mục tiêu 72" / "72" with no unit: only accept when the role is stated or the slot context makes it clear AND it is a plausible body weight.
    const plausibleAgainstCurrent = ctx.currentWeightKg ? Math.abs(w.value - ctx.currentWeightKg) / ctx.currentWeightKg <= 0.4 : false;
    // another weight WITH a unit in the same message anchors the scale ("80kg … muốn xuống 72")
    const anchored = roles.some((o) => o.w !== w && o.w.hasUnit && Math.abs(w.value - o.w.value) / o.w.value <= 0.4);
    const impliesWeight = /(muon (xuong|giam|len|tang|con)|xuong|giam (con|xuong)|len (den|toi)|mong muon|nang|can nang|hien tai)/.test(clauseBefore(s, w.index));
    const contextClear = impliesWeight || ctx.expectedSlot === "targetWeight" || ctx.expectedSlot === "currentWeightKg" || plausibleAgainstCurrent || anchored;
    if (role === "NONE") {
      if (w.hasUnit) push({ type: "WEIGHT_UNLABELED", value: w.value, sourceText: w.text, explicit: false, confidence: 0.6 });
      else ambiguities.push({ field: "WEIGHT", reason: `"${w.text}" has neither a unit nor a role (current vs target)` });
      continue;
    }
    const type = role === "TARGET" ? "TARGET_WEIGHT_KG" : "WEIGHT_KG";
    if (unitless && !contextClear) {
      ambiguities.push({ field: type, reason: `"${w.text}" has no unit (kg?)` });
      push({ type, value: w.value, sourceText: w.text, explicit: false, confidence: 0.45 });
      continue;
    }
    push({ type, value: w.value, sourceText: w.text, explicit: !unitless, confidence: unitless ? 0.7 : 0.94 });
  }

  const gender = extractGender(s);
  if (gender) push({ type: "GENDER", value: gender, sourceText: gender === "MALE" ? "nam" : "nữ", explicit: true, confidence: 0.92 });

  return { normalized: s, entities, ambiguities };
}
