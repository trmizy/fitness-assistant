/**
 * D4 / B4 - sha256 of a file chosen on this device, computed in the browser with `crypto.subtle`.
 *
 * The file is read into memory HERE and nowhere else: its bytes never reach the network layer (the caller only keeps the 64-char hex string,
 * and the B4 body is built from strings only). Files above `MAX_HASH_FILE_BYTES` are refused because `subtle.digest` has no streaming mode;
 * the user can paste a hash computed elsewhere instead.
 */
import { MAX_HASH_FILE_BYTES } from "./partyModel";

export type HashResult = { status: "ok"; hex: string } | { status: "too-large" } | { status: "unsupported" } | { status: "empty" } | { status: "error" };

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Injectable for tests; the default is the browser's own. */
export interface SubtleLike {
  digest(algorithm: "SHA-256", data: ArrayBuffer): Promise<ArrayBuffer>;
}

export async function sha256OfFile(file: Pick<Blob, "size" | "arrayBuffer">, subtle?: SubtleLike | null): Promise<HashResult> {
  const impl = subtle === undefined ? ((globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle ?? null) : subtle;
  if (!impl || typeof impl.digest !== "function") return { status: "unsupported" };
  if (file.size === 0) return { status: "empty" };
  if (file.size > MAX_HASH_FILE_BYTES) return { status: "too-large" };
  try {
    const bytes = await file.arrayBuffer();
    return { status: "ok", hex: toHex(await impl.digest("SHA-256", bytes)) };
  } catch {
    return { status: "error" };
  }
}

export const HASH_MESSAGE: Record<Exclude<HashResult["status"], "ok">, string> = {
  "too-large": "Tệp lớn hơn 100 MB nên trình duyệt không tính được mã tại đây. Hãy dán mã sha256 bạn đã tính ở nơi khác.",
  unsupported: "Trình duyệt này không tính được mã sha256 ở địa chỉ hiện tại. Hãy dán mã sha256 bạn đã tính ở nơi khác.",
  empty: "Tệp này trống nên không tính được mã. Hãy chọn tệp khác hoặc dán mã sha256.",
  error: "Không đọc được tệp để tính mã. Hãy chọn lại hoặc dán mã sha256.",
};
