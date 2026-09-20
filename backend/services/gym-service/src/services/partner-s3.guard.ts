/**
 * Chốt an toàn cấu hình S3 của hồ sơ đối tác: production chỉ được dùng S3 gốc của AWS.
 * MinIO / endpoint tuỳ chỉnh / khoá tĩnh chỉ dành cho dev. Xem GYM_PARTNER_SECURITY_MODEL.md §6.
 */

type Env = Record<string, string | undefined>;

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)|^(minio|host\.docker\.internal)$|\.local$|\.internal$/i;

export function isProductionEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** Trả danh sách vi phạm (rỗng = hợp lệ). Ngoài production luôn hợp lệ. */
export function partnerS3ProductionViolations(env: Env = process.env): string[] {
  if (!isProductionEnv(env)) return [];
  const problems: string[] = [];

  if (env.PARTNER_S3_ENDPOINT) {
    problems.push('PARTNER_S3_ENDPOINT phải để trống ở production (dùng endpoint S3 mặc định của AWS SDK)');
  }
  if (env.PARTNER_S3_PUBLIC_ENDPOINT) {
    problems.push('PARTNER_S3_PUBLIC_ENDPOINT phải để trống ở production');
  }
  if (env.PARTNER_S3_FORCE_PATH_STYLE === 'true') {
    problems.push('PARTNER_S3_FORCE_PATH_STYLE không được bật ở production');
  }
  if (env.PARTNER_S3_ACCESS_KEY_ID || env.PARTNER_S3_SECRET_ACCESS_KEY) {
    problems.push('production dùng IAM role / default credential chain, không dùng PARTNER_S3_ACCESS_KEY_ID/SECRET');
  }

  const base = env.PARTNER_S3_PUBLIC_BASE_URL;
  if (base) {
    try {
      const u = new URL(base);
      if (u.protocol !== 'https:') problems.push('PARTNER_S3_PUBLIC_BASE_URL phải dùng https ở production');
      if (LOCAL_HOST.test(u.hostname)) problems.push('PARTNER_S3_PUBLIC_BASE_URL đang trỏ về máy cục bộ/mạng nội bộ');
    } catch {
      problems.push('PARTNER_S3_PUBLIC_BASE_URL không phải URL hợp lệ');
    }
  }
  return problems;
}

/** Ném lỗi (dừng khởi động / chặn mọi thao tác S3) nếu production cấu hình sai. */
export function assertPartnerS3ProductionSafe(env: Env = process.env): void {
  const problems = partnerS3ProductionViolations(env);
  if (problems.length) {
    throw new Error(`Cấu hình lưu trữ hồ sơ đối tác không an toàn cho production: ${problems.join('; ')}`);
  }
}
