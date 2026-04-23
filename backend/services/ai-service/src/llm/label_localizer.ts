import type { ResponseLanguage } from './types';

const INTERNAL_LABEL_REPLACEMENTS: Record<string, string> = {
  recomposition: 'tái cấu trúc cơ thể',
  strength_retention: 'giữ sức mạnh',
  omnivorous: 'ăn đa dạng thực phẩm',
  moderate_volume: 'khối lượng tập vừa phải',
  confidence: 'độ tin cậy',
};

function sanitizeVietnameseOutput(text: string): string {
  let sanitized = text;
  for (const [rawLabel, replacement] of Object.entries(INTERNAL_LABEL_REPLACEMENTS)) {
    const regex = new RegExp(rawLabel, 'gi');
    sanitized = sanitized.replace(regex, replacement);
  }

  sanitized = sanitized.replace(/missing profile/gi, 'thiếu thông tin hồ sơ');
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
      profile: 'hồ sơ cơ bản',
      weight: 'cân nặng',
      height: 'chiều cao',
      age: 'tuổi',
      gender: 'giới tính',
      goal: 'mục tiêu',
      activity_level: 'mức độ vận động',
      experience_level: 'kinh nghiệm tập',
    };

    return fields.map((field) => map[field] || field);
  },
};

