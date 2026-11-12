/**
 * Post-LLM check of PERSONAL BMI figures (V1 RC1, 2026-11-12 — B4-30: "chỉ số BMI khoảng 20.8" for a 170 cm / 70 kg user whose
 * prompt carried no weight at all; the model invented one). The authority is computeBmi() over the resolved profile
 * (body_composition_rules.ts); the model never is.
 *
 *  - wrong personal figure (|stated − computed| > 0.2)  → the figure is replaced by the computed one and an adjacent ADULT
 *    category phrase ("(trong khoảng bình thường)", "is in the normal range") is dropped (it described the wrong number)
 *  - personal figure but no computable BMI               → the sentence is removed (nothing supports it)
 *  - the user is a minor                                  → adult categories are dropped and one BMI-for-age note is added
 *  - generic statements ("BMI trên 25 là thừa cân", "BMI không phân biệt cơ và mỡ") and conditionals are never touched
 * Deterministic; never returns an empty answer.
 */
type Bmi = { value: number; minor: boolean } | null;

const PERSONAL = /(?<![\p{L}])(bạn|em|của bạn|của em|hồ sơ|your|you)(?![\p{L}])/iu;
const CONDITIONAL = /(?<![\p{L}])(nếu|giả sử|if|suppose)(?![\p{L}])/iu;
// BMI … <figure>, within one clause; thresholds ("trên 25", "over 25") are not a personal figure
const FIGURE = /\bBMI\b((?:(?!\b(?:trên|dưới|từ|lớn hơn|nhỏ hơn|over|above|below|under)\b)[^\d.!?\n]){0,30}?)(\d{1,2}(?:[.,]\d{1,2})?)(?!\s*(?:kg|cm|%|tuổi|years?)\b)/giu;
const CATEGORY_WORDS = "(?:bình thường|thừa cân|béo phì|thiếu cân|gầy|khỏe mạnh|lý tưởng|normal|healthy|overweight|obese|underweight|ideal)";
const CATEGORY_AFTER = new RegExp(String.raw`^(\s*\([^()]{0,40}?${CATEGORY_WORDS}[^()]{0,20}\)|,?\s*(?:thuộc|nằm trong|nằm ở|trong|ở)\s+(?:khoảng|mức|nhóm|ngưỡng|phạm vi)?\s*[^,.;!?\n]{0,25}?${CATEGORY_WORDS}(?:\s+range)?|\s+(?:is|which is)\s+(?:in|within)\s+the\s+(?:\w+\s+)?${CATEGORY_WORDS}(?:\s+range)?)`, "iu");

const MINOR_NOTE = {
  vi: "Ở tuổi dưới 18, BMI cần được đánh giá theo bách phân vị theo tuổi và giới (WHO/CDC), không dùng ngưỡng của người lớn.",
  en: "Under 18, BMI has to be read as a BMI-for-age percentile by age and sex (WHO/CDC), not with adult cut-offs.",
};

export interface BmiGroundingResult { answer: string; corrected: number; removed: number; minorNoteAdded: boolean }

export function groundBmiClaims(answer: string, ctx: { bmi: Bmi; lang: "vi" | "en" | string }): BmiGroundingResult {
  let corrected = 0, removed = 0, touchedMinor = false;
  const lang = ctx.lang === "en" ? "en" : "vi";
  const sentences = answer.split(/(?<=[.!?])(\s+)/u);
  const out = sentences.map((seg) => {
    if (!/\bBMI\b/i.test(seg) || !PERSONAL.test(seg) || CONDITIONAL.test(seg)) return seg;
    FIGURE.lastIndex = 0;
    if (!FIGURE.test(seg)) return seg;
    if (!ctx.bmi) { removed++; return null; }
    const bmi = ctx.bmi;
    let s = seg, pos = 0;
    for (;;) {
      const re = new RegExp(FIGURE.source, "iu");
      const m = re.exec(s.slice(pos));
      if (!m) break;
      const start = pos + m.index, end = start + m[0].length;
      const stated = Number(m[2].replace(",", "."));
      const wrong = Math.abs(stated - bmi.value) > 0.2;
      let tail = s.slice(end);
      if (wrong || bmi.minor) {
        const cat = CATEGORY_AFTER.exec(tail);
        if (cat) { tail = tail.slice(cat[0].length); if (bmi.minor) touchedMinor = true; }
      }
      if (wrong) corrected++;
      const replacement = `BMI${m[1]}${wrong ? String(bmi.value) : m[2]}`;
      s = s.slice(0, start) + replacement + tail;
      pos = start + replacement.length;
    }
    return s;
  });
  let text = out.filter((s): s is string => s !== null).join("").replace(/\s{2,}/g, " ").trim();
  let minorNoteAdded = false;
  if (ctx.bmi?.minor && (touchedMinor || /\bBMI\b/i.test(text)) && !text.includes(MINOR_NOTE[lang])) {
    text = `${text} ${MINOR_NOTE[lang]}`; minorNoteAdded = true;
  }
  if (text.split(/\s+/).filter(Boolean).length < 3) return { answer, corrected: 0, removed: 0, minorNoteAdded: false };
  return { answer: corrected || removed || minorNoteAdded ? text : answer, corrected, removed, minorNoteAdded };
}
