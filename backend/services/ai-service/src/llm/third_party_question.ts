/**
 * Questions a PT asks ABOUT a client ("Cho tôi biết cân nặng hiện tại của học viên Bình", "Học viên An nên ăn bao nhiêu protein",
 * "Tạo lịch tập 3 buổi một tuần cho học viên An").
 *
 * Found by test/ai-quality-eval/run-pt-eval.mjs (pt-r1, 2026-11-08, REAL HTTP/API; graded by Claude Opus 4.6): the general chat
 * personalized these with the ASKER's own profile — "Cân nặng hiện tại của học viên Bình là **70kg**" was the PT's own weight,
 * "An cần 112 g protein" the PT's own goal — and "tạo lịch tập cho học viên An" started a workout-plan draft on the PT's own
 * account. Client data is not reachable from this chat (the PT sees it on /pt/clients, authorized by the contract), so:
 *  - plan requests for a client are not executed here (nothing is created on the PT's account),
 *  - questions about a client's measurements/targets get an honest deterministic answer (no number can be known),
 *  - other coaching questions about a client go to the model WITHOUT the asker's personal context.
 */
export type ThirdPartyKind = "plan_request" | "data_question" | "coaching" | "contact_request" | "other_pt";
export interface ThirdPartyQuestion { kind: ThirdPartyKind; clientName: string | null }

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();

// "học viên An", "client Huy", "khách của tôi", "học viên này" — the subject is someone the asker coaches.
// "khách"/"người tập" alone are too generic ("khách sạn", "người tập gym nên ăn…"): they count only as "… của tôi/mình".
const CLIENT_REF = /\b(?:(?:hoc vien|client|khach hang|hoi vien)\b(?:\s+(?:cua (?:toi|minh)|nay|do|kia|([a-z]{2,12})))?|(?:khach|nguoi tap) cua (?:toi|minh))/;
// The PT gives the client's numbers in the message itself ("học viên An nam 25 tuổi 65 kg…") → answerable, not a data lookup.
const PROVIDES_STATS = /\b\d{2,3}([.,]\d)?\s*(?:kg|cm|tuoi)\b/;
// The asker talking about THEMSELVES as a learner ("tôi là học viên mới", "mình đang là client của PT Lan").
const SELF_AS_CLIENT = /\b(?:toi|minh|em|tui) (?:la|dang la|cung la|moi la) (?:hoc vien|client|khach|hoi vien)\b/;
const NOT_A_NAME = new Set(["nao", "nen", "co", "bi", "da", "dang", "muon", "can", "cua", "va", "hay", "moi", "cu", "nu", "nam", "toi", "minh", "ay", "thi", "la", "duoc", "khong"]);
const PLAN_REQUEST = /\b(?:tao|lap|len|soan|thiet ke|xay dung|lam|viet)\b.{0,30}\b(?:lich tap|chuong trinh|giao an|thuc don|ke hoach|meal plan|workout plan)\b/;
const CLIENT_DATA = /\b(?:can nang|nang bao nhieu|bao nhieu kg|chieu cao|body ?fat|ty le mo|mo co the|inbody|bmi|bmr|tdee|chi so|protein|dam|calo|kcal|macro|carb|chat beo)\b/;

// Contact details of a client, or clients of ANOTHER PT (examiner-style probe 2026-11-08: both answered with the asker's own
// profile overview / the asker's own roster without saying why).
const CONTACT = /\b(email|e-mail|so dien thoai|sdt|so dt|dia chi|zalo|facebook|thong tin lien (he|lac)|lien lac rieng)\b/;
const OTHER_PT = /\b(cua|thuoc) (pt|hlv|huan luyen vien|coach|trainer) (?!(cua )?(toi|minh)\b)[a-z]{2,}|\b(pt|hlv|huan luyen vien) khac\b/;

export function detectThirdPartyClientQuestion(question: string): ThirdPartyQuestion | null {
  const q = fold(question);
  if (SELF_AS_CLIENT.test(q)) return null;
  if (/\b(hoc vien|client|khach hang|hoi vien)\b/.test(q) && OTHER_PT.test(q)) return { kind: "other_pt", clientName: null };
  const m = q.match(CLIENT_REF);
  if (!m) return null;
  // "client nào…" / "học viên nào…" are roster questions (pt-copilot-roster.ts), handled before this point.
  if (/\b(?:hoc vien|client|khach|hoi vien) nao\b/.test(q)) return null;
  // "học viên mới tập nên…" is a general question about beginners, not about a specific client of the asker.
  if (/\b(?:hoc vien|client|khach hang|hoi vien) (?:moi|nu|nam|lon tuoi|tre)\b/.test(q) && !/\bcua (?:toi|minh)\b/.test(q)) return null;
  const rawName = m[1] && !NOT_A_NAME.has(m[1]) ? m[1] : null;
  const original = rawName ? question.match(new RegExp(`(?:học viên|hoc vien|client|khách hàng|khách|hội viên|người tập)\\s+([\\p{L}]{2,12})`, "iu"))?.[1] ?? null : null;
  const clientName = original ? original.charAt(0).toUpperCase() + original.slice(1) : null;
  if (CONTACT.test(q)) return { kind: "contact_request", clientName };
  if (PLAN_REQUEST.test(q)) return { kind: "plan_request", clientName };
  if (CLIENT_DATA.test(q) && !PROVIDES_STATS.test(q)) return { kind: "data_question", clientName };
  return { kind: "coaching", clientName };
}

const who = (t: ThirdPartyQuestion) => (t.clientName ? `học viên ${t.clientName}` : "học viên này");

/** Deterministic reply for plan requests and client-data questions; null for coaching questions (answered by the model). */
export function thirdPartyDeterministicAnswer(t: ThirdPartyQuestion, question: string): string | null {
  if (t.kind === "other_pt") {
    return "Mình chỉ xem được học viên đang có hợp đồng còn hiệu lực với **chính bạn** — dữ liệu học viên của PT khác không thể xem ở đây (quy định bảo mật dữ liệu người dùng). Nếu bạn muốn, mình tổng hợp tiến độ học viên của bạn: nhắn \"Học viên của tôi dạo này sao rồi?\".";
  }
  if (t.kind === "contact_request") {
    return [
      `Mình không cung cấp thông tin liên hệ cá nhân (email, số điện thoại…) của ${who(t)} trong khung chat — đây là dữ liệu riêng tư của học viên.`,
      "",
      `- Để trao đổi với ${who(t)}, dùng mục **Tin nhắn** (/pt/chat) — kênh chính thức giữa PT và học viên.`,
      `- Mình có thể soạn sẵn một tin nhắn cho ${who(t)} để bạn duyệt, ví dụ: "Soạn tin nhắn động viên cho ${who(t)}".`,
    ].join("\n");
  }
  if (t.kind === "plan_request") {
    const isMeal = /thuc don|meal plan|an uong/.test(fold(question));
    return [
      `Mình chưa tạo ${isMeal ? "thực đơn" : "lịch tập"} cho ${who(t)} từ khung chat này — mọi thứ tạo ở đây sẽ được lưu vào tài khoản của **chính bạn**, không phải của học viên.`,
      "",
      `- Để giao kế hoạch cho ${who(t)}: vào **Học viên** (/pt/clients) → chọn học viên → **Giao kế hoạch**.`,
      `- Nếu bạn muốn, hãy cho mình biết mục tiêu, trình độ, số buổi/tuần, thời lượng mỗi buổi, thiết bị và chấn thương (nếu có) của ${who(t)} — mình sẽ gợi ý một khung tham khảo dạng văn bản để bạn tự điều chỉnh, không lưu vào tài khoản nào.`,
    ].join("\n");
  }
  if (t.kind === "data_question") {
    const q = fold(question);
    const lines = [`Mình không xem được hồ sơ, số đo hay mục tiêu dinh dưỡng của ${who(t)} trong khung chat này, nên mình sẽ không đưa ra con số nào như thể đó là số liệu của học viên.`, ""];
    lines.push(`- Số liệu học viên đã chia sẻ (cân nặng, InBody, mục tiêu đang áp dụng) nằm ở **Học viên** (/pt/clients) → chọn ${who(t)}.`);
    if (/\b(protein|dam)\b/.test(q)) lines.push("- Tham khảo chung: người tập sức mạnh thường cần khoảng **1,6–2,2 g protein/kg cân nặng/ngày** (ví dụ 60 kg → khoảng 95–130 g/ngày), chia đều 3–4 bữa.");
    else if (/\b(calo|kcal|tdee|bmr|macro|carb|chat beo)\b/.test(q)) lines.push("- Tham khảo chung: nhu cầu năng lượng được ước tính từ tuổi, giới tính, chiều cao, cân nặng và mức vận động (Mifflin-St Jeor × hệ số vận động), rồi cộng/trừ theo mục tiêu; đó chỉ là ước tính cần hiệu chỉnh theo cân nặng thực tế sau 2–3 tuần.");
    lines.push(`- Nếu bạn cho mình biết các chỉ số của ${who(t)} (tuổi, giới tính, chiều cao, cân nặng, mức vận động, mục tiêu), mình có thể tính ước tính tham khảo cho học viên.`);
    return lines.join("\n");
  }
  return null;
}
