/**
 * Keeps the semantic type of a protein figure (V1 RC1, 2026-11-12 — H-13: "bạn hiện đang tiêu thụ 88g đạm/ngày" where 88 g is
 * the user's NutritionGoal TARGET and nothing was logged). A sentence asserting CURRENT intake whose figure equals the target,
 * while no intake is logged, is rewritten to state the target. Logged intake, advice ("bạn nên ăn 88g"), conditionals
 * ("nếu bạn đang ăn 60g") and other figures are never touched. Deterministic.
 */
const VI = /(?<![\p{L}])(bạn|em)\s+(?:hiện\s+(?:tại\s+)?)?(?:đang|đã|vẫn)\s+(?:tiêu thụ|ăn|nạp|hấp thụ|bổ sung)(?:\s+(?:được|khoảng|tầm|vào khoảng))?\s+(\*{0,2})(\d+(?:[.,]\d+)?)\s*g(?![\p{L}])/iu;
const EN = /\b(you(?:'re| are)?)\s+(?:currently\s+)?(?:eating|consuming|getting|taking in)\s+(?:about\s+|around\s+)?(\*{0,2})(\d+(?:\.\d+)?)\s*g\b/i;
const CONDITIONAL = /(?<![\p{L}])(nếu|giả sử|if|suppose)(?![\p{L}])/iu;

export function groundIntakeClaims(answer: string, ctx: { proteinTargetG?: number | null; loggedIntake: boolean; lang: string }): { answer: string; rewritten: number } {
  if (ctx.loggedIntake || typeof ctx.proteinTargetG !== "number") return { answer, rewritten: 0 };
  const target = ctx.proteinTargetG;
  let rewritten = 0;
  const out = answer.split(/(?<=[.!?\n])/u).map((sentence) => {
    if (CONDITIONAL.test(sentence)) return sentence;
    const re = ctx.lang === "en" ? EN : VI;
    const m = re.exec(sentence);
    if (!m || Math.abs(Number(m[3].replace(",", ".")) - target) > 1) return sentence;
    rewritten++;
    const startsSentence = sentence.slice(0, m.index).trim() === "";
    const lead = ctx.lang === "en" ? (startsSentence ? "Your target is " : "your target is ") : (startsSentence ? "Mục tiêu của bạn là " : "mục tiêu của bạn là ");
    return sentence.slice(0, m.index) + `${lead}${m[2]}${m[3]}g` + sentence.slice(m.index + m[0].length);
  });
  return { answer: rewritten ? out.join("") : answer, rewritten };
}
