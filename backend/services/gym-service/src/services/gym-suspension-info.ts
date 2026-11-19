import { prisma } from '../repositories/prisma';

/**
 * N15C-08 — what the branch's OWNER / MANAGER sees about an admin suspension: the reason the admin typed and when. The reason
 * lives only on the PartnerAuditLog row written by gymAdminLifecycleService (action GYM_ADMIN_STATUS_CHANGED, metadata.lifecycleAction
 * SUSPEND); the gyms table has no such column, so it is read here (no schema change). A suspension made before that audit row
 * existed has no row -> reason null (the UI then shows the status without a reason).
 */
export interface AdminSuspensionInfo {
  reason: string | null;
  at: string;
}

/** gymId -> latest SUSPEND of that branch. Pass only branches whose status is SUSPENDED (a later LIFT_SUSPENSION makes the old row irrelevant). */
export async function adminSuspensionInfoFor(gymIds: string[]): Promise<Map<string, AdminSuspensionInfo>> {
  const out = new Map<string, AdminSuspensionInfo>();
  if (gymIds.length === 0) return out;
  const rows = await prisma.$queryRaw<Array<{ gym_id: string; reason: string | null; created_at: Date }>>`
    SELECT DISTINCT ON (metadata->>'gymId') metadata->>'gymId' AS gym_id, reason, created_at
    FROM partner_audit_logs
    WHERE action = 'GYM_ADMIN_STATUS_CHANGED'::"PartnerAuditAction"
      AND metadata->>'lifecycleAction' = 'SUSPEND'
      AND metadata->>'gymId' = ANY(${gymIds}::text[])
    ORDER BY metadata->>'gymId', created_at DESC`;
  for (const r of rows) out.set(r.gym_id, { reason: r.reason, at: new Date(r.created_at).toISOString() });
  return out;
}

/** Adds adminSuspensionReason / adminSuspendedAt to every SUSPENDED row (other rows untouched). */
export async function withAdminSuspension<T extends { id: string; status?: string }>(rows: T[]): Promise<Array<T & { adminSuspensionReason?: string | null; adminSuspendedAt?: string | null }>> {
  const suspended = rows.filter((r) => r.status === 'SUSPENDED').map((r) => r.id);
  if (suspended.length === 0) return rows;
  const info = await adminSuspensionInfoFor(suspended);
  return rows.map((r) => {
    if (r.status !== 'SUSPENDED') return r;
    const i = info.get(r.id);
    return { ...r, adminSuspensionReason: i?.reason ?? null, adminSuspendedAt: i?.at ?? null };
  });
}
