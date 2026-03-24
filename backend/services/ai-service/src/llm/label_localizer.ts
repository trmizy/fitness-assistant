import type { ResponseLanguage } from './types';

const INTERNAL_LABEL_REPLACEMENTS: Record<string, string> = {
  recomposition: 'tai cau truc co the',
  strength_retention: 'giu suc manh',
  omnivorous: 'an da dang thuc pham',
  moderate_volume: 'khoi luong tap vua phai',
  confidence: 'do tin cay',
};

function sanitizeVietnameseOutput(text: string): string {
  let sanitized = text;
  for (const [rawLabel, replacement] of Object.entries(INTERNAL_LABEL_REPLACEMENTS)) {
    const regex = new RegExp(rawLabel, 'gi');
    sanitized = sanitized.replace(regex, replacement);
  }

  sanitized = sanitized.replace(/missing profile/gi, 'thieu thong tin ho so');
  sanitized = sanitized.replace(/ {2,}/g, ' ').trim();
  return sanitized;
}

export const labelLocalizer = {
  localize(text: string, language: ResponseLanguage): string {
    if (language === 'vi') {
      return sanitizeVietnameseOutput(text);
    }
    return text;
  },

  localizeMissingFields(fields: string[], language: ResponseLanguage): string[] {
    if (language === 'en') return fields;

    const map: Record<string, string> = {
      profile: 'ho so co ban',
      weight: 'can nang',
      height: 'chieu cao',
      age: 'tuoi',
      gender: 'gioi tinh',
      goal: 'muc tieu',
      activity_level: 'muc do van dong',
      experience_level: 'kinh nghiem tap',
    };

    return fields.map((field) => map[field] || field);
  },
};
