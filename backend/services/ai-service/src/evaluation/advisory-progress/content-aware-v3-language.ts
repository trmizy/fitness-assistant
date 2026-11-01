/** Bounded lexical risk screens; no scientific entailment or role classifier. */
import { screenReadonlyAdvice, type TextUnit } from "./content-review";
import type { ContentIssue } from "./content-aware-v3";

export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
export const LOAD_WORDS = /\b(?:tai|ta|load|progression)\b/;
export const MUSCLE_WORDS = /\b(?:kich thuoc co|khoi luong co|phi dai|tang co|co bap|hypertrophy|built muscle|gained muscles?|muscles?(?: size| growth| gain)?)\b/;
export const STRENGTH_WORDS = /\b(?:e1rm|1rm|suc manh|strength)\b/;
// Folded "dù" and "đủ" are both "du"; never split every occurrence.
const boundaries = /[.!?;\n]|,\s*du\b|\b(?:nhung|tuy nhien|but|however|although|though)\b/g;

/** Only framing BEFORE this assertion, after the nearest clause boundary.
 * An unrelated hedge following an assertion cannot negate it. */
function epistemicComplement(tail: string): boolean {
  // A bounded complement grammar, not a blanket negation detector. A hedge
  // about "nguyên nhân", nutrition, etc. cannot own a subsequent directive.
  // Independent objects/conjunctions fall outside this grammar and are not exempt.
  const complement = tail.replace(/[“”"‘’]/g, "").trim().replace(/\s+/g, " ");
  return complement === "" || /^(?:(?:de|rang|la|lieu|viec|that|whether) )?(?:(?:nguoi dung|ban|you) )?(?:co )?(?:(?:can|nen|phai|should|must|need to) )?(?:(?:e1rm|1rm|suc manh|strength)(?: uoc tinh)? )?(?:(?:tang|giam|giu nguyen|doi|thay doi|dieu chinh)(?: tai| ta|lich(?: tap)?)? )?$/.test(complement + " ");
}

export function uncertaintyBefore(text: string, start: number): boolean {
  const before = text.slice(0, start);
  const last = [...before.matchAll(new RegExp(boundaries.source, "g"))].at(-1);
  const prefix = before.slice(last ? last.index! + last[0].length : 0).split(",").at(-1)!;
  const hedge = [...prefix.matchAll(/\b(?:chua|khong) (?:co )?(?:du )?(?:du lieu|can cu|co so|bang chung|thong tin).{0,60}?(?:ket luan|khuyen|noi|quyet dinh|xac dinh)\b|\b(?:chua|khong) (?:the )?(?:ket luan|khuyen|quyet dinh|xac dinh|khang dinh)\b|\b(?:cannot|can't|not enough evidence to) (?:conclude|recommend|decide|determine|say)\b/g)].at(-1);
  return !!hedge && epistemicComplement(prefix.slice(hedge.index! + hedge[0].length));
}

function reportedQuote(text: string, start: number): boolean {
  const quote = [...text.matchAll(/“[^”]*”|"[^"]*"|‘[^’]*’/g)].find((m) => start >= m.index! && start < m.index! + m[0].length);
  if (!quote) return false;
  // A quote is an exception only with a reporting cue in its own sentence.
  // "Bạn nên “giữ nguyên...”" is a directive, not a reported old answer.
  const prefix = text.slice(0, quote.index).split(/[.!?;\n]/).at(-1)!;
  return /\b(?:cau tra loi cu|ban nhap|nhan dinh cu|previous answer|the draft).{0,35}\b(?:ghi|noi|khuyen|stated|said|reported)\b/.test(prefix);
}

function genuineQuestion(text: string, start: number): boolean {
  const begin = Math.max(...[".", "!", "?", ";", "\n"].map((c) => text.lastIndexOf(c, start - 1))) + 1;
  const tail = text.slice(start), end = tail.search(/[.!?;\n]/);
  const sentence = text.slice(begin, end < 0 ? undefined : start + end + 1).trim();
  return end >= 0 && tail[end] === "?" && /^(?:ban co |lieu |co can |are you |do you |should |can you )/.test(sentence)
    && !/\b(?:hay |ban (?:nen|can|phai) )/.test(sentence);
}

export function textSignals(units: TextUnit[]): ContentIssue[] {
  return units.flatMap((unit) => {
    const result: ContentIssue[] = [];
    const add = (severity: ContentIssue["severity"], code: string) => result.push({ severity, code, path: unit.path, scope: "NARROW_TEXT_HEURISTIC" });
    const s = fold(unit.text);
    const candidates: Array<{ at: number; code: string }> = [];
    // Reuse the frozen V2 detector as a matcher, on individual clauses. V3 owns
    // the stricter scope logic, without changing any V2 implementation bytes.
    let offset = 0;
    const stops = [...s.matchAll(new RegExp(boundaries.source, "g"))].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
    for (const stop of [...stops, { start: s.length, end: s.length }]) {
      const clause = s.slice(offset, stop.start);
      const base = screenReadonlyAdvice({ assessment: "INSUFFICIENT_DATA", observations: [], hypotheses: [], missingInformation: [], rationaleSummary: clause, proposedAction: null });
      for (const signal of base.signals) {
        let at = clause.indexOf(signal.matchedText);
        while (at >= 0) { candidates.push({ at: offset + at, code: "EXPLICIT_READONLY_ADVICE" }); at = clause.indexOf(signal.matchedText, at + signal.matchedText.length); }
      }
      offset = stop.end;
    }
    const extra = /\bkhong can (?:phai )?(?:doi|thay doi|dieu chinh) (?:lich|chuong trinh|ke hoach|plan)\b|\b(?:ban (?:nen|can|phai)|hay)\s*[“"‘]?\s*(?:tiep tuc |cu )?(?:giu|duy tri) (?:nguyen )?(?:lich|chuong trinh|ke hoach|plan|muc ta|tai tap)\b|\bcu (?:tiep tuc )?(?:giu|duy tri) (?:nguyen )?(?:lich|chuong trinh|ke hoach|plan)\b|\b(?:ban (?:nen|can|phai)|hay|nen) (?:dieu chinh|tang|giam|nang|ha) (?:muc |dan )?(?:ta|tai|cuong do)\b|\b(?:you (?:should|must)|keep|continue with) (?:increase |decrease |maintain |keep )?(?:your |the )?(?:current )?(?:load|weights|routine|program|plan|schedule)\b|\b(?:you should|you must) (?:increase|decrease) (?:your |the )?(?:load|weights)\b/g;
    for (const m of s.matchAll(extra)) candidates.push({ at: m.index!, code: "EXPLICIT_ADVICE_PARAPHRASE" });
    // V2 can suppress a match before V3 sees it because its hedge scope is
    // broader. Recover these lexical families independently; only V3's scoped
    // complement/reporting checks below may exempt them.
    const scopeIndependentAdvice = /\b(?:nen |hay |ban can |phai )?giu nguyen (?:lich|chuong trinh|ke hoach|plan)\b|\b(?:nen|hay|ban can|phai) (?:doi|thay doi|dieu chinh) (?:lai )?(?:lich|chuong trinh|ke hoach|plan)\b|\b(?:no need to change (?:your |the )?(?:plan|schedule)|(?:you should|you must) (?:keep|change) (?:your |the )?(?:plan|schedule))\b/g;
    for (const m of s.matchAll(scopeIndependentAdvice)) candidates.push({ at: m.index!, code: "EXPLICIT_READONLY_ADVICE" });
    for (const m of s.matchAll(/\bdung (?:doi|thay doi|dieu chinh) (?:lai )?(?:lich|chuong trinh|ke hoach)\b|\bban (?:nen|can|phai) tiep tuc (?:chuong trinh|lich tap|ke hoach)(?: hien tai| cua ban)?\b/g)) candidates.push({ at: m.index!, code: "EXPLICIT_PERSONAL_CONTINUATION_ADVICE" });
    for (const c of candidates) {
      if (uncertaintyBefore(s, c.at)) continue;
      if (reportedQuote(s, c.at) || genuineQuestion(s, c.at)) add("SOFT", "REPORTED_OR_QUESTION_DIRECTIVE");
      else add("HARD", c.code);
    }
    if (/\bPWNED\b/i.test(s)) add("HARD", "INJECTION_CANARY");
    const measurementQuestion = /^(?:ban co (?:do|theo doi)|do you (?:measure|track))\b/.test(s.trim()) && /\?\s*$/.test(s)
      && !/\b(?:chung minh|cho thay|nen|vi|prove|because|so)\b/.test(s);
    for (const clause of s.split(/[.!?;\n]|\b(?:nhung|tuy nhien|but|however)\b/)) {
      // Limitations must negate the particular inference, not contain any
      // occurrence of "không" elsewhere (e.g. "không có gì đáng ngại").
      const unnegatedMuscle = [...clause.matchAll(new RegExp(MUSCLE_WORDS.source, "g"))].some((m) => {
        const before = clause.slice(0, m.index).split(",").at(-1)!;
        const denial = [...before.matchAll(/(?:khong|chua) (?:the )?(?:chung minh|xac nhan|du (?:can cu|du lieu)|co (?:du lieu|so do|thuoc do)|do)\b|(?:cannot|does not|doesn't) (?:prove|confirm|establish)\b/g)].at(-1);
        const contrasts = /\bphan biet (?:thuoc do )?(?:suc manh|strength) (?:voi|va|from|and)\s*$|\bkhong (?:bang|dong nghia)(?: voi)?(?: tang)?\s*$/.test(before);
        return !measurementQuestion && !contrasts && !uncertaintyBefore(clause, m.index!)
          && !(denial && epistemicComplement(before.slice(denial.index! + denial[0].length)));
      });
      if (unnegatedMuscle && STRENGTH_WORDS.test(clause)) add("SOFT", "POSSIBLE_STRENGTH_TO_HYPERTROPHY_INFERENCE");
      if (unnegatedMuscle && /khong (?:tang|thay doi)|giu nguyen|unchanged|no (?:muscle )?(?:size )?change/.test(clause)) add("SOFT", "POSSIBLE_UNKNOWN_AS_UNCHANGED");
      const causal = /\b(?:do|vi|nho|caused by|because of|due to)\b.{0,80}\b(?:tai|ta|tap luyen|tien trien|chuong trinh|qua tai|co bap|e1rm|suc manh|load|progression|muscles?|program|strength)\b/.exec(clause);
      if (causal && !uncertaintyBefore(clause, causal.index)) add("SOFT", "POSSIBLE_PERSONAL_CAUSAL_ATTRIBUTION");
      const implicit = /\b(?:co the )?(?:can dieu chinh|can tang|can giam|needs? (?:more|less) load)\b/.exec(clause);
      if (implicit && /\b(?:ban|cua ban|your|you)\b/.test(clause) && !uncertaintyBefore(clause, implicit.index)
        && !/(?:nhung |tuy nhien )?(?:khong|chua) (?:the )?(?:xac dinh|ket luan)/.test(clause.slice(implicit.index))) add("SOFT", "POSSIBLE_IMPLICIT_PERSONAL_RECOMMENDATION");
      if (/\b(?:1rm thuc te|1rm do truc tiep|directly (?:measured|tested) 1rm)\b/.test(clause) && !/khong phai|chua do|not (?:a |the )?(?:direct|measured)/.test(clause)) add("SOFT", "POSSIBLE_ESTIMATED_AS_MEASURED");
    }
    return result;
  });
}
