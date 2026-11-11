/**
 * Medical-referral guarantee (eval B1-45 2026-11-10, B2-43/B2-50 2026-11-11).
 *
 * The MODEL still writes the answer. This only appends one short referral line when the model's answer never refers the
 * user to a doctor and either
 *   (a) the user says THEY have a chronic condition — in this question or in one of their recent questions
 *       ("Tôi bị loãng xương nhẹ." … then "Thế tôi có nên tập squat không?"), or
 *   (b) the question is about a group with elevated risk for exercise (after menopause), where clearance is the usual advice.
 * Pure, no I/O, never replaces model text.
 */
const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

const CHRONIC_CONDITION =
  /(?<![a-z0-9])(loang xuong|osteopor\w*|hen suyen|asthma|suy tim|nhoi mau|dot quy|stroke|ung thu|cancer|dong kinh|epilep\w*|suy than|xo gan|roi loan nhip|benh mach vanh|tieu duong|diabetes|cao huyet ap|huyet ap cao|tang huyet ap|hypertension|thoat vi dia dem)(?![a-z0-9])/;
// The user speaks about themselves ("tôi bị…", "em đang…", "I have…"), not about the condition in general ("loãng xương là gì?").
const SELF_REPORT = /(?<![a-z0-9])(toi|minh|em|tui|bi|dang bi|mac|i have|i am|i'm|my)(?![a-z0-9])/;
const GENERAL_QUESTION = /(la gi(?![a-z])|do dau|tai sao|vi sao|nguyen nhan|trieu chung cua|dinh nghia|what is|causes? of)/;
const ALREADY_REFERS = /(bac si|bac sy|chuyen gia y te|chuyen khoa|thay thuoc|nha thuoc|doctor|physician|healthcare provider|medical professional|clinician)/;
const RISK_GROUP = /(?<![a-z0-9])(man kinh|menopaus\w*)(?![a-z0-9])/;

// The user reports THEIR OWN pain / injury ("tôi bị đau lưng", "bị bong gân") — not a general "có bị chấn thương không?".
const OWN_PAIN_OR_INJURY =
  /(?<![a-z0-9])(?<!co )bi (?:dau|bong gan|chan thuong|cang co|trat|thoat vi)|(?<![a-z0-9])(?:toi|em|minh|tui) (?:dang |van |hay )?dau (?:lung|goi|vai|co|hong|khop|bap chan|dau)/;

// "Tôi sắp 60 tuổi", "bà tôi 65 tuổi": people 60+ starting or changing a program are usually told to get a health check first (ACSM preparticipation screening).
function isSixtyOrOlder(foldedQuestion: string): boolean {
  const m = /(?<![a-z0-9])(?:sap |gan )?(\d{2,3}) tuoi/.exec(foldedQuestion);
  return m !== null && Number(m[1]) >= 60 && Number(m[1]) <= 110;
}

type Reason = "CONDITION" | "RISK_GROUP" | "PAIN" | null;

function reasonFor(question: string, answer: string, recentUserTurns: string[]): Reason {
  if (ALREADY_REFERS.test(fold(answer))) return null;
  const q = fold(question);
  if (OWN_PAIN_OR_INJURY.test(q) && !GENERAL_QUESTION.test(q) && !CHRONIC_CONDITION.test(q)) return "PAIN";
  const reports = (text: string) => CHRONIC_CONDITION.test(text) && SELF_REPORT.test(text) && !GENERAL_QUESTION.test(text);
  if (!GENERAL_QUESTION.test(q) && (reports(q) || recentUserTurns.some((t) => reports(fold(t))))) return "CONDITION";
  if (RISK_GROUP.test(q) || isSixtyOrOlder(q)) return "RISK_GROUP";
  return null;
}

export function needsMedicalReferralNote(question: string, answer: string, recentUserTurns: string[] = []): boolean {
  return reasonFor(question, answer, recentUserTurns) !== null;
}

const NOTE_CONDITION_VI =
  "⚠️ Vì bạn đang có bệnh nền, hãy hỏi bác sĩ điều trị trước khi bắt đầu hoặc thay đổi chương trình tập, và dừng ngay nếu thấy đau, chóng mặt hay khó thở.";
const NOTE_CONDITION_EN =
  "⚠️ Because you have an underlying condition, check with your doctor before starting or changing a training program, and stop right away if you feel pain, dizziness or shortness of breath.";
const NOTE_RISK_VI =
  "⚠️ Nếu bạn đã được chẩn đoán loãng xương hoặc có bệnh nền (tim mạch, huyết áp, khớp), hãy hỏi bác sĩ trước khi bắt đầu hoặc tăng mức tập, và dừng ngay nếu thấy đau, chóng mặt hay khó thở.";
const NOTE_RISK_EN =
  "⚠️ If you have been diagnosed with osteoporosis or have an underlying condition (heart, blood pressure, joints), check with your doctor before starting or increasing training, and stop right away if you feel pain, dizziness or shortness of breath.";

const NOTE_PAIN_VI =
  "⚠️ Nếu cơn đau tăng, kèm sưng, tê, yếu hoặc không đỡ sau vài ngày, hãy đi khám bác sĩ hoặc chuyên gia vật lý trị liệu; trong lúc đó tránh các động tác làm đau tăng.";
const NOTE_PAIN_EN =
  "⚠️ If the pain gets worse, comes with swelling, numbness or weakness, or does not improve within a few days, see a doctor or physiotherapist; until then avoid movements that increase it.";

export function appendMedicalReferralNote(
  question: string,
  answer: string,
  language: "vi" | "en" | string = "vi",
  recentUserTurns: string[] = [],
): string {
  const reason = reasonFor(question, answer, recentUserTurns);
  if (!reason) return answer;
  const en = language === "en";
  const note =
    reason === "CONDITION" ? (en ? NOTE_CONDITION_EN : NOTE_CONDITION_VI)
    : reason === "PAIN" ? (en ? NOTE_PAIN_EN : NOTE_PAIN_VI)
    : en ? NOTE_RISK_EN : NOTE_RISK_VI;
  return `${answer.trimEnd()}\n\n${note}`;
}

// ── Minors asking a general safety question (see safety_guard.isMinorGeneralKnowledgeQuestion) ─────────────────────────────

/** Added to the prompt for that case only: general, evidence-based information, nothing personalised. */
export function minorGeneralInfoPromptNote(lang: string): string {
  return lang === "en"
    ? "IMPORTANT: the user is under 18. Give only general, evidence-based information that answers the question directly (for example, NSCA 2009 and Lloyd 2014 conclude that supervised resistance training does not stunt growth). Do NOT give calorie targets, weight-loss advice, maximal-load advice or a personalised plan. Stress supervision by a qualified coach, correct technique, and talking with a parent/guardian or paediatrician."
    : "QUAN TRỌNG: người dùng dưới 18 tuổi. Chỉ đưa thông tin chung, dựa trên bằng chứng và trả lời thẳng vào câu hỏi (ví dụ: NSCA 2009 và Lloyd 2014 kết luận tập kháng lực có người giám sát không làm chậm tăng chiều cao). KHÔNG đưa mục tiêu calo, lời khuyên giảm cân, mức tạ tối đa hay lịch tập cá nhân hóa. Nhấn mạnh tập với huấn luyện viên có chứng chỉ, kỹ thuật đúng, và trao đổi với phụ huynh hoặc bác sĩ nhi khoa.";
}

const MINOR_REFERS = /(phu huynh|bo me|ba me|cha me|bac si|huan luyen vien|parent|guardian|pediatric|paediatric|coach)/;
const MINOR_NOTE_VI =
  "👨‍👩‍👧 Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên có chứng chỉ giám sát và trao đổi với phụ huynh hoặc bác sĩ nhi khoa trước khi thay đổi chế độ tập hoặc ăn uống.";
const MINOR_NOTE_EN =
  "👨‍👩‍👧 Because you are under 18, train under a qualified coach and talk with a parent/guardian or paediatrician before changing your training or diet.";

/** Appends the supervision/guardian line when the model's answer did not already say it. */
export function appendMinorSupervisionNote(answer: string, language: "vi" | "en" | string = "vi"): string {
  if (MINOR_REFERS.test(fold(answer))) return answer;
  return `${answer.trimEnd()}\n\n${language === "en" ? MINOR_NOTE_EN : MINOR_NOTE_VI}`;
}
