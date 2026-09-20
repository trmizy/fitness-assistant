import { partnerS3 } from './partner-s3.service';

/**
 * Địa chỉ của MỘT ảnh chi nhánh theo nơi nó đang nằm — một hàm dùng chung cho mọi nơi trả ảnh ra
 * ngoài (danh sách của chủ, của admin, màn duyệt hồ sơ):
 *
 *   ảnh đĩa cũ (s3Key null)     → `/uploads/gym-photos/<fileName>`, đúng như trước đây (phục vụ tĩnh)
 *   ảnh S3, visibility PUBLIC    → URL công khai qua CDN (PARTNER_S3_PUBLIC_BASE_URL)
 *   ảnh S3, visibility PRIVATE   → presigned GET hạn ngắn (ảnh của hồ sơ đang chờ duyệt)
 *
 * Trả null (không ném lỗi) khi không dựng được URL — một ảnh hỏng không được làm hỏng cả danh sách.
 */
export async function resolvePhotoUrl(photo: {
  fileName: string;
  s3Key: string | null;
  visibility: 'PRIVATE' | 'PUBLIC';
}): Promise<string | null> {
  if (!photo.s3Key) return `/uploads/gym-photos/${photo.fileName}`;
  if (photo.visibility === 'PUBLIC') return partnerS3.publicUrl(photo.s3Key) || null;
  try {
    return await partnerS3.presignGet({ key: photo.s3Key, attachment: false, expiresSec: 300 });
  } catch {
    return null;
  }
}

/**
 * Logo thương hiệu của đối tác. Nằm cùng bucket riêng tư với phần còn lại của hồ sơ, nên trả về
 * presigned GET hạn ngắn chứ không phải URL vĩnh viễn. Chưa có logo thì null — logo là tuỳ chọn,
 * không có nó hồ sơ vẫn nộp và vẫn duyệt được.
 */
export async function brandLogoUrl(logoKey: string | null | undefined): Promise<string | null> {
  if (!logoKey) return null;
  try {
    return await partnerS3.presignGet({ key: logoKey, attachment: false, expiresSec: 300 });
  } catch {
    return null;
  }
}
