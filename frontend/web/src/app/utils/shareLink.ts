/**
 * Chia sẻ liên kết công khai (Q8 / N14G-04): Web Share API khi trình duyệt có (điện thoại),
 * không thì sao chép liên kết vào clipboard. Trả về kết quả để nơi gọi tự hiện toast.
 */

/** Liên kết công khai của chi tiết một phòng gym — mở được cả khi chưa đăng nhập. */
export function publicGymPath(gymId: string): string {
  return `/gyms/${encodeURIComponent(gymId)}`;
}

export function publicGymUrl(gymId: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${publicGymPath(gymId)}`;
}

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* rơi xuống đường dự phòng (trang http/LAN không có clipboard API) */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function shareOrCopyLink(opts: { title: string; text?: string; url: string }): Promise<ShareResult> {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : undefined;
  if (nav?.share) {
    try {
      await nav.share({ title: opts.title, text: opts.text, url: opts.url });
      return "shared";
    } catch (e: any) {
      // Người dùng đóng bảng chia sẻ: không phải lỗi, cũng không tự chuyển sang sao chép.
      if (e?.name === "AbortError") return "cancelled";
      // Lỗi khác (không hỗ trợ trong ngữ cảnh này) → thử sao chép.
    }
  }
  return (await copyText(opts.url)) ? "copied" : "failed";
}
