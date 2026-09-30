/**
 * Phase 14.3 — the pure half of a member's QR check-in (web: components/gym/CheckinScanModal.tsx).
 *
 * The gym's front desk shows a QR holding an opaque, signed token (gym-service `checkin-qr`); the
 * member scans it and `POST /me/gym-checkins { token }` records the visit. The member's identity
 * comes from the session, never from the QR — so a photo of the desk QR is useless to anyone who
 * is not a member of that brand.
 */

/** Server codes (gym-service checkin.controller CODE_STATUS + the service's own throws) → Vietnamese. */
const MESSAGES: Record<string, string> = {
  INVALID_TOKEN: "Mã QR không hợp lệ. Hãy quét đúng mã tại quầy lễ tân.",
  TOKEN_EXPIRED: "Mã QR của phòng gym đã hết hạn — báo nhân viên tạo lại.",
  NO_MEMBERSHIP: "Bạn chưa có gói hội viên dùng được tại phòng gym này.",
  NOT_ACTIVE: "Gói hội viên của bạn không còn hiệu lực.",
  VISIT_LIMIT_REACHED: "Bạn đã dùng hết số lượt của gói.",
  TOO_SOON: "Bạn vừa check-in xong — không cần quét lại.",
  GYM_NOT_ACTIVE: "Phòng gym này đang tạm ngưng nhận check-in.",
};

export function checkinErrorMessage(error: unknown): string {
  const body = (error as { response?: { data?: any } } | null)?.response?.data;
  // Coded failures arrive as { error: { code } }; the service's uncoded throws as { error: { message } }.
  const code = body?.error?.code ?? body?.error?.message;
  if (typeof code === "string" && MESSAGES[code]) return MESSAGES[code];
  if (!body) return "Không kết nối được máy chủ — kiểm tra mạng rồi quét lại.";
  return "Check-in chưa thành công — thử quét lại.";
}

export interface CheckinResult {
  clientName: string | null;
  gymName: string | null;
  planName: string | null;
  usedVisits: number;
  totalVisits: number | null;
  endDate: string | null;
  checkedInAt: string | null;
}

const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

export function normalizeCheckinResult(raw: unknown): CheckinResult {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    clientName: text(d.clientName),
    gymName: text(d.gymName),
    planName: text(d.planName),
    usedVisits: Number(d.usedVisits) || 0,
    totalVisits: d.totalVisits == null || d.totalVisits === "" ? null : Number(d.totalVisits),
    endDate: text(d.endDate),
    checkedInAt: text(d.checkedInAt),
  };
}

/** "3/10" or "3 · không giới hạn" — what the desk reads off the member's screen. */
export function visitsLabel(r: Pick<CheckinResult, "usedVisits" | "totalVisits">): string {
  return r.totalVisits != null ? `${r.usedVisits}/${r.totalVisits}` : `${r.usedVisits} · không giới hạn`;
}

/**
 * A scanned QR is only sent when it has the shape of a gym check-in token — `base64url(payload)`
 * `.` `base64url(hmac)` (gym-service utils/checkinToken.ts). A URL, a product barcode or any other
 * QR the camera happens to see is ignored instead of costing a request and an error toast; the
 * server still verifies the signature of anything that does get through.
 */
export function isCheckinToken(data: string | null | undefined): data is string {
  if (!data) return false;
  return /^[A-Za-z0-9_-]{16,1024}\.[A-Za-z0-9_-]{16,128}$/.test(data.trim());
}
