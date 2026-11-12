import { classifySpeechAct, foldVi } from "../llm/speech_act";
import { classifyConfirmationUtterance } from "./confirmation-boundary";

/**
 * What the user's turn IS, for the fitness agent (V1 stabilization, 2026-11-12).
 *
 *   QUESTION      asks for information/advice            "Đổi lên 5 buổi được không?" · "Tập 5 buổi có nhiều không?"
 *   REQUEST       asks the ASSISTANT to do something,    "Bạn có thể tạo lịch 5 buổi cho tôi không?" · "Lên giúp tôi lịch
 *                 phrased as a question                  tập 4 buổi được không?" · "Tạo lịch tập cho tôi được không?"
 *   COMMAND       imperative                             "Hãy đổi lịch của tôi lên 5 buổi." · "Tạo lịch tập 5 buổi cho tôi"
 *   CONFIRMATION  bare consent to a pending action       "Xác nhận" · "Ok lưu đi"
 *   HYPOTHETICAL  a condition, not a wish                "Nếu tập 5 buổi thì thế nào?"
 *   STATEMENT     anything else                          "Tôi muốn tạo lịch tập mới"
 *
 * Why (REAL HTTP/API, Nova Pro recheck B1-13): the agent runs BEFORE the chat router, so a suitability question that mentioned a
 * schedule change opened the create-schedule flow. A "…được không?" question is advice-seeking UNLESS it is explicitly addressed
 * to the assistant as something to do ("bạn có thể…", "giúp tôi…", "<verb> … cho tôi"); the "?" alone never decides it, and a
 * question without "?" ("…có nhiều không") is still a question (speech_act.ts).
 *
 * Polite conditions ("nếu được", "nếu có thể", "nếu tiện") are not hypotheticals: "Lên lịch tập cho tôi, nếu được thì 4 buổi"
 * is a command. Deterministic, no model.
 */
export type AgentTurnAct = "QUESTION" | "REQUEST" | "COMMAND" | "CONFIRMATION" | "HYPOTHETICAL" | "STATEMENT";

const POLITE_CONDITION = /(?<!\p{L})(?:nếu|neu)\s+(?:được|duoc|có thể|co the|tiện|tien|bạn (?:thấy )?(?:ok|được|duoc))(?!\p{L})|(?<![a-z])if possible(?![a-z])/giu;

// Verbs that make the assistant DO something with the user's plan/data (folded).
const ACTION_VERB = /\b(?:tao|len|lap|xay dung|xay|thiet ke|soan|xep|doi|chuyen|thay|chinh|sua|gan|luu|ap dung|kich hoat|bat dau|bo qua|huy|lam lai|make|create|build|change|switch|plan)\b/;
// The assistant is addressed as the agent ("em" is deliberately absent: users call THEMSELVES "em" — "Em có thể tập 5 buổi không?").
const ADDRESSED = /\b(?:ban|anh|chi|coach|gymini|ai)\s+(?:co the|giup|ho|lam on)\b|^(?:co the|lam on|vui long|xin|nho)\b|\b(?:can|could|would) you\b/;
const BENEFACTIVE = /\b(?:giup|ho|dum|gium)\s+(?:toi|minh|em|tui)\b/;
const VERB_FOR_ME = /\b(?:tao|len|lap|xay dung|thiet ke|soan|doi|chuyen|xep|lam)\b(?:\s+\S+){0,6}?\s+cho\s+(?:toi|minh|em|tui)\b/;
// "… có tốt cho tôi không" judges something — it does not ask for it to be done.
const EVALUATIVE = /\bco (?:tot|hop|phu hop|nen|on|sao|hai|an toan|hieu qua|qua)\b|\b(?:nhieu|it) qua\b|\bqua (?:nhieu|it|suc)\b|\bhop ly\b/;

function isRequestShaped(f: string): boolean {
  if (!ACTION_VERB.test(f)) return false;
  return ADDRESSED.test(f) || BENEFACTIVE.test(f) || (VERB_FOR_ME.test(f) && !EVALUATIVE.test(f));
}

function sentenceAct(sentence: string): AgentTurnAct {
  const act = classifySpeechAct(sentence);
  const f = foldVi(sentence);
  if (act === "QUESTION") return isRequestShaped(f) ? "REQUEST" : "QUESTION";
  return act;
}

export function classifyAgentTurnAct(text: string): AgentTurnAct {
  const raw = String(text ?? "").trim();
  if (!raw) return "STATEMENT";
  const confirmation = classifyConfirmationUtterance(raw);
  if (confirmation === "CONFIRM") return "CONFIRMATION";
  if (confirmation === "STATUS") return "QUESTION";
  const cleaned = raw.replace(POLITE_CONDITION, " ").replace(/\s*,\s*(?:thì|thi)\s+/giu, ", ").replace(/\s+/g, " ").trim();
  const acts = cleaned.split(/(?<=[.!?\n])\s+/u).map((s) => s.trim()).filter(Boolean).map(sentenceAct);
  // An explicit instruction anywhere in the turn wins ("Tôi đang tập 3 buổi. Hãy đổi lên 5 buổi."); otherwise a question in the
  // turn makes it a question ("Tôi đang tập 3 buổi. Có nên tăng lên 5 không?").
  for (const winner of ["COMMAND", "REQUEST", "QUESTION", "HYPOTHETICAL"] as const) if (acts.includes(winner)) return winner;
  return "STATEMENT";
}

/** Acts that may start creating or changing the user's data (each still ends in the existing preview + explicit confirmation). */
export function mayStartMutation(act: AgentTurnAct): boolean {
  return act !== "QUESTION" && act !== "HYPOTHETICAL";
}
