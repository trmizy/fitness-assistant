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
      reason: 'Mục tiêu giảm cân quá nhanh có thể gây mất cơ, rối loạn điện giải và ảnh hưởng tim mạch.',
      safeAlternative: 'Mục tiêu an toàn hơn là giảm khoảng 0.3-0.8 kg mỗi tuần, kết hợp tập sức mạnh và điều chỉnh calo vừa phải.',
      firstWeekSteps: [
        'Đặt mục tiêu giảm 0.5 kg trong tuần đầu.',
        'Giảm 300-500 kcal mỗi ngày từ tổng khẩu phần hiện tại.',
        'Tập tạ 3-4 buổi và đi bộ nhanh 20-30 phút, 4-5 buổi mỗi tuần.',
        'Ngủ 7-8 giờ mỗi đêm và theo dõi cân nặng 2-3 lần mỗi tuần.',
      ],
    };
  },
};
