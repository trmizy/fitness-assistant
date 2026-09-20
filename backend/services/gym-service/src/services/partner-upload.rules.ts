/**
 * Quy tắc tải lên của hồ sơ đối tác tự đăng ký — GYM_PARTNER_SECURITY_MODEL.md §6. Toàn hàm THUẦN để
 * test được trọn vẹn: đây chính là lớp chặn "HTML/SVG/JS đội lốt ảnh" và "đổi đuôi tệp".
 */

export type UploadKind = 'PHOTO' | 'DOCUMENT' | 'LOGO';

/** Cố ý CHỈ cho định dạng mà trình duyệt không thực thi được khi mở: không HTML, SVG, XML, JS, office. */
const ALLOWED: Record<UploadKind, readonly string[]> = {
  PHOTO: ['image/jpeg', 'image/png', 'image/webp'],
  DOCUMENT: ['application/pdf', 'image/jpeg', 'image/png'],
  // Logo cùng luật với ảnh; SVG vẫn bị loại vì trình duyệt thực thi được script trong đó.
  LOGO: ['image/jpeg', 'image/png', 'image/webp'],
};

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** 10 MB — cùng mức PT-application documents đang dùng ở user-service. */
export const MAX_UPLOAD_BYTES = Number(process.env.PARTNER_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
/** Trần ảnh mỗi chi nhánh — cùng con số gymPhotoService đang dùng. */
export const MAX_APPLICATION_PHOTOS = 20;

export function isAllowedContentType(kind: UploadKind, contentType: string): boolean {
  return ALLOWED[kind].includes(contentType);
}

export function extensionFor(contentType: string): string {
  const ext = EXTENSION[contentType];
  if (!ext) throw new Error(`Không có đuôi tệp cho ${contentType}`);
  return ext;
}

/**
 * Đọc "chữ ký" đầu tệp thay vì tin Content-Type do client khai. Trả về loại thật, hoặc null nếu không
 * phải định dạng nào trong danh sách cho phép (kể cả khi tên tệp/Content-Type nói là ảnh).
 */
export function detectContentType(head: Uint8Array): string | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 //  WEBP
  ) {
    return 'image/webp';
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf'; // %PDF-
  }
  return null;
}

export type UploadCheck = { ok: true } | { ok: false; reason: string };

/** Kiểm sau khi tệp đã nằm trên S3 (HEAD + đọc đầu tệp): kích thước, loại khai báo và loại thật phải khớp. */
export function validateStoredObject(params: {
  kind: UploadKind;
  declaredContentType: string;
  declaredMaxBytes: number;
  head: { contentLength?: number; contentType?: string };
  firstBytes: Uint8Array;
}): UploadCheck {
  const { kind, declaredContentType, declaredMaxBytes, head, firstBytes } = params;

  if (!isAllowedContentType(kind, declaredContentType)) {
    return { ok: false, reason: 'Định dạng tệp không được phép' };
  }
  const size = head.contentLength ?? 0;
  if (size <= 0) return { ok: false, reason: 'Tệp rỗng' };
  if (size > Math.min(declaredMaxBytes, MAX_UPLOAD_BYTES)) {
    return { ok: false, reason: 'Tệp vượt quá dung lượng cho phép' };
  }
  if (head.contentType && head.contentType !== declaredContentType) {
    return { ok: false, reason: 'Loại tệp không khớp với khai báo' };
  }
  const real = detectContentType(firstBytes);
  if (!real || real !== declaredContentType) {
    return { ok: false, reason: 'Nội dung tệp không phải định dạng đã khai báo' };
  }
  return { ok: true };
}
