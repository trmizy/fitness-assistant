import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { partnerS3 } from './partner-s3.service';

/**
 * Dọn tệp mồ côi của hồ sơ đối tác.
 *
 * `presign` tạo một `PartnerUploadIntent` rồi trình duyệt tải thẳng tệp lên S3. Nếu người dùng đóng
 * tab trước khi bấm xác nhận thì tệp đã nằm trên S3 nhưng KHÔNG có bản ghi nghiệp vụ nào trỏ tới nó:
 * intent hết hạn sau 10 phút và từ đó không ai dùng được nữa. Không có việc này thì những tệp đó nằm
 * lại vĩnh viễn và tính tiền lưu trữ mãi.
 *
 * Không phải lỗ hổng bảo mật — tệp nằm trong bucket riêng tư, chỉ đọc được qua presigned GET mà
 * không ai còn sinh được nữa. Đây thuần tuý là dọn rác.
 *
 * Xoá S3 TRƯỚC, xoá dòng DB SAU: nếu xoá S3 hỏng thì dòng vẫn còn để lần chạy sau thử lại. Làm ngược
 * lại sẽ mất dấu vết của tệp và không bao giờ dọn được nữa.
 */

// Ân hạn sau khi intent hết hạn, phòng trường hợp `confirm` đang chạy dở ngay lúc sweep quét qua.
const GRACE_MS = 60 * 60 * 1000;
const BATCH = 200;

let running = false;

export async function runPartnerUploadSweep(): Promise<{ deleted: number; failed: number; skipped: boolean }> {
  if (running) {
    logger.info('[PartnerUploadSweep] Lần chạy trước chưa xong — bỏ qua nhịp này');
    return { deleted: 0, failed: 0, skipped: true };
  }
  running = true;

  let deleted = 0;
  let failed = 0;
  try {
    if (!partnerS3.isConfigured()) {
      logger.info('[PartnerUploadSweep] Chưa cấu hình lưu trữ — bỏ qua');
      return { deleted: 0, failed: 0, skipped: true };
    }

    const stale = await prisma.partnerUploadIntent.findMany({
      where: { confirmedAt: null, expiresAt: { lt: new Date(Date.now() - GRACE_MS) } },
      orderBy: { expiresAt: 'asc' },
      take: BATCH,
    });

    for (const intent of stale) {
      try {
        // Tệp có thể chưa từng được tải lên (người dùng bỏ ngay sau khi xin quyền) — S3 trả về
        // thành công cho lệnh xoá một khoá không tồn tại, nên không cần kiểm tra trước.
        await partnerS3.deleteObject(intent.objectKey);
        await prisma.partnerUploadIntent.delete({ where: { id: intent.id } });
        deleted += 1;
      } catch (e) {
        failed += 1;
        logger.warn(
          { err: (e as Error).message, intentId: intent.id },
          '[PartnerUploadSweep] Không dọn được lượt tải lên bỏ dở — sẽ thử lại lần sau',
        );
      }
    }

    if (deleted > 0 || failed > 0) {
      logger.info({ deleted, failed }, '[PartnerUploadSweep] Đã dọn tệp tải lên bỏ dở');
    }
    return { deleted, failed, skipped: false };
  } finally {
    running = false;
  }
}
