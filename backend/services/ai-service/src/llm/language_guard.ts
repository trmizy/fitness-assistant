import type { LanguageDecision, ResponseLanguage } from './types';

const userLanguageLock = new Map<string, ResponseLanguage>();

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
  const text = message.toLowerCase();
  if (/(tra loi bang tieng viet|chi dung tieng viet|noi tieng viet|speak vietnamese)/i.test(text)) {
    return 'vi';
  }
  if (/(reply in english|speak english|tra loi bang tieng anh|use english)/i.test(text)) {
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
