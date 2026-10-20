/**
 * FH-8 - audited, idempotent adjustment operations (no HTTP route; driven only by scripts/fh8-adjust.ts).
 *
 *   PartnerReceivable:            suspend | resume | waive (part or all of the outstanding amount)
 *   ContractUnpaidObligation:     resolve | waive         (status change + event; NO money moves)
 *
 * Invariants (each is asserted by fh8-adjustments.integration.test.ts):
 *  - history is never deleted or rewritten: every change appends a row to an append-only event table (a DB trigger also
 *    rejects UPDATE/DELETE on those tables); `recovered` is never touched; nothing is ever marked paid;
 *  - compare-and-set: the operator passes the amount and the payment transaction id they were shown/approved. If the live
 *    row differs the operation is refused (CAS_MISMATCH) and nothing is written;
 *  - idempotent by business key `<OP>:<row id>:<approvalRef>`: running the same approval twice applies once and replays
 *    the second time (REPLAYED); a different approval on an already-adjusted row is refused by the state rules;
 *  - no wallet / ledger_entries / ledger_operations row is written, so the escrow invariant is untouched.
 *
 * Waiving: `waived` is the part of `amount` the platform bears. When recovered + waived >= amount the row is closed
 * (`settledAt` set) exactly like a fully recovered row, but `waived` (and the event) say it was not paid by the partner.
 * NOTE for the collector (contract-ledger.service `recoverReceivables`): it reads `settledAt: null` and `amount - recovered`.
 * A fully waived row is therefore already skipped; a PARTIAL waive or a SUSPENDED row is only honoured there once that
 * query also filters `suspendedAt: null` and uses `amount - recovered - waived` (D62 C.4 item 1). Until then, suspend/
 * partial-waive take effect for reporting and for the FH-0 switch-off, not for a switched-on collector.
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

export type AdjustmentOutcome = 'APPLIED' | 'REPLAYED' | 'DRY_RUN';

export class AdjustmentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AdjustmentError';
  }
}

export interface AdjustmentResult {
  outcome: AdjustmentOutcome;
  /** Idempotency key of the operation. */
  key: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  eventId?: string;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal.Value) => D(v).toFixed(2);

/** Operator-supplied compare-and-set values. `expectedTransactionId` is the literal NONE for rows with no transaction. */
export interface ReceivableCas {
  receivableId: string;
  expectedAmount: string;
  expectedTransactionId: string;
}

interface CommonAudit {
  reason: string;
  approvedBy: string;
  approvalRef: string;
}

type ReceivableRow = {
  id: string;
  partnerType: string;
  amount: Prisma.Decimal;
  recovered: Prisma.Decimal;
  waived: Prisma.Decimal;
  transactionId: string | null;
  settledAt: Date | null;
  suspendedAt: Date | null;
};

function requireText(name: string, v: string, min: number): string {
  const t = (v ?? '').trim();
  if (t.length < min) throw new AdjustmentError('INVALID_INPUT', `${name} is required (at least ${min} characters).`);
  return t;
}

function receivableSnapshot(r: ReceivableRow): Record<string, unknown> {
  return {
    amount: money(r.amount),
    recovered: money(r.recovered),
    waived: money(r.waived),
    outstanding: money(r.amount.minus(r.recovered).minus(r.waived)),
    transactionId: r.transactionId,
    settled: r.settledAt !== null,
    suspended: r.suspendedAt !== null,
  };
}

function assertReceivableCas(r: ReceivableRow, cas: ReceivableCas): void {
  let expected: Prisma.Decimal;
  try {
    expected = D(cas.expectedAmount);
  } catch {
    throw new AdjustmentError('INVALID_INPUT', 'expectedAmount is not a number.');
  }
  if (!r.amount.equals(expected)) {
    throw new AdjustmentError('CAS_MISMATCH', `Receivable amount is ${money(r.amount)}, expected ${money(expected)}. Nothing changed.`);
  }
  const live = r.transactionId ?? 'NONE';
  if (live !== cas.expectedTransactionId) {
    throw new AdjustmentError('CAS_MISMATCH', 'Receivable transaction id does not match the approved one. Nothing changed.');
  }
}

type ReceivableAction = 'SUSPEND' | 'RESUME' | 'WAIVE';

interface ReceivablePlan {
  data: Prisma.PartnerReceivableUpdateManyMutationInput;
  eventAmount: Prisma.Decimal;
  after: Record<string, unknown>;
}

/** Pure decision: what the row would become, or the reason it cannot. */
export function planReceivableChange(
  row: ReceivableRow,
  action: ReceivableAction,
  audit: CommonAudit,
  waiveAmount?: string,
  now: Date = new Date(),
): ReceivablePlan {
  if (row.settledAt) throw new AdjustmentError('ALREADY_SETTLED', 'This receivable is already closed; nothing to adjust.');
  const outstanding = row.amount.minus(row.recovered).minus(row.waived);
  if (action === 'SUSPEND') {
    if (row.suspendedAt) throw new AdjustmentError('ALREADY_SUSPENDED', 'This receivable is already suspended.');
    return {
      data: { suspendedAt: now, suspendedBy: audit.approvedBy, suspensionReason: audit.reason, suspensionRef: audit.approvalRef },
      eventAmount: outstanding,
      after: { ...receivableSnapshot(row), suspended: true },
    };
  }
  if (action === 'RESUME') {
    if (!row.suspendedAt) throw new AdjustmentError('NOT_SUSPENDED', 'This receivable is not suspended.');
    return {
      data: { suspendedAt: null, suspendedBy: null, suspensionReason: null, suspensionRef: null },
      eventAmount: outstanding,
      after: { ...receivableSnapshot(row), suspended: false },
    };
  }
  let w: Prisma.Decimal;
  try {
    w = D(waiveAmount ?? '');
  } catch {
    throw new AdjustmentError('INVALID_INPUT', 'waive amount is not a number.');
  }
  if (w.lessThanOrEqualTo(0)) throw new AdjustmentError('INVALID_INPUT', 'waive amount must be greater than 0.');
  if (w.greaterThan(outstanding)) {
    throw new AdjustmentError('WAIVE_EXCEEDS_OUTSTANDING', `Waive ${money(w)} exceeds the outstanding ${money(outstanding)}.`);
  }
  const newWaived = row.waived.plus(w);
  const closes = row.recovered.plus(newWaived).greaterThanOrEqualTo(row.amount);
  return {
    data: {
      waived: newWaived,
      waivedAt: now,
      waivedBy: audit.approvedBy,
      waiveReason: audit.reason,
      waiveRef: audit.approvalRef,
      ...(closes ? { settledAt: now } : {}),
    },
    eventAmount: w,
    after: {
      ...receivableSnapshot({ ...row, waived: newWaived, settledAt: closes ? now : null }),
    },
  };
}

const KEY_PREFIX: Record<ReceivableAction, string> = {
  SUSPEND: 'RECEIVABLE_SUSPEND',
  RESUME: 'RECEIVABLE_RESUME',
  WAIVE: 'RECEIVABLE_WAIVE',
};

export interface ReceivableAdjustInput extends ReceivableCas, CommonAudit {
  action: ReceivableAction;
  /** WAIVE only: the amount to forgive (0 < amount <= outstanding). */
  waiveAmount?: string;
  dryRun: boolean;
}

export async function adjustReceivable(input: ReceivableAdjustInput): Promise<AdjustmentResult> {
  const reason = requireText('reason', input.reason, 5);
  const approvedBy = requireText('approvedBy', input.approvedBy, 2);
  const approvalRef = requireText('approvalRef', input.approvalRef, 2);
  const audit = { reason, approvedBy, approvalRef };
  const key = `${KEY_PREFIX[input.action]}:${input.receivableId}:${approvalRef}`;

  const read = async (db: Pick<typeof prisma, 'partnerReceivable'>): Promise<ReceivableRow> => {
    const r = await db.partnerReceivable.findUnique({ where: { id: input.receivableId } });
    if (!r) throw new AdjustmentError('NOT_FOUND', 'No such receivable.');
    return {
      id: r.id,
      partnerType: r.partnerType,
      amount: D(r.amount),
      recovered: D(r.recovered),
      waived: D(r.waived),
      transactionId: r.transactionId,
      settledAt: r.settledAt,
      suspendedAt: r.suspendedAt,
    };
  };

  const replay = async (db: Pick<typeof prisma, 'partnerReceivableEvent'>): Promise<AdjustmentResult | null> => {
    const ev = await db.partnerReceivableEvent.findUnique({ where: { idempotencyKey: key } });
    if (!ev) return null;
    return {
      outcome: 'REPLAYED',
      key,
      before: ev.beforeJson as Record<string, unknown>,
      after: ev.afterJson as Record<string, unknown>,
      eventId: ev.id,
    };
  };

  if (input.dryRun) {
    const done = await replay(prisma);
    if (done) return { ...done, outcome: 'REPLAYED' };
    const row = await read(prisma);
    assertReceivableCas(row, input);
    const plan = planReceivableChange(row, input.action, audit, input.waiveAmount);
    return { outcome: 'DRY_RUN', key, before: receivableSnapshot(row), after: plan.after };
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Serialise concurrent adjusters (and the collector's write) on this one row.
        await tx.$queryRaw`SELECT id FROM partner_receivables WHERE id = ${input.receivableId} FOR UPDATE`;
        const done = await replay(tx);
        if (done) return done;
        const row = await read(tx);
        assertReceivableCas(row, input);
        const plan = planReceivableChange(row, input.action, audit, input.waiveAmount);
        const before = receivableSnapshot(row);

        const moved = await tx.partnerReceivable.updateMany({
          where: {
            id: row.id,
            amount: row.amount,
            recovered: row.recovered,
            waived: row.waived,
            settledAt: null,
            ...(row.suspendedAt ? { suspendedAt: { not: null } } : { suspendedAt: null }),
          },
          data: plan.data,
        });
        if (moved.count !== 1) throw new AdjustmentError('CONCURRENT_CHANGE', 'The receivable changed while adjusting. Nothing changed.');

        const ev = await tx.partnerReceivableEvent.create({
          data: {
            receivableId: row.id,
            action: input.action,
            amount: plan.eventAmount,
            reason,
            approvedBy,
            approvalRef,
            idempotencyKey: key,
            beforeJson: before as Prisma.InputJsonValue,
            afterJson: plan.after as Prisma.InputJsonValue,
          },
        });
        return { outcome: 'APPLIED' as const, key, before, after: plan.after, eventId: ev.id };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (e) {
    // Two runners with the same approval raced past the replay check: the unique key makes the loser a replay.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const done = await replay(prisma);
      if (done) return done;
    }
    throw e;
  }
}

// ───────────────────────────────────────────────────────────── unpaid obligations ──

export interface ObligationAdjustInput {
  obligationId: string;
  /** CAS: the `unpaid` amount shown to / approved by the owner. */
  expectedUnpaid: string;
  /** CAS: the payment transaction id of the obligation. */
  expectedTransactionId: string;
  /** RESOLVE = handled outside this tool (say how in the note); WAIVE = the owner decided it is not pursued. */
  action: 'RESOLVE' | 'WAIVE';
  note: string;
  actor: string;
  approvalRef: string;
  dryRun: boolean;
}

export async function adjustObligation(input: ObligationAdjustInput): Promise<AdjustmentResult> {
  const note = requireText('note', input.note, 5);
  const actor = requireText('actor', input.actor, 2);
  const approvalRef = requireText('approvalRef', input.approvalRef, 2);
  const key = `OBLIGATION_${input.action}:${input.obligationId}:${approvalRef}`;
  const toStatus = input.action === 'RESOLVE' ? 'RESOLVED' : 'WAIVED';

  const replay = async (db: Pick<typeof prisma, 'contractUnpaidObligationEvent'>): Promise<AdjustmentResult | null> => {
    const ev = await db.contractUnpaidObligationEvent.findUnique({ where: { idempotencyKey: key } });
    if (!ev) return null;
    return {
      outcome: 'REPLAYED',
      key,
      before: { status: ev.fromStatus, unpaid: money(ev.unpaid) },
      after: { status: ev.toStatus, unpaid: money(ev.unpaid) },
      eventId: ev.id,
    };
  };

  const check = async (db: Pick<typeof prisma, 'contractUnpaidObligation'>) => {
    const o = await db.contractUnpaidObligation.findUnique({ where: { id: input.obligationId } });
    if (!o) throw new AdjustmentError('NOT_FOUND', 'No such obligation.');
    let expected: Prisma.Decimal;
    try {
      expected = D(input.expectedUnpaid);
    } catch {
      throw new AdjustmentError('INVALID_INPUT', 'expectedUnpaid is not a number.');
    }
    if (!D(o.unpaid).equals(expected) || o.transactionId !== input.expectedTransactionId) {
      throw new AdjustmentError('CAS_MISMATCH', 'Obligation unpaid amount / transaction id do not match the approved values. Nothing changed.');
    }
    if (o.status !== 'OPEN') throw new AdjustmentError('NOT_OPEN', `Obligation is already ${o.status}; nothing to do.`);
    return o;
  };

  if (input.dryRun) {
    const done = await replay(prisma);
    if (done) return done;
    const o = await check(prisma);
    return {
      outcome: 'DRY_RUN',
      key,
      before: { status: o.status, unpaid: money(o.unpaid) },
      after: { status: toStatus, unpaid: money(o.unpaid) },
    };
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM contract_unpaid_obligations WHERE id = ${input.obligationId} FOR UPDATE`;
        const done = await replay(tx);
        if (done) return done;
        const o = await check(tx);
        const moved = await tx.contractUnpaidObligation.updateMany({
          where: { id: o.id, status: 'OPEN', unpaid: o.unpaid },
          data: { status: toStatus, resolvedAt: new Date(), resolvedBy: actor, resolvedNote: note },
        });
        if (moved.count !== 1) throw new AdjustmentError('CONCURRENT_CHANGE', 'The obligation changed while adjusting. Nothing changed.');
        const ev = await tx.contractUnpaidObligationEvent.create({
          data: {
            obligationId: o.id,
            action: input.action,
            note,
            actor,
            approvalRef,
            idempotencyKey: key,
            fromStatus: 'OPEN',
            toStatus,
            unpaid: o.unpaid,
          },
        });
        return {
          outcome: 'APPLIED' as const,
          key,
          before: { status: 'OPEN', unpaid: money(o.unpaid) },
          after: { status: toStatus, unpaid: money(o.unpaid) },
          eventId: ev.id,
        };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const done = await replay(prisma);
      if (done) return done;
    }
    throw e;
  }
}
