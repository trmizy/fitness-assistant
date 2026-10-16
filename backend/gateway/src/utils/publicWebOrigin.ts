import fs from "fs";

/**
 * Địa chỉ web CÔNG KHAI hiện tại (vd tunnel Cloudflare tới cổng 5173) — do script
 * `Khoi-dong-Tunnel-Web.bat` ghi ra một tệp, KHÔNG lấy từ bất kỳ header nào của request.
 *
 * Vì sao là tệp mà không phải header: link trong email (đặt lại mật khẩu, magic link đăng ký đối tác,
 * lời mời quản lý) mang token sống. Nếu host của link lấy từ thứ người gọi tự đặt được (Origin,
 * X-Forwarded-Host) thì ai cũng xin được một email hợp lệ mà link trỏ về tên miền của họ
 * (password-reset poisoning) — và *.trycloudflare.com thì ai cũng tạo được. Tệp do chính máy chạy
 * stack ghi, nên người ngoài không lái được.
 *
 * Tệp chỉ có hiệu lực khi còn "sống": script chạm (touch) nó mỗi ~30 giây trong lúc tunnel chạy; quá
 * STALE_MS không được chạm (tunnel đã tắt, cửa sổ bị đóng) thì bỏ qua để link không trỏ vào tunnel chết.
 */
const STALE_MS = 2 * 60 * 1000;
const CACHE_MS = 5 * 1000;
const ORIGIN_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

let cache: { at: number; value: string | null } | null = null;

export function publicWebOrigin(now = Date.now()): string | null {
  const file = process.env.PUBLIC_WEB_ORIGIN_FILE;
  if (!file) return null;
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  let value: string | null = null;
  try {
    const stat = fs.statSync(file);
    if (now - stat.mtimeMs <= STALE_MS) {
      const raw = fs.readFileSync(file, "utf8").trim().replace(/\/$/, "");
      if (ORIGIN_RE.test(raw)) value = raw;
    }
  } catch {
    value = null; // chưa có tệp = chưa mở tunnel web — bình thường
  }
  cache = { at: now, value };
  return value;
}

/** Chỉ dùng trong test. */
export function _resetPublicWebOriginCache() {
  cache = null;
}
