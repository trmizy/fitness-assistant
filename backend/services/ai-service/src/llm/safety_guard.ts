import type { UnsafeGuidance } from './types';

function detectUnsafeWeightLoss(question: string): boolean {
  const q = question.toLowerCase();
  const numericRapidPattern = /(giam|lose).{0,20}(\d{1,2})\s*kg.{0,20}(1\s*(tuan|week)|[1-7]\s*(ngay|day))/i;
  const extremePattern = /(cuc doan|extreme|nhin an|fasting[^\n]{0,20}(day|ngay)|rapid weight loss)/i;
  return numericRapidPattern.test(q) || extremePattern.test(q);
}

export const safetyGuard = {
  evaluate(question: string): UnsafeGuidance | undefined {
    if (!detectUnsafeWeightLoss(question)) return undefined;

    return {
      blocked: true,
      reason: 'Muc tieu giam can qua nhanh co the gay mat co, roi loan dien giai va anh huong tim mach.',
      safeAlternative: 'Muc tieu an toan hon la giam khoang 0.3-0.8 kg moi tuan, ket hop tap suc manh va dieu chinh calo vua phai.',
      firstWeekSteps: [
        'Dat muc tieu giam 0.5 kg trong tuan dau.',
        'Giam 300-500 kcal moi ngay tu tong khau phan hien tai.',
        'Tap ta 3-4 buoi va di bo nhanh 20-30 phut, 4-5 buoi moi tuan.',
        'Ngu 7-8 gio moi dem va theo doi can nang 2-3 lan moi tuan.',
      ],
    };
  },
};
