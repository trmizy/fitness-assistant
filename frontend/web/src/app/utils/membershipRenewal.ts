/**
 * Membership renewal ("Gia hạn") - what a client sees BEFORE paying for another plan at a brand they already belong to.
 *
 * The server is the authority: gym-service starts a bought plan when the client's latest paid membership of the brand ends
 * (stacking, decided when the payment lands; no overlap, no lost day). This file only PROJECTS that for display - the dates it
 * prints are "dự kiến" and can only be the same or later if the old membership changes in between.
 *
 * Also the PT-contract hint: a plan "covers" a PT contract when the membership, once this plan is added, still runs on the last
 * day of the contract. It is a hint to sort and badge plans, never a requirement (owner rule 19/11/2026).
 *
 * Kept byte-identical with frontend/mobile/src/features/services/membershipRenewal.ts.
 */

export const RENEWAL_DAY_MS = 24 * 60 * 60 * 1000;

/** The fields of a `GET /me/gym-memberships` row this file reads. */
export type MembershipRowLike = {
  gymId?: string | null;
  status?: string | null;
  endDate?: string | null;
};

export type RenewalProjection = {
  /** The client already has a running (or queued) membership at the brand: this purchase is a renewal. */
  isRenewal: boolean;
  startsAt: Date;
  endsAt: Date;
};

const toDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * End of the client's latest paid (ACTIVE, current or queued) membership among the given branches of one brand, or null when they
 * have none still running. A row with no end date is ignored (a plan always has an end date; an unreadable one proves nothing).
 */
export function latestMembershipEnd(
  rows: ReadonlyArray<MembershipRowLike> | null | undefined,
  gymIds: ReadonlyArray<string>,
  now: Date = new Date(),
): Date | null {
  const ids = new Set(gymIds);
  let best: Date | null = null;
  for (const r of rows ?? []) {
    if (r?.status !== "ACTIVE" || !r.gymId || !ids.has(r.gymId)) continue;
    const end = toDate(r.endDate);
    if (!end || end.getTime() <= now.getTime()) continue;
    if (!best || end.getTime() > best.getTime()) best = end;
  }
  return best;
}

/** Where a plan of `durationDays` would run if bought now, given the end of the latest running membership. */
export function projectRenewal(latestEnd: Date | null, durationDays: number, now: Date = new Date()): RenewalProjection {
  const isRenewal = !!latestEnd && latestEnd.getTime() > now.getTime();
  const startsAt = isRenewal ? new Date(latestEnd!.getTime()) : new Date(now.getTime());
  return { isRenewal, startsAt, endsAt: new Date(startsAt.getTime() + durationDays * RENEWAL_DAY_MS) };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "19/12/2026" */
export function renewalDate(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** The line shown under a plan before payment. A first purchase shows only the end date. */
export function renewalCaption(p: RenewalProjection): string {
  return p.isRenewal
    ? `Gia hạn: dùng tiếp từ ${renewalDate(p.startsAt)}, hết hạn ${renewalDate(p.endsAt)}`
    : `Hết hạn dự kiến ${renewalDate(p.endsAt)}`;
}

/** Does the membership, with this plan added, still run through `coverUntil` (the last day of the PT contract)? No date = no hint. */
export function planCoversContract(p: RenewalProjection, coverUntil: Date | null): boolean {
  return !!coverUntil && p.endsAt.getTime() >= coverUntil.getTime();
}

export const PLAN_COVERS_CONTRACT_LABEL = "Đủ cho hợp đồng PT";

/** Plans that cover the PT contract first, then the rest; each group keeps the server's order (stable). Without a contract date: unchanged. */
export function sortPlansCoveringFirst<T extends { durationDays: number }>(
  plans: ReadonlyArray<T>,
  latestEnd: Date | null,
  coverUntil: Date | null,
  now: Date = new Date(),
): T[] {
  if (!coverUntil) return [...plans];
  const covers = (pl: T) => planCoversContract(projectRenewal(latestEnd, pl.durationDays, now), coverUntil);
  return [...plans.filter(covers), ...plans.filter((pl) => !covers(pl))];
}

/** The code user-service answers (422) when a booked or moved session falls on a day the client's gym membership does not cover. */
export const SESSION_NOT_COVERED_BY_MEMBERSHIP = "SESSION_NOT_COVERED_BY_MEMBERSHIP";

export type MembershipNotCovered = { message: string; gymId: string | null };

/**
 * Is this (axios) error a "no membership on that day" refusal? Reads the single-booking / reschedule shape
 * `{ error, code, details: { gymId } }` and the batch shape (`slotErrors[]` rows carrying the same code). `fallbackGymId` (the
 * contract's gym) fills in when the server body has no gym. null for every other error.
 */
export function readMembershipNotCovered(error: unknown, fallbackGymId?: string | null): MembershipNotCovered | null {
  const data = (error as any)?.response?.data;
  if (!data || typeof data !== "object") return null;
  const gymOf = (details: any): string | null => (typeof details?.gymId === "string" && details.gymId ? details.gymId : fallbackGymId || null);
  if (data.code === SESSION_NOT_COVERED_BY_MEMBERSHIP) {
    return { message: typeof data.error === "string" && data.error ? data.error : "Gói hội viên của bạn không có hiệu lực vào ngày này.", gymId: gymOf(data.details) };
  }
  if (Array.isArray(data.slotErrors)) {
    const row = data.slotErrors.find((r: any) => r?.code === SESSION_NOT_COVERED_BY_MEMBERSHIP);
    if (row) {
      return { message: typeof row.error === "string" && row.error ? row.error : "Gói hội viên của bạn không có hiệu lực vào ngày này.", gymId: gymOf(row.details) };
    }
  }
  return null;
}
