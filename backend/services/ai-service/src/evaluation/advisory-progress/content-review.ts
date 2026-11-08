/** Narrow read-only advice screen, not a universal semantic entailment judge. */
import type { Answer } from "./experiment";

export interface TextUnit { path: string; text: string }
export interface ContentSignal { path: string; code: "UNSUPPORTED_READONLY_ADVICE"; ruleId: string; matchedText: string }

export function answerTextUnits(answer: Answer): TextUnit[] {
  return [
    ...answer.observations.map((item, index) => ({ path: `observations.${index}.text`, text: item.text })),
    ...answer.hypotheses.map((item, index) => ({ path: `hypotheses.${index}.text`, text: item.text })),
    ...answer.missingInformation.map((item, index) => ({ path: `missingInformation.${index}.question`, text: item.question })),
    { path: "rationaleSummary", text: answer.rationaleSummary },
  ];
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
const rules: Array<{ id: string; pattern: RegExp }> = [
  { id: "no_change_needed", pattern: /\bkhong can (?:phai )?(?:doi|thay doi|dieu chinh|sua) (?:lai )?(?:lich|chuong trinh|ke hoach|plan)\b/g },
  { id: "retain_plan", pattern: /\b(?:nen |hay |ban can |phai )?giu nguyen (?:lich|chuong trinh|ke hoach|plan)\b/g },
  { id: "change_plan", pattern: /\b(?:nen|hay|ban can|phai) (?:doi|thay doi|dieu chinh) (?:lai )?(?:lich|chuong trinh|ke hoach|plan)\b/g },
  { id: "personal_load_or_calories", pattern: /\b(?:ban can|hay|nen) (?:tang|giam) (?:muc )?(?:ta|tai|calo|kcal)\b/g },
  { id: "english_plan_decision", pattern: /\b(?:no need to change (?:your |the )?(?:plan|schedule)|(?:you should|you must) (?:keep|change) (?:your |the )?(?:plan|schedule))\b/g },
];

/** Sentence-local epistemic framing: saying there is insufficient basis to advise
 * is different from advising no change. This is intentionally a narrow heuristic. */
function deniesBasis(prefix: string): boolean {
  return /(?:chua|khong) (?:co )?(?:du )?(?:du lieu|bang chung|co so|can cu|thong tin).{0,70}(?:de )?(?:ket luan|khuyen|quyet dinh|khang dinh|noi)\b/.test(prefix)
    || /\b(?:chua|khong) (?:the )?(?:ket luan|khang dinh|quyet dinh|khuyen|noi)\b/.test(prefix)
    || /\b(?:cannot|can't|not enough evidence to) (?:conclude|recommend|decide|say)\b/.test(prefix);
}

export function screenReadonlyAdvice(answer: Answer): {
  scope: string; status: "FLAGGED_FOR_REVIEW" | "NO_RULE_MATCH_NOT_CONTENT_PASS"; signals: ContentSignal[];
} {
  const signals: ContentSignal[] = [];
  for (const unit of answerTextUnits(answer)) {
    const normalized = fold(unit.text);
    for (const rule of rules) {
      for (const match of normalized.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
        const before = normalized.slice(0, match.index);
        const sentencePrefix = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1);
        if (deniesBasis(sentencePrefix)) continue;
        signals.push({ path: unit.path, code: "UNSUPPORTED_READONLY_ADVICE", ruleId: rule.id, matchedText: match[0] });
      }
    }
  }
  return {
    scope: "Narrow directive-language screen for this read-only experiment. No rule match is not semantic, scientific or clinical clearance; negation/quotation can still need manual review.",
    status: signals.length ? "FLAGGED_FOR_REVIEW" : "NO_RULE_MATCH_NOT_CONTENT_PASS", signals,
  };
}
