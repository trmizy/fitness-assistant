import { z } from 'zod';
import { gymCreateSchema } from './gym.schemas';

/**
 * Hồ sơ đối tác tự đăng ký — kiểm dữ liệu ở lớp route, trước khi controller/service thấy body.
 * Các quy tắc trường của chi nhánh dùng lại đúng `gymCreateSchema` (một nguồn duy nhất cho định
 * dạng tên/địa chỉ/điện thoại/email/toạ độ), chỉ bỏ `facilities` (không thuộc hồ sơ ứng tuyển) và
 * cho phép lưu từng phần để wizard tự lưu nháp.
 */

export const representativeSchema = z.object({
  name: z.string({ required_error: 'Họ tên người đại diện là bắt buộc' }).trim().min(2, 'Họ tên quá ngắn').max(120),
  phone: z
    .string({ required_error: 'Số điện thoại là bắt buộc' })
    .trim()
    .min(8, 'Số điện thoại không hợp lệ')
    .max(20, 'Số điện thoại không hợp lệ')
    .regex(/^[0-9+\-\s().]+$/, 'Số điện thoại chỉ gồm chữ số và các ký tự + - ( ) .'),
  role: z.enum(['GYM_OWNER', 'CO_FOUNDER', 'LEGAL_REPRESENTATIVE', 'AUTHORIZED_MANAGER'], {
    errorMap: () => ({ message: 'Vai trò không hợp lệ' }),
  }),
});

export const businessScaleSchema = z.object({
  scale: z.enum(['ONE_BRANCH', 'MULTIPLE_BRANCHES'], { errorMap: () => ({ message: 'Quy mô không hợp lệ' }) }),
});

export const applicationBrandSchema = z.object({
  name: z.string({ required_error: 'Tên thương hiệu là bắt buộc' }).trim().min(2, 'Tên thương hiệu quá ngắn').max(120),
  description: z.string().trim().max(1000).optional(),
});

/**
 * Link mạng xã hội của thương hiệu. Link này hiện công khai cho khách, nên chỉ nhận https và đúng tên
 * miền của từng mạng — không để một ô "Facebook" trỏ sang trang lừa đảo bất kỳ. Ô trống = xoá link.
 */
const SOCIAL_HOSTS = {
  facebookUrl: ['facebook.com', 'fb.com', 'fb.me'],
  instagramUrl: ['instagram.com'],
  tiktokUrl: ['tiktok.com'],
  youtubeUrl: ['youtube.com', 'youtu.be'],
} as const;

const socialUrl = (field: keyof typeof SOCIAL_HOSTS, label: string) =>
  z
    .string()
    .trim()
    .max(300, 'Link quá dài')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine(
      (v) => {
        if (v == null) return true;
        try {
          const u = new URL(v);
          const host = u.hostname.toLowerCase().replace(/^(www|m|vm|vt)\./, '');
          return u.protocol === 'https:' && SOCIAL_HOSTS[field].some((h) => host === h || host.endsWith(`.${h}`));
        } catch {
          return false;
        }
      },
      { message: `Link ${label} không hợp lệ — dán đường dẫn https://… tới trang ${label} của bạn` },
    );

export const socialLinksSchema = z.object({
  facebookUrl: socialUrl('facebookUrl', 'Facebook'),
  instagramUrl: socialUrl('instagramUrl', 'Instagram'),
  tiktokUrl: socialUrl('tiktokUrl', 'TikTok'),
  youtubeUrl: socialUrl('youtubeUrl', 'YouTube'),
});

export const applicationBranchSchema = gymCreateSchema.omit({ facilities: true }).partial();

export const legalSchema = z.object({
  legalName: z
    .string({ required_error: 'Tên pháp lý là bắt buộc' })
    .trim()
    .min(2, 'Tên pháp lý quá ngắn')
    .max(200),
  taxCode: z.string().trim().max(30).nullable().optional(),
  businessLicenseNo: z.string().trim().max(50).nullable().optional(),
});

const DOC_TYPES = [
  'BUSINESS_LICENSE',
  'REPRESENTATIVE_ID',
  'PREMISES_PROOF',
  'TAX_CODE_CERTIFICATE',
  'SITE_PHOTOS',
  'FIRE_SAFETY_CERTIFICATE',
] as const;

const PHOTO_CATEGORIES = [
  'EXTERIOR',
  'MAIN_TRAINING_AREA',
  'EQUIPMENT',
  'CARDIO',
  'CHANGING_ROOM',
  'AMENITIES',
  'OTHER',
] as const;

export const presignSchema = z
  .object({
    kind: z.enum(['PHOTO', 'DOCUMENT', 'LOGO']),
    contentType: z.string().trim().max(100),
    sizeBytes: z.number().int().positive(),
    docType: z.enum(DOC_TYPES).optional(),
    photoCategory: z.enum(PHOTO_CATEGORIES).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'DOCUMENT' && !v.docType) {
      ctx.addIssue({ code: 'custom', path: ['docType'], message: 'Cần chọn loại giấy tờ' });
    }
  });

export const confirmUploadSchema = z.object({ uploadId: z.string().uuid('uploadId không hợp lệ') });

export const submitApplicationSchema = z.object({ acceptTerms: z.boolean().optional() });

export const markUpdatedSchema = z.object({ note: z.string().trim().max(500).optional() });

export const reorderPhotosSchema = z.object({ ids: z.array(z.string().uuid()).max(20) });

// ── Admin ────────────────────────────────────────────────────────────────────────────────────

const REVIEW_CATEGORIES = ['REPRESENTATIVE', 'BRAND', 'BRANCH', 'LOCATION', 'PHOTOS', 'LEGAL', 'OTHER'] as const;

export const requestChangesSchema = z
  .object({
    issues: z
      .array(
        z.object({
          category: z.enum(REVIEW_CATEGORIES),
          message: z.string().trim().min(3, 'Nội dung yêu cầu quá ngắn').max(1000),
        }),
      )
      .max(30)
      .default([]),
    documents: z
      .array(
        z.object({
          docType: z.enum(DOC_TYPES),
          note: z.string().trim().min(3, 'Cần nêu lý do yêu cầu cập nhật giấy tờ').max(1000),
        }),
      )
      .max(6)
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.issues.length === 0 && v.documents.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['issues'], message: 'Cần nêu ít nhất một mục hoặc một giấy tờ cần sửa' });
    }
  });

export const reopenIssueSchema = z.object({
  message: z.string().trim().min(3, 'Cần nêu lý do mở lại').max(1000),
});

export const rejectApplicationSchema = z.object({
  reason: z.string().trim().min(3, 'Cần nêu lý do từ chối').max(1000),
  adminNote: z.string().trim().max(1000).optional(),
});
