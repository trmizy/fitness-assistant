import { gymService } from './gym.service';
import { resolveStatsRange, shiftLocalDate } from './gym-stats.service';
import { analyticsRepository, PAID_MEMBERSHIP_STATUSES, type NewReturningRow, type RenewalCounts } from '../repositories/analytics.repository';
import { paymentClient } from '../clients/payment.client';
import { logger } from '@gym-coach/shared';
import { APP_TIME_ZONE, localDateOf, windowOfLocalDate } from '../utils/local-day';

/**
 * Chart data for the owner dashboard: GET /owner/gyms/:gymId/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD.
 * Same range rules as /stats (resolveStatsRange: both bounds inclusive Vietnam days, default last 7, max 92 days).
 * Read-only. Every section is null when the caller's role may not read it (the controller decides `visibility`), exactly like /stats.
 *
 * DEFINITIONS (also returned in the response where a number could be misread):
 *  - heatmap: GymCheckIn rows (all rows, the same ones stats counts), Vietnam weekday x hour; weekday 1 = Monday .. 7 = Sunday.
 *  - sales: paid memberships = status ACTIVE or EXPIRED and data_origin REAL (the Finance page's "doanh số": recognizedSales). Dated by
 *    `created_at` (purchase) in Vietnam days. gross = Σ price_at_purchase (a list price, NOT the gym's income - see netIncome).
 *  - netIncome: the gym wallet's ledger as payment-service reports it (see gym-membership-income.service.ts); gym-service computes nothing.
 *  - renewal: see RENEWAL_WINDOW_DAYS and analyticsRepository.renewalCounts / newVsReturningPerDay.
 */

/** A client who buys again within this many days after a membership ended counts as a renewal. 30 = one monthly cycle, the common plan length. */
export const RENEWAL_WINDOW_DAYS = 30;

const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;
const ratio = (num: number, den: number): number | null => (den > 0 ? round(num / den) : null);

export interface AnalyticsVisibility {
  /** checkin.list */
  heatmap: boolean;
  /** membership.full | membership.sales (sales + renewal; none of it carries an identity) */
  memberships: boolean;
  /** finance.wallet.view */
  netIncome: boolean;
}

export type AnalyticsSection = 'netIncome';

export interface GymAnalytics {
  gymId: string;
  timeZone: string;
  from: string;
  to: string;
  today: string;
  heatmap: {
    total: number;
    /** matrix[weekday - 1][hour]: rows Monday..Sunday, 24 columns 0..23, Vietnam time. */
    matrix: number[][];
    byHour: number[];
    byWeekday: number[];
    peak: { weekday: number; hour: number; count: number } | null;
  } | null;
  sales: {
    statusesCounted: string[];
    dateBasis: 'PURCHASE_DATE';
    total: { count: number; gross: number };
    daily: { date: string; count: number; gross: number }[];
    byPlan: { planId: string; name: string; count: number; gross: number }[];
  } | null;
  renewal: {
    windowDays: number;
    scope: 'BRAND';
    ended: number;
    renewed: number;
    renewedSameBranch: number;
    /** ended cards whose renewal window is over: the cohort in which "not renewed" is final. */
    settled: number;
    settledRenewed: number;
    /** ended, not renewed yet, window still open: undecided. */
    open: number;
    /** renewed / ended so far (null when nothing ended). Leans high for recent cards (a renewal is seen at once, a lapse only after the window). */
    rate: number | null;
    /** settledRenewed / settled (null when no card is settled): the unbiased rate. */
    settledRate: number | null;
    newVsReturning: {
      newMembers: number;
      returningMembers: number;
      daily: { date: string; new: number; returning: number }[];
    };
  } | null;
  netIncome: {
    source: 'PAYMENT_LEDGER';
    walletFound: boolean;
    dateBasis: 'LEDGER_ENTRY_DATE';
    totals: Record<string, number>;
    daily: { date: string; sales: number; grossPrice: number; gymShare: number; feeAtSale: number; referralCommission: number; adjustments: number; net: number }[];
  } | null;
  /** Sections the caller may read but that could not be produced right now (payment-service unreachable): shown as an error, never as 0. */
  unavailable: AnalyticsSection[];
}

export const gymAnalyticsService = {
  async getAnalytics(
    gymId: string,
    ownerId: string,
    query: { from?: unknown; to?: unknown },
    visibility: AnalyticsVisibility,
    now: Date = new Date(),
  ): Promise<GymAnalytics> {
    await gymService.getOwnedGym(gymId, ownerId);
    const range = resolveStatsRange(query, now);
    const start = windowOfLocalDate(range.from).start;
    const end = windowOfLocalDate(range.to).end;
    const dates = Array.from({ length: range.days }, (_, i) => shiftLocalDate(range.from, i));
    const unavailable: AnalyticsSection[] = [];

    const heatmapP = visibility.heatmap ? analyticsRepository.checkinHeat(gymId, start, end) : null;
    const salesP = visibility.memberships
      ? Promise.all([analyticsRepository.salesPerDay(gymId, start, end), analyticsRepository.salesPerPlan(gymId, start, end)])
      : null;
    const renewalP = visibility.memberships
      ? analyticsRepository.brandGymIds(gymId).then((brandIds): Promise<[RenewalCounts, NewReturningRow[]]> =>
          Promise.all([
            analyticsRepository.renewalCounts(gymId, brandIds, start, end, now, RENEWAL_WINDOW_DAYS),
            analyticsRepository.newVsReturningPerDay(gymId, brandIds, start, end),
          ]),
        )
      : null;
    const incomeP = visibility.netIncome
      ? paymentClient.getGymMembershipIncome(gymId, start, end).catch((e: any) => {
          logger.error({ err: e?.message, gymId }, 'analytics: net income unavailable');
          return null;
        })
      : null;

    const [heat, sales, renewalRaw, income] = await Promise.all([heatmapP, salesP, renewalP, incomeP]);

    let heatmap: GymAnalytics['heatmap'] = null;
    if (heat) {
      const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
      let peak: { weekday: number; hour: number; count: number } | null = null;
      let total = 0;
      for (const c of heat) {
        if (c.weekday < 1 || c.weekday > 7 || c.hour < 0 || c.hour > 23) continue;
        matrix[c.weekday - 1][c.hour] += c.count;
        total += c.count;
      }
      const byHour = new Array<number>(24).fill(0);
      const byWeekday = new Array<number>(7).fill(0);
      for (let w = 0; w < 7; w++) {
        for (let h = 0; h < 24; h++) {
          const n = matrix[w][h];
          byHour[h] += n;
          byWeekday[w] += n;
          // First maximum in Monday-first, hour-ascending order: deterministic on ties.
          if (n > 0 && (!peak || n > peak.count)) peak = { weekday: w + 1, hour: h, count: n };
        }
      }
      heatmap = { total, matrix, byHour, byWeekday, peak };
    }

    let salesOut: GymAnalytics['sales'] = null;
    if (sales) {
      const [perDay, perPlan] = sales;
      const byDate = new Map(perDay.map((r) => [r.date, r]));
      const daily = dates.map((date) => ({ date, count: byDate.get(date)?.count ?? 0, gross: byDate.get(date)?.gross ?? 0 }));
      salesOut = {
        statusesCounted: [...PAID_MEMBERSHIP_STATUSES],
        dateBasis: 'PURCHASE_DATE',
        total: { count: daily.reduce((s, d) => s + d.count, 0), gross: daily.reduce((s, d) => s + d.gross, 0) },
        daily,
        byPlan: perPlan,
      };
    }

    let renewal: GymAnalytics['renewal'] = null;
    if (renewalRaw) {
      const [c, nvr] = renewalRaw;
      const byDate = new Map(nvr.map((r) => [r.date, r]));
      const daily = dates.map((date) => ({ date, new: byDate.get(date)?.newCount ?? 0, returning: byDate.get(date)?.returningCount ?? 0 }));
      const settledNotRenewed = c.matured - c.maturedRenewed;
      renewal = {
        windowDays: RENEWAL_WINDOW_DAYS,
        scope: 'BRAND',
        ended: c.ended,
        renewed: c.renewed,
        renewedSameBranch: c.renewedSameBranch,
        settled: c.matured,
        settledRenewed: c.maturedRenewed,
        open: c.ended - c.renewed - settledNotRenewed,
        rate: ratio(c.renewed, c.ended),
        settledRate: ratio(c.maturedRenewed, c.matured),
        newVsReturning: {
          newMembers: daily.reduce((s, d) => s + d.new, 0),
          returningMembers: daily.reduce((s, d) => s + d.returning, 0),
          daily,
        },
      };
    }

    let netIncome: GymAnalytics['netIncome'] = null;
    if (visibility.netIncome) {
      if (!income) {
        unavailable.push('netIncome');
      } else {
        const byDate = new Map(income.daily.map((d) => [d.date, d]));
        const zero = { sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: 0, net: 0 };
        netIncome = {
          source: 'PAYMENT_LEDGER',
          walletFound: income.walletFound,
          dateBasis: 'LEDGER_ENTRY_DATE',
          totals: income.totals,
          daily: dates.map((date) => ({ date, ...(byDate.get(date) ?? zero) })),
        };
      }
    }

    return { gymId, timeZone: APP_TIME_ZONE, from: range.from, to: range.to, today: localDateOf(now), heatmap, sales: salesOut, renewal, netIncome, unavailable };
  },
};
