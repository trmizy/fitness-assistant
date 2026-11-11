import { z } from 'zod';

/**
 * POST /owner/gyms/:gymId/trainers — mời một PT về đầu quân cho chi nhánh. N-A-01: thiếu `ptId` từng rơi xuống Prisma và trả 500 kèm
 * nguyên văn lỗi Prisma + đường dẫn tệp; nay bị chặn ở lớp route bằng 400 + thông báo tiếng Việt. Các trường tuỳ chọn khác (enum, tỷ lệ)
 * cũng được kiểm ở đây vì sai giá trị cũng rơi xuống Prisma theo cùng cách.
 */
export const affiliationInviteSchema = z.object({
  ptId: z
    .string({ required_error: 'Thiếu mã huấn luyện viên (ptId)', invalid_type_error: 'Mã huấn luyện viên (ptId) không hợp lệ' })
    .trim()
    .min(1, 'Thiếu mã huấn luyện viên (ptId)')
    .max(64, 'Mã huấn luyện viên (ptId) không hợp lệ'),
  employmentType: z.enum(['IN_HOUSE', 'FREELANCE', 'PARTNER'], { errorMap: () => ({ message: 'Hình thức làm việc không hợp lệ' }) }).optional(),
  visibility: z.enum(['PUBLIC', 'INTERNAL_ONLY'], { errorMap: () => ({ message: 'Chế độ hiển thị không hợp lệ' }) }).optional(),
  commissionRate: z
    .number({ invalid_type_error: 'Tỷ lệ hoa hồng phải là số' })
    .min(0, 'Tỷ lệ hoa hồng phải từ 0 đến 1')
    .max(1, 'Tỷ lệ hoa hồng phải từ 0 đến 1')
    .optional(),
});
