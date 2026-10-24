import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { buildReconciliationReport } from './reconcile.service';
import { PLATFORM_REVENUE_ID } from './wallet.service';

export type FinanceGroupBy = 'day' | 'week' | 'month' | 'quarter';

export interface FinanceBucket {
  /** Bucket start, ISO — the client renders the label (dd/MM, "Tuần …", "Thg …", "Quý …"). */
  period: string;
  income: string;
  expense: string;
  netRevenue: string;
  transactionCount: number;
}

export interface FinanceOverviewReport {
  groupBy: FinanceGroupBy;
  from: string;
  to: string;
  buckets: FinanceBucket[];
  totals: { income: string; expense: string; netRevenue: string; transactionCount: number };
  /**
   * B29: the platform's revenue wallet RIGHT NOW (same figures the admin dashboard and the
   * reconciliation report show — read from `buildReconciliationReport`, not recomputed). Not
   * period-bound: `available` is money already earned and released, `pending` is commission
   * the platform has been promised but that is still held (e.g. an unfinished contract) —
   * kept apart from `netRevenue`, which only ever counts realized revenue.
   */
  platformRevenue: { available: string; pending: string; asOf: string };
}

const VALID_GROUP_BY: FinanceGroupBy[] = ['day', 'week', 'month', 'quarter'];

export function isFinanceGroupBy(value: unknown): value is FinanceGroupBy {
  return typeof value === 'string' && (VALID_GROUP_BY as string[]).includes(value);
}

interface BucketSumRow {
  bucket: Date;
  total: string | null;
  count: bigint;
}

/**
 * "Tài chính" → tab Tổng quan: thu (income) / chi (expense) / doanh thu ròng nền tảng
 * (netRevenue), theo ngày/tuần/tháng/quý cho một khoảng thời gian.
 *
 *   - income      = mọi giao dịch PAID trừ REFUND/WITHDRAWAL — tiền mặt thật sự đi VÀO hệ
 *     thống qua cổng thanh toán, gộp theo `paidAt`.
 *   - expense     = giao dịch REFUND + WITHDRAWAL đã PAID — tiền thật sự rời khỏi ESCROW của
 *     nền tảng, gộp theo `paidAt`. Một yêu cầu rút tiền mới được "Duyệt" (khoá tiền) chưa tính
 *     là chi — tiền chưa rời custody (xem ghi chú `locked` ở reconcile.service.ts); chỉ giao
 *     dịch payout do `withdrawal.service.ts#markPaid` tạo (purpose WITHDRAWAL, có paidAt) mới
 *     tính.
 *   - netRevenue  = doanh thu nền tảng đã THỰC HIỆN trong kỳ, lấy từ SỔ CÁI (nguồn duy nhất,
 *     cùng ví REVENUE mà màn Tổng quan admin và reconcile.service.ts đọc): chuyển động ròng
 *     (CREDIT − DEBIT) của bucket AVAILABLE ở ví nền tảng REVENUE, gộp theo `createdAt` của
 *     dòng sổ cái. Hoàn tiền/thu hồi hoa hồng (DEBIT) làm giảm; tiền chủ nền tảng rút ra
 *     (giao dịch purpose WITHDRAWAL) KHÔNG tính là mất doanh thu. Tiền còn nằm ở PENDING
 *     (hoa hồng chưa được giải phóng, vd. hợp đồng chưa xong) không vào netRevenue — nó được
 *     trả riêng, có nhãn, ở `platformRevenue.pending`. Trước đây netRevenue chỉ cộng bảng
 *     `platform_commissions` (chỉ luồng ví cũ wallet.service#transfer ghi), nên luôn 0 với
 *     luồng hợp đồng/hội viên dù sổ cái có doanh thu. Ví REVENUE mọi luồng đều ghi qua sổ cái
 *     nên không cần cộng thêm bảng commissions (sẽ tính trùng).
 *
 * `date_trunc`'s first argument here is a query parameter, not a literal — Postgres accepts a
 * text expression there so this is safe from injection despite looking like it needs a literal;
 * `isFinanceGroupBy` still whitelists the caller-supplied value before it ever reaches this
 * function, matching the enum-in/enum-out shape used everywhere else money is queried in this
 * service.
 */
export async function buildFinanceOverview(params: {
  from: Date;
  to: Date;
  groupBy: FinanceGroupBy;
}): Promise<FinanceOverviewReport> {
  const { from, to, groupBy } = params;

  const [incomeRows, expenseRows, revenueRows] = await Promise.all([
    prisma.$queryRaw<BucketSumRow[]>(Prisma.sql`
      SELECT date_trunc(${groupBy}, paid_at) AS bucket, SUM(amount)::text AS total, COUNT(*) AS count
      FROM payment_transactions
      WHERE status = 'PAID' AND purpose NOT IN ('REFUND', 'WITHDRAWAL')
        AND paid_at >= ${from} AND paid_at < ${to}
      GROUP BY bucket
    `),
    prisma.$queryRaw<BucketSumRow[]>(Prisma.sql`
      SELECT date_trunc(${groupBy}, paid_at) AS bucket, SUM(amount)::text AS total, COUNT(*) AS count
      FROM payment_transactions
      WHERE status = 'PAID' AND purpose IN ('REFUND', 'WITHDRAWAL')
        AND paid_at >= ${from} AND paid_at < ${to}
      GROUP BY bucket
    `),
    prisma.$queryRaw<BucketSumRow[]>(Prisma.sql`
      SELECT date_trunc(${groupBy}, e.created_at) AS bucket,
             SUM(CASE WHEN e.entry_type = 'CREDIT' THEN e.amount ELSE -e.amount END)::text AS total,
             COUNT(*) AS count
      FROM wallet_ledger_entries e
      JOIN wallets w ON w.id = e.wallet_id
      JOIN payment_transactions t ON t.id = e.transaction_id
      WHERE w.owner_type = 'PLATFORM' AND w.owner_id = ${PLATFORM_REVENUE_ID}
        AND e.bucket = 'AVAILABLE' AND t.purpose != 'WITHDRAWAL'
        AND e.created_at >= ${from} AND e.created_at < ${to}
      GROUP BY 1
    `),
  ]);

  const zero = new Prisma.Decimal(0);
  const map = new Map<string, { period: string; income: Prisma.Decimal; expense: Prisma.Decimal; netRevenue: Prisma.Decimal; transactionCount: number }>();
  const entryFor = (bucket: Date) => {
    const key = bucket.toISOString();
    let entry = map.get(key);
    if (!entry) {
      entry = { period: key, income: zero, expense: zero, netRevenue: zero, transactionCount: 0 };
      map.set(key, entry);
    }
    return entry;
  };

  for (const r of incomeRows) {
    const entry = entryFor(r.bucket);
    entry.income = entry.income.plus(r.total ?? 0);
    entry.transactionCount += Number(r.count);
  }
  for (const r of expenseRows) {
    const entry = entryFor(r.bucket);
    entry.expense = entry.expense.plus(r.total ?? 0);
    entry.transactionCount += Number(r.count);
  }
  for (const r of revenueRows) {
    const entry = entryFor(r.bucket);
    entry.netRevenue = entry.netRevenue.plus(r.total ?? 0);
  }

  const buckets = Array.from(map.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((b) => ({
      period: b.period,
      income: b.income.toFixed(2),
      expense: b.expense.toFixed(2),
      netRevenue: b.netRevenue.toFixed(2),
      transactionCount: b.transactionCount,
    }));

  const totals = buckets.reduce(
    (acc, b) => ({
      income: acc.income.plus(b.income),
      expense: acc.expense.plus(b.expense),
      netRevenue: acc.netRevenue.plus(b.netRevenue),
      transactionCount: acc.transactionCount + b.transactionCount,
    }),
    { income: zero, expense: zero, netRevenue: zero, transactionCount: 0 },
  );

  const recon = await buildReconciliationReport();

  return {
    groupBy,
    from: from.toISOString(),
    to: to.toISOString(),
    buckets,
    totals: {
      income: totals.income.toFixed(2),
      expense: totals.expense.toFixed(2),
      netRevenue: totals.netRevenue.toFixed(2),
      transactionCount: totals.transactionCount,
    },
    platformRevenue: {
      available: recon.breakdown.platformRevenueAvailable,
      pending: recon.breakdown.platformRevenuePending,
      asOf: new Date().toISOString(),
    },
  };
}
