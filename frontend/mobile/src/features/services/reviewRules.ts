/**
 * 14B.6 (PG-B2) — who may review a gym: someone who holds or held a membership there. ACTIVE (current
 * member) and EXPIRED (used to be one) count; a CANCELLED or never-paid one does not — gym-service's
 * NOT_A_MEMBER rule, which web's GymReviewsSection mirrors.
 */
export function canReviewGym(memberships: unknown, gymId: string): boolean {
  const list: any[] = Array.isArray(memberships) ? memberships : ((memberships as any)?.data ?? []);
  return list.some((m) => m?.gymId === gymId && (m.status === "ACTIVE" || m.status === "EXPIRED"));
}
