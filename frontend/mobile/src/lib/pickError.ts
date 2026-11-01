/**
 * Image-picker failures → one Vietnamese sentence. expo-image-picker re-encodes the chosen file (quality < 1) and rejects
 * with its own English text ("Failed to read a file 'file:///…'") when Android cannot decode it; that text must never reach
 * the user. Our own pickFile.ts errors are already Vietnamese ("Ảnh quá lớn…", "Cần quyền truy cập ảnh.") and are kept.
 */
export const PICK_FAILED_MESSAGE = "Không đọc được ảnh này. Hãy chọn ảnh khác (JPEG, PNG hoặc WebP).";

const VIETNAMESE_LETTER = /[ăâđêôơưĂÂĐÊÔƠƯà-ỹÀ-Ỹ]/;

export function pickErrorMessage(error: unknown): string {
  const own = typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message.trim() : "";
  if (own && VIETNAMESE_LETTER.test(own) && own.length <= 160) return own;
  return PICK_FAILED_MESSAGE;
}
