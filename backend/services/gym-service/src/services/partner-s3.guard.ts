/**
 * Chốt an toàn cấu hình S3 của hồ sơ đối tác: production chỉ được dùng S3 gốc của AWS.
 * MinIO / endpoint tuỳ chỉnh / khoá tĩnh chỉ dành cho dev. Xem GYM_PARTNER_SECURITY_MODEL.md §6.
 */

type Env = Record<string, string | undefined>;


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
  // Bucket công khai đã bị gỡ khỏi kiến trúc: còn biến này nghĩa là cấu hình cũ sót lại.
  if (env.PARTNER_S3_PUBLIC_BUCKET || env.PARTNER_S3_PUBLIC_BASE_URL) {
    problems.push('PARTNER_S3_PUBLIC_BUCKET/PARTNER_S3_PUBLIC_BASE_URL không còn dùng — mọi tệp đều riêng tư');
  }
  if (env.PARTNER_S3_PUBLIC_VIA_REQUEST === 'true') {
    problems.push('PARTNER_S3_PUBLIC_VIA_REQUEST chỉ dành cho dev (ký link qua gateway tới MinIO) — production gọi thẳng S3');
  }
  if (env.PARTNER_S3_FORCE_PATH_STYLE === 'true') {
    problems.push('PARTNER_S3_FORCE_PATH_STYLE không được bật ở production');
  }
  if (env.PARTNER_S3_ACCESS_KEY_ID || env.PARTNER_S3_SECRET_ACCESS_KEY) {
    problems.push('production dùng IAM role / default credential chain, không dùng PARTNER_S3_ACCESS_KEY_ID/SECRET');
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
