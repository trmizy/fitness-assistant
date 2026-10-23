import { prisma } from '../repositories/prisma';

/**
 * D15b - TỔNG hoa hồng giới thiệu PT theo kỳ, cho KẾ TOÁN (và chủ), trong phạm vi thương hiệu/chi nhánh.
 *
 * Nguồn duy nhất: `GymMembershipReferral` (số hoa hồng tính lúc mua + `clawedBack` + trạng thái) nối với
 * `GymMembershipContract.payoutReleasedAt` (khi tiền chờ được giải phóng sang số dư khả dụng) - cùng dữ liệu
 * `membershipService` và payment-service/membership-ledger đã dùng. Không có bảng/biến theo dõi thứ hai.
 *
 * Ba nhóm, mỗi hoa hồng thuộc ĐÚNG MỘT nhóm (net = amount - clawedBack):
 *   expected  (dự kiến)    PENDING / FAILED : đã tính lúc mua nhưng CHƯA chuyển cho PT (thẻ chưa kích hoạt, hoặc
 *                          chuyển lỗi và đang chờ job thử lại).
 *   recorded  (đã ghi nhận) RELEASED, thẻ chưa giải phóng : đã chuyển vào số dư CHỜ của PT, chưa khả dụng.
 *   paid      (đã chi)     RELEASED, thẻ đã `payoutReleasedAt` : đã giải phóng sang số dư KHẢ DỤNG của PT. Việc PT
 *                          rút khỏi ví ra ngân hàng không được theo dõi theo từng thẻ nên không nằm trong con số này.
 * VOIDED (thẻ không bao giờ kích hoạt) và hoa hồng chưa chuyển của thẻ đã huỷ không tính. `clawedBack` (đã thu hồi do hoàn tiền) báo riêng.
 *
 * ĐIỀU KHOẢN / TỶ LỆ TỪNG PT KHÔNG BAO GIỜ rời khỏi hàm này: truy vấn không chọn `referrerPtUserId` và `rate`,
 * kết quả không có chiều "theo PT". Kỳ = tháng (Asia/Ho_Chi_Minh) của ngày thẻ được mua (createdAt của hoa hồng).
 */

export interface CommissionBucket {
  expected: string;
  recorded: string;
  paid: string;
  clawedBack: string;
  referralCount: number;
}

export interface PtCommissionSummary {
  currency: 'VND';
  from: string;
  to: string;
  branchCount: number;
  totals: CommissionBucket;
  byMonth: Array<CommissionBucket & { month: string }>;
  definitions: { expected: string; recorded: string; paid: string; clawedBack: string; period: string };
}

export const COMMISSION_DEFINITIONS = {
  expected: 'Đã tính khi mua thẻ nhưng chưa chuyển cho PT (thẻ chưa kích hoạt hoặc đang chờ chuyển lại).',
  recorded: 'Đã chuyển vào số dư chờ của PT, chưa được giải phóng sang số dư khả dụng.',
  paid: 'Đã giải phóng sang số dư khả dụng của PT. Việc PT rút tiền ra ngân hàng không theo dõi theo từng thẻ.',
  clawedBack: 'Đã thu hồi lại do hoàn tiền thẻ (đã trừ khỏi các con số trên).',
  period: 'Tháng mua thẻ (giờ Việt Nam).',
} as const;

const OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_MONTHS = 6;
const MAX_RANGE_MS = 366 * 2 * 24 * 60 * 60 * 1000;

/** 'YYYY-MM' của một thời điểm theo giờ Việt Nam (UTC+7 cố định, không DST). */
export function monthKeyVn(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 7);
}

function startOfMonthVn(instant: Date, monthsBack = 0): Date {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  const startShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - monthsBack, 1);
  return new Date(startShifted - OFFSET_MS);
}

export type RangeParse = { ok: true; from: Date; to: Date } | { ok: false; error: string };

/** from/to là ngày 'YYYY-MM-DD' (giờ VN) hoặc ISO có múi giờ; to là chặn trên LOẠI TRỪ. Mặc định: 6 tháng gần nhất. */
export function parseCommissionRange(query: { from?: unknown; to?: unknown }, now: Date = new Date()): RangeParse {
  const parse = (v: unknown, endOfDay: boolean): Date | null | 'bad' => {
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string') return 'bad';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(`${v}T00:00:00.000+07:00`);
      if (Number.isNaN(d.getTime())) return 'bad';
      return endOfDay ? new Date(d.getTime() + 24 * 60 * 60 * 1000) : d;
    }
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(v)) return 'bad';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? 'bad' : d;
  };
  const f = parse(query.from, false);
  const t = parse(query.to, true);
  if (f === 'bad') return { ok: false, error: 'from phải là ngày YYYY-MM-DD' };
  if (t === 'bad') return { ok: false, error: 'to phải là ngày YYYY-MM-DD' };
  const from = f ?? startOfMonthVn(now, DEFAULT_MONTHS - 1);
  const to = t ?? new Date(now.getTime() + 1);
  if (from.getTime() >= to.getTime()) return { ok: false, error: 'from phải nhỏ hơn to' };
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) return { ok: false, error: 'Khoảng thời gian tối đa là 24 tháng' };
  return { ok: true, from, to };
}

type Acc = { expected: number; recorded: number; paid: number; clawedBack: number; referralCount: number };
const empty = (): Acc => ({ expected: 0, recorded: 0, paid: 0, clawedBack: 0, referralCount: 0 });
// Tiền VND lưu Decimal(14,2): cộng bằng số nguyên "xu" để không trôi dấu phẩy động.
const cents = (v: { toString(): string } | number | string) => Math.round(Number(v.toString()) * 100);
const fmt = (c: number) => (c / 100).toFixed(2);
const out = (a: Acc): CommissionBucket => ({
  expected: fmt(a.expected), recorded: fmt(a.recorded), paid: fmt(a.paid), clawedBack: fmt(a.clawedBack), referralCount: a.referralCount,
});

export interface ReferralFact {
  status: string;
  amount: { toString(): string };
  clawedBack: { toString(): string };
  createdAt: Date;
  payoutReleasedAt: Date | null;
  /** Trạng thái thẻ - thẻ đã huỷ mà hoa hồng chưa từng chuyển thì không còn là khoản "dự kiến". */
  membershipStatus?: string;
}

/** Thuần tuý (không DB) - chỗ DUY NHẤT phân loại expected/recorded/paid, để kiểm thử độc lập. */
export function summarizeCommission(facts: readonly ReferralFact[]): { totals: CommissionBucket; byMonth: Array<CommissionBucket & { month: string }> } {
  const total = empty();
  const months = new Map<string, Acc>();
  for (const f of facts) {
    if (f.status === 'VOIDED') continue;
    if (f.status !== 'RELEASED' && f.membershipStatus === 'CANCELLED') continue;
    const gross = cents(f.amount);
    const clawed = cents(f.clawedBack);
    const net = Math.max(0, gross - clawed);
    const month = monthKeyVn(f.createdAt);
    const m = months.get(month) ?? empty();
    months.set(month, m);
    for (const acc of [total, m]) {
      acc.referralCount += 1;
      acc.clawedBack += clawed;
      if (f.status === 'RELEASED') {
        if (f.payoutReleasedAt) acc.paid += net;
        else acc.recorded += net;
      } else {
        // PENDING / FAILED / trạng thái chưa biết: chưa chuyển cho PT -> dự kiến (fail-safe: không tính là đã chi).
        acc.expected += net;
      }
    }
  }
  return {
    totals: out(total),
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, a]) => ({ month, ...out(a) })),
  };
}

export const ptCommissionSummaryService = {
  async summarize(gymIds: readonly string[], from: Date, to: Date): Promise<PtCommissionSummary> {
    const rows = gymIds.length === 0
      ? []
      : await prisma.gymMembershipReferral.findMany({
          where: { gymId: { in: [...gymIds] }, createdAt: { gte: from, lt: to } },
          // Cố ý KHÔNG chọn referrerPtUserId / rate / id: tổng hợp không có chiều theo PT.
          select: { status: true, amount: true, clawedBack: true, createdAt: true, membershipContract: { select: { payoutReleasedAt: true, status: true } } },
        });
    const { totals, byMonth } = summarizeCommission(
      rows.map((r) => ({ status: r.status, amount: r.amount, clawedBack: r.clawedBack, createdAt: r.createdAt, payoutReleasedAt: r.membershipContract.payoutReleasedAt, membershipStatus: r.membershipContract.status })),
    );
    return {
      currency: 'VND',
      from: from.toISOString(),
      to: to.toISOString(),
      branchCount: gymIds.length,
      totals,
      byMonth,
      definitions: { ...COMMISSION_DEFINITIONS },
    };
  },
};
