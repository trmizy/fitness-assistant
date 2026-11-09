/**
 * E5 (Ngài, 05/11/2026) - the FORMAL obligation after a WON APPEAL.
 *
 * user-service creates it ONLY when the approved appeal finding established BOTH an amount and a responsible party (validated there against the finding, never free text); otherwise the consequence
 * stays NEEDS_RECONCILIATION and nothing is created here. This module:
 *   - works from THAT contract's own context: the payment transaction must be a PT_CONTRACT payment whose related entity IS the contract the request names, must be PAID, and the amount must not
 *     exceed what the contract was paid;
 *   - writes ONE obligation (kind APPEAL_AWARD, owed to the CLIENT, owed = amount, paid 0, status OPEN, responsible_party, source_ref = the consequence) and ONE append-only event, in one transaction;
 *   - is IDEMPOTENT on APPEAL_OBLIGATION:<consequenceId>: the same request replays the stored obligation, the same key with a different body is refused 409 (never a second obligation, never overwritten);
 *   - moves NO money: no wallet, ledger entry, ledger operation, PartnerReceivable or holdback is touched. It cannot be paid by this module; it is settled by the existing FH-8 lifecycle
 *     (verified external payment) or by a decision of a person, exactly like every other unpaid obligation.
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

export class AppealObligationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AppealObligationParams {
  transactionId: string;
  contractId: string;
  consequenceId: string;
  caseId: string;
  appealId: string;
  amount: string;
  responsibleParty: 'PT' | 'GYM' | 'PLATFORM';
  decidedBy: string;
  reason: string;
}

const keyOf = (consequenceId: string) => `APPEAL_OBLIGATION:${consequenceId}`;
const view = (o: { id: string; key: string; status: string; owed: Prisma.Decimal; paid: Prisma.Decimal; unpaid: Prisma.Decimal; transactionId: string; responsibleParty: string | null; sourceRef: string | null }) => ({
  obligationId: o.id,
  key: o.key,
  status: o.status,
  owed: o.owed.toFixed(2),
  paid: o.paid.toFixed(2),
  unpaid: o.unpaid.toFixed(2),
  transactionId: o.transactionId,
  responsibleParty: o.responsibleParty,
  consequenceId: o.sourceRef,
});

export async function createAppealAwardObligation(p: AppealObligationParams) {
  const key = keyOf(p.consequenceId);
  const amount = new Prisma.Decimal(p.amount);
  const existing = await prisma.contractUnpaidObligation.findUnique({ where: { key } });
  const sameAs = (o: NonNullable<typeof existing>) => o.transactionId === p.transactionId && o.owed.equals(amount) && o.responsibleParty === p.responsibleParty && o.kind === 'APPEAL_AWARD';
  if (existing) {
    if (!sameAs(existing)) throw new AppealObligationError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'An obligation for this consequence already exists with different terms; nothing was changed.');
    return { created: false, ...view(existing) };
  }
  const txn = await prisma.paymentTransaction.findUnique({ where: { id: p.transactionId }, select: { id: true, status: true, amount: true, relatedEntityType: true, relatedEntityId: true } });
  if (!txn || txn.relatedEntityType !== 'PT_CONTRACT' || txn.relatedEntityId !== p.contractId) {
    throw new AppealObligationError(422, 'CONTRACT_MISMATCH', 'The payment transaction is not the PT-contract payment of the contract named in the request; nothing was created.');
  }
  if (txn.status !== 'PAID' && txn.status !== 'REFUNDED') {
    throw new AppealObligationError(409, 'PAYMENT_NOT_PAID', 'The contract payment was never paid; there is nothing to owe back. Nothing was created.');
  }
  if (amount.greaterThan(txn.amount)) {
    throw new AppealObligationError(422, 'AMOUNT_EXCEEDS_PAYMENT', 'The established amount is greater than what the contract was paid; nothing was created.');
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.contractUnpaidObligation.create({
        data: {
          key,
          transactionId: p.transactionId,
          contractRef: p.contractId,
          kind: 'APPEAL_AWARD',
          party: 'CLIENT',
          owed: amount,
          paid: new Prisma.Decimal(0),
          unpaid: amount,
          reason: p.reason,
          responsibleParty: p.responsibleParty,
          sourceRef: p.consequenceId,
        },
      });
      await tx.contractUnpaidObligationEvent.create({
        data: {
          obligationId: row.id,
          action: 'CREATE_FROM_APPEAL',
          note: `appeal ${p.appealId} of case ${p.caseId}: ${p.reason}`.slice(0, 2000),
          actor: p.decidedBy,
          approvalRef: p.consequenceId,
          idempotencyKey: `APPEAL_OBLIGATION_EVENT:${p.consequenceId}`,
          fromStatus: 'OPEN',
          toStatus: 'OPEN',
          unpaid: amount,
        },
      });
      return { created: true, ...view(row) };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await prisma.contractUnpaidObligation.findUnique({ where: { key } });
      if (again && sameAs(again)) return { created: false, ...view(again) };
      throw new AppealObligationError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'An obligation for this consequence already exists with different terms; nothing was changed.');
    }
    throw e;
  }
}

/** READ-ONLY: the live obligation of a consequence, or {found:false}. */
export async function readAppealAwardObligation(consequenceId: string) {
  const o = await prisma.contractUnpaidObligation.findUnique({ where: { key: keyOf(consequenceId) } });
  return o ? { found: true as const, ...view(o) } : { found: false as const };
}
