/**
 * Phase 2 / P2.3 — the pure half of a PT's QR check-in at a gym (mobile: src/features/services/ptCheckin.ts).
 *
 * The PT scans the BRANCH's front-desk QR (the same signed token members use) and
 * `POST /me/pt-gym-checkins { token }` records that they are on site (D16/D17/D70). The server
 * decides: it needs a confirmed in-person session of this PT at this branch today. Check-in is
 * attendance only — it never completes a session and never moves money — so the result card shows
 * no visit counts and no client identity.
 */

/** gym-service `error.code` (pt-checkin.service + checkin.controller CODE_STATUS) → Vietnamese. */
const MESSAGES: Record<string, string> = {
  PT_NO_QUALIFYING_SESSION: "Hôm nay bạn không có buổi dạy đã xác nhận tại chi nhánh này.",
  PT_RESTRICTED: "Tài khoản huấn luyện của bạn đang bị hạn chế nên chưa thể check-in.",
  PT_BANNED: "Tài khoản huấn luyện của bạn đang bị hạn chế nên chưa thể check-in.",
  NOT_A_PT: "Tài khoản này chưa phải huấn luyện viên.",
  PT_NOT_FOUND: "Tài khoản này chưa phải huấn luyện viên.",
  PT_SESSION_CHECK_UNAVAILABLE: "Hệ thống tạm thời chưa kiểm tra được lịch dạy. Vui lòng thử lại sau ít phút.",
  GYM_NOT_ACTIVE: "Chi nhánh này hiện không mở cửa.",
  INVALID_TOKEN: "Mã QR không hợp lệ hoặc đã hết hạn.",
  TOKEN_EXPIRED: "Mã QR không hợp lệ hoặc đã hết hạn.",
};

export const PT_CHECKIN_GENERIC_ERROR = "Check-in chưa thành công — thử quét lại.";
export const PT_CHECKIN_NETWORK_ERROR = "Không kết nối được máy chủ — kiểm tra mạng rồi quét lại.";

export function ptCheckinErrorMessage(error: unknown): string {
  const body = (error as { response?: { data?: any } } | null)?.response?.data;
  const code = body?.error?.code;
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, code)) return MESSAGES[code];
  if (!body) return PT_CHECKIN_NETWORK_ERROR;
  return PT_CHECKIN_GENERIC_ERROR;
}

export interface PtCheckinResult {
  gymName: string | null;
  /** Local day at the branch, "YYYY-MM-DD" (server, Asia/Ho_Chi_Minh). */
  localDate: string | null;
  firstScanAt: string | null;
}

const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

export function normalizePtCheckinResult(raw: unknown): PtCheckinResult {
  const d = (raw ?? {}) as Record<string, unknown>;
  return { gymName: text(d.gymName), localDate: text(d.localDate), firstScanAt: text(d.firstScanAt) };
}

/** "YYYY-MM-DD" → "dd/mm/yyyy" without going through Date (no device-timezone shift). */
export function ptCheckinDateLabel(localDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "08:05" from the first scan instant, in Vietnam time so it matches the day the server recorded. */
export function ptCheckinTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 7 * 3600_000); // Asia/Ho_Chi_Minh has no DST: UTC+7 year-round
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** One row of the owner's "Huấn luyện viên đã check-in" list. No client identity by contract. */
export interface OwnerPtCheckin {
  id: string;
  ptName: string;
  localDate: string | null;
  firstScanAt: string | null;
  lastScanAt: string | null;
  scanCount: number;
}

export const PT_NAME_FALLBACK = "Huấn luyện viên";

export function normalizeOwnerPtCheckins(raw: unknown): OwnerPtCheckin[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [];
  const out: OwnerPtCheckin[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || typeof r.id !== "string") continue;
    const name = typeof r.ptName === "string" ? r.ptName.trim() : "";
    out.push({
      id: r.id,
      ptName: name || PT_NAME_FALLBACK,
      localDate: text(r.localDate),
      firstScanAt: text(r.firstScanAt),
      lastScanAt: text(r.lastScanAt),
      scanCount: Math.max(1, Number(r.scanCount) || 1),
    });
  }
  return out;
}

/** "08:05 · 16/10/2026" for a row: time of the first scan, day the server recorded. */
export function ownerPtCheckinWhen(c: Pick<OwnerPtCheckin, "firstScanAt" | "localDate">): string {
  return [ptCheckinTimeLabel(c.firstScanAt), ptCheckinDateLabel(c.localDate)].filter(Boolean).join(" · ");
}

export function ownerPtScanLabel(scanCount: number): string {
  return `${scanCount} lần quét`;
}
