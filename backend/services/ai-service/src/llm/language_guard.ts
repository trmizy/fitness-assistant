import type { LanguageDecision, ResponseLanguage } from "./types";

const userLanguageLock = new Map<string, ResponseLanguage>();

/**
 * Strips diacritics / tone marks so that both accented ("trả lời bằng tiếng việt")
 * and unaccented ("tra loi bang tieng viet") forms reduce to the same ASCII string.
 * Steps: lowercase → NFD decompose → remove combining marks → collapse whitespace.
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Unaccented Vietnamese ("toi bi dau nguc va kho tho khi tap") has no diacritics for the check above and may contain none of its fixed
 * phrases; it was answered in ENGLISH — including the medical-emergency reply, to the user who most needs to understand it. A phrase list
 * can never be complete, so also count Vietnamese FUNCTION/SYMPTOM syllables once the diacritics are gone. Only syllables that are not
 * ordinary English words are listed (no "la", "do", "an", "ban", "mat", "tap", "can"…), and the English stop-words are counted against them.
 */
const VI_PLAIN_SYLLABLES = new Set([
  "toi", "khong", "nhung", "duoc", "nhu", "muon", "minh", "cua", "nay", "roi", "voi", "thi", "hay", "gi", "sao", "dang", "nen", "khi", "bi", "va",
  "cung", "con", "rat", "qua", "nhieu", "it", "hon", "that", "nao", "dau", "dau", "nguc", "kho", "tho", "bung", "lung", "dui", "goi", "tim", "dap", "ngat", "xiu",
  "chong", "buon", "non", "met", "moi", "nhuc", "sung", "te", "tuc", "bac", "si", "kham", "benh", "thuoc", "an", "ngu", "uong", "tap", "giam", "tang",
]);
const VI_STRONG = new Set(["toi", "khong", "nhung", "duoc", "nhu", "muon", "minh", "cua", "nay", "roi", "voi", "thi", "hay", "gi", "sao", "dang", "nen", "khi", "bi", "cung", "nguc", "kho", "tho", "nhuc", "ngat", "xiu", "chong", "buon", "bung", "dui", "goi"]);
const EN_STOP = new Set(["the", "is", "are", "i", "my", "me", "you", "your", "and", "or", "to", "of", "for", "with", "what", "how", "should", "can", "do", "does", "have", "has", "it", "in", "on", "that", "this", "when", "why", "which", "please", "about", "after", "before", "get", "give"]);
function looksLikeUnaccentedVietnamese(text: string): boolean {
  const tokens = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const strong = new Set(tokens.filter((t) => VI_STRONG.has(t)));
  const vi = tokens.filter((t) => VI_PLAIN_SYLLABLES.has(t)).length;
  const en = tokens.filter((t) => EN_STOP.has(t)).length;
  return strong.size >= 2 && vi > en;
}

function detectLanguage(message: string): ResponseLanguage {
  const text = message.toLowerCase();
  // Vietnamese-specific diacritics (tone marks + vowel modifiers outside basic Latin)
  const hasVietnameseDiacritics = /[\u00C0-\u024F\u1E00-\u1EFF]/.test(message);
  // Common Vietnamese words without diacritics as fallback — kept as multi-word
  // phrases (not single short words) to avoid false-positives against English
  // (e.g. a bare "la"/"do"/"an" could be English too; "cho toi"/"an uong" can't be).
  const viSignals =
    /(lich tap|bai tap|giam mo|tang co|thuc don|tieng viet|tap gym|buoi tap|tuan nay|hom nay|hom qua|ngay mai|cho toi|minh nen|minh muon|lam sao|nhu the nao|the nao|xin chao|chao ban|cam on|giup toi|giup minh|cho hoi|bao nhieu|bao lau|khi nao|o dau|tai sao|duoc khong|an uong|dinh duong|giam can|tang can|suc khoe|the duc|khong the|khong biet)/i;
  if (hasVietnameseDiacritics || viSignals.test(text)) return "vi";
  return looksLikeUnaccentedVietnamese(text) ? "vi" : "en";
}

function parseExplicitLanguageRequest(
  message: string,
): ResponseLanguage | undefined {
  // Normalize so accented + unaccented variants both match the same ASCII patterns.
  const norm = normalizeForMatch(message);
  if (
    /(tra loi bang tieng viet|chi dung tieng viet|noi tieng viet|speak vietnamese)/i.test(
      norm,
    )
  ) {
    return "vi";
  }
  if (
    /(reply in english|speak english|tra loi bang tieng anh|use english)/i.test(
      norm,
    )
  ) {
    return "en";
  }
  return undefined;
}

export const languageGuard = {
  resolve(userMessage: string, userId?: string): LanguageDecision {
    const explicitRequest = parseExplicitLanguageRequest(userMessage);

    if (userId && explicitRequest) {
      userLanguageLock.set(userId, explicitRequest);
      return {
        responseLanguage: explicitRequest,
        locked: true,
        lockReason: "explicit_user_request",
      };
    }

    if (userId) {
      const existing = userLanguageLock.get(userId);
      if (existing) {
        return {
          responseLanguage: existing,
          locked: true,
          lockReason: "explicit_user_request",
        };
      }
    }

    return {
      responseLanguage: detectLanguage(userMessage),
      locked: false,
      lockReason: "user_last_message",
    };
  },

  resetLock(userId: string): void {
    userLanguageLock.delete(userId);
  },
};
