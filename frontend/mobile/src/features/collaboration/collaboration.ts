/**
 * PT ↔ phòng gym: phần dùng chung cho CẢ HAI phía.
 *
 * Trước đây khối này nằm trong `features/pt/pt.ts` vì chỉ ghế huấn luyện viên dùng tới (Phase 11).
 * Phase 12 dựng ghế chủ gym trên đúng một hợp tác đó, nên nó chuyển ra đây: hai màn đọc cùng một
 * bảng trạng thái và cùng một phép kiểm tỷ lệ, không thể lệch nhau. `features/pt/pt.ts` xuất lại
 * những gì nó vẫn xuất, nên các màn Phase 11 không phải sửa gì.
 *
 * Chỉ những gì KHÔNG phụ thuộc vào việc mình đang ngồi ghế nào mới được nằm ở đây; nhãn phụ thuộc
 * phía (ai đang phải trả lời) là hàm riêng ở từng module.
 */

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

export type CollabParty = "PT" | "GYM";

export type CollabRow = {
  id: string;
  status?: string | null;
  proposedBy?: string | null;
  round?: number | null;
  gymId?: string | null;
  /** Máy chủ đính kèm sẵn phòng gym; đừng bắt màn hình tự tra lại từ danh sách chi nhánh. */
  gym?: { id?: string | null; name?: string | null; city?: string | null } | null;
  ptUserId?: string | null;
  proposedPtRate?: string | null;
  proposedGymRate?: string | null;
  /**
   * Tên trường của phần nền tảng là `platformRate`, KHÔNG phải `proposedPlatformRate` như hai
   * trường kia — đã đối chiếu `GET /owner/collaborations` thật. Đoán theo quy luật đặt tên thì ô
   * "Nền tảng" hiện "—" trên mọi dòng.
   */
  platformRate?: string | null;
  note?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
};

/**
 * gym-service's `validateRates`: the three shares must sum to EXACTLY 1 and the platform's share
 * cannot go below `MIN_PLATFORM_RATE` (0.10 by default). Checked here too because these numbers
 * land on every contract signed under the partnership and are split to the đồng — a table summing
 * to 0.9999 is a typo to catch in the form, not a rounding error to absorb.
 */
export const MIN_PLATFORM_RATE = 0.1;

export function ratesError(ptPct: string, gymPct: string, platformPct: string): string | null {
  const nums = [ptPct, gymPct, platformPct].map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return "Nhập đủ ba tỷ lệ theo phần trăm.";
  if (nums.some((n) => n < 0)) return "Tỷ lệ không được âm.";
  const [pt, gym, platform] = nums;
  if (platform < MIN_PLATFORM_RATE * 100) return `Tỷ lệ nền tảng không được nhỏ hơn ${MIN_PLATFORM_RATE * 100}%.`;
  const sum = pt + gym + platform;
  // Percent inputs are whole numbers, so the sum is exact — no epsilon needed.
  if (sum !== 100) return `Tổng ba tỷ lệ phải bằng đúng 100%, hiện là ${sum}%.`;
  return null;
}

/** The API takes fractions ("0.60"), the form shows percentages — convert at the boundary. */
export function ratesPayload(ptPct: string, gymPct: string, platformPct: string) {
  const f = (v: string) => (Number(v) / 100).toFixed(4);
  return { ptRate: f(ptPct), gymRate: f(gymPct), platformRate: f(platformPct) };
}

export function ratePercent(rate: unknown): string {
  // `Number(null)` is 0, so a missing rate would render as "0%" — i.e. claim the trainer gets
  // nothing — unless absence is rejected before the conversion.
  if (rate == null || rate === "") return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

/**
 * The real `CollaborationStatus` enum (gym-service schema.prisma:1133). PENDING and COUNTERED are
 * both "someone owes an answer" — WHOSE turn it is comes from `proposedBy`, which the schema
 * documents as "who made the offer currently on the table, i.e. whose turn it is NOT". So the
 * status alone can never say whether the button should be shown.
 */
export const COLLAB_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Đang chờ trả lời", tone: "warning" },
  COUNTERED: { label: "Đã trả giá lại", tone: "warning" },
  ACCEPTED: { label: "Đang hợp tác", tone: "success" },
  REJECTED: { label: "Đã từ chối", tone: "danger" },
  EXPIRED: { label: "Đã hết hạn", tone: "neutral" },
  TERMINATED: { label: "Đã chấm dứt", tone: "neutral" },
};

/**
 * Nhãn trạng thái NHÌN TỪ MỘT PHÍA. Cùng một dòng dữ liệu, PT thấy "Bạn cần trả lời" thì phòng gym
 * phải thấy "Chờ huấn luyện viên trả lời" — nên phía xem là tham số, không phải hằng số nhúng
 * trong hàm. Hai chỗ gọi cùng hàm này thì không thể lệch nhau.
 */
export function collabStatusFor(
  row: { status?: string | null; proposedBy?: string | null } | null | undefined,
  viewer: CollabParty,
) {
  const status = row?.status ?? "";
  const base = COLLAB_STATUS[status] ?? { label: status || "Không rõ", tone: "neutral" as StatusTone };
  if ((status === "PENDING" || status === "COUNTERED") && row?.proposedBy) {
    // `proposedBy` là bên ĐÃ ra giá, nên lượt thuộc về bên kia.
    if (row.proposedBy === viewer) {
      return {
        label: viewer === "PT" ? "Chờ phòng gym trả lời" : "Chờ huấn luyện viên trả lời",
        tone: "info" as StatusTone,
      };
    }
    return { label: "Bạn cần trả lời", tone: "warning" as StatusTone };
  }
  return base;
}

/** Chỉ trả lời được khi lời đề nghị đang trên bàn là của BÊN KIA — server cũng từ chối bằng 409. */
export function canRespondAs(
  row: { status?: string | null; proposedBy?: string | null } | null | undefined,
  viewer: CollabParty,
): boolean {
  const open = row?.status === "PENDING" || row?.status === "COUNTERED";
  return open && !!row?.proposedBy && row.proposedBy !== viewer;
}

/** Hợp tác còn hiệu lực mới chấm dứt được; chấm dứt một đề nghị chưa ai nhận là vô nghĩa. */
export function canTerminateCollab(row: { status?: string | null } | null | undefined): boolean {
  return row?.status === "ACCEPTED";
}
