import { Request, Response } from 'express';
import { prisma } from '../repositories/prisma';

/**
 * FH-4 - READ-ONLY status facts about gym memberships, for payment-service's reconciliation report.
 * Returns ONLY { id, status, paymentTxnId, validUntil }: no client id, no gym id, no price, no free text.
 * Mounted under the service-secret router (internal.routes.ts). Never writes.
 */
export const INTERNAL_STATUS_MAX_BATCH = 100;

const SELECT = { id: true, status: true, paymentTxnId: true, endDate: true } as const;

function toFact(m: { id: string; status: string; paymentTxnId: string | null; endDate: Date | null }) {
  return { id: m.id, status: m.status, paymentTxnId: m.paymentTxnId, validUntil: m.endDate ? m.endDate.toISOString() : null };
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 100);

export const internalStatusController = {
  /** GET /internal/gym-memberships/by-transaction/:txnId -> 200 { success, data: fact } | 404 */
  async byTransaction(req: Request, res: Response) {
    const rows = await prisma.gymMembershipContract.findMany({
      where: { paymentTxnId: req.params.txnId },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No membership for this transaction' } });
      return;
    }
    res.json({ success: true, data: toFact(rows[0]) });
  },

  /** POST /internal/gym-memberships/status { ids?: string[], txnIds?: string[] } (<= 100 each, at least one) */
  async batchStatus(req: Request, res: Response) {
    const { ids, txnIds } = req.body ?? {};
    const hasIds = ids !== undefined;
    const hasTxn = txnIds !== undefined;
    if ((!hasIds && !hasTxn) || (hasIds && !isStringList(ids)) || (hasTxn && !isStringList(txnIds))) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'ids / txnIds must be non-empty string arrays' } });
      return;
    }
    const idList: string[] = hasIds ? ids : [];
    const txnList: string[] = hasTxn ? txnIds : [];
    if (idList.length > INTERNAL_STATUS_MAX_BATCH || txnList.length > INTERNAL_STATUS_MAX_BATCH || idList.length + txnList.length === 0) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: `1..${INTERNAL_STATUS_MAX_BATCH} ids / txnIds per call` } });
      return;
    }
    const rows = await prisma.gymMembershipContract.findMany({
      where: { OR: [...(idList.length ? [{ id: { in: idList } }] : []), ...(txnList.length ? [{ paymentTxnId: { in: txnList } }] : [])] },
      select: SELECT,
    });
    res.json({ success: true, data: rows.map(toFact) });
  },
};
