import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';

/**
 * FH-2a. Read-only lookup of the ledger's idempotency records, mounted under `/internal/ledger-operations`
 * (behind the service-secret middleware of the internal router; the gateway does not proxy it).
 *
 * It answers one question for a caller that lost a response or is reconciling: "did payment-service
 * already do the operation with this business key, and what was the result?". It never writes: every
 * read runs in a READ ONLY transaction, so the guarantee is the database's, not just this file's.
 *
 *   GET  /internal/ledger-operations/:key                  200 {key, kind, transactionId, result, createdAt, fingerprinted, obligation?} | 404
 *   POST /internal/ledger-operations/lookup  {keys[<=100]} 200 {operations[], missing[]}
 *
 * `obligation` ({id, status, owed, paid, unpaid}) is present when the operation's stored result names an `obligationId`: the LIVE
 * status of the unpaid obligation (OPEN / RESOLVED / WAIVED), so a caller that shows the client how much was refunded can tell a
 * still-open shortfall from one an authorised person has since handled. List responses do not carry it.
 *   GET  /internal/ledger-operations?prefix&since&cursor&limit<=200   200 {operations[], nextCursor}
 */
const router = Router();

const MAX_LOOKUP_KEYS = 100;
const MAX_PAGE = 200;

/** Business-key prefix -> operation kind, for rows written before the `kind` column existed. */
const KIND_BY_PREFIX: Record<string, string> = {
  SESSION_RELEASE: 'RELEASE_SESSION',
  PT_NO_SHOW: 'NO_SHOW',
  PT_LATE_ARRIVAL: 'LATE_ARRIVAL',
  CONTRACT_TERMINATE: 'TERMINATE',
  UNRESOLVED_SESSION: 'RESOLVE_UNRESOLVED',
  HOLDBACK_RELEASE: 'RELEASE_HOLDBACK',
  CONTRACT_UNACTIVATED_REFUND: 'UNACTIVATED_REFUND',
  MEMBERSHIP_REFERRAL: 'MEMBERSHIP_REFERRAL',
  REFERRAL_CLAWBACK: 'REFERRAL_CLAWBACK',
  MEMBERSHIP_RELEASE: 'MEMBERSHIP_RELEASE',
  PERSONALIZED_RELEASE: 'PERSONALIZED_RELEASE',
  PERSONALIZED_REFUND: 'PERSONALIZED_REFUND',
  WITHDRAWAL: 'WITHDRAWAL',
  WITHDRAWAL_LOCK: 'WITHDRAWAL_LOCK',
  WITHDRAWAL_UNLOCK: 'WITHDRAWAL_UNLOCK',
};

type Row = {
  key: string;
  kind: string | null;
  transactionId: string | null;
  result: unknown;
  createdAt: Date;
  requestFingerprint: string | null;
};

type ObligationView = { id: string; status: string; owed: string; paid: string; unpaid: string };

function present(r: Row, obligations?: Map<string, ObligationView>) {
  const prefix = r.key.split(':')[0];
  const obligationId = (r.result as { obligationId?: unknown } | null)?.obligationId;
  const obligation = typeof obligationId === 'string' ? obligations?.get(obligationId) : undefined;
  return {
    key: r.key,
    kind: r.kind ?? KIND_BY_PREFIX[prefix] ?? null,
    transactionId: r.transactionId,
    result: r.result,
    createdAt: r.createdAt.toISOString(),
    fingerprinted: r.requestFingerprint !== null,
    ...(obligation ? { obligation } : {}),
  };
}

type ReadTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The live status of the obligations the given rows' results point at (one query, same READ ONLY transaction). */
async function obligationsOf(tx: ReadTx, rows: Row[]): Promise<Map<string, ObligationView>> {
  const ids = [...new Set(rows.map((r) => (r.result as { obligationId?: unknown } | null)?.obligationId).filter((v): v is string => typeof v === 'string'))];
  if (ids.length === 0) return new Map();
  const found = await tx.contractUnpaidObligation.findMany({ where: { id: { in: ids } } });
  return new Map(
    found.map((o) => [o.id, { id: o.id, status: o.status, owed: o.owed.toFixed(2), paid: o.paid.toFixed(2), unpaid: o.unpaid.toFixed(2) }]),
  );
}

/** Runs `fn` in a READ ONLY transaction: any write attempted inside is rejected by Postgres. */
async function readOnly<T>(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return fn(tx);
  });
}

const lookupSchema = z.object({ keys: z.array(z.string().min(1).max(300)).min(1).max(MAX_LOOKUP_KEYS) });

router.post('/lookup', async (req: Request, res: Response) => {
  const parsed = lookupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const keys = [...new Set(parsed.data.keys)];
  try {
    const { rows, obligations } = await readOnly(async (tx) => {
      const rows = await tx.ledgerOperation.findMany({ where: { key: { in: keys } } });
      return { rows, obligations: await obligationsOf(tx, rows) };
    });
    const found = new Set(rows.map((r) => r.key));
    logger.info(`[LedgerLookup] ${keys.length} key(s) asked, ${rows.length} found`);
    return res.json({
      success: true,
      data: { operations: rows.map((r) => present(r, obligations)), missing: keys.filter((k) => !found.has(k)) },
    });
  } catch (err) {
    logger.error({ error: 'ledger-operations lookup failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'LOOKUP_FAILED' } });
  }
});

const listSchema = z.object({
  prefix: z.string().max(300).optional(),
  since: z.string().datetime().optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
});

router.get('/', async (req: Request, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  }
  const { prefix, since, cursor, limit } = parsed.data;
  try {
    const rows = await readOnly((tx) =>
      tx.ledgerOperation.findMany({
        where: {
          ...(prefix ? { key: { startsWith: prefix } } : {}),
          ...(since ? { createdAt: { gte: new Date(since) } } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    const page = rows.slice(0, limit);
    logger.info(`[LedgerLookup] list prefix=${prefix ?? '*'} returned ${page.length}`);
    return res.json({
      success: true,
      data: { operations: page.map((r) => present(r)), nextCursor: rows.length > limit ? (rows[limit - 1] as unknown as { id: string }).id : null },
    });
  } catch (err) {
    logger.error({ error: 'ledger-operations list failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'LOOKUP_FAILED' } });
  }
});

router.get('/:key', async (req: Request, res: Response) => {
  try {
    const { row, obligations } = await readOnly(async (tx) => {
      const row = await tx.ledgerOperation.findUnique({ where: { key: req.params.key } });
      return { row, obligations: row ? await obligationsOf(tx, [row]) : undefined };
    });
    if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    logger.info('[LedgerLookup] 1 key asked, 1 found');
    return res.json({ success: true, data: present(row, obligations) });
  } catch (err) {
    logger.error({ error: 'ledger-operations get failed', message: (err as Error).message });
    return res.status(500).json({ success: false, error: { code: 'LOOKUP_FAILED' } });
  }
});

export default router;
