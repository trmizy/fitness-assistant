/**
 * FRONTEND_URL là gốc của mọi link gửi qua email (mời nhân sự, đặt lại mật khẩu). Ở môi trường
 * thật mà thiếu hoặc trỏ về localhost / mạng nội bộ thì người nhận được email có link không mở được
 * (hoặc trỏ về máy dev) — nên production phải dừng ngay lúc khởi động thay vì lặng lẽ rơi về
 * http://localhost:5173. Môi trường dev giữ nguyên hành vi cũ.
 */

const DEV_FALLBACK_FRONTEND_URL = "http://localhost:5173";

function isPrivateOrLocalHost(hostnameRaw: string): boolean {
  const host = hostnameRaw.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) {
    // IPv6: loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7).
    return host === "::1" || host === "::" || /^fe[89ab]/.test(host) || /^f[cd]/.test(host);
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Lý do FRONTEND_URL không dùng được ở production, hoặc null nếu hợp lệ. */
export function frontendUrlProblem(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return "FRONTEND_URL is not set";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "FRONTEND_URL is not a valid absolute URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "FRONTEND_URL must start with http:// or https://";
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    return `FRONTEND_URL points to a local/private host (${url.hostname})`;
  }
  return null;
}

/** Ném lỗi rõ ràng khi NODE_ENV=production mà FRONTEND_URL không hợp lệ. Ngoài production: không làm gì. */
export function assertFrontendUrlForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problem = frontendUrlProblem(env.FRONTEND_URL);
  if (problem) {
    throw new Error(
      `[gym-service] ${problem}. In production FRONTEND_URL must be the public https/http address users open (e.g. https://app.example.com) — emailed invitation and password-reset links are built from it. Refusing to start.`,
    );
  }
}

/**
 * Gốc link để dựng email. Production: bắt buộc FRONTEND_URL hợp lệ (ném lỗi nếu không, không bao
 * giờ rơi về localhost). Dev: rơi về http://localhost:5173 như trước.
 */
export function resolveFrontendUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") {
    assertFrontendUrlForProduction(env);
    return env.FRONTEND_URL!.trim();
  }
  return env.FRONTEND_URL || DEV_FALLBACK_FRONTEND_URL;
}
