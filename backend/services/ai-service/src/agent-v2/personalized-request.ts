/**
 * Gymini V2 — M7-P5A.2.2: is a HIGH_RISK question a request for a PERSONALISED recommendation (a dose, a quantity, a plan, a
 * target, an aggressive weight-loss / intensity instruction for the user)? Used ONLY by Gate 1 (supervisor) for the AGE_UNKNOWN
 * fail-closed block, next to the agents' own `needsUserData` patterns. Pure, deterministic, no I/O, no model, never throws.
 *
 * WHY: `needsUserData` keys on phrases like "của tôi"; a personalised ask without them ("Uống mấy muỗng whey mỗi ngày?",
 * "Giảm 5 kg trong 2 tuần thế nào?") would otherwise slip past the unknown-age block. A first-person pronoun (tôi/mình/em/tui)
 * is deliberately NOT a signal in either direction: "Tôi thấy whey là gì nhỉ?" is educational; "Uống mấy muỗng whey?" is personal.
 *
 * DECISION ORDER (folded text, see `foldVi`: accents / "đ" / case removed, so accented, unaccented and mixed input agree):
 *   1. STRONG signals  -> true.  A concrete quantity, number target, timeframe or plan/menu/dose creation. These win even over an
 *      educational wording ("Uống mấy muỗng whey thì có hại?" is still a dose ask).
 *   2. IMPERSONAL / EDUCATIONAL wording -> false.  Definitions, mechanisms, safety / myth questions, third-person populations
 *      ("là gì", "hoạt động như thế nào", "có an toàn không", "tại sao", "vận động viên", "người ta", "khuyến cáo").
 *   3. WEAK signals -> true.  "mỗi ngày", "bao nhiêu" next to an intake unit / kg, "nên … bao nhiêu", "thế nào / làm sao / cách" to
 *      ACHIEVE a body-change target, "giảm mỡ nhanh". Only reached when nothing educational / impersonal was seen.
 *   4. otherwise false.
 *
 * NOT covered (known limits):
 *   - An anaphoric follow-up with no body words ("Vậy uống cái đó mỗi ngày nhé?") relies on "mỗi ngày" alone.
 *   - "Giảm 5 kg trong 2 tuần được không?" is a feasibility question about a plan -> true (stated target + timeframe), even
 *     though it could be read as general. Fail-closed is the intent: the user is asked for an age, not refused.
 *   - A third-person ask that carries an explicit quantity ("Vận động viên uống mấy muỗng whey?") is still true (strong signal
 *     beats impersonal wording) — the user may be asking for themselves in disguise.
 *   - Third-person populations / educational wording DO neutralise the weak signals ("Người ta thường giảm bao nhiêu kg mỗi
 *     tháng là an toàn?" -> false); a user could phrase a personal ask that way — it then gets general-only handling downstream.
 *   - Only Vietnamese (plus a few English words). No spelling correction. Text is capped at MAX_CHARS.
 *   - No accent-sensitive raw-text check is needed: every pattern is meaningful once folded ("an toan" = safe and "an" = eat are
 *     distinct tokens; "may muong" cannot be anything but "mấy muỗng").
 *
 * Gate 1 only calls this for classifyMinorRequest(question) === "HIGH_RISK"; the function still behaves sensibly on any input.
 */
import { foldVi } from "../llm/speech_act";

const MAX_CHARS = 4_000;

// intake / quantity nouns, folded (used inside alternations)
const INTAKE = "muong|vien|scoop|gam|g|ml|cc|goi|ly|lon|chai|calo|kcal|protein|dam|carb|tinh bot|whey|creatine|bcaa|nuoc|lit|lan|bua";

// ── 1. STRONG ────────────────────────────────────────────────────────────────────────────────────────────────────────
// a body-change number target ("giảm 5 kg", "xuống 62 kg", "tăng 3kg", "giảm 10%")
const NUMBER_TARGET = /\b(?:giam|tang|xuong|con|cat|sut|dot|dat|len)\s*(?:duoc\s*)?(?:khoang\s*)?\d+(?:[.,]\d+)?\s*(?:kg|ky|can|cm|%|phan tram)(?![a-z])/;
// an action verb + a timeframe ("giảm cân trong 2 tuần", "tăng cơ sau 1 tháng")
const TARGET_TIMEFRAME = /\b(?:giam|tang|cat|sut|dot|siet)\b.{0,30}\b(?:trong|sau|chi|vong)\s*\d+\s*(?:tuan|thang|ngay|buoi)\b/;
// dose / quantity ask: "mấy muỗng / viên / gam / scoop / lần / gói / ly …" or an explicit numeric dose ("uống 3 muỗng", "2 scoop")
const DOSE_ASK = new RegExp(
  `\\bmay\\s+(?:muong|vien|scoop|gam|g|goi|ly|lan|ml|cc|bua)\\b|\\b(?:uong|dung|an|nap|bo sung)\\s*\\d+(?:[.,]\\d+)?\\s*(?:${INTAKE})\\b|\\b\\d+(?:[.,]\\d+)?\\s*(?:muong|vien|scoop|goi)\\b`,
);
// an explicit frequency of one's own training ("7 ngày một tuần", "7/7", "2 buổi mỗi ngày")
const OWN_FREQUENCY = /\b\d+\s*(?:ngay|buoi|lan)\s*(?:\/|mot|1|moi|trong)\s*(?:tuan|thang|ngay)\b|\b7\s*\/\s*7\b/;
// create a plan / menu / schedule / regimen
const PLAN_CREATION = /\b(?:lap|tao|xay dung|thiet ke|soan|len|goi y|de xuat|viet|lam|cho|tu van|xin)\b.{0,25}\b(?:ke hoach|lich|thuc don|chuong trinh|giao an|lo trinh|menu|che do)\b|\bche do an (?:kieng|giam can|tang can|cat calo)\b/;
// imperative asking for a dose / method ("cho mình liều dùng …", "tư vấn cách giảm …")
const IMPERATIVE = /\b(?:cho|giup|tu van|goi y|de xuat|huong dan|chi)\b(?: (?:toi|em|minh|tui))?\s.{0,30}\b(?:lieu(?: luong| dung)?|cach (?:giam|tang|cat|an|uong|tap|dung)|muc (?:calo|protein|an|uong)|bai tap)\b/;

// ── 2. GENERAL / EDUCATIONAL / IMPERSONAL ────────────────────────────────────────────────────────────────────────────
const EDUCATIONAL = /\bla gi\b|\bla cai gi\b|\bhoat dong (?:nhu the nao|ra sao|the nao)\b|\bco tac dung (?:gi|nhu the nao)\b|\btac dung phu\b|\bco (?:an toan|hai|nguy hiem|gay|lam|bi|tot|that|dung|hieu qua|anh huong|nen|can thiet|phai)\b|\btai sao\b|\bvi sao\b|\bkhac nhau\b|\bnguy co\b|\bhuyen thoai\b|\bdung hay sai\b|\bsu that\b/;
const IMPERSONAL = /\b(?:nguoi ta|van dong vien|nguoi tap (?:gym|the hinh|the thao)|dan gym|nguoi binh thuong|nguoi (?:truong thanh|lon|moi tap|ban dau|\d+ tuoi)|phu nu|nam gioi|nhung nguoi|trung binh|da so|hau het|chuyen gia|nghien cuu|khuyen cao|huong dan cua|nhieu nguoi)\b/;

// ── 3. WEAK ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const EVERY_DAY = /\b(?:moi|hang) (?:ngay|tuan|buoi|lan|sang|toi|bua)\b/;
const HOW_MUCH_INTAKE = new RegExp(`\\bbao nhieu\\b.{0,20}\\b(?:${INTAKE}|kg|ky|buoi|set|rep)\\b|\\b(?:${INTAKE}|kg|ky)\\b.{0,25}\\bbao nhieu\\b`);
const SHOULD_HOW_MUCH = /\bnen\b.{0,40}\b(?:bao nhieu|may|nhu the nao|the nao)\b/;
const GOAL = "(?:giam (?:can|mo|\\d)|tang (?:can|co|mo|ky|\\d)|sut can|cat can|dot mo|giam nhanh|siet can|an kieng|giam eo)";
const HOW_TO_GOAL = new RegExp(
  `\\b(?:lam sao|lam the nao|the nao|cach|bang cach nao|nhu the nao|bi quyet|meo|phuong phap|ra sao)\\b.{0,40}\\b${GOAL}|\\b${GOAL}.{0,40}\\b(?:the nao|lam sao|cach|bang cach nao|ra sao)\\b`,
);
const AGGRESSIVE = /\b(?:giam|cat|dot) (?:mo|can)\b.{0,15}\b(?:nhanh|gap|cap toc|toi da)\b|\b(?:nhanh nhat|gap|cap toc)\b.{0,15}\bgiam (?:mo|can)\b/;

const STRONG: readonly RegExp[] = [NUMBER_TARGET, TARGET_TIMEFRAME, DOSE_ASK, OWN_FREQUENCY, PLAN_CREATION, IMPERATIVE];
const WEAK: readonly RegExp[] = [EVERY_DAY, HOW_MUCH_INTAKE, SHOULD_HOW_MUCH, HOW_TO_GOAL, AGGRESSIVE];

export function isPersonalizedHighRiskRequest(question: string): boolean {
  if (typeof question !== "string" || !question) return false;
  let folded: string;
  try {
    folded = foldVi(question.slice(0, MAX_CHARS));
  } catch {
    return false;
  }
  if (!folded) return false;
  if (STRONG.some((re) => re.test(folded))) return true;
  if (IMPERSONAL.test(folded) || EDUCATIONAL.test(folded)) return false;
  return WEAK.some((re) => re.test(folded));
}

/**
 * M7-P5A.2.2 (second Gate-1 signal): an AGGRESSIVE body-change request — a stated number target ("giảm 5 kg", "xuống 62 kg"),
 * an action + short timeframe ("giảm … trong 2 tuần") or "giảm mỡ / cân nhanh / gấp / tối đa" — for the user. Needed because
 * V1's `classifyMinorRequest` does not rate every such wording HIGH_RISK ("Tăng protein lên bao nhiêu để giảm mỡ nhanh?" is
 * GENERAL_KNOWLEDGE there) and V1 may not be changed here. Deliberately NARROWER than isPersonalizedHighRiskRequest: no dose,
 * plan or "mỗi ngày" signals, so ordinary plan / nutrition questions of an unknown-age user are NOT blocked by it. Educational
 * or impersonal wording ("Giảm cân nhanh có hại không?", "Người ta thường giảm bao nhiêu kg…") returns false.
 * Gate 1 uses it only for an AGE_UNKNOWN profile with no stated age; the outcome is the age-required message, not a refusal.
 */
export function isAggressiveBodyChangeRequest(question: string): boolean {
  if (typeof question !== "string" || !question) return false;
  let folded: string;
  try { folded = foldVi(question.slice(0, MAX_CHARS)); } catch { return false; }
  if (!folded) return false;
  if (NUMBER_TARGET.test(folded) || TARGET_TIMEFRAME.test(folded)) return true;
  if (IMPERSONAL.test(folded) || EDUCATIONAL.test(folded)) return false;
  return AGGRESSIVE.test(folded);
}
