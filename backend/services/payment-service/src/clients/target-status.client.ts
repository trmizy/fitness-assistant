/**
 * FH-4 - short-timeout, BATCHED, read-only client for the owning services' status facts:
 *   gym-service  POST /internal/gym-memberships/status                      { ids }  -> [{ id, status, paymentTxnId, validUntil }]
 *   ai-service   POST /internal/personalized-service/orders/status          { ids }  -> [{ id, status, paymentTransactionId, cumulativeRefundedAmount }]
 *                (PARTNER-OWNED service: the route does not exist yet, so this call is OFF unless AI_ORDER_STATUS_LOOKUP=true;
 *                 until then personalized orders stay in "pending verification". Spec for the partner: see the FH-4 handoff.)
 *
 * Used as `lookupTargetStatus` by the admin reconciliation report (see activated-but-cancelled-target.query.ts):
 * `prime()` fetches every candidate in <= ceil(n/100) calls per service (in parallel), then the per-row lookup is a map
 * read. Anything that goes wrong (timeout, 5xx, 401, bad shape, id not found at the owner) leaves the row unresolved, and
 * the lookup then THROWS for it, which the classifier reports as "pending verification" - never as cancelled, never as OK.
 * No personal data is requested or kept: only status facts and the refunded amount.
 */
import { postServiceJson } from './service-lambda.client';
import type { TargetRef, TargetStatusLookup } from '../services/activated-but-cancelled-target.query';

export const TARGET_STATUS_BATCH = 100;
export const TARGET_STATUS_DEFAULT_TIMEOUT_MS = 3000;

interface Fact {
  status: string;
  refunded: number | null;
}

const SERVICE_FOR: Record<string, { service: 'gym' | 'ai'; path: string; enabled: () => boolean }> = {
  GYM_MEMBERSHIP: { service: 'gym', path: '/internal/gym-memberships/status', enabled: () => true },
  PERSONALIZED_SERVICE_PURCHASE: {
    service: 'ai',
    path: '/internal/personalized-service/orders/status',
    enabled: () => process.env.AI_ORDER_STATUS_LOOKUP === 'true',
  },
};

export function targetStatusTimeoutMs(): number {
  const n = Number.parseInt(process.env.TARGET_STATUS_LOOKUP_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : TARGET_STATUS_DEFAULT_TIMEOUT_MS;
}

function secretHeaders(): Record<string, string> {
  return { 'x-service-secret': process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production' };
}

/** Hard deadline around one batch call (the lambda transport has no timeout of its own). */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('target status lookup timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function createTargetStatusLookup(opts: { timeoutMs?: number } = {}): TargetStatusLookup {
  const timeoutMs = opts.timeoutMs ?? targetStatusTimeoutMs();
  const facts = new Map<string, Fact>();
  const key = (t: { relatedEntityType: string; relatedEntityId: string }) => `${t.relatedEntityType}:${t.relatedEntityId}`;

  async function fetchBatch(type: string, ids: string[]): Promise<void> {
    const cfg = SERVICE_FOR[type];
    try {
      const res = await withDeadline(
        postServiceJson({ service: cfg.service, path: cfg.path, body: { ids }, headers: secretHeaders(), timeoutMs }),
        timeoutMs + 250,
      );
      const rows: unknown = res?.data;
      if (!Array.isArray(rows)) return;
      for (const r of rows as Array<Record<string, unknown>>) {
        if (typeof r?.id !== 'string' || typeof r?.status !== 'string') continue;
        const refunded = typeof r.cumulativeRefundedAmount === 'number' && Number.isFinite(r.cumulativeRefundedAmount) ? r.cumulativeRefundedAmount : null;
        facts.set(`${type}:${r.id}`, { status: r.status, refunded: type === 'PERSONALIZED_SERVICE_PURCHASE' ? refunded : null });
      }
    } catch {
      // timeout / network / 4xx / 5xx: these ids stay unresolved -> pending verification
    }
  }

  const lookup = (async (txn: TargetRef) => {
    const f = facts.get(key(txn));
    if (!f) throw new Error('target status unavailable');
    return f.status;
  }) as TargetStatusLookup;

  lookup.prime = async (txns: TargetRef[]) => {
    const byType = new Map<string, Set<string>>();
    for (const t of txns) {
      if (!SERVICE_FOR[t.relatedEntityType]?.enabled() || facts.has(key(t))) continue;
      if (!byType.has(t.relatedEntityType)) byType.set(t.relatedEntityType, new Set());
      byType.get(t.relatedEntityType)!.add(t.relatedEntityId);
    }
    const calls: Promise<void>[] = [];
    for (const [type, set] of byType) {
      const all = [...set];
      for (let i = 0; i < all.length; i += TARGET_STATUS_BATCH) calls.push(fetchBatch(type, all.slice(i, i + TARGET_STATUS_BATCH)));
    }
    await Promise.all(calls);
  };

  lookup.ownerRefundedAmount = (txn: TargetRef) => facts.get(key(txn))?.refunded ?? null;
  return lookup;
}
