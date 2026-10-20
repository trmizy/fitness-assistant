import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import {
  assertHoldbackRateValid,
  computeLateArrivalCompensation,
  computeNoShowCompensation,
  computeSessionRelease,
  computeTermination,
  holdbackTarget,
  splitReleaseWithHoldback,
  splitThreeWays,
  type RateTable,
  type TerminationReason,
  ZERO,
} from './contract-money';
import { pendingForTransaction, walletService, type LedgerOps } from './wallet.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';
import {
  assertRequestMatchesTransaction,
  contractOpMeta,
  ledgerStrictOwnFunds,
} from './contract-request-guard';

/**
 * Moves the money a contract's formulas call for.
 *
 * Split of responsibility: contract-money.ts decides the amounts and proves they reconcile,
 * this file writes them to the ledger. Every routine here runs inside one wallet-locked DB
 * transaction, so a split either lands whole or not at all.
 *
 * Direction of travel, once:
 *   payment  → ESCROW gains P; each party's PENDING bucket gains rate × P
 *   release  → a party's PENDING falls, their AVAILABLE rises (ESCROW untouched: still held)
 *   payout   → a party's AVAILABLE falls and ESCROW falls (cash actually left the building)
 *   refund   → a party's PENDING falls, the client's AVAILABLE rises (ESCROW untouched)
 *
 * ESCROW only changes when money genuinely enters or leaves the platform. Shuffling between
 * buckets and between parties is a reallocation of the same held cash, which is precisely
 * why the reconciliation invariant survives every one of these operations.
 */

export interface ContractParties {
  ptUserId: string;
  gymId?: string | null;
  clientUserId: string;
}

interface ResolvedWallets {
  escrowId: string;
  revenueId: string;
  ptId: string;
  gymId: string | null;
  clientId: string;
  all: string[];
}

async function resolveWallets(parties: ContractParties): Promise<ResolvedWallets> {
  const [escrow, revenue, pt, client] = await Promise.all([
    walletService.getEscrowWallet(),
    walletService.getRevenueWallet(),
    walletService.getOrCreateWallet('PT', parties.ptUserId),
    walletService.getOrCreateWallet('CLIENT', parties.clientUserId),
  ]);
  const gym = parties.gymId ? await walletService.getOrCreateWallet('GYM', parties.gymId) : null;

  const all = [escrow.id, revenue.id, pt.id, client.id];
  if (gym) all.push(gym.id);
  return {
    escrowId: escrow.id,
    revenueId: revenue.id,
    ptId: pt.id,
    gymId: gym?.id ?? null,
    clientId: client.id,
    all,
  };
}

/**
 * How much PENDING one contract still has in one wallet — never the wallet's pooled bucket.
 *
 * A PT, a gym and the platform REVENUE account each have ONE wallet, and its pending bucket
 * holds the not-yet-earned money of every contract that party is running (plus, for a gym, its
 * memberships and, for a PT, referral commissions). `ops.balance(walletId, 'PENDING')` is the
 * whole pot. Reading it as "this contract's pending" let one contract's termination drain its
 * neighbours' money and book it to REVENUE as a "forfeited share".
 *
 * Every ledger call for a contract runs under the contract's own payment transaction id
 * (withWallets stamps it on each row), so the contract's pending is what the PENDING rows
 * carrying that id net to — the same derivation membership-ledger.service.ts uses.
 *
 * Clamped to [0, what the wallet really holds]. On a database where the old pooled drain has
 * run, a terminated contract's rows net NEGATIVE (it debited its neighbours' pending under its
 * own id) and a neighbour's can net MORE than the wallet still holds. Treating the first as
 * nothing and capping the second at the bucket means this can never push a bucket below zero
 * nor hand a contract money the wallet does not have; whatever the contract is then short of
 * surfaces through the shortfall paths every caller already has.
 */
export async function ownPending(ops: LedgerOps, walletId: string, transactionId: string): Promise<Prisma.Decimal> {
  const own = await pendingForTransaction(ops, walletId, transactionId);
  const held = ops.balance(walletId, 'PENDING');
  if (own.lessThanOrEqualTo(0)) return ZERO;
  return own.lessThan(held) ? own : held;
}

// ── FH-1: unpaid obligations (D48 / N7) ──────────────────────────────────────

type ObligationKind = 'NO_SHOW' | 'LATE_ARRIVAL' | 'REFUND_SHORT' | 'OVER_RELEASED';

/**
 * Writes the durable record of what a PT-fault step could not pay out of THE CONTRACT'S OWN money.
 * It is an unpaid obligation to the client (or, for OVER_RELEASED, an incident for the admin) and
 * nothing else: no PartnerReceivable, no platform fronting, no draw on any pooled balance.
 *
 * Always called inside withIdempotentLedgerOp, i.e. in the same DB transaction as the ledger rows and
 * only on the first execution of the operation, so a retry replays the stored result and can never
 * create a second row (the UNIQUE key is the backstop). `key` is the operation's idempotency key;
 * a second row of the same operation (OVER_RELEASED) appends `#<kind>:<party>`.
 */
async function recordObligation(
  ops: LedgerOps,
  o: {
    key: string;
    transactionId: string;
    contractRef: string;
    kind: ObligationKind;
    party: 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';
    owed: Prisma.Decimal;
    paid: Prisma.Decimal;
  },
): Promise<string> {
  const unpaid = o.owed.minus(o.paid);
  const row = await ops.tx.contractUnpaidObligation.create({
    data: {
      key: o.key,
      transactionId: o.transactionId,
      contractRef: o.contractRef,
      kind: o.kind,
      party: o.party,
      owed: o.owed,
      paid: o.paid,
      unpaid,
    },
  });
  logger.warn(
    `[ContractLedger] ${o.contractRef}: ${o.kind} obligation ${row.id} — owed ${o.owed.toFixed(2)}, paid ${o.paid.toFixed(2)}, unpaid ${unpaid.toFixed(2)} (${o.party}); no pooled balance touched, nothing fronted`,
  );
  return row.id;
}

/**
 * FH-2c fence. Once a termination has left unresolved sessions behind, their value sits in the three
 * parties' pending for the contract — and ONLY resolveUnresolvedSession may spend it. A release or a
 * compensation that arrives late (a slow payment-service call that outlived its caller's timeout) must
 * not eat that reserve. The reserve is derived from the same marker rows resolveUnresolvedSession
 * uses (held count − resolved count) × one session's split, so it is zero for every contract that was
 * never ended with unresolved sessions and for one whose sessions are all resolved.
 */
async function unresolvedReserve(
  ops: LedgerOps,
  revenueWalletId: string,
  transactionId: string,
  rel: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal },
): Promise<{ pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal }> {
  const none = { pt: ZERO, gym: ZERO, platform: ZERO };
  const markerWhere = { walletId: revenueWalletId, transactionId, bucket: 'PENDING' as const };
  const held = await ops.tx.walletLedgerEntry.findFirst({
    where: { ...markerWhere, description: { contains: UNRESOLVED_HELD_MARKER } },
    select: { description: true },
  });
  if (!held?.description) return none;
  const opened = Number(held.description.split(UNRESOLVED_HELD_MARKER).pop());
  if (!Number.isInteger(opened) || opened <= 0) return none;
  const resolved = await ops.tx.walletLedgerEntry.count({
    where: { ...markerWhere, description: { contains: UNRESOLVED_RESOLVED_MARKER } },
  });
  const remaining = Math.max(0, opened - resolved);
  if (remaining === 0) return none;
  return { pt: rel.pt.mul(remaining), gym: rel.gym.mul(remaining), platform: rel.platform.mul(remaining) };
}

// ── D77: late-arrival compensation is deducted from THAT session's value ───────

const LATE_ARRIVAL_KEY_PREFIX = 'PT_LATE_ARRIVAL:';

/** `SESSION_RELEASE:<x>` / `UNRESOLVED_SESSION:<x>` -> `PT_LATE_ARRIVAL:<x>`: the same session, by the key every caller already uses. */
function lateArrivalKeyFor(opKey: string): string | null {
  for (const prefix of ['SESSION_RELEASE:', 'UNRESOLVED_SESSION:']) {
    if (opKey.startsWith(prefix)) return LATE_ARRIVAL_KEY_PREFIX + opKey.slice(prefix.length);
  }
  return null;
}

type PartyAmounts = { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
const NO_AMOUNTS = (): PartyAmounts => ({ pt: ZERO, gym: ZERO, platform: ZERO });

function chargedOf(result: unknown): PartyAmounts | null {
  const c = (result as { charged?: Record<string, string> } | null)?.charged;
  if (!c) return null;
  return { pt: new Prisma.Decimal(c.pt ?? 0), gym: new Prisma.Decimal(c.gym ?? 0), platform: new Prisma.Decimal(c.platform ?? 0) };
}

type LedgerOpReader = { ledgerOperation: LedgerOps['tx']['ledgerOperation'] };

/**
 * What the late-arrival compensation of THIS session already took out of each party's pending, read from the ledger:
 * the stored result of the session's `PT_LATE_ARRIVAL:<session>` operation (same session id as the release /
 * resolution key - no field from the caller). Only operations written under this transaction by FH-2b-and-later code
 * count (they carry `kind` and `transactionId`); an older row, or no row, means no deduction, so a session that was
 * already released in full before D77 keeps the outcome it had and nothing is clawed back. Strict mode only.
 */
async function lateDeductionFor(ops: LedgerOps, transactionId: string, opKey: string): Promise<PartyAmounts | null> {
  if (!ledgerStrictOwnFunds()) return null;
  const lateKey = lateArrivalKeyFor(opKey);
  if (!lateKey) return null;
  const row = await ops.tx.ledgerOperation.findUnique({ where: { key: lateKey } });
  if (!row || row.kind !== 'LATE_ARRIVAL' || row.transactionId !== transactionId) return null;
  return chargedOf(row.result);
}

/**
 * The late-arrival compensations of a contract, split the way the termination arithmetic needs them (D77):
 *   settled  sessions already released / resolved WITH the deduction (their release result says so)
 *   open     the first `unresolvedCount` compensations whose session has no release / resolution yet - the sessions the
 *            ending holds. Any further open one cannot be attributed to a held session and is left alone (it was paid
 *            out of the contract's general pending, as before).
 * A compensation whose session was released WITHOUT the deduction (it arrived after the release) is also left alone.
 */
export async function loadLateArrivalDeductions(
  db: LedgerOpReader,
  transactionId: string,
  unresolvedCount: number,
): Promise<{ settled: PartyAmounts; open: PartyAmounts }> {
  const settled = NO_AMOUNTS();
  const open = NO_AMOUNTS();
  if (!ledgerStrictOwnFunds()) return { settled, open };
  const lateOps = await db.ledgerOperation.findMany({ where: { transactionId, kind: 'LATE_ARRIVAL' }, orderBy: { createdAt: 'asc' } });
  let openTaken = 0;
  for (const late of lateOps) {
    const charged = chargedOf(late.result);
    if (!charged) continue;
    const suffix = late.key.startsWith(LATE_ARRIVAL_KEY_PREFIX) ? late.key.slice(LATE_ARRIVAL_KEY_PREFIX.length) : null;
    if (suffix === null) continue;
    const done =
      (await db.ledgerOperation.findUnique({ where: { key: `SESSION_RELEASE:${suffix}` } })) ??
      (await db.ledgerOperation.findUnique({ where: { key: `UNRESOLVED_SESSION:${suffix}` } }));
    const target = done ? ((done.result as { lateArrivalDeducted?: unknown } | null)?.lateArrivalDeducted ? settled : null) : openTaken < unresolvedCount ? open : null;
    if (!done && target) openTaken++;
    if (!target) continue;
    target.pt = target.pt.plus(charged.pt);
    target.gym = target.gym.plus(charged.gym);
    target.platform = target.platform.plus(charged.platform);
  }
  return { settled, open };
}

const amountsToStrings = (a: PartyAmounts) => ({ pt: a.pt.toFixed(2), gym: a.gym.toFixed(2), platform: a.platform.toFixed(2) });

// ── PT holdback bookkeeping ──────────────────────────────────────────────────
//
// A contract that carries a holdback rate keeps the FIRST money its PT earns in the PT's
// PENDING bucket instead of releasing it (contract-money.ts, splitReleaseWithHoldback). That
// money never leaves PENDING, so the bucket balance alone cannot say how much of it is "held"
// as opposed to "unearned, for a session not yet delivered" — both are pending money of the
// same contract. Rather than trust a number from the caller, the pot is derived from this
// contract's own ledger rows, which are written under the contract's payment transaction id:
//
//   held = Σ PENDING credits described "… PT holdback retained"
//        − Σ PENDING debits  described "… PT holdback released (no activity)"
//
// releaseSession writes a retained row for each session's held part (and releases that part
// from "unearned" with the ordinary release-to-available debit, so the net PENDING movement
// is exactly what a contract without a holdback posts: the amount actually paid out).
// releasePtHoldback writes the released row. Termination needs no row of its own: it ends the
// contract and drains its pending, and every later read is clamped to ownPending.
//
// The descriptions are matched by suffix, so the label a caller chooses can never collide.
export const HOLDBACK_RETAINED_SUFFIX = ' — PT holdback retained';
export const HOLDBACK_RELEASED_SUFFIX = ' — PT holdback released (no activity)';
/**
 * Written (as a zero-amount row, like the release marker) by a termination that leaves
 * unresolved sessions behind while a holdback was in force. That termination has already paid
 * the whole pot out (to the PT, or part of it to the client as compensation), but the contract's
 * pending is NOT empty afterwards — it still holds the unresolved sessions' value — so the pot
 * derived from the retained rows (ptHeld) would otherwise still read as "held" and a later
 * idle-holdback release would sweep up money that belongs to the unresolved sessions.
 * holdbackWasReleased treats this marker exactly like the release marker.
 */
export const HOLDBACK_SETTLED_SUFFIX = ' — contract ended, PT holdback settled';
/**
 * Zero-amount rows in the platform's pending bucket that make "this contract was ended with
 * unresolved sessions" and "this many have been resolved since" facts of the ledger, readable
 * by resolveUnresolvedSession without any schema change. See that function.
 */
export const UNRESOLVED_HELD_MARKER = ' — unresolved sessions held: ';
export const UNRESOLVED_RESOLVED_MARKER = ' — unresolved session resolved: ';

/**
 * What is held back for the PT on this contract right now: the ledger-derived pot, never more
 * than the contract's own pending the PT really has (a PT no-show charge draws on the same
 * pending pool and can, in the extreme, eat into the pot — `held` is then simply what is left).
 */
export async function ptHeld(ops: LedgerOps, ptWalletId: string, transactionId: string): Promise<Prisma.Decimal> {
  const rows = await ops.tx.walletLedgerEntry.findMany({
    where: {
      walletId: ptWalletId,
      transactionId,
      bucket: 'PENDING',
      OR: [
        { entryType: 'CREDIT', description: { endsWith: HOLDBACK_RETAINED_SUFFIX } },
        { entryType: 'DEBIT', description: { endsWith: HOLDBACK_RELEASED_SUFFIX } },
      ],
    },
    select: { entryType: true, amount: true },
  });
  const pot = rows.reduce(
    (sum, r) => (r.entryType === 'CREDIT' ? sum.plus(r.amount) : sum.minus(r.amount)),
    ZERO,
  );
  if (pot.lessThanOrEqualTo(0)) return ZERO;
  const pending = await ownPending(ops, ptWalletId, transactionId);
  return pot.lessThan(pending) ? pot : pending;
}

/**
 * Whether this contract's holdback was already released for inactivity. Once it has been, the
 * contract carries on WITHOUT a holdback — later sessions release in full and a later PT-fault
 * ending pays no compensation — and payment-service enforces that itself, from the ledger,
 * rather than relying on the caller's flag having been saved before the next call arrives.
 */
async function holdbackWasReleased(ops: LedgerOps, ptWalletId: string, transactionId: string): Promise<boolean> {
  const marker = await ops.tx.walletLedgerEntry.findFirst({
    where: {
      walletId: ptWalletId,
      transactionId,
      bucket: 'PENDING',
      entryType: 'DEBIT',
      OR: [
        { description: { endsWith: HOLDBACK_RELEASED_SUFFIX } },
        { description: { endsWith: HOLDBACK_SETTLED_SUFFIX } },
      ],
    },
    select: { id: true },
  });
  return marker !== null;
}

/**
 * A gym share must never be credited when there is no gym wallet to hold it. Rather than
 * silently dropping the money (which would break the invariant), refuse the operation —
 * resolveRates already guarantees gymRate is 0 whenever gymId is absent, so reaching here
 * means the rate table and the parties disagree.
 */
function assertGymConsistency(wallets: ResolvedWallets, gymAmount: Prisma.Decimal): void {
  if (gymAmount.greaterThan(0) && !wallets.gymId) {
    throw new Error(`Rate table allocates ${gymAmount.toString()} to a gym, but the contract has no gymId`);
  }
}

export interface SettlementResult {
  escrowAfter: string;
  pending: { pt: string; gym: string; platform: string };
}

/**
 * Step 1 of the lifecycle: the gateway confirmed the client paid.
 *
 * The whole price lands in escrow, and is simultaneously attributed to the three parties'
 * pending buckets. Nobody can withdraw any of it yet — the sessions have not happened.
 */
export async function settleContractPayment(params: {
  transactionId: string;
  price: Prisma.Decimal;
  rates: RateTable;
  parties: ContractParties;
  label: string;
}): Promise<SettlementResult> {
  const { transactionId, price, rates, parties, label } = params;
  if (price.lessThanOrEqualTo(0)) throw new Error('price must be > 0');

  const wallets = await resolveWallets(parties);
  const split = splitThreeWays(price, rates);
  assertGymConsistency(wallets, split.gym);

  return walletService.withWallets(wallets.all, transactionId, async (ops) => {
    // Compare-and-swap first: only the caller that actually flips the transaction to PAID may
    // move money. Two webhook deliveries racing here serialise on the wallet locks, and the
    // loser sees status already PAID and does nothing. Same guard the top-up path uses.
    const flipped = await ops.tx.paymentTransaction.updateMany({
      where: { id: transactionId, status: { not: 'PAID' } },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (flipped.count === 0) {
      logger.info(`[ContractLedger] Transaction ${transactionId} already settled — skipping`);
      return {
        escrowAfter: ops.balance(wallets.escrowId, 'AVAILABLE').toFixed(2),
        pending: {
          pt: ops.balance(wallets.ptId, 'PENDING').toFixed(2),
          gym: wallets.gymId ? ops.balance(wallets.gymId, 'PENDING').toFixed(2) : '0.00',
          platform: ops.balance(wallets.revenueId, 'PENDING').toFixed(2),
        },
      };
    }

    await ops.credit(wallets.escrowId, price, `${label} — received`);
    if (split.pt.greaterThan(0)) await ops.credit(wallets.ptId, split.pt, `${label} — PT share`, 'PENDING');
    if (split.gym.greaterThan(0)) await ops.credit(wallets.gymId!, split.gym, `${label} — gym share`, 'PENDING');
    if (split.platform.greaterThan(0)) {
      await ops.credit(wallets.revenueId, split.platform, `${label} — platform share`, 'PENDING');
    }

    return {
      escrowAfter: ops.balance(wallets.escrowId, 'AVAILABLE').toFixed(2),
      pending: {
        pt: ops.balance(wallets.ptId, 'PENDING').toFixed(2),
        gym: wallets.gymId ? ops.balance(wallets.gymId, 'PENDING').toFixed(2) : '0.00',
        platform: ops.balance(wallets.revenueId, 'PENDING').toFixed(2),
      },
    };
  });
}

export interface UnactivatedRefundResult {
  /** What the client was credited: everything this transaction's settlement had put in pending (= `paid`). */
  refunded: string;
  returnedFromPending: { pt: string; gym: string; platform: string };
  /**
   * FH-1. `owed` is what the client paid, `paid` what the transaction's own pending could fund (what
   * `refunded` credited), `unpaid` the difference — recorded as an OPEN obligation, never fronted by the
   * platform and never booked as a PT debt. Normally paid = owed and unpaid = 0.
   */
  owed?: string;
  paid?: string;
  unpaid?: string;
  obligationId?: string;
}

/**
 * The contract this payment was for cannot be activated by it any more — it was cancelled,
 * rejected, expired or completed while the client was on the bank's page, or it is already
 * active under a DIFFERENT payment. The client gets this transaction's money back in full.
 *
 * It exactly reverses settleContractPayment for ONE transaction: that call put the price in
 * escrow and into the three parties' pending buckets (all stamped with the transaction id), so
 * this takes each party's pending that carries that same id (`ownPending` — never the pooled
 * bucket, other contracts' money is out of reach) and credits the client with it. Escrow does
 * not move: the cash never left the platform, the claim on it passed from the parties' pending
 * to the client's wallet — the same as the refund leg of terminateContract.
 *
 * Why not terminateContract with a "full refund" reason. Its refund line is labelled with the
 * reason ("refund (MUTUAL)", "refund (PT_BANNED)") — every one of them tells a ledger reader a
 * contract that had run was ended by somebody — and it needs usedSessions / rates /
 * alreadyReleased machinery that has no meaning for a contract that never started. Here nothing
 * is computed at all: the refund IS whatever this transaction put into pending, so no formula,
 * rate or rounding can drift from what settlement booked.
 *
 * The credit's description contains "refund", which is what
 * withdrawal.repository#sumRefundSourcedCredits matches on — the client can withdraw it like
 * any other refund.
 *
 * Exactly once, atomically: the ledger movements, the idempotency key (`CONTRACT_UNACTIVATED_REFUND:
 * <transactionId>`, per TRANSACTION — two different payments for one contract are two refunds)
 * and the transaction's refund marker all commit in the one wallet-locked DB transaction. A
 * failure anywhere rolls the lot back, so a retry always starts clean; a retry after a commit
 * replays the stored result.
 */
export async function refundUnactivatedContractPayment(params: {
  transactionId: string;
  parties: ContractParties;
  label: string;
  /** Machine-readable cause recorded on the transaction, e.g. CONTRACT_NOT_ACTIVATABLE. */
  reason: string;
  /** The contract's status as user-service reported it — for the admin reading the marker. */
  contractStatus: string | null;
}): Promise<UnactivatedRefundResult> {
  const { transactionId, parties, label, reason, contractStatus } = params;
  const idempotencyKey = `CONTRACT_UNACTIVATED_REFUND:${transactionId}`;
  const opMeta = contractOpMeta('UNACTIVATED_REFUND', { transactionId });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, async () => {
      const back = { pt: ZERO, gym: ZERO, platform: ZERO };
      let drained = ZERO;
      for (const [key, id] of [['pt', wallets.ptId], ['gym', wallets.gymId], ['platform', wallets.revenueId]] as const) {
        if (!id) continue;
        const own = await ownPending(ops, id, transactionId);
        if (own.greaterThan(0)) {
          await ops.debit(id, own, `${label} — pending reversed (payment refunded)`, 'PENDING');
          back[key] = own;
          drained = drained.plus(own);
        }
      }

      // What the client paid, per the transaction itself — the authority for "full amount".
      const txn = await ops.tx.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId } });
      const price = new Prisma.Decimal(txn.amount);
      if (price.lessThanOrEqualTo(0)) throw new Error(`transaction ${transactionId} has no positive amount to refund`);

      // Reconcile what came out of pending with what the client is owed, as terminateContract
      // does. Normally they are equal to the đồng (settlement put exactly `price` there and
      // nothing has touched this transaction's pending since — it is never released while the
      // contract is not ACTIVE). Surplus cannot come from this transaction's own rows; it is
      // booked to REVENUE rather than lost so the invariant holds whatever happens.
      //
      // A deficit (pending already short — only possible on a ledger damaged by the old pooled
      // drain) is the client's unpaid obligation (FH-1, D48): the client is credited exactly what
      // the transaction's own money could fund, the rest is an OPEN obligation for the admin. The
      // platform does not front it and no PartnerReceivable is created. With
      // LEDGER_STRICT_OWN_FUNDS=false (emergency rollback only) the old behaviour returns: the
      // client is credited in full, the platform fronts the gap and books it against the PT.
      const strict = ledgerStrictOwnFunds();
      const residue = drained.minus(price);
      const paid = strict && residue.lessThan(0) ? drained : price;
      let obligationId: string | undefined;
      if (paid.greaterThan(0)) {
        await ops.credit(wallets.clientId, paid, `${label} — refund (contract could not be activated)`);
      }
      if (residue.greaterThan(0)) {
        await ops.credit(wallets.revenueId, residue, `${label} — surplus of reversed pending`, 'AVAILABLE');
      } else if (residue.lessThan(0)) {
        if (strict) {
          obligationId = await recordObligation(ops, {
            key: idempotencyKey,
            transactionId,
            contractRef: label,
            kind: 'REFUND_SHORT',
            party: 'CLIENT',
            owed: price,
            paid,
          });
        } else {
          await coverShortfall(ops, wallets.revenueId, residue.abs(), {
            partnerType: 'PT',
            partnerId: parties.ptUserId,
            reason: `Refund of unactivated contract payment shortfall (${label})`,
            transactionId,
          });
        }
      }
      const unpaid = price.minus(paid);

      // The marker, in the same DB transaction as the money. Not ACTIVATED — nothing was —
      // and not REFUNDED either: that status belongs to the admin refund flow (a REFUND child
      // transaction plus cancel-after-refund) and other code treats it as such. PAID stays true
      // (the gateway did capture the money); ACTIVATION_FAILED takes it out of the retry sweep's
      // selection (activationStatus = PENDING) and the metadata says exactly what happened.
      // Merge, never replace: the frozen rate/party snapshot lives in the same JSON.
      const meta = (txn.metadata ?? {}) as Record<string, unknown>;
      await ops.tx.paymentTransaction.update({
        where: { id: transactionId },
        data: {
          activationStatus: 'ACTIVATION_FAILED',
          metadata: {
            ...meta,
            unactivatedRefund: {
              refundedAt: new Date().toISOString(),
              amount: paid.toFixed(2),
              ...(unpaid.greaterThan(0) ? { owed: price.toFixed(2), unpaid: unpaid.toFixed(2), obligationId } : {}),
              reason,
              contractStatus,
              idempotencyKey,
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });

      logger.warn(
        `[ContractLedger] ${label}: contract could not be activated (${contractStatus ?? 'unknown'}) — refunded ${paid.toFixed(2)} of ${price.toFixed(2)} to client ${parties.clientUserId}`,
      );
      return {
        refunded: paid.toFixed(2),
        returnedFromPending: { pt: back.pt.toFixed(2), gym: back.gym.toFixed(2), platform: back.platform.toFixed(2) },
        owed: price.toFixed(2),
        paid: paid.toFixed(2),
        unpaid: unpaid.toFixed(2),
        ...(obligationId ? { obligationId } : {}),
      };
    }),
  );
}

export interface ReleaseResult {
  released: { pt: string; gym: string; platform: string };
  unit: string;
  /**
   * Present only when this call applied a PT holdback (a rate > 0 that has not been released
   * for inactivity). Left off entirely otherwise, so the result — and the copy of it stored for
   * idempotent replay — for a contract without a holdback is exactly what it was before this
   * field existed.
   */
  /** D77: present only when this session had a late-arrival compensation, deducted from what the parties were released. */
  lateArrivalDeducted?: { pt: string; gym: string; platform: string };
  ptHoldback?: {
    /** H = h × price in whole đồng: how much of the PT's first earnings is held back. */
    target: string;
    /** Taken out of THIS session's PT share and kept in pending. */
    heldNow: string;
    /** The pot after this session. */
    totalHeld: string;
  };
}

/**
 * Step 2: a session was confirmed by the client, so that slice of the price is earned.
 *
 * Pending falls and available rises by the same amount for each party — written as a PENDING
 * debit plus an AVAILABLE credit sharing one transactionId, so the release is one auditable
 * event rather than two unexplained movements. Escrow does not move: the cash is still held,
 * it merely became withdrawable.
 *
 * Releasing per session (rather than at the end) keeps each pending bucket exactly equal to
 * the value of the sessions still owed — which is the same pot a refund draws from, so the
 * two mechanisms stay consistent with no extra bookkeeping.
 *
 * PT holdback. When the contract carries a `ptHoldbackRate` h, the PT's share is not released
 * in full until a pot of H = h × price has been held back from their FIRST earnings: after u
 * sessions the PT has been released exactly max(0, E − H), E being the PT share of u sessions,
 * and the other min(E, H) stays in their pending (contract-money.ts#splitReleaseWithHoldback).
 * The gym and the platform are not affected. The amounts returned in `released` are what
 * REALLY went to available — the first session of a held contract returns 0 for the PT — which
 * is what user-service adds to releasedToPt and hands back at termination as `alreadyReleased`,
 * so the two stay consistent.
 *
 * With no rate (or 0), or once the holdback was released for inactivity, this posts exactly
 * the rows it always has.
 */
export async function releaseSession(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** Business key `SESSION_RELEASE:<sessionId>` — a retry with the same key replays the
   * first call's result instead of releasing the session's money a second time (plan 1.1). */
  idempotencyKey: string;
  /** The holdback rate frozen onto THIS contract (0..1). Absent or 0: no holdback. */
  ptHoldbackRate?: Prisma.Decimal;
}): Promise<ReleaseResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey, ptHoldbackRate } = params;
  assertHoldbackRateValid(ptHoldbackRate);
  const opMeta = contractOpMeta('RELEASE_SESSION', { transactionId, price, totalSessions, rates, parties });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, price, rates, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);
  const rel = computeSessionRelease(price, totalSessions, rates);
  assertGymConsistency(wallets, rel.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, async () => {
      const moved = { pt: ZERO, gym: ZERO, platform: ZERO };
      // FH-2c: a release that arrives after the contract was ended with unresolved sessions must
      // not spend their reserve — only resolveUnresolvedSession may.
      const reserve = await unresolvedReserve(ops, wallets.revenueId, transactionId, rel);
      // D77: this session's own late-arrival compensation was already paid to the client out of its value.
      const lateDeduction = await lateDeductionFor(ops, transactionId, idempotencyKey);
      const dueOf = (full: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') =>
        lateDeduction ? Prisma.Decimal.max(full.minus(lateDeduction[key]), ZERO) : full;
      // Decided once, under the wallet locks: a holdback released for inactivity stays released
      // whatever rate the caller still sends.
      const target = holdbackTarget(price, ptHoldbackRate);
      const holding = target.greaterThan(0) && !(await holdbackWasReleased(ops, wallets.ptId, transactionId));
      let ptHoldback: ReleaseResult['ptHoldback'];

      const move = async (
        walletId: string,
        amount: Prisma.Decimal,
        who: string,
        key: 'pt' | 'gym' | 'platform',
        debtor?: { partnerType: 'PT' | 'GYM'; partnerId: string },
        holdbackPot?: Prisma.Decimal,
      ) => {
        if (amount.lessThanOrEqualTo(0)) return;
        // Clamp to what THIS CONTRACT still has pending. A contract whose own pending has
        // already been spent (PT no-shows, a late-arrival compensation, a termination) must
        // not push a bucket negative — and must not be paid out of a neighbour's pending
        // either, which is what clamping to the wallet's pooled bucket used to do. Releasing
        // only what remains keeps the invariant intact and the shortfall visible.
        const reserved = reserve[key];
        const spendable = (await ownPending(ops, walletId, transactionId)).minus(reserved);
        const available = spendable.greaterThan(0) ? spendable : ZERO;
        const moving = available.lessThan(amount) ? available : amount;
        if (moving.lessThanOrEqualTo(0)) {
          logger.warn(`[ContractLedger] ${who} pending bucket empty for ${label} — nothing to release`);
          return;
        }

        // `moving` is what the party EARNED with this session. All of it leaves "unearned"
        // pending; with a holdback, the part that tops up the held-back pot goes straight back
        // into pending under its own description, and only the rest reaches available. The net
        // PENDING movement is then exactly the amount paid out, as for every other contract.
        let toAvailable = moving;
        let heldNow = ZERO;
        if (holdbackPot) {
          const heldBefore = await ptHeld(ops, walletId, transactionId);
          const split = splitReleaseWithHoldback(moving, heldBefore, holdbackPot);
          toAvailable = split.released;
          heldNow = split.held;
          ptHoldback = {
            target: holdbackPot.toFixed(2),
            heldNow: heldNow.toFixed(2),
            totalHeld: heldBefore.plus(heldNow).toFixed(2),
          };
        }

        await ops.debit(walletId, moving, `${label} — release to available`, 'PENDING');
        if (heldNow.greaterThan(0)) {
          await ops.credit(walletId, heldNow, `${label}${HOLDBACK_RETAINED_SUFFIX}`, 'PENDING');
        }
        if (toAvailable.greaterThan(0)) {
          await ops.credit(walletId, toAvailable, `${label} — session earned`, 'AVAILABLE');
        }
        moved[key] = toAvailable;

        // A partner who owes the platform works the debt off out of what they just earned,
        // before it becomes withdrawable. The platform is never a debtor to itself, so the
        // revenue wallet is not passed a debtor.
        if (debtor && toAvailable.greaterThan(0)) {
          await recoverReceivables({
            ops,
            walletId,
            revenueWalletId: wallets.revenueId,
            ...debtor,
            justCredited: toAvailable,
            label,
          });
        }
      };

      await move(wallets.ptId, dueOf(rel.pt, 'pt'), 'PT', 'pt', { partnerType: 'PT', partnerId: parties.ptUserId }, holding ? target : undefined);
      if (wallets.gymId) {
        await move(wallets.gymId, dueOf(rel.gym, 'gym'), 'Gym', 'gym', { partnerType: 'GYM', partnerId: parties.gymId! });
      }
      await move(wallets.revenueId, dueOf(rel.platform, 'platform'), 'Platform', 'platform');

      // Report what actually moved, not what the formula asked for. The caller adds these
      // figures to the contract's releasedTo* running totals and hands them back at
      // termination as `alreadyReleased`: reporting a release that was clamped to nothing would
      // make termination believe the party had been paid, skip their top-up and — if it then
      // saw them as over-paid — claw the difference out of their AVAILABLE balance.
      return {
        unit: rel.unit.toFixed(2),
        released: { pt: moved.pt.toFixed(2), gym: moved.gym.toFixed(2), platform: moved.platform.toFixed(2) },
        ...(ptHoldback ? { ptHoldback } : {}),
        ...(lateDeduction ? { lateArrivalDeducted: amountsToStrings(lateDeduction) } : {}),
      };
    }),
  );
}

export interface NoShowResult {
  /** What the client was credited: = `paid`. Equal to `owed` unless the contract's own money ran short. */
  compensation: string;
  charged: { pt: string; gym: string; platform: string };
  /** = `unpaid`, kept under its old name for existing readers. */
  shortfall: string;
  /**
   * FH-1 (D48 / N7). `owed` is the compensation the formula asks for, `paid` what the CONTRACT'S OWN
   * pending could fund (and the only thing credited to the client), `unpaid` the difference. A shortfall
   * is an OPEN obligation to the client (`obligationId`) — never drawn from the PT's / gym's / platform's
   * pooled balance, never fronted by the platform, never a PT debt. Normal case: paid = owed, unpaid = 0
   * and no obligation row exists.
   */
  owed: string;
  paid: string;
  unpaid: string;
  obligationId?: string;
}

/**
 * Shared body of compensateNoShow / compensateLateArrival: charge the three parties for the client's
 * compensation and credit the client. Runs inside withIdempotentLedgerOp, i.e. under the wallet locks.
 *
 * STRICT (default, LEDGER_STRICT_OWN_FUNDS): each party is charged ONLY from this contract's own
 * pending (ownPending, minus the FH-2c reserve of unresolved sessions); the client is credited exactly
 * what was drawn; the rest becomes an OPEN obligation.
 *
 * LEGACY (LEDGER_STRICT_OWN_FUNDS=false, emergency rollback only): this contract's pending, then the
 * party's pooled AVAILABLE, then the platform fronts the remainder and books a PartnerReceivable.
 */
async function chargeCompensation(
  ops: LedgerOps,
  p: {
    wallets: ResolvedWallets;
    transactionId: string;
    parties: ContractParties;
    label: string;
    idempotencyKey: string;
    kind: 'NO_SHOW' | 'LATE_ARRIVAL';
    comp: { compensation: Prisma.Decimal; pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
    rel: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
    chargeWording: string;
    creditWording: string;
    shortfallReason: string;
  },
): Promise<NoShowResult> {
  const { wallets, transactionId, parties, label, idempotencyKey, kind, comp: c } = p;
  const strict = ledgerStrictOwnFunds();
  const charged = { pt: ZERO, gym: ZERO, platform: ZERO };
  let shortfall = ZERO;
  const reserve = strict
    ? await unresolvedReserve(ops, wallets.revenueId, transactionId, p.rel)
    : { pt: ZERO, gym: ZERO, platform: ZERO };

  const charge = async (walletId: string, amount: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') => {
    if (amount.lessThanOrEqualTo(0)) return;
    let outstanding = amount;
    // Pending first — that is the money set aside for sessions still owed, and this is one
    // of them: THIS contract's pending, not the wallet's pooled bucket (which also holds the
    // party's other contracts' unearned money). Strict mode stops there. The legacy path then
    // goes on to the party's pooled available balance and, for the rest, to the platform-fronted
    // shortfall below.
    for (const bucket of strict ? (['PENDING'] as const) : (['PENDING', 'AVAILABLE'] as const)) {
      if (outstanding.lessThanOrEqualTo(0)) break;
      let held: Prisma.Decimal;
      if (bucket === 'PENDING') {
        const own = (await ownPending(ops, walletId, transactionId)).minus(reserve[key]);
        held = own.greaterThan(0) ? own : ZERO;
      } else {
        held = ops.balance(walletId, bucket);
      }
      const taken = held.lessThan(outstanding) ? held : outstanding;
      if (taken.greaterThan(0)) {
        await ops.debit(walletId, taken, `${label} — ${p.chargeWording}`, bucket);
        charged[key] = charged[key].plus(taken);
        outstanding = outstanding.minus(taken);
      }
    }
    shortfall = shortfall.plus(outstanding);
  };

  await charge(wallets.ptId, c.pt, 'pt');
  if (wallets.gymId) await charge(wallets.gymId, c.gym, 'gym');
  else if (c.gym.greaterThan(0)) shortfall = shortfall.plus(c.gym);
  await charge(wallets.revenueId, c.platform, 'platform');

  const owed = c.compensation;
  // Escrow does NOT move: the cash never left the platform, the claim on it simply passed from the
  // parties to the client. Both sides of the invariant fall and rise by the same amount.
  // Strict: the client gets exactly what was drawn. Legacy: the client is made whole regardless
  // (section 3.9) and the platform fronts what the parties could not fund.
  const paid = strict ? charged.pt.plus(charged.gym).plus(charged.platform) : owed;
  if (paid.greaterThan(0)) await ops.credit(wallets.clientId, paid, `${label} — ${p.creditWording}`);

  let obligationId: string | undefined;
  if (strict) {
    if (owed.minus(paid).greaterThan(0)) {
      obligationId = await recordObligation(ops, {
        key: idempotencyKey,
        transactionId,
        contractRef: label,
        kind,
        party: 'CLIENT',
        owed,
        paid,
      });
    }
  } else if (shortfall.greaterThan(0)) {
    await coverShortfall(ops, wallets.revenueId, shortfall, {
      partnerType: 'PT',
      partnerId: parties.ptUserId,
      reason: `${p.shortfallReason} (${label})`,
      transactionId,
    });
  }

  const unpaid = strict ? owed.minus(paid) : ZERO;
  return {
    compensation: paid.toFixed(2),
    charged: {
      pt: charged.pt.toFixed(2),
      gym: charged.gym.toFixed(2),
      platform: charged.platform.toFixed(2),
    },
    shortfall: (strict ? unpaid : shortfall).toFixed(2),
    owed: owed.toFixed(2),
    paid: paid.toFixed(2),
    unpaid: unpaid.toFixed(2),
    ...(obligationId ? { obligationId } : {}),
  };
}

/**
 * The PT failed to attend. The client is paid one session's value in cash, funded by taking
 * that value back off the three parties in proportion — the platform gives back its
 * commission too, since it earned nothing on a session that never happened.
 *
 * The money comes ONLY from this contract's own pending (FH-1): when it is not enough the client is
 * credited what it could fund and the rest is an OPEN obligation — see chargeCompensation.
 *
 * The caller must also increment the contract's compensatedSessions by one — never decrement
 * totalSessions (that number, and price, are immutable once the contract is signed; see
 * money-flow plan 1.5). Compensating the client AND leaving the entitlement uncounted would
 * hand them the same session's value twice: once as cash here, once again as an unused
 * session when the contract later settles or terminates. remainingValue() and
 * computeTermination() in contract-money.ts are what actually subtract compensatedSessions
 * back out of "still owed."
 */
export async function compensateNoShow(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** Business key `PT_NO_SHOW:<sessionId>` — a retry with the same key replays the first
   * call's result instead of compensating the client a second time (plan 1.1). */
  idempotencyKey: string;
}): Promise<NoShowResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey } = params;
  const opMeta = contractOpMeta('NO_SHOW', { transactionId, price, totalSessions, rates, parties });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, price, rates, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);
  const c = computeNoShowCompensation(price, totalSessions, rates);
  assertGymConsistency(wallets, c.gym);
  const rel = computeSessionRelease(price, totalSessions, rates);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, () =>
      chargeCompensation(ops, {
        wallets, transactionId, parties, label, idempotencyKey, kind: 'NO_SHOW', comp: c, rel,
        chargeWording: 'PT no-show charge',
        creditWording: 'compensation for a missed session',
        shortfallReason: 'PT no-show compensation shortfall',
      }),
    ),
  );
}

/**
 * Open-room online session — the PT joined the room, but after the grace window past the
 * scheduled start. Half of compensateNoShow's rate (computeLateArrivalCompensation), same
 * own-money-only charge mechanics (chargeCompensation).
 */
export async function compensateLateArrival(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** Business key `PT_LATE_ARRIVAL:<sessionId>` — a retry with the same key replays the
   * first call's result instead of compensating the client a second time. */
  idempotencyKey: string;
}): Promise<NoShowResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey } = params;
  const opMeta = contractOpMeta('LATE_ARRIVAL', { transactionId, price, totalSessions, rates, parties });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, price, rates, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);
  const c = computeLateArrivalCompensation(price, totalSessions, rates);
  assertGymConsistency(wallets, c.gym);
  const rel = computeSessionRelease(price, totalSessions, rates);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, () =>
      chargeCompensation(ops, {
        wallets, transactionId, parties, label, idempotencyKey, kind: 'LATE_ARRIVAL', comp: c, rel,
        chargeWording: 'PT late-arrival charge',
        creditWording: "compensation for the PT's late arrival",
        shortfallReason: 'PT late-arrival compensation shortfall',
      }),
    ),
  );
}

/**
 * The platform funds a gap out of its own revenue and books it as owed by the partner.
 *
 * Called when a party's buckets could not cover a charge the client is nonetheless entitled
 * to. The alternative — letting a wallet go negative, or crediting the client with money
 * nobody funded — would break the reconciliation invariant, and a broken invariant is
 * indistinguishable from theft when someone comes to audit it. If even revenue cannot cover
 * the gap, the whole movement is refused: better a failed operation than untraceable money.
 */
export async function coverShortfall(
  ops: LedgerOps,
  revenueWalletId: string,
  shortfall: Prisma.Decimal,
  debt: { partnerType: 'PT' | 'GYM'; partnerId: string; reason: string; transactionId: string },
): Promise<void> {
  const revenueHeld = ops.balance(revenueWalletId, 'AVAILABLE');
  if (revenueHeld.lessThan(shortfall)) {
    throw new Error(
      `[ContractLedger] cannot fund ${shortfall.toString()} shortfall: platform revenue holds only ${revenueHeld.toString()}`,
    );
  }
  await ops.debit(revenueWalletId, shortfall, `${debt.reason} — fronted by the platform`, 'AVAILABLE');
  await ops.tx.partnerReceivable.create({
    data: {
      partnerType: debt.partnerType,
      partnerId: debt.partnerId,
      amount: shortfall,
      reason: debt.reason,
      transactionId: debt.transactionId,
    },
  });
  logger.warn(`[ContractLedger] platform fronted ${shortfall.toString()} owed by ${debt.partnerType} ${debt.partnerId}`);
}

/**
 * RECEIVABLE_RECOVERY_ENABLED — only the exact value "true" (case-insensitive) turns automatic debt
 * recovery on. Unset or anything else: paused (FH-0). Read on every call, never cached.
 */
export function receivableRecoveryEnabled(): boolean {
  return (process.env.RECEIVABLE_RECOVERY_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * The other half of coverShortfall: take the fronted money back out of what the partner
 * earns next (money-flow §3.9, "khoản phải thu này bị trừ vào các lần ghi có sau").
 *
 * Called immediately after a partner's AVAILABLE bucket is credited, and withholds from
 * that credit before the partner can withdraw it. Three deliberate limits:
 *
 *  · Never more than the credit that just landed. The debt is recovered out of *subsequent
 *    earnings*, not by raiding a balance the partner built up before the debt arose — that
 *    would be a seizure, and it would surprise someone who had already been told a figure.
 *  · Oldest debt first, so a long-standing receivable cannot be starved by newer ones.
 *  · The recovered money goes back to REVENUE, which is where coverShortfall took it from.
 *    Escrow does not move: the partner's claim shrinks and the platform's grows by the same
 *    amount, so the §6 invariant holds without a compensating entry.
 *
 * Partial recovery is normal — a large debt is worked off over several sessions. The row
 * only settles when `recovered` reaches `amount`.
 *
 * Withdrawal requests (VĐ1) now exist, and P0 cluster F gave `WalletLedgerV2` a third bucket
 * (`LOCKED`) for exactly this reason: once a withdrawal is `approve()`d, its amount is moved
 * OUT of AVAILABLE into LOCKED, so this function's `ops.balance(walletId, 'AVAILABLE')` read
 * can no longer touch it — an approved-but-not-yet-paid withdrawal is structurally safe from
 * a clawback that lands afterward. The still-open gap is narrower than the old comment above
 * implied: a withdrawal that is only *requested* (still PENDING, still sitting in AVAILABLE)
 * has no reservation yet, so a same-moment recovery can still shrink the balance a pending
 * request expects to draw from — `requestWithdrawal`/`approve()` do not re-check against an
 * in-flight receivable. Money-flow §15 rules that recovery should outrank a pending request
 * in that case; the check, if added, belongs in `withdrawal.service.ts#approve()`, not here.
 */
export async function recoverReceivables(params: {
  ops: LedgerOps;
  walletId: string;
  revenueWalletId: string;
  partnerType: 'PT' | 'GYM';
  partnerId: string;
  /** Ceiling for this pass: the amount just credited to the partner's AVAILABLE bucket. */
  justCredited: Prisma.Decimal;
  label: string;
}): Promise<Prisma.Decimal> {
  const { ops, walletId, revenueWalletId, partnerType, partnerId, justCredited, label } = params;
  if (justCredited.lessThanOrEqualTo(0)) return ZERO;
  // FH-0 (D75, DQ-4): automatic collection of old PartnerReceivables is PAUSED unless explicitly
  // enabled. Read at call time. Disabled = no deduction, every debt row untouched, history kept.
  if (!receivableRecoveryEnabled()) return ZERO;

  const debts = await ops.tx.partnerReceivable.findMany({
    // FH-8: a SUSPENDED receivable is not collected (history kept); a WAIVED part is not owed any more.
    where: { partnerType, partnerId, settledAt: null, suspendedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (debts.length === 0) return ZERO;

  // Cap by what is actually in the bucket as well. These should agree, but a bucket that is
  // somehow short must not be pushed negative — that breaks the invariant this whole file
  // exists to protect.
  const held = ops.balance(walletId, 'AVAILABLE');
  let budget = justCredited.lessThan(held) ? justCredited : held;
  let recoveredTotal = ZERO;

  for (const debt of debts) {
    if (budget.lessThanOrEqualTo(0)) break;
    const outstanding = new Prisma.Decimal(debt.amount).minus(debt.recovered).minus(debt.waived);
    if (outstanding.lessThanOrEqualTo(0)) continue;

    const take = outstanding.lessThan(budget) ? outstanding : budget;
    const nowRecovered = new Prisma.Decimal(debt.recovered).plus(take);
    const settled = nowRecovered.plus(debt.waived).greaterThanOrEqualTo(debt.amount);

    await ops.tx.partnerReceivable.update({
      where: { id: debt.id },
      data: { recovered: nowRecovered, settledAt: settled ? new Date() : null },
    });

    budget = budget.minus(take);
    recoveredTotal = recoveredTotal.plus(take);
    logger.info(
      `[ContractLedger] recovered ${take.toString()} of receivable ${debt.id} from ${partnerType} ${partnerId}` +
        (settled ? ' — settled in full' : ` — ${outstanding.minus(take).toString()} still owed`),
    );
  }

  if (recoveredTotal.greaterThan(0)) {
    await ops.debit(walletId, recoveredTotal, `${label} — withheld against outstanding debt`, 'AVAILABLE');
    await ops.credit(revenueWalletId, recoveredTotal, `${label} — debt recovered`, 'AVAILABLE');
  }

  return recoveredTotal;
}

export interface TerminationLedgerResult {
  reason: TerminationReason;
  refund: string;
  entitlement: { pt: string; gym: string; platform: string };
  topUp: { pt: string; gym: string; platform: string };
  returnedToEscrow: string;
  /** What the pending buckets could not fund of the refund and the parties' final shares. */
  shortfall: string;
  /**
   * FH-1 (D48 / N7). What the CLIENT is owed by this ending (refund + any PT-fault holdback
   * compensation), what the contract's own pending could fund and was credited (`paid`; `refund`
   * above is the refund part of it), and the difference: an OPEN obligation (`obligationId`), never
   * fronted by the platform and never a PT debt. Normal case: paid = owed, unpaid = 0, no obligation.
   */
  owed: string;
  paid: string;
  unpaid: string;
  obligationId?: string;
  /**
   * Present only when a party's `alreadyReleased` exceeded its final entitlement (the caller's counter
   * is ahead of the ledger). The ledger does NOT claw that back out of the party's pooled available
   * balance any more: it records an OVER_RELEASED incident for the admin and leaves every balance alone.
   */
  overReleased?: Array<{ party: 'PT' | 'GYM' | 'PLATFORM'; amount: string; obligationId: string }>;
  /**
   * Present only when a PT holdback was in force when the contract ended (a rate > 0 that had
   * not been released for inactivity). Left off entirely otherwise, so the result — and the
   * copy of it stored for idempotent replay — for every other termination is exactly what it
   * was before this field existed. Kept apart from `shortfall` above so that figure keeps
   * meaning what its existing readers take it to mean.
   */
  ptHoldback?: {
    /** H = h × price in whole đồng. */
    target: string;
    /** What was really still held back for the PT on this contract when it ended. */
    held: string;
    /** Credited to the client on top of `refund`, taken out of `held`. Zero unless PT-fault. */
    compensation: string;
    /** The rest of the pot, paid to the PT inside `topUp.pt`: held − compensation. */
    returnedToPt: string;
  };
  /**
   * Present only when the termination left unresolved sessions behind (unresolvedSessions > 0).
   * Left off entirely otherwise, so every other result — and its stored replay copy — is exactly
   * what it was before this field existed.
   */
  unresolved?: {
    sessions: number;
    /** What really stays in the three parties' pending for this contract, in whole đồng. */
    amountHeld: string;
    /** The same amount per party: what each one receives if a session is resolved as delivered. */
    byParty: { pt: string; gym: string; platform: string };
  };
}

/** Wording of the client-facing ledger row, per PT-fault reason. Always contains
 * "compensation": withdrawal.repository#sumRefundSourcedCredits matches on that word. */
const PT_FAULT_WORDING: Partial<Record<TerminationReason, string>> = {
  PT_CANCELLED: "the PT's cancellation",
  PT_BANNED: "the PT's removal",
  PT_REPEATED_NO_SHOW: "the PT's repeated no-shows",
};

/**
 * Step 3: the contract stops, for any of the six reasons.
 *
 * One code path serves them all, because the outcome is always the same shape:
 *
 *   final entitlement of a party = rate × (P − refund)
 *
 * So: refund the client, top each party up from pending to whatever their final entitlement
 * exceeds what they were already released, then empty the contract's pending buckets — the
 * residue is the client's refund money and goes back to escrow's custody on their behalf.
 *
 * PT holdback (`ptHoldbackRate`). The held-back pot is still in the PT's pending when the
 * contract ends, and it is part of the PT's final entitlement — so for the endings that are not
 * the PT's fault (COMPLETED, EXPIRED, CLIENT_CANCELLED, MUTUAL) the ordinary top-up above pays it
 * to the PT with no extra step: less was released along the way, so the gap is larger by exactly
 * the pot.
 *
 * For a PT-fault ending (PT_CANCELLED, PT_BANNED, PT_REPEATED_NO_SHOW) the client is also paid
 *
 *   compensation = min( h × base , held , what the PT was still to be paid )
 *
 * where `base` is the value of the sessions never delivered (PT_REPEATED_NO_SHOW adds the
 * sessions already compensated as no-shows — contract-money.ts#holdbackCompensationBase) and
 * `held` is what is really still held back for the PT on this contract at this moment
 * (ptHeld: the ledger-derived pot, clamped to the contract's own pending). It is carved out of
 * that pot: the PT's top-up shrinks by the same amount and the client gets a separate,
 * clearly-described credit. It is NEVER taken from the PT's available balance, never fronted by
 * the platform and never booked as a receivable — nothing held means nothing owed, and the
 * client still gets the normal refund. Whatever of the pot is not used goes to the PT.
 *
 * It runs inside the same wallet-locked transaction and under the same idempotency key as
 * everything else, so it lands with the refund or not at all, and a replay can never post it
 * twice.
 *
 * Unresolved sessions (`unresolvedSessions` = n). The client leaves while n sessions are neither
 * certainly delivered nor certainly not: the PT reported them and the client has not confirmed,
 * or they are disputed. Refunding them would pay the PT nothing for a session that may have been
 * taught; releasing them would pay for one that may not have been. So their value — n × one
 * session's value, the unit and split releaseSession uses — is taken out of BOTH sides:
 *
 *   refund      = the usual refund on the sessions certainly not delivered (P × (N − u − c − n)/N,
 *                 rounded up; × 90% for CLIENT_CANCELLED)
 *   entitlement = rate × (P − compensation − refund) − that party's share of the held value
 *   held        = n × unit, left in each party's own pending for this contract, untouched
 *
 * and refund + Σ entitlement + held = P − compensation, to the đồng. The PT-fault compensation
 * and the holdback top-up are computed on that reduced entitlement, so the unresolved PT share
 * can neither be paid as holdback nor taken as compensation. resolveUnresolvedSession later
 * moves each session's held value to the parties (DELIVERED) or back to the client (NOT_DELIVERED).
 */
export async function terminateContract(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  usedSessions: number;
  /** Cụm A1 — sessions consumed via cash compensation (a PT no-show), not by being trained.
   * Must reach computeTermination or the value of an already-compensated session is handed
   * back to the client a second time on cancellation. Defaults to 0. */
  compensatedSessions?: number;
  /**
   * Sessions the PT reported delivered that the client has not confirmed yet, or that are under
   * dispute: neither used nor unused. Their value is excluded from the refund and from every
   * party's top-up and stays in the three parties' pending for this contract, untouched by the
   * drain, until resolveUnresolvedSession settles each one. Integer, 0..(N − used − compensated);
   * anything else throws before money moves. 0 or absent: every posting is what it always was.
   */
  unresolvedSessions?: number;
  rates: RateTable;
  reason: TerminationReason;
  /** Already moved to each party's available bucket, session by session. */
  alreadyReleased: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
  parties: ContractParties;
  label: string;
  /** Business key `CONTRACT_TERMINATE:<contractId>` — a retry with the same key replays the
   * first call's result instead of settling the contract a second time (plan 1.1). */
  idempotencyKey: string;
  /**
   * The PT holdback rate THIS contract carries (0..1), as snapshotted when it was created.
   * Absent or zero means the contract carries no holdback (or it was already released for
   * inactivity — the caller then sends 0), and termination settles exactly as it did before
   * this parameter existed. There is no fallback to a platform-wide rate here or in
   * contract-money.ts: the caller passes the contract's own value or nothing.
   */
  ptHoldbackRate?: Prisma.Decimal;
}): Promise<TerminationLedgerResult> {
  const { transactionId, price, totalSessions, usedSessions, compensatedSessions, unresolvedSessions, rates, reason, alreadyReleased, parties, label, idempotencyKey, ptHoldbackRate } = params;

  const outcome = computeTermination(
    { price, totalSessions, usedSessions, compensatedSessions, unresolvedSessions, rates, ptHoldbackRate },
    reason,
  );
  const unresolvedCount = unresolvedSessions ?? 0;
  const holdbackPot = holdbackTarget(price, ptHoldbackRate);
  // Only immutable fields are checked/fingerprinted: usedSessions, compensatedSessions,
  // unresolvedSessions and alreadyReleased legitimately differ between a call and its retry.
  const opMeta = contractOpMeta('TERMINATE', { transactionId, price, totalSessions, rates, parties, reason });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, price, rates, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);
  assertGymConsistency(wallets, outcome.entitlement.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, async () => {
    // D77: the late-arrival compensations of this contract come from the ledger, read under the wallet locks, so the
    // figures below (and the preview, which reads the same facts) account for them.
    const lateArrival = await loadLateArrivalDeductions(ops.tx, transactionId, unresolvedCount);
    const outcome = computeTermination(
      { price, totalSessions, usedSessions, compensatedSessions, unresolvedSessions, rates, ptHoldbackRate, lateArrival },
      reason,
    );
    const strict = ledgerStrictOwnFunds();
    const topUp = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;
    // Parties whose caller-supplied `alreadyReleased` is ahead of their final entitlement (strict mode).
    const overReleased: Array<{ party: 'PT' | 'GYM' | 'PLATFORM'; amount: Prisma.Decimal }> = [];
    // Sum of the other parties' positive gaps (what they are still owed on top of what they were released).
    let positiveGapTotal = ZERO;

    // The PT holdback, decided under the wallet locks. `held` is what is really still held back
    // for the PT; `compensation` is the client's share of it (zero unless the PT is at fault).
    // Capped three ways, each for a reason:
    //   · the target h × base — the contract term;
    //   · held — the compensation may only ever come out of the held-back pot;
    //   · what the PT was still to be paid (final entitlement − already released) — so carving
    //     the compensation out of the PT's top-up can never push the top-up below zero and
    //     reach into available money.
    const holding = holdbackPot.greaterThan(0) && !(await holdbackWasReleased(ops, wallets.ptId, transactionId));
    let held = ZERO;
    let compensation = ZERO;
    if (holding) {
      held = await ptHeld(ops, wallets.ptId, transactionId);
      if (outcome.ptFaultCompensationTarget.greaterThan(0)) {
        const ptStillToBePaid = Prisma.Decimal.max(outcome.entitlement.pt.minus(alreadyReleased.pt), ZERO);
        compensation = Prisma.Decimal.min(outcome.ptFaultCompensationTarget, held, ptStillToBePaid);
      }
    }

    /**
     * Bring one party from "what they have already been paid" to "what they are finally owed".
     * A positive gap is topped up out of their pending bucket; a negative gap means they were
     * released more than they ended up entitled to and the excess is clawed back.
     *
     * `reserve` is pending money that must stay behind to be drained into the client's credit
     * instead — the PT's compensation. It is only ever non-zero when the PT was still owed at
     * least that much (see the cap above), so it reduces a top-up and never creates a clawback.
     */
    const settleParty = async (
      walletId: string | null,
      entitlement: Prisma.Decimal,
      released: Prisma.Decimal,
      key: 'pt' | 'gym' | 'platform',
      debtor?: { partnerType: 'PT' | 'GYM'; partnerId: string },
      reserve: Prisma.Decimal = ZERO,
      keepBack: Prisma.Decimal = ZERO,
      /** Rounding dust trimmed off this party's top-up so the client's refund stays whole (see trimTopUps). */
      trimmed: Prisma.Decimal = ZERO,
    ) => {
      if (!walletId) return;
      const gap = entitlement.minus(released).minus(reserve);
      if (gap.greaterThan(0)) positiveGapTotal = positiveGapTotal.plus(gap);
      if (gap.greaterThan(0)) {
        // `keepBack` is the party's share of the unresolved sessions. It sits in this same
        // pending pool but is not what the party is owed now, so a top-up that finds the pool
        // short (a pre-existing shortfall) must never be paid out of it — it reports the gap.
        const pendingHeld = (await ownPending(ops, walletId, transactionId)).minus(reserve).minus(keepBack);
        const available = pendingHeld.greaterThan(0) ? pendingHeld : ZERO;
        const wanted = gap.minus(trimmed);
        const moving = available.lessThan(wanted) ? available : wanted;
        if (moving.greaterThan(0)) {
          await ops.debit(walletId, moving, `${label} — final settlement`, 'PENDING');
          await ops.credit(walletId, moving, `${label} — final settlement`, 'AVAILABLE');
          topUp[key] = moving;
          // Last chance to recover: after this the contract is closed and this partner has
          // no further credits from it to withhold against.
          if (debtor) {
            await recoverReceivables({
              ops,
              walletId,
              revenueWalletId: wallets.revenueId,
              ...debtor,
              justCredited: moving,
              label,
            });
          }
        }
        shortfall = shortfall.plus(gap.minus(trimmed).minus(moving));
      } else if (gap.lessThan(0) && strict) {
        // FH-1 (DQ-5): the caller says this party was released more than it ends up entitled to.
        // Whatever the books say, the answer is NEVER to take it out of the party pooled AVAILABLE
        // (that is money earned on other contracts) and NEVER to move it to REVENUE as a forfeit.
        // Record the discrepancy for the admin; if the money really was paid out, the contract own
        // pending is short and the client refund shows it as an unpaid obligation below.
        overReleased.push({ party: key === 'pt' ? 'PT' : key === 'gym' ? 'GYM' : 'PLATFORM', amount: gap.abs() });
      } else if (gap.lessThan(0)) {
        const owed = gap.abs();
        const heldAvailable = ops.balance(walletId, 'AVAILABLE');
        const clawed = heldAvailable.lessThan(owed) ? heldAvailable : owed;
        if (clawed.greaterThan(0)) {
          await ops.debit(walletId, clawed, `${label} — over-released, clawed back`, 'AVAILABLE');
          await ops.credit(walletId, clawed, `${label} — returned to pending`, 'PENDING');
          topUp[key] = clawed.negated();
        }
        shortfall = shortfall.plus(owed.minus(clawed));
      }
    };

    // Rounding dust (strict mode). The three-way split rounds the PT and gym DOWN and gives the platform the
    // remainder, at every split: the per-session releases (computeSessionRelease), the unresolved hold and the final
    // entitlement. Those remainders do not add up the same way, so a party can end a whole-dong or two AHEAD of its
    // final entitlement (the platform) while another is that much BEHIND (PT / gym top-up): the books balance in
    // total, but the pending left to drain is a few dong short of the refund the formula (and the preview) quotes.
    // The client is paid first: before any top-up is made, the top-ups are trimmed, in a fixed order (PT, gym,
    // platform), by exactly what the refund would otherwise be short. The over-release that dust caused is netted
    // against it, so it does not show up as an incident. Anything beyond that is NOT dust (a real shortfall, or a
    // caller counter far ahead of the ledger) and is reported as before.
    const trim = { pt: ZERO, gym: ZERO, platform: ZERO };
    let trimmedTotal = ZERO;
    if (strict) {
      const plan: Array<{ key: 'pt' | 'gym' | 'platform'; walletId: string | null; ent: Prisma.Decimal; rel: Prisma.Decimal; reserve: Prisma.Decimal }> = [
        { key: 'pt', walletId: wallets.ptId, ent: outcome.entitlement.pt, rel: alreadyReleased.pt, reserve: compensation },
        { key: 'gym', walletId: wallets.gymId, ent: outcome.entitlement.gym, rel: alreadyReleased.gym, reserve: ZERO },
        { key: 'platform', walletId: wallets.revenueId, ent: outcome.entitlement.platform, rel: alreadyReleased.platform, reserve: ZERO },
      ];
      let projectedDrain = ZERO;
      const topups: Record<string, Prisma.Decimal> = { pt: ZERO, gym: ZERO, platform: ZERO };
      for (const q of plan) {
        if (!q.walletId) continue;
        const own = await ownPending(ops, q.walletId, transactionId);
        const wantedHeld = outcome.unresolvedHeld[q.key];
        const gap = q.ent.minus(q.rel).minus(q.reserve);
        const room = own.minus(q.reserve).minus(wantedHeld);
        const topup = gap.greaterThan(0) ? Prisma.Decimal.min(gap, room.greaterThan(0) ? room : ZERO) : ZERO;
        topups[q.key] = topup;
        const after = own.minus(topup);
        projectedDrain = projectedDrain.plus(after.greaterThan(wantedHeld) ? after.minus(wantedHeld) : ZERO);
      }
      // Only dust is absorbed this way (at most 2 dong per session of the contract): a bigger shortage is a real one -
      // the parties' earned top-ups are not given up for it; it becomes the client's unpaid obligation below.
      let short = Prisma.Decimal.min(outcome.refund.plus(compensation).minus(projectedDrain), new Prisma.Decimal(2 * totalSessions));
      for (const q of plan) {
        if (short.lessThanOrEqualTo(0)) break;
        const cut = Prisma.Decimal.min(short, topups[q.key]);
        trim[q.key] = cut;
        short = short.minus(cut);
        trimmedTotal = trimmedTotal.plus(cut);
      }
    }

    await settleParty(wallets.ptId, outcome.entitlement.pt, alreadyReleased.pt, 'pt', {
      partnerType: 'PT',
      partnerId: parties.ptUserId,
    }, compensation, outcome.unresolvedHeld.pt, trim.pt);
    await settleParty(wallets.gymId, outcome.entitlement.gym, alreadyReleased.gym, 'gym',
      parties.gymId ? { partnerType: 'GYM', partnerId: parties.gymId } : undefined, ZERO, outcome.unresolvedHeld.gym, trim.gym);
    await settleParty(wallets.revenueId, outcome.entitlement.platform, alreadyReleased.platform, 'platform',
      undefined, ZERO, outcome.unresolvedHeld.platform, trim.platform);

    // Net the dust: whatever was trimmed off the top-ups is the over-release it came from.
    if (trimmedTotal.greaterThan(0)) {
      let net = trimmedTotal;
      for (const o of overReleased) {
        const cut = Prisma.Decimal.min(net, o.amount);
        o.amount = o.amount.minus(cut);
        net = net.minus(cut);
      }
    }
    // What is left of an over-release is still dust (and not an incident) when it is no more than the whole-dong
    // remainders the per-session splits can accumulate (at most 2 dong per session of the contract) AND another
    // party's top-up in this very settlement is the other side of the same rounding. Anything bigger, or without that
    // counterpart, is a real discrepancy and stays an OVER_RELEASED incident.
    if (strict) {
      let counterpart = positiveGapTotal.minus(trimmedTotal);
      const dustCeiling = new Prisma.Decimal(2 * totalSessions);
      for (const o of overReleased) {
        if (o.amount.lessThanOrEqualTo(dustCeiling) && o.amount.lessThanOrEqualTo(counterpart)) {
          counterpart = counterpart.minus(o.amount);
          o.amount = ZERO;
        }
      }
      for (let i = overReleased.length - 1; i >= 0; i--) if (overReleased[i].amount.lessThanOrEqualTo(0)) overReleased.splice(i, 1);
    }

    // Drain whatever THIS CONTRACT has left in the three pending buckets — that residue is
    // exactly the client's refund (plus any forfeited share, plus the PT-fault compensation
    // reserved above), still sitting under the parties' names. Only this contract's: each of
    // those buckets is a pool that also holds every other contract's, membership's and
    // referral's unearned money, and draining the pool would refund this client out of
    // strangers' money and then book the surplus to REVENUE.
    //
    // The unresolved sessions' value is the exception: it stays. Each party's share of it is left
    // in that party's own pending for this contract (never more than the contract's pending
    // there actually holds, so a bucket cannot go negative and a shortfall is reported, not
    // invented). `kept` is what really stayed.
    let drained = ZERO;
    const kept = { pt: ZERO, gym: ZERO, platform: ZERO };
    for (const [id, key] of [[wallets.ptId, 'pt'], [wallets.gymId, 'gym'], [wallets.revenueId, 'platform']] as const) {
      if (!id) continue;
      const own = await ownPending(ops, id, transactionId);
      const wanted = outcome.unresolvedHeld[key];
      const keep = own.lessThan(wanted) ? own : wanted;
      kept[key] = keep;
      const left = own.minus(keep);
      if (left.greaterThan(0)) {
        await ops.debit(id, left, `${label} — pending released on termination`, 'PENDING');
        drained = drained.plus(left);
      }
    }

    // What the client can really be paid: strict mode credits only what this contract's own pending
    // funded (refund first, then the PT-fault compensation); legacy credits in full and fronts the gap.
    const owedToClient = outcome.refund.plus(compensation);
    let refundPaid = outcome.refund;
    let compensationPaid = compensation;
    if (strict && drained.lessThan(owedToClient)) {
      refundPaid = Prisma.Decimal.min(outcome.refund, drained);
      compensationPaid = Prisma.Decimal.min(compensation, drained.minus(refundPaid));
    }

    if (refundPaid.greaterThan(0)) {
      await ops.credit(wallets.clientId, refundPaid, `${label} — refund (${reason})`);
      // Escrow does not move. The cash never left the platform; the claim on it passed from
      // the parties' pending buckets to the client's balance. Only a real payout debits escrow.
    }

    // Its own ledger row, not folded into the refund: the client is owed two different things
    // for two different reasons, and an auditor has to be able to tell them apart. The wording
    // matters — a client may only withdraw credits described as a refund or a compensation
    // (withdrawal.repository#sumRefundSourcedCredits matches on this text). Escrow does not
    // move, for the same reason it does not for the refund.
    if (compensationPaid.greaterThan(0)) {
      await ops.credit(
        wallets.clientId,
        compensationPaid,
        `${label} — compensation for ${PT_FAULT_WORDING[reason] ?? 'the PT'} (from the PT's held-back earnings)`,
      );
    }

    // Every đồng drained out of pending must land somewhere, and the client's refund and
    // compensation must be fully funded. Reconcile the two. The compensation was reserved out
    // of the PT's own pending above, so it is always among what was drained.
    const residue = drained.minus(owedToClient);
    let obligationId: string | undefined;
    if (residue.greaterThan(0)) {
      // Drained more than the client is owed — the surplus is the parties' forfeited share
      // (a cancellation fee, say) and belongs to the platform, not to nobody.
      await ops.credit(wallets.revenueId, residue, `${label} — forfeited share`, 'AVAILABLE');
    } else if (residue.lessThan(0) && strict) {
      // Drained less than the client is owed: this contract's own pending was already short.
      // The client was credited what could be drawn; the rest is an OPEN obligation (FH-1),
      // not fronted by the platform and not a PT debt.
      obligationId = await recordObligation(ops, {
        key: idempotencyKey,
        transactionId,
        contractRef: label,
        kind: 'REFUND_SHORT',
        party: 'CLIENT',
        owed: owedToClient,
        paid: refundPaid.plus(compensationPaid),
      });
    } else if (residue.lessThan(0)) {
      // LEGACY (LEDGER_STRICT_OWN_FUNDS=false): the platform funds the difference and books it
      // against the PT, exactly as for a no-show.
      await coverShortfall(ops, wallets.revenueId, residue.abs(), {
        partnerType: 'PT',
        partnerId: parties.ptUserId,
        reason: `Termination refund shortfall (${label}, ${reason})`,
        transactionId,
      });
    }

    const overReleasedOut: NonNullable<TerminationLedgerResult['overReleased']> = [];
    for (const o of overReleased) {
      const id = await recordObligation(ops, {
        key: `${idempotencyKey}#OVER_RELEASED:${o.party}`,
        transactionId,
        contractRef: label,
        kind: 'OVER_RELEASED',
        party: o.party,
        owed: o.amount,
        paid: ZERO,
      });
      overReleasedOut.push({ party: o.party, amount: o.amount.toFixed(2), obligationId: id });
    }
    const paidToClient = refundPaid.plus(compensationPaid);
    const unpaidToClient = owedToClient.minus(paidToClient);

    // Facts for the later operations, written only when sessions were left unresolved (zero
    // amounts: no balance moves). The count lets resolveUnresolvedSession refuse a session
    // beyond the ones this termination left open, and the settled marker stops the idle-holdback
    // release from reading the pot (still derivable from the retained rows) while the contract's
    // pending is non-empty only because of the unresolved sessions.
    const keptTotal = kept.pt.plus(kept.gym).plus(kept.platform);
    if (unresolvedCount > 0) {
      await ops.credit(wallets.revenueId, ZERO, `${label}${UNRESOLVED_HELD_MARKER}${unresolvedCount}`, 'PENDING');
      if (holding) await ops.debit(wallets.ptId, ZERO, `${label}${HOLDBACK_SETTLED_SUFFIX}`, 'PENDING');
    }

    return {
      reason,
      refund: refundPaid.toFixed(2),
      entitlement: {
        pt: outcome.entitlement.pt.toFixed(2),
        gym: outcome.entitlement.gym.toFixed(2),
        platform: outcome.entitlement.platform.toFixed(2),
      },
      topUp: { pt: topUp.pt.toFixed(2), gym: topUp.gym.toFixed(2), platform: topUp.platform.toFixed(2) },
      returnedToEscrow: drained.toFixed(2),
      shortfall: shortfall.plus(residue.lessThan(0) ? residue.abs() : ZERO).toFixed(2),
      owed: owedToClient.toFixed(2),
      paid: paidToClient.toFixed(2),
      unpaid: (strict ? unpaidToClient : ZERO).toFixed(2),
      ...(obligationId ? { obligationId } : {}),
      ...(overReleasedOut.length > 0 ? { overReleased: overReleasedOut } : {}),
      // Spread in rather than assigned, so the key does not exist at all when no holdback was
      // in force: an explicit `undefined` would vanish when the result is stored as JSON for
      // replay, and the first call would then differ from every retry of it.
      ...(holding
        ? {
            ptHoldback: {
              target: holdbackPot.toFixed(2),
              held: held.toFixed(2),
              compensation: compensationPaid.toFixed(2),
              returnedToPt: held.minus(compensationPaid).toFixed(2),
            },
          }
        : {}),
      ...(unresolvedCount > 0
        ? {
            unresolved: {
              sessions: unresolvedCount,
              amountHeld: keptTotal.toFixed(2),
              byParty: { pt: kept.pt.toFixed(2), gym: kept.gym.toFixed(2), platform: kept.platform.toFixed(2) },
            },
          }
        : {}),
    };
    }),
  );
}

export interface ReleaseHoldbackResult {
  /** What went from the PT's pending to their available balance. 0 when nothing was held. */
  released: string;
}

/**
 * The contract has had no session for a long time (user-service decides what "a long time"
 * is): hand the PT the held-back pot now, and from here on treat the contract as having no
 * holdback — releaseSession releases in full and terminateContract owes no compensation,
 * because holdbackWasReleased finds the marker row this writes.
 *
 * The amount is derived from the ledger (ptHeld), not from the caller. Idempotent two ways: the
 * business key (`HOLDBACK_RELEASE:<contractId>`) replays the first result, and the marker row
 * makes a second call under a different key for the same payment a no-op as well. The marker is
 * written even when nothing was held (as a zero-amount row), so "released" is a fact in the
 * ledger whether or not there was anything to release.
 *
 * Safe on a contract that has already ended: its pending has been drained, ptHeld is clamped to
 * that pending, so nothing moves.
 */
export async function releasePtHoldback(params: {
  transactionId: string;
  parties: ContractParties;
  label: string;
  /** Business key `HOLDBACK_RELEASE:<contractId>`. */
  idempotencyKey: string;
}): Promise<ReleaseHoldbackResult> {
  const { transactionId, parties, label, idempotencyKey } = params;
  const opMeta = contractOpMeta('RELEASE_HOLDBACK', { transactionId, parties });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, async () => {
      if (await holdbackWasReleased(ops, wallets.ptId, transactionId)) return { released: '0.00' };

      const pot = await ptHeld(ops, wallets.ptId, transactionId);
      const description = `${label}${HOLDBACK_RELEASED_SUFFIX}`;
      await ops.debit(wallets.ptId, pot, description, 'PENDING');
      if (pot.greaterThan(0)) {
        await ops.credit(wallets.ptId, pot, description, 'AVAILABLE');
        // The PT works any debt they owe the platform off out of what they just earned, as for
        // every other release.
        await recoverReceivables({
          ops,
          walletId: wallets.ptId,
          revenueWalletId: wallets.revenueId,
          partnerType: 'PT',
          partnerId: parties.ptUserId,
          justCredited: pot,
          label,
        });
      }
      logger.info(`[ContractLedger] ${label}: PT holdback of ${pot.toFixed(2)} released for inactivity`);
      return { released: pot.toFixed(2) };
    }),
  );
}

export interface ResolveUnresolvedResult {
  outcome: 'DELIVERED' | 'NOT_DELIVERED';
  /** One session's value, the unit releaseSession uses. */
  unit: string;
  /**
   * What ACTUALLY moved. DELIVERED: each party's share PENDING → AVAILABLE (client 0).
   * NOT_DELIVERED: each party's share out of its pending (pt/gym/platform) and, in `client`, the
   * sum credited to the client's wallet.
   */
  moved: { pt: string; gym: string; platform: string; client: string };
  /** D77: present only when the session had a late-arrival compensation, deducted from what was held for it. */
  lateArrivalDeducted?: { pt: string; gym: string; platform: string };
  /**
   * What the contract's own pending could not fund of the session's value (unit − Σ moved), so a
   * short ledger is visible rather than papered over. "0.00" on a healthy ledger.
   */
  shortfall: string;
}

/** Refused before any money moves; the route maps it to 409. */
export class UnresolvedSessionError extends Error {
  constructor(public readonly code: 'NO_UNRESOLVED_HELD' | 'ALL_UNRESOLVED_RESOLVED', message: string) {
    super(message);
  }
}

/**
 * One session that was left unresolved when its contract ended (terminateContract's
 * `unresolvedSessions`) has been decided. The value held for it is one session's value —
 * `unit = floor(P / N)` split three ways exactly as releaseSession splits it — sitting in the
 * parties' pending for this contract.
 *
 *   DELIVERED      The session was taught: each party's share goes PENDING → AVAILABLE, the same
 *                  rows releaseSession writes, including the recovery of any debt the PT or gym
 *                  owes the platform out of what was just earned. NO PT holdback is applied, and
 *                  `ptHoldbackRate` (accepted so the caller can send the same body as for
 *                  release-session) is only validated: the contract is over, and the termination
 *                  that left this session open already paid the held-back pot out (as it does for
 *                  every non-PT-fault ending) and recorded that. Holding the PT's share again
 *                  would strand it in a contract that has no further session to release it, and
 *                  would pay the PT less than the same session confirmed before the exit did.
 *   NOT_DELIVERED  The session was not taught: the three shares are taken out of the parties'
 *                  pending and credited to the client in ONE separate ledger row whose
 *                  description says "refund" (withdrawal.repository#sumRefundSourcedCredits
 *                  matches the word, so the client can withdraw it). Escrow does not move — the
 *                  cash never left; the claim passed from the parties to the client.
 *
 * Guarantees.
 *  · Own money only: every amount is clamped to `ownPending` — the rows carrying THIS contract's
 *    transaction id — so a neighbouring contract's, membership's or referral's pending is out of
 *    reach, and no bucket can go negative. What the contract cannot fund is reported in
 *    `shortfall`, never invented, never fronted.
 *  · Exactly once per session, one way only: the business key `UNRESOLVED_SESSION:<sessionId>`
 *    goes through withIdempotentLedgerOp, so a retry — or the same session resolved the other
 *    way — gets the first result back and posts nothing.
 *  · Only for a contract that really was ended with unresolved sessions, and only as many as it
 *    was ended with: terminateContract leaves two zero-amount marker rows in the platform's
 *    pending bucket (the count held, and one per resolution). Without them this call is refused
 *    (409 upstream) — otherwise it could eat the pending of an ACTIVE contract's undelivered
 *    sessions, or of a second session nobody left open.
 *  · Rounding. Everything here is whole đồng and equals what releaseSession would have moved for
 *    the session. The sub-đồng left over from P / N is not part of the held value; it went to the
 *    parties with the exit settlement, so after all sessions are resolved a client's total can be
 *    at most one đồng per NOT_DELIVERED session below what classifying the session as unused from
 *    the start would have refunded — never more, never invented from another party.
 */
export async function resolveUnresolvedSession(params: {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** Business key `UNRESOLVED_SESSION:<sessionId>`. */
  idempotencyKey: string;
  outcome: 'DELIVERED' | 'NOT_DELIVERED';
  /** Validated only — see DELIVERED above. */
  ptHoldbackRate?: Prisma.Decimal;
}): Promise<ResolveUnresolvedResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey, outcome, ptHoldbackRate } = params;
  if (outcome !== 'DELIVERED' && outcome !== 'NOT_DELIVERED') throw new Error(`unknown outcome ${String(outcome)}`);
  assertHoldbackRateValid(ptHoldbackRate);
  const opMeta = contractOpMeta('RESOLVE_UNRESOLVED', { transactionId, price, totalSessions, rates, parties, reason: outcome });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, price, rates, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);
  const rel = computeSessionRelease(price, totalSessions, rates);
  assertGymConsistency(wallets, rel.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, async () => {
      const markerWhere = { walletId: wallets.revenueId, transactionId, bucket: 'PENDING' as const };
      const heldMarker = await ops.tx.walletLedgerEntry.findFirst({
        where: { ...markerWhere, description: { contains: UNRESOLVED_HELD_MARKER } },
        select: { description: true },
      });
      const openedWith = heldMarker?.description ? Number(heldMarker.description.split(UNRESOLVED_HELD_MARKER).pop()) : 0;
      if (!heldMarker || !Number.isInteger(openedWith) || openedWith <= 0) {
        throw new UnresolvedSessionError('NO_UNRESOLVED_HELD', `contract transaction ${transactionId} was not ended with unresolved sessions`);
      }
      const alreadyResolved = await ops.tx.walletLedgerEntry.count({
        where: { ...markerWhere, description: { contains: UNRESOLVED_RESOLVED_MARKER } },
      });
      if (alreadyResolved >= openedWith) {
        throw new UnresolvedSessionError('ALL_UNRESOLVED_RESOLVED', `all ${openedWith} unresolved session(s) of contract transaction ${transactionId} are already resolved`);
      }

      const moved = { pt: ZERO, gym: ZERO, platform: ZERO };
      // D77: the held value of a session that had a late-arrival compensation is (share - the party's portion of it).
      const lateDeduction = await lateDeductionFor(ops, transactionId, idempotencyKey);
      const dueOf = (full: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') =>
        lateDeduction ? Prisma.Decimal.max(full.minus(lateDeduction[key]), ZERO) : full;
      const parts: Array<{
        key: 'pt' | 'gym' | 'platform';
        walletId: string | null;
        amount: Prisma.Decimal;
        debtor?: { partnerType: 'PT' | 'GYM'; partnerId: string };
      }> = [
        { key: 'pt', walletId: wallets.ptId, amount: dueOf(rel.pt, 'pt'), debtor: { partnerType: 'PT', partnerId: parties.ptUserId } },
        { key: 'gym', walletId: wallets.gymId, amount: dueOf(rel.gym, 'gym'), debtor: parties.gymId ? { partnerType: 'GYM', partnerId: parties.gymId } : undefined },
        { key: 'platform', walletId: wallets.revenueId, amount: dueOf(rel.platform, 'platform') },
      ];

      for (const part of parts) {
        if (!part.walletId || part.amount.lessThanOrEqualTo(0)) continue;
        const own = await ownPending(ops, part.walletId, transactionId);
        const moving = own.lessThan(part.amount) ? own : part.amount;
        if (moving.lessThanOrEqualTo(0)) {
          logger.warn(`[ContractLedger] ${part.key} pending empty for ${label} — nothing to move for the unresolved session`);
          continue;
        }
        if (outcome === 'DELIVERED') {
          await ops.debit(part.walletId, moving, `${label} — unresolved session delivered (release to available)`, 'PENDING');
          await ops.credit(part.walletId, moving, `${label} — session earned`, 'AVAILABLE');
          // Same as every release: a partner who owes the platform works the debt off out of
          // what they just earned, before it is withdrawable.
          if (part.debtor) {
            await recoverReceivables({
              ops,
              walletId: part.walletId,
              revenueWalletId: wallets.revenueId,
              ...part.debtor,
              justCredited: moving,
              label,
            });
          }
        } else {
          await ops.debit(part.walletId, moving, `${label} — unresolved session not delivered (pending returned)`, 'PENDING');
        }
        moved[part.key] = moving;
      }

      const movedTotal = moved.pt.plus(moved.gym).plus(moved.platform);
      let toClient = ZERO;
      if (outcome === 'NOT_DELIVERED' && movedTotal.greaterThan(0)) {
        toClient = movedTotal;
        await ops.credit(wallets.clientId, toClient, `${label} — refund (unresolved session not delivered)`);
      }
      await ops.credit(wallets.revenueId, ZERO, `${label}${UNRESOLVED_RESOLVED_MARKER}${outcome}`, 'PENDING');

      return {
        outcome,
        unit: rel.unit.toFixed(2),
        moved: {
          pt: moved.pt.toFixed(2),
          gym: moved.gym.toFixed(2),
          platform: moved.platform.toFixed(2),
          client: toClient.toFixed(2),
        },
        shortfall: dueOf(rel.pt, 'pt').plus(dueOf(rel.gym, 'gym')).plus(dueOf(rel.platform, 'platform')).minus(movedTotal).toFixed(2),
        ...(lateDeduction ? { lateArrivalDeducted: amountsToStrings(lateDeduction) } : {}),
      };
    }),
  );
}

/** Reads both buckets of a wallet without locking — for display and reconciliation only. */
export async function readWallet(ownerType: 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM', ownerId: string) {
  const w = await walletService.getOrCreateWallet(ownerType, ownerId);
  return {
    id: w.id,
    ownerType: w.ownerType,
    ownerId: w.ownerId,
    availableBalance: w.availableBalance.toFixed(2),
    pendingBalance: w.pendingBalance.toFixed(2),
    status: w.status,
  };
}

export { prisma as ledgerPrisma };
