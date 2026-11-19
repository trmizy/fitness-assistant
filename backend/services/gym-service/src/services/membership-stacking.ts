/**
 * Membership stacking ("Gia hạn", owner rule 19/11/2026) - the ONE place the period of a bought membership is decided.
 *
 *   start = the end of the client's latest paid membership of the same brand, when that is still in the future; else now.
 *   end   = start + the plan's duration (snapshotted on the membership, whole 24 h days - Vietnam has no DST).
 *
 * So a renewal bought while a membership still runs begins the instant the old one ends: no overlap, no lost day.
 * Used by `membershipRepository.activateIfPending` (the real, locked decision at the moment payment lands) and by
 * `membershipService.purchase` (the projection returned to the buyer before they pay - the real one can only be
 * identical or later if the old membership changes in between).
 *
 * MONEY: nothing here moves money. The price of a stacked membership sits in escrow / the gym's and platform's PENDING
 * bucket from the payment, exactly like a first purchase, and is released by the payout sweep only after THIS row's own
 * endDate (status EXPIRED) - so a stacked membership is paid out at the end of ITS OWN period, never at the end of the
 * one it queues behind and never at purchase.
 */
export const MEMBERSHIP_DAY_MS = 24 * 60 * 60 * 1000;

export function stackedPeriod(now: Date, latestEnd: Date | null | undefined, durationDays: number): { startDate: Date; endDate: Date; isRenewal: boolean } {
  const isRenewal = !!latestEnd && latestEnd.getTime() > now.getTime();
  const startDate = isRenewal ? new Date(latestEnd!.getTime()) : new Date(now.getTime());
  return { startDate, endDate: new Date(startDate.getTime() + durationDays * MEMBERSHIP_DAY_MS), isRenewal };
}
