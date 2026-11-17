/**
 * Họ tên đầy đủ để hiển thị: ghép firstName + lastName, bỏ phần trống hoặc chỉ là dấu chấm đệm
 * (bản web cũ gửi lastName "." cho tên một từ; từ N13A-14 lastName là null). Không bao giờ in ra "null"/"undefined".
 */
export function fullName(
  user: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallback = "",
): string {
  const clean = (v?: string | null) => {
    const t = (v ?? "").trim();
    return /^\.*$/.test(t) ? "" : t;
  };
  const name = [clean(user?.firstName), clean(user?.lastName)].filter(Boolean).join(" ");
  return name || fallback;
}
