/**
 * N13B-09: the PT application wizard's UploadBox only ever said "Tải lên thất bại". These helpers give the reason:
 * a client-side pre-check (type + size, same limits as user-service pt_application routes: JPG/PNG/PDF, 10 MB) and a
 * mapper for the server's refusals (413 too large, 400 wrong type, network, session).
 */
import { listingErrorInfo } from "./listingErrors";

export const PT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_MB = PT_DOCUMENT_MAX_BYTES / 1024 / 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "application/pdf"]);
const ALLOWED_EXT = /\.(jpe?g|png|pdf)$/i;
const VIETNAMESE_LETTER = /[ăâđêôơưÀ-ỹ]/;

export const PT_DOCUMENT_TYPE_MESSAGE = "Chỉ nhận tệp JPG, PNG hoặc PDF.";
export const PT_DOCUMENT_SIZE_MESSAGE = `Tệp vượt quá ${MAX_MB} MB. Hãy chọn tệp nhỏ hơn.`;

/** Returns a Vietnamese reason when the file cannot be uploaded, otherwise null. */
export function checkPtDocumentFile(file: { name: string; type?: string; size: number }): string | null {
  const type = (file.type ?? "").trim().toLowerCase();
  const typeOk = type ? ALLOWED_MIME.has(type) : ALLOWED_EXT.test(file.name);
  if (!typeOk || !ALLOWED_EXT.test(file.name)) return PT_DOCUMENT_TYPE_MESSAGE;
  if (file.size > PT_DOCUMENT_MAX_BYTES) return PT_DOCUMENT_SIZE_MESSAGE;
  return null;
}

export function ptDocumentUploadErrorMessage(error: unknown): string {
  const info = listingErrorInfo(error);
  if (info.status === 413) return PT_DOCUMENT_SIZE_MESSAGE;
  if (info.status === 400) {
    const m = info.serverMessage ?? "";
    if (/png|jpe?g|pdf|contentType|format|loại tệp/i.test(m)) return PT_DOCUMENT_TYPE_MESSAGE;
    if (VIETNAMESE_LETTER.test(m)) return m;
    return "Tệp không hợp lệ. Hãy chọn ảnh JPG, PNG hoặc tệp PDF.";
  }
  if (info.status === 401) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (info.status === 403) return "Bạn không có quyền tải tệp này lên.";
  if (info.status === 410 || info.status === 503) return "Chức năng tải tệp đang tạm dừng. Vui lòng thử lại sau.";
  if (info.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  if (info.status === null) {
    // Errors thrown by the web itself (e.g. uploadFileToPresignedUrl's size check) already carry Vietnamese text.
    const own = (error as { message?: unknown } | null)?.message;
    if (typeof own === "string" && VIETNAMESE_LETTER.test(own)) return own;
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  return "Tải lên thất bại. Vui lòng thử lại sau.";
}
