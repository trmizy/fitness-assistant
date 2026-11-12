import { foldVi } from "./speech_act";

/**
 * Minor (<18) safety policy — what KIND of request a training/nutrition message is, independent of whose age it is
 * (V1 RC, 2026-11-12). The decision is by personalisation level and risk, not by age alone:
 *
 *   GENERAL_KNOWLEDGE  impersonal or myth/safety question ("Người 16 tuổi có được tập gym không?", "Tập tạ có bị lùn không?")
 *                      → for a minor: a general, evidence-based answer + supervision note (never a personal number/plan)
 *   PERSONAL_ADVICE    the user's OWN frequency / intensity / load / recovery / intake ("Tôi 16 tuổi, có nên tập mỗi ngày?")
 *   PLAN_REQUEST       create / change a schedule or a menu
 *   HIGH_RISK          high intensity, max load, every-day or 7-day hard training, pain/injury/symptoms, supplements/drugs,
 *                      weight cutting
 *                      → for a minor, the last three get the minors' triage (parent + paediatric professional)
 *
 * Who counts as a minor (orchestrator + safety_guard): the message age, the profile age, or a hypothetical age — the MINOR
 * reading always wins when they disagree (profile 16 + "tôi 19" → minor; profile 20 + "tôi 16" → minor).
 * Deterministic, no model. Pure: no I/O.
 */
export type MinorRequestCategory = "GENERAL_KNOWLEDGE" | "PERSONAL_ADVICE" | "PLAN_REQUEST" | "HIGH_RISK";

// The user talking about themselves ("con tôi" / "con em" = their child → third person, excluded).
// ("tao" is NOT included: "tạo" (create) folds to the same string.)
const FIRST_PERSON = /\b(?:toi|em|minh|tui)\b/;
const THIRD_PERSON_CHILD = /\bcon (?:toi|em|minh)\b|\b(?:be|chau|con trai|con gai|hoc sinh|tre)\b/;

const HIGH_RISK = /\b(?:cuong do cao|hiit|1 ?rm|rep max|max|toi da|het suc|nang nhat|nang nhu|tap nang|2 buoi (?:mot|1|moi) ngay|7 (?:ngay|buoi)|7\/7|lien tuc|khong nghi|giam \d+ ?(?:kg|ky)|nhin an|nhin doi|bo bua|cat calo|an kieng|whey|creatine|bcaa|pre ?workout|steroid|thuoc|thuc pham chuc nang|bo sung|supplement|chan thuong|bong gan|chong mat|kho tho|ngat|tuc nguc|bao nhieu kg|muc ta|ta bao nhieu)\b/;
// "đau" (pain) only with its accent: "bắt đầu" / "đầu gối" fold to the same "dau".
const PAIN = /(?<!\p{L})đau(?!\p{L})|\bbi dau\b|\bpain\b/u;

const PLAN_REQUEST = /\b(?:tao|lap|xay dung|thiet ke|soan|goi y|de xuat|lam)\b.{0,30}\b(?:lich|ke hoach|giao an|chuong trinh|thuc don)\b|\blen\b(?!\s*\d).{0,20}\b(?:lich|ke hoach|thuc don|giao an)\b|\b(?:doi|chinh|sua)\b.{0,20}\b(?:lich tap|ke hoach tap|thuc don)\b/;

const PERSONAL_DOSE = /\b(?:bao nhieu|may) (?:buoi|lan|hiep|set|rep|phut|gio|ngay|bua|calo|kcal|gam|g)\b|\b(?:moi|hang) ngay\b|\b\d+\s*(?:buoi|lan)\s*(?:\/|mot|1|moi|trong)?\s*(?:tuan|week)\b|\btan suat\b|\bcuong do\b|\bnghi (?:bao lau|may ngay)\b|\bphuc hoi\b|\bnen (?:tap|an) (?:bao|may|gi|bai|nhu the nao|the nao)\b|\b(?:an|uong) bao nhieu\b|\b(?:calo|kcal|protein|dam|tinh bot|carb)\b|\b(?:giam|tang) (?:can|mo|ky)\b/;

export function classifyMinorRequest(message: string): MinorRequestCategory {
  const raw = String(message ?? "").normalize("NFC").toLowerCase();
  const f = foldVi(raw);
  if (HIGH_RISK.test(f) || PAIN.test(raw)) return "HIGH_RISK";
  if (PLAN_REQUEST.test(f)) return "PLAN_REQUEST";
  if (isFirstPersonAboutSelf(f) && PERSONAL_DOSE.test(f)) return "PERSONAL_ADVICE";
  return "GENERAL_KNOWLEDGE";
}

/** The message talks about the user themselves (not "người 16 tuổi", not "con tôi"). Folded text. */
export function isFirstPersonAboutSelf(folded: string): boolean {
  return FIRST_PERSON.test(folded) && !THIRD_PERSON_CHILD.test(folded);
}

/** Wording that could need the minors' triage if the user turns out to be a minor by PROFILE (worth a profile-age read). */
export function needsProfileAgeForMinorPolicy(message: string): boolean {
  return classifyMinorRequest(message) !== "GENERAL_KNOWLEDGE";
}
