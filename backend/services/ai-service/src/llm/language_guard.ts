import type { LanguageDecision, ResponseLanguage } from './types';

const userLanguageLock = new Map<string, ResponseLanguage>();

/**
 * Strips diacritics / tone marks so that both accented ("trả lời bằng tiếng việt")
 * and unaccented ("tra loi bang tieng viet") forms reduce to the same ASCII string.
 * Steps: lowercase → NFD decompose → remove combining marks → collapse whitespace.
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritical marks
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguage(message: string): ResponseLanguage {
  const text = message.toLowerCase();
  // Vietnamese-specific diacritics (tone marks + vowel modifiers outside basic Latin)
  const hasVietnameseDiacritics = /[\u00C0-\u024F\u1E00-\u1EFF]/.test(message);
  // Common Vietnamese words without diacritics as fallback
  const viSignals = /(lich tap|bai tap|giam mo|tang co|thuc don|tieng viet|tap gym|buoi tap|tuan nay|hom nay|cho toi|minh nen|lam sao|nhu the nao)/i;
  if (hasVietnameseDiacritics || viSignals.test(text)) return 'vi';
  return 'en';
}

function parseExplicitLanguageRequest(message: string): ResponseLanguage | undefined {
  // Normalize so accented + unaccented variants both match the same ASCII patterns.
  const norm = normalizeForMatch(message);
  if (/(tra loi bang tieng viet|chi dung tieng viet|noi tieng viet|speak vietnamese)/i.test(norm)) {
    return 'vi';
  }
  if (/(reply in english|speak english|tra loi bang tieng anh|use english)/i.test(norm)) {
    return 'en';
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
        lockReason: 'explicit_user_request',
      };
    }

    if (userId) {
      const existing = userLanguageLock.get(userId);
      if (existing) {
        return {
          responseLanguage: existing,
          locked: true,
          lockReason: 'explicit_user_request',
        };
      }
    }

    return {
      responseLanguage: detectLanguage(userMessage),
      locked: false,
      lockReason: 'user_last_message',
    };
  },

  resetLock(userId: string): void {
    userLanguageLock.delete(userId);
  },
};
