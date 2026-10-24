/**
 * Quy ước tên Việt trong hệ thống: firstName = họ (từ đầu tiên), lastName = phần còn lại.
 * Lời chào dùng TÊN gọi (từ cuối của họ tên đầy đủ), không phải họ. lastName "." là giá trị đệm
 * khi người dùng đăng ký chỉ nhập một từ.
 */
export function givenName(user: { firstName?: string | null; lastName?: string | null } | null | undefined, fallback = "Bạn"): string {
  const last = (user?.lastName ?? "").trim();
  const words = [user?.firstName ?? "", last === "." ? "" : last].join(" ").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 ? words[words.length - 1] : fallback;
}
