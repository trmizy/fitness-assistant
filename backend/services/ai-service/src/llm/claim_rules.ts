import { foldVi } from "./speech_act";

/**
 * Curated, short, sourced training/nutrition claims for topics where the model repeated outdated beliefs in the 200-question
 * eval (2026-11-11; RAG seed data contains none of these myths — the answers came from the model's prior).
 *
 * Use:
 *  - relevantClaimRules(question): only the rules whose TOPIC matches the question are added to the prompt (a few lines,
 *    context-on-demand — not a long canned answer);
 *  - detectMythClaims(answer): deterministic Layer-1 check (offline eval + runtime log). It does not rewrite the answer.
 *
 * Wording distinguishes "false" from "over-generalised": e.g. knee travel is fine for most people, but reducing it can be a
 * reasonable short-term choice for someone with knee pain.
 */
export interface ClaimRule {
  id: string;
  topic: RegExp; // on the folded question
  rule: string; // Vietnamese, ≤ 2 sentences, with source
  myth?: RegExp; // on the folded answer, evaluated per sentence
  /**
   * Tested on the ACCENTED, lower-cased sentence (never on folded text: "đầu" and "đau" both fold to "dau"). A sentence
   * matching this is NOT the myth even if `myth` matches (conditional caveat, explicit rejection).
   */
  exempt?: RegExp;
  /** Structured judgement of ONE sentence (accented, lower-cased); when present it replaces `myth`/`exempt`. */
  assess?: (sentence: string) => boolean;
  kind: "false" | "overgeneralised";
}

// ── knee over toes, judged by claim structure (V1 RC1 2026-11-12: B2-21 "không được vượt quá NGÓN chân" was missed; B3-19's
// refutation "ép gối không vượt mũi chân … làm tăng tải lên hông" was flagged). Folded text for the structure, accented
// text for "đau". A sentence is the myth only if it PROHIBITS knee travel past the toes/foot and is not refuting, quoting,
// conditional (in pain / temporarily) or permissive.
const K_SUBJ = String.raw`\b(?:goi|knees?)\b`;
const K_TRAVEL = String.raw`\b(?:vuot(?: qua| qua khoi| khoi| ra khoi| ra)?|di qua|qua khoi|ra truoc|go(?:es)? past|past|beyond|travel(?:s|ling)? over)\b`;
const K_OBJ = String.raw`\b(?:mui chan|ngon chan|ban chan|dau ngon chan|toes?|feet|foot)\b`;
const K_CLAIM = new RegExp(String.raw`${K_SUBJ}.{0,40}?${K_TRAVEL}.{0,20}?${K_OBJ}`);
const K_PROHIBIT = /\b(?:khong (?:duoc|nen|bao gio)|khong|dung(?: bao gio)?(?: de)?|tranh(?: de)?|tuyet doi khong|cam|never|should(?:n'?t| not)|must not|don'?t|do not|avoid)\b/;
const K_REFUTE = /\b(?:ngo nhan|quan niem sai|khong dung|khong chinh xac|sai lam|myth|misconception|nhieu nguoi (?:nghi|cho rang|tin)|nguoi ta (?:hay )?(?:noi|khuyen)|thuong duoc khuyen|lam tang tai|tang tai len|binh thuong|khong sao|is fine|is normal|is okay|perfectly normal|khong phai (?:la )?tuyet doi|khong bat buoc|not (?:an )?absolute)\b/;
const K_PERMIT = /\b(?:co the|duoc phep|cho phep|is allowed|can)\b/;
function kneeOverToesMyth(sentence: string): boolean {
  const f = foldVi(sentence);
  const m = K_CLAIM.exec(f);
  if (!m) return false;
  if (K_REFUTE.test(f)) return false; // refuted or quoted to be refuted
  if (/(?<![\p{L}])(?:nếu|khi|trong trường hợp)(?![\p{L}]).{0,30}(?<![\p{L}])đau(?![\p{L}])|(?<![\p{L}])tạm thời(?![\p{L}])|\bif you (?:have|are in|feel) pain\b/u.test(sentence)) return false;
  // polarity: a prohibition between the start of the claim's clause and the travel verb
  const clauseStart = Math.max(0, f.lastIndexOf(",", m.index) + 1, m.index - 30);
  const before = f.slice(clauseStart, m.index + m[0].search(new RegExp(K_TRAVEL)));
  if (!K_PROHIBIT.test(before)) return false;
  return !K_PERMIT.test(before.replace(/\bkhong (?:duoc|nen)\b/g, ""));
}

export const CLAIM_RULES: ClaimRule[] = [
  {
    id: "knee_over_toes",
    // also knee + squat/lunge depth/safety questions (B2-21: "Squat xuống sâu đến đâu thì an toàn cho đầu gối?" got no rule)
    topic: /\b(goi|dau goi|knees?)\b.{0,40}\b(mui chan|ngon chan|ban chan|toes?)\b|\b(squat|lunge|ngoi xom)\b.{0,60}\b(goi|knees?)\b|\b(goi|knees?)\b.{0,60}\b(squat|lunge|ngoi xom)\b/,
    rule: "Gối vượt mũi chân khi squat/lunge là bình thường nếu gối đi theo hướng mũi chân và không đau; ép gối không vượt làm tăng tải lên hông/lưng dưới (Fry 2003; Hartmann 2013). Chỉ hạn chế tạm thời khi đang đau gối.",
    myth: /(?:(khong (nen|duoc|de)|tranh|dung de|han che).{0,30}\b(goi|dau goi)\b.{0,25}vuot.{0,15}mui chan|\b(goi|dau goi)\b.{0,25}\b(khong nen|khong duoc|khong|dung|tranh)\b.{0,10}\bvuot (qua )?(khoi )?mui chan)(?!.{0,60}(binh thuong|khong sao|an toan))/,
    // a caveat for someone IN pain ("Nếu đang đau gối, hạn chế tạm thời…") is the evidence-based exception, not the myth
    exempt: /(?<![\p{L}])(nếu|khi|với tình trạng|trong trường hợp)(?![\p{L}]).{0,25}(?<![\p{L}])(đang\s+)?đau(?![\p{L}])|(?<![\p{L}])tạm thời(?![\p{L}])/u,
    assess: kneeOverToesMyth,
    kind: "overgeneralised",
  },
  {
    id: "static_stretch_injury",
    topic: /\b(gian co|stretch|khoi dong)\b/,
    rule: "Giãn cơ tĩnh trước tập KHÔNG được chứng minh giảm chấn thương; khởi động động + hiệp nhẹ phù hợp hơn, giãn tĩnh ngắn (<60 giây/nhóm) ít ảnh hưởng sức mạnh (Lauersen 2014; Behm 2016).",
    myth: /(gian co tinh|static stretch\w*)(?:(?!\bkhong\b|\bchang\b|\bchua\b).){0,80}\b(giup |de )?(giam|ngan ngua|phong ngua|tranh|han che)\b.{0,15}\bchan thuong\b/,
    kind: "false",
  },
  {
    id: "fasted_cardio",
    topic: /\b(bung doi|luc doi|nhin an|fasted|truoc khi an sang)\b.{0,40}\b(cardio|chay|tap)\b|\b(cardio|chay|tap)\b.{0,40}\b(bung doi|luc doi|fasted)\b/,
    rule: "Cardio lúc đói không giảm mỡ nhiều hơn khi tổng năng lượng trong ngày như nhau; chọn theo cảm giác và lịch sinh hoạt (Schoenfeld 2014; Hackett & Hagstrom 2017).",
    myth: /(cardio|chay|tap)\b.{0,30}(luc doi|bung doi|fasted)(?:(?!\bkhong\b|\bchang\b).){0,80}\b(dot|giam)\b.{0,12}\bmo\b.{0,25}\b(hon|tot hon|nhieu hon|hieu qua hon)\b/,
    kind: "false",
  },
  {
    id: "toning_light_weights",
    topic: /\b(san chac|tone|thon gon|ta nhe|nhieu rep|nhieu lan)\b/,
    rule: "\"Săn chắc\" = có cơ và mỡ thấp; khoảng 6–30 rep đều phát triển cơ nếu tập gần thất bại, tạ nhẹ nhiều rep không có tác dụng \"tone\" riêng (Schoenfeld 2017).",
    myth: /(ta nhe|nhieu rep|nhieu lan lap|rep cao).{0,120}\b(giup |de )?(san chac|tone|thon gon|lam san|dinh hinh|cat net)\b|(ta nhe|rep cao)\b.{0,40}\b(nhieu rep|rep cao|ta nhe)?.{0,20}\bdot chay (nhieu )?calo hon\b/,
    // explicit rejection: "tạ nhẹ nhiều rep KHÔNG có tác dụng 'tone' riêng"
    exempt: /(?<![\p{L}])không\s+(có\s+)?(tác dụng|hiệu quả)(?![\p{L}]).{0,20}(tone|săn chắc)|(?<![\p{L}])không\s+(phải|làm|giúp)(?![\p{L}]).{0,30}(tone|săn chắc)/u,
    kind: "false",
  },
  {
    id: "muscle_gain_rate",
    topic: /\b(tang|len)\b.{0,20}\b(bao nhieu|may)\b.{0,10}\bkg\b.{0,20}\bco\b|\btoc do tang co\b|\bmoi thang\b.{0,20}\bco\b/,
    rule: "Người mới tập thường tăng khoảng 0,5–1 kg cơ/tháng trong năm đầu (nữ và người đã tập lâu thấp hơn); 1–2 kg cơ/tháng không phải kỳ vọng chung — đây là ước tính thực hành, khác nhau theo người.",
    myth: /\b(tang|len)\b (duoc |khoang |tu |chung )?(1|1[.,]5|2)\s*(-|–|den|toi)\s*(2|3)\s*kg\b.{0,10}\b(co|co bap|khoi co)\b|\b(tang|len)\s+(co|khoi co|co bap)\b.{0,70}\b(0[.,]25|0[.,]5)\s*(-|–|den)\s*(0[.,]5|1)\s*kg\b.{0,10}\b(moi|\/|mot)\s*tuan\b/,
    kind: "overgeneralised",
  },
  {
    id: "protein_older_adults",
    topic: /\b(nguoi (cao|lon) tuoi|tuoi gia|tren (50|60|65)|\b(5|6|7)\d tuoi|man kinh)\b.{0,60}\b(protein|dam)\b|\b(protein|dam)\b.{0,60}\b(nguoi (cao|lon) tuoi|tuoi gia|tren (50|60|65))\b/,
    rule: "Người lớn tuổi cần đạm CAO hơn người trẻ: khoảng 1,0–1,2 g/kg/ngày, 1,2–1,5 g/kg nếu tập kháng lực hoặc có bệnh (PROT-AGE, Bauer 2013; ESPEN 2014).",
    myth: /(nguoi (cao|lon) tuoi|tuoi tac|tren (50|60)).{0,80}\b(khong can|khong phai|khong thay doi|giong nhu|nhu nguoi tre)\b.{0,30}\b(tang|them|nhu cau)?\b.{0,15}\b(protein|dam)\b/,
    kind: "false",
  },
  {
    id: "spot_reduction",
    topic: /\b(mo bung|giam mo).{0,30}\b(tap bung|gap bung|plank)\b|\b(tap bung|gap bung)\b.{0,30}\b(giam mo|mo bung)\b/,
    rule: "Tập bụng không đốt mỡ bụng tại chỗ; mỡ giảm toàn thân nhờ thâm hụt năng lượng (Vispute 2011).",
    myth: /\b(tap bung|gap bung|plank)\b(?:(?!khong|chang|khong the).){0,40}\b(dot|giam|tieu)\b.{0,10}\bmo bung\b(?!.{0,30}\b(khong|toan than)\b)/,
    kind: "false",
  },
  {
    id: "rest_compound",
    topic: /\b(nghi|rest)\b.{0,30}\b(giua (cac )?(hiep|set)|bao lau)\b/,
    rule: "Bài compound nặng (squat, deadlift, bench) nên nghỉ khoảng 2–3 phút giữa hiệp; bài đơn khớp 60–90 giây là đủ (Schoenfeld 2016).",
    myth: /\b(compound|bai ghep|bai da khop|squat|deadlift|bench)\b.{0,60}\bnghi\b.{0,15}\b(30|45|60)\s*(-|–|den)\s*(60|90)\s*giay\b/,
    kind: "overgeneralised",
  },
];

export function relevantClaimRules(question: string, max = 3): ClaimRule[] {
  const q = foldVi(question);
  return CLAIM_RULES.filter((r) => r.topic.test(q)).slice(0, max);
}

export function formatClaimRulesForPrompt(question: string): string {
  const rules = relevantClaimRules(question);
  return rules.length ? ["Kiến thức đã kiểm chứng liên quan (ưu tiên hơn hiểu biết chung):", ...rules.map((r) => `- ${r.rule}`)].join("\n") : "";
}

export function detectMythClaims(answer: string): Array<{ id: string; kind: ClaimRule["kind"] }> {
  // markdown emphasis and line breaks must not split a claim ("tăng khoảng **1–\n2 kg** cơ")
  // markdown emphasis and line breaks must not split a claim; evaluation is per sentence so a conditional caveat / explicit
  // rejection exempts only its own sentence; a sentence ending in "?" (e.g. the answer echoing the question as a heading) is
  // not an assertion.
  const cleaned = answer.replace(/[*_`#>]+/g, "").replace(/\s*\n\s*/g, " ").normalize("NFC").toLowerCase();
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => !/\?\s*$/.test(s));
  return CLAIM_RULES.filter((r) => (r.assess || r.myth) && sentences.some((raw) => (r.assess ? r.assess(raw) : r.myth!.test(foldVi(raw)) && !(r.exempt && r.exempt.test(raw))))).map((r) => ({ id: r.id, kind: r.kind }));
}
