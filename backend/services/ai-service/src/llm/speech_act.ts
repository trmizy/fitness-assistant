/**
 * Deterministic speech-act classification of ONE user sentence (Vietnamese + English, diacritic-insensitive).
 *
 *   QUESTION      "Em vừa sinh con được 6 tuần, giờ tập bụng được chưa?"  · "Tập 5 buổi mỗi tuần có nhiều không"
 *   HYPOTHETICAL  "Nếu tôi ăn chay thì có tăng cơ được không"           · "Giả sử tôi tập 6 buổi…"
 *   COMMAND       "Lên giúp em lịch tập 4 buổi"                          · "Hãy đổi bài squat"
 *   STATEMENT     "Tôi không ăn thịt"                                    · "Em thích tập buổi tối"
 *
 * Why it exists (eval 2026-11-11): the memory pipeline saved QUESTIONS as facts about the user ("…giờ tập bụng được chưa"
 * matched the "giờ tập" preference keyword) and the router sent advice QUESTIONS to plan-building templates. A negation is
 * NOT a question marker — "Tôi không ăn thịt" is a statement; only a sentence-final "không" / "chưa" asks something.
 * No LLM call: this runs on every turn.
 */
export type SpeechAct = "QUESTION" | "HYPOTHETICAL" | "COMMAND" | "STATEMENT";

export function foldVi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// "Nhớ giúp tôi là tôi ăn chay" — an explicit remember request carries a statement; classify what follows.
const REMEMBER_PREFIX = /^(?:hay |ban )?(?:ghi )?nho(?: giup| ho)?(?: (?:toi|em|minh))?(?: (?:la|rang))?[,:]?\s+/;

const HYPOTHETICAL = /(?:^|[\s,])(?:neu|gia su|gia du|lo nhu|trong truong hop|if|suppose|what if|imagine)\b/;

const QUESTION_FINAL = /(?:\b(?:khong|chua|nhi|sao|gi|nao|the nao|ra sao|bao nhieu|bao lau|duoc khong|duoc chua|phai khong|dung khong|hay khong|chu))\s*[.!…]*$/;
// "Tôi chưa tập bài nào" / "Em không ăn gì" — a negation followed by a sentence-final "nào/gì" is the "any" reading, not a question.
const NEGATIVE_POLARITY_ANY = /\b(?:khong|chua|chang|cha)\b.*\b(?:nao|gi)\s*[.!…]*$/;
const QUESTION_ANYWHERE = /\b(?:tai sao|vi sao|lam sao|lam the nao|nhu the nao|ra sao|bao nhieu|bao lau|khi nao|luc nao|o dau|co nen|co phai|lieu|nen.{1,60} (?:hay|hoac) |may (?:buoi|hiep|set|lan|kg|ngay|phut|gio|bua|rep))\b/;
// A question word INSIDE the sentence: "Phụ nữ sau mãn kinh nên ưu tiên tập gì để giữ xương chắc", "bài nào tốt cho lưng".
const QUESTION_INTERIOR = /\b(?:nen|can|phai|co the)\b.{0,30}\b(?:gi|nao|bao nhieu)\b|\b(?:cai|bai|mon|loai|cach|kieu|luc) nao\b|\bgi (?:de|cho|thi|hon)\b/;
const QUESTION_EN =/^(?:what|why|how|when|where|which|who|should|can|could|is|are|do|does|did|will|would|am i)\b/;

const COMMAND = /^(?:(?:vay |the |oke? |ok )?(?:hay|giup|lam on|vui long|xin (?:cho|hay|goi y|tu van|lich|thuc don|ke hoach)|cho (?:toi|em|minh)|len|tao|doi|thay|lap|xay dung|goi y|de xuat|thiet ke|soan|viet|tinh|liet ke|please|make|create|give|show|build|change|plan)\b)/;
const COMMAND_INNER = /\b(?:giup|ho) (?:toi|em|minh)\b|\b(?:len|tao|lap|xay dung|thiet ke) (?:giup )?(?:(?:cho )?(?:toi|em|minh) )?(?:mot |1 )?(?:lich|ke hoach|thuc don|giao an|chuong trinh|buoi tap)/;

export function classifySpeechAct(sentence: string): SpeechAct {
  const raw = sentence.trim();
  if (!raw) return "STATEMENT";
  let f = foldVi(raw);
  const remember = REMEMBER_PREFIX.exec(f);
  if (remember) f = f.slice(remember[0].length);

  if (HYPOTHETICAL.test(` ${f}`)) return "HYPOTHETICAL";
  if (/\?\s*$/.test(raw) && !remember) return "QUESTION";
  const negativeAny = NEGATIVE_POLARITY_ANY.test(f) || /\b(?:khong|chua|chang)\b.{0,25}\b(?:cai|bai|mon|loai|cach|kieu|luc) nao\b/.test(f);
  const finalQuestion = QUESTION_FINAL.test(f) && !negativeAny;
  const interiorQuestion = QUESTION_INTERIOR.test(f) && !negativeAny;
  if (!remember && (finalQuestion || interiorQuestion || QUESTION_ANYWHERE.test(f) || QUESTION_EN.test(f))) return "QUESTION";
  if (!remember && (COMMAND.test(f) || COMMAND_INNER.test(f))) return "COMMAND";
  return "STATEMENT";
}

/** Whole-message view: a message is a QUESTION if any of its sentences asks something (the last one wins ties). */
export function classifyMessageSpeechAct(message: string): SpeechAct {
  const parts = message.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const acts = parts.map(classifySpeechAct);
  if (acts.includes("COMMAND") && !acts.includes("QUESTION")) return "COMMAND";
  if (acts.includes("QUESTION")) return acts.includes("COMMAND") && acts.at(-1) === "COMMAND" ? "COMMAND" : "QUESTION";
  if (acts.includes("HYPOTHETICAL")) return "HYPOTHETICAL";
  return "STATEMENT";
}
