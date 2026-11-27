import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

/**
 * Owner analytics, read-only: what a gym's wallet ledger says it earned from MEMBERSHIP sales, per Vietnam calendar day.
 *
 * The ledger is the only source: nothing here knows a commission rate or recomputes a split. `settleContractPayment` already wrote the
 * gym's share (gross price minus the platform's cut) as a PENDING credit tagged with the membership's payment transaction, and every later
 * movement of that same money (referral commission to a PT, release to AVAILABLE, refund draw, appeal supplement) is another entry of the
 * same wallet tagged with the same transaction. So, per transaction, the net of ALL the gym wallet's movements on it is what the gym
 * really holds / received; summed per day it is a net-income series.
 *
 *   net                = SUM(credit - debit) of the gym wallet's entries on GYM_MEMBERSHIP transactions, by the entry's `created_at` VN day.
 *                        Release PENDING -> AVAILABLE nets to ~0 on its day (a debit of the pending bucket and a credit of the available one);
 *                        a refund / appeal supplement shows as a NEGATIVE on the day it happened. It never includes a withdrawal (that is
 *                        a WITHDRAWAL transaction) nor a PT-contract share (that is a PT_CONTRACT transaction).
 *   gymShare           = the "gym share" PENDING credits = the gym's part of the price at sale (price minus the platform cut).
 *   grossPrice         = what the client paid for those same sales (`payment_transactions.amount`).
 *   feeAtSale          = grossPrice - gymShare, taken from the two ledger/transaction facts above (the platform's cut at sale).
 *   referralCommission = PENDING debits "referral commission" = the part of the gym's share moved to the referring PT.
 *   adjustments        = net - (gymShare - referralCommission): everything else (refund draws, clawback returns, appeal supplement).
 *
 * Left out on purpose: the platform repaying itself from the gym's income ("gym debt recovered from income" legs). That is a debt
 * settlement of a past advance, not a membership sale, and its own wallet row says so.
 *
 * Description matching mirrors wallet-entry-category.ts (`— gym share`, `— referral commission`, the gym-debt fragment); a test settles a real
 * membership through settleContractPayment so a changed wording fails loudly instead of silently zeroing the chart.
 */

export const GYM_INCOME_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** One call covers at most this many days of ledger (gym-service caps its ranges at 92 inclusive days). */
export const GYM_INCOME_MAX_RANGE_MS = 93 * 24 * 60 * 60 * 1000;

const GYM_DEBT_FRAGMENT = '— gym debt recovered from income';

export interface GymIncomeDay {
  date: string;
  sales: number;
  grossPrice: number;
  gymShare: number;
  feeAtSale: number;
  referralCommission: number;
  adjustments: number;
  net: number;
}

export interface GymMembershipIncome {
  gymId: string;
  from: string;
  to: string;
  /** false = the gym has no wallet yet (never sold a paid membership): every number is 0, nothing was created. */
  walletFound: boolean;
  /** Only the days that have at least one entry, ascending. The caller zero-fills its own calendar. */
  daily: GymIncomeDay[];
  totals: Omit<GymIncomeDay, 'date'>;
}

interface Row {
  day: string;
  sales: number;
  gross: number | null;
  gym_share: number | null;
  referral: number | null;
  net: number | null;
}

const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

function toDay(r: Row): GymIncomeDay {
  const grossPrice = num(r.gross);
  const gymShare = num(r.gym_share);
  const referralCommission = num(r.referral);
  const net = num(r.net);
  return {
    date: r.day,
    sales: num(r.sales),
    grossPrice,
    gymShare,
    feeAtSale: round2(grossPrice - gymShare),
    referralCommission,
    adjustments: round2(net - (gymShare - referralCommission)),
    net,
  };
}

export const gymMembershipIncomeService = {
  /** READ-ONLY: never creates the wallet (unlike getOrCreateWallet). `start` inclusive, `end` exclusive, both instants. */
  async forGym(gymId: string, start: Date, end: Date): Promise<GymMembershipIncome> {
    const wallet = await prisma.wallet.findUnique({
      where: { ownerType_ownerId: { ownerType: 'GYM', ownerId: gymId } },
      select: { id: true },
    });
    const base = { gymId, from: start.toISOString(), to: end.toISOString() };
    if (!wallet) {
      const zero = { sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: 0, net: 0 };
      return { ...base, walletFound: false, daily: [], totals: zero };
    }

    // wallet_ledger_entries.created_at is timestamp(3) WITHOUT zone holding UTC wall-clock (how Prisma writes a Date): declare it UTC, then move it to VN.
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT to_char((e.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${GYM_INCOME_TIME_ZONE}, 'YYYY-MM-DD') AS day,
             (COUNT(DISTINCT e.transaction_id) FILTER (WHERE e.entry_type = 'CREDIT' AND e.bucket = 'PENDING' AND e.description LIKE '% — gym share'))::int AS sales,
             (SUM(t.amount) FILTER (WHERE e.entry_type = 'CREDIT' AND e.bucket = 'PENDING' AND e.description LIKE '% — gym share'))::float8 AS gross,
             (SUM(e.amount) FILTER (WHERE e.entry_type = 'CREDIT' AND e.bucket = 'PENDING' AND e.description LIKE '% — gym share'))::float8 AS gym_share,
             (SUM(e.amount) FILTER (WHERE e.entry_type = 'DEBIT' AND e.bucket = 'PENDING' AND e.description LIKE '%— referral commission'))::float8 AS referral,
             (SUM(CASE WHEN e.entry_type = 'CREDIT' THEN e.amount ELSE -e.amount END))::float8 AS net
        FROM wallet_ledger_entries e
        JOIN payment_transactions t ON t.id = e.transaction_id
       WHERE e.wallet_id = ${wallet.id}
         AND e.created_at >= ${start.toISOString()}::timestamp
         AND e.created_at < ${end.toISOString()}::timestamp
         AND t.purpose = 'GYM_MEMBERSHIP'
         AND COALESCE(e.description, '') NOT LIKE ${'%' + GYM_DEBT_FRAGMENT + '%'}
       GROUP BY 1
       ORDER BY 1`);

    const daily = rows.map(toDay);
    const sum = (pick: (d: GymIncomeDay) => number) => round2(daily.reduce((s, d) => s + pick(d), 0));
    return {
      ...base,
      walletFound: true,
      daily,
      totals: {
        sales: sum((d) => d.sales),
        grossPrice: sum((d) => d.grossPrice),
        gymShare: sum((d) => d.gymShare),
        feeAtSale: sum((d) => d.feeAtSale),
        referralCommission: sum((d) => d.referralCommission),
        adjustments: sum((d) => d.adjustments),
        net: sum((d) => d.net),
      },
    };
  },
};
