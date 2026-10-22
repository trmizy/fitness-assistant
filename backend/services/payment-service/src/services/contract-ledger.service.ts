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
  PT_FAULT_REASONS,
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
  RequestDoesNotMatchTransactionError,
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

export type ObligationKind = 'NO_SHOW' | 'LATE_ARRIVAL' | 'REFUND_SHORT' | 'OVER_RELEASED';

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
export async function recordObligation(
  ops: LedgerOps,
  o: {
    key: string;
    transactionId: string;
    contractRef: string;
    kind: ObligationKind;
    party: 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';
    owed: Prisma.Decimal;
    paid: Prisma.Decimal;
    /** Why, in words (D77 record-only late arrival). */
    reason?: string;
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
      ...(o.reason ? { reason: o.reason } : {}),
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
 * already released in full before D77 keeps the outcome it had and nothing is clawed back.
 */
async function lateDeductionFor(ops: LedgerOps, transactionId: string, opKey: string): Promise<PartyAmounts | null> {
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
  const lateOps = await db.ledgerOperation.findMany({ where: { transactionId, kind: 'LATE_ARRIVAL' }, orderBy: { createdAt: 'asc' } });
  let openTaken = 0;
  for (const late of lateOps) {
    const charged = chargedOf(late.result);
    if (!charged) continue;
    // A compensation that charged nothing (record-only obligation, or one whose contract money was already spent) deducts nothing from
    // anyone: it must not take the place of a real one in the "first N open" attribution below.
    if (charged.pt.plus(charged.gym).plus(charged.platform).lessThanOrEqualTo(0)) continue;
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

// ── PT holdback bookkeeping (FH-9) ───────────────────────────────────────────
//
// A contract that carries a holdback rate keeps part of the PT's EARNINGS on that contract in the PT wallet's HOLDBACK bucket
// instead of paying them to AVAILABLE (contract-money.ts, holdbackTarget / splitReleaseWithHoldback). The held money is earned (it
// left PENDING, so it is no longer "unearned money of a session still to come"), it is the PT's, and it is NOT withdrawable.
//
// Because it lives in its own bucket, the contract's held amount is a real number of the ledger, not a text match on a description:
//
//   held(contract) = Σ HOLDBACK credits − Σ HOLDBACK debits of the rows carrying THAT contract's payment transaction id
//
// and the wallet's HOLDBACK balance is the sum over the PT's contracts. Nothing that draws on PENDING (a no-show / late-arrival charge,
// a refund, the termination drain) can reach it, nothing withdraws from it, and it leaves in exactly two ways, both below: as the
// contract's own verified PT-fault compensation to the client, and as the release to the PT's AVAILABLE once the contract has ended and
// is reconciled. Descriptions are for people reading the ledger; no code matches on them.
export const HOLDBACK_RETAINED_SUFFIX = ' — PT holdback retained';
export const HOLDBACK_RELEASED_SUFFIX = ' — PT holdback released to available';
/**
 * Zero-amount rows in the platform's pending bucket that make "this contract was ended with
 * unresolved sessions" and "this many have been resolved since" facts of the ledger, readable
 * by resolveUnresolvedSession without any schema change. See that function.
 */
export const UNRESOLVED_HELD_MARKER = ' — unresolved sessions held: ';
export const UNRESOLVED_RESOLVED_MARKER = ' — unresolved session resolved: ';

/**
 * What is held back for the PT on this contract right now: the ledger-derived HOLDBACK sum of this contract's own rows, never more
 * than the wallet's HOLDBACK bucket really holds (on a damaged ledger the sum of one contract could exceed it; nothing is invented).
 */
export async function ptHeld(ops: LedgerOps, ptWalletId: string, transactionId: string): Promise<Prisma.Decimal> {
  const rows = await ops.tx.walletLedgerEntry.findMany({
    where: { walletId: ptWalletId, transactionId, bucket: 'HOLDBACK' },
    select: { entryType: true, amount: true },
  });
  const pot = rows.reduce(
    (sum, r) => (r.entryType === 'CREDIT' ? sum.plus(r.amount) : sum.minus(r.amount)),
    ZERO,
  );
  if (pot.lessThanOrEqualTo(0)) return ZERO;
  const bucket = ops.balance(ptWalletId, 'HOLDBACK');
  return pot.lessThan(bucket) ? pot : bucket;
}

/**
 * The hold's own snapshot on the payment transaction (metadata.ptHoldback = { rate, target, policy }), written once, the first time a
 * session of the contract is held. The caller keeps sending the rate from the contract's snapshot; this is the ledger's copy: a later
 * call that disagrees with it is refused (a changed rate must never change the target of money already held), and the PT views read the
 * target from here. JSONB merge in the same DB transaction, under the PT wallet lock.
 */
export const HOLDBACK_POLICY_VERSION = 1;
async function recordHoldbackSnapshot(ops: LedgerOps, transactionId: string, rate: Prisma.Decimal, target: Prisma.Decimal): Promise<void> {
  const txn = await ops.tx.paymentTransaction.findUnique({ where: { id: transactionId }, select: { metadata: true } });
  const snap = ((txn?.metadata ?? {}) as { ptHoldback?: { rate?: string; target?: string } }).ptHoldback;
  if (snap) {
    if (!new Prisma.Decimal(snap.rate ?? NaN).equals(rate) || !new Prisma.Decimal(snap.target ?? NaN).equals(target)) {
      throw new RequestDoesNotMatchTransactionError(
        `holdback rate/target ${rate.toString()}/${target.toString()} does not match the snapshot ${snap.rate}/${snap.target} frozen on transaction ${transactionId}`,
      );
    }
    return;
  }
  const patch = JSON.stringify({ ptHoldback: { rate: rate.toString(), target: target.toFixed(0), policy: HOLDBACK_POLICY_VERSION } });
  await ops.tx.$executeRawUnsafe(
    `UPDATE payment_transactions SET metadata = coalesce(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
    patch,
    transactionId,
  );
}

/**
 * Whether this contract's ending was already recorded by the ledger (a TERMINATE operation exists for its payment transaction). From
 * then on nothing is held back any more: a late call (a slow release that outlived its caller) must never raise the hold of a contract
 * that has ended.
 */
export async function contractEndingRecorded(ops: LedgerOps, transactionId: string): Promise<boolean> {
  const row = await ops.tx.ledgerOperation.findFirst({ where: { transactionId, kind: 'TERMINATE' }, select: { id: true } });
  return row !== null;
}

/** States in which the client has NOT been verifiably paid: open, under review, approved for payment, waiting for a second person to verify the evidence, and the legacy unverified "paid externally". */
export const OBLIGATION_STILL_OWED = ['OPEN', 'UNDER_REVIEW', 'APPROVED_FOR_PAYMENT', 'AWAITING_EVIDENCE', 'PAID_EXTERNALLY'] as const;

/** The kinds that are attributable to the PT (their share): a PT no-show / late arrival. REFUND_SHORT (the contract's own money ran short) and OVER_RELEASED (an incident) are NOT the PT's liability, so nothing is reserved for them. */
const PT_BORNE_OBLIGATION_KINDS = ['NO_SHOW', 'LATE_ARRIVAL'] as const;

/**
 * The PT-borne part of an amount: floor(amount x the contract's frozen PT rate). The gym's and the platform's portions of a charge are NEVER
 * borne by the PT, so a reserve (and a verified payment out of it) is sized on this share only.
 */
export function ptBorneShare(amount: Prisma.Decimal, rates: RateTable): Prisma.Decimal {
  return amount.mul(rates.ptRate).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
}

/** PT_HOLDBACK_REVIEW_DAYS (default 14, D-HOLD_REVIEW_DAYS): how long a reserve may wait for a decision before the admin report calls it overdue. */
export function holdbackReviewDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PT_HOLDBACK_REVIEW_DAYS ?? 14);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

export type HoldbackReviewKind = 'PT_FAULT' | 'OPEN_OBLIGATION' | 'UNSECURED_DISPUTE' | 'UNCOMPUTABLE';

/** One durable review item for a reserve kept in HOLDBACK. Written once, with the ending (key per cause). */
async function createHoldbackReview(
  ops: LedgerOps,
  r: { transactionId: string; kind: HoldbackReviewKind; reserve: Prisma.Decimal; reason: string; relatedRef?: string | null },
): Promise<string> {
  const key = `HBR:${r.transactionId}:${r.kind}${r.relatedRef && r.kind === 'OPEN_OBLIGATION' ? `:${r.relatedRef}` : ''}`;
  const row = await ops.tx.ptHoldbackReview.create({
    data: {
      key,
      transactionId: r.transactionId,
      kind: r.kind,
      reserve: r.reserve,
      reason: r.reason,
      relatedRef: r.relatedRef ?? null,
      reviewBy: new Date(Date.now() + holdbackReviewDays() * 24 * 3600 * 1000),
      // The queue that handles it (a person can take it over by assigning themselves); never empty, so no reserve is ownerless.
      handler: (process.env.PT_HOLDBACK_REVIEW_HANDLER ?? 'ADMIN_FINANCE_QUEUE').trim() || 'ADMIN_FINANCE_QUEUE',
    },
  });
  logger.warn(`[ContractLedger] ${r.transactionId}: PT holdback reserve ${r.reserve.toFixed(2)} kept for ${r.kind} (review ${row.id}) - ${r.reason}`);
  return row.id;
}

/** How many sessions the ending left unresolved and nobody has decided yet (the marker rows resolveUnresolvedSession uses). */
async function unresolvedRemaining(ops: LedgerOps, revenueWalletId: string, transactionId: string): Promise<number> {
  const markerWhere = { walletId: revenueWalletId, transactionId, bucket: 'PENDING' as const };
  const held = await ops.tx.walletLedgerEntry.findFirst({
    where: { ...markerWhere, description: { contains: UNRESOLVED_HELD_MARKER } },
    select: { description: true },
  });
  if (!held?.description) return 0;
  const opened = Number(held.description.split(UNRESOLVED_HELD_MARKER).pop());
  if (!Number.isInteger(opened) || opened <= 0) return 0;
  const resolved = await ops.tx.walletLedgerEntry.count({
    where: { ...markerWhere, description: { contains: UNRESOLVED_RESOLVED_MARKER } },
  });
  return Math.max(0, opened - resolved);
}

/**
 * HOLDBACK -> AVAILABLE for the PT, one pair of rows. The ONLY way held money reaches the PT. It moves at most what the contract
 * really holds (ptHeld), so a second call finds nothing and cannot pay twice, and it never touches another contract's held money.
 */
export async function releaseHeldToAvailable(
  ops: LedgerOps,
  ptWalletId: string,
  transactionId: string,
  label: string,
  amount: Prisma.Decimal,
): Promise<Prisma.Decimal> {
  if (amount.lessThanOrEqualTo(0)) return ZERO;
  const held = await ptHeld(ops, ptWalletId, transactionId);
  const moving = held.lessThan(amount) ? held : amount;
  if (moving.lessThanOrEqualTo(0)) return ZERO;
  await ops.debit(ptWalletId, moving, `${label}${HOLDBACK_RELEASED_SUFFIX}`, 'HOLDBACK');
  await ops.credit(ptWalletId, moving, `${label}${HOLDBACK_RELEASED_SUFFIX}`, 'AVAILABLE');
  return moving;
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
      // platform does not front it and no PartnerReceivable is created. This is a financial
      // invariant (D48), not a feature: there is no flag, env or API that brings fronting back.
      const residue = drained.minus(price);
      const paid = residue.lessThan(0) ? drained : price;
      let obligationId: string | undefined;
      if (paid.greaterThan(0)) {
        await ops.credit(wallets.clientId, paid, `${label} — refund (contract could not be activated)`);
      }
      if (residue.greaterThan(0)) {
        await ops.credit(wallets.revenueId, residue, `${label} — surplus of reversed pending`, 'AVAILABLE');
      } else if (residue.lessThan(0)) {
        obligationId = await recordObligation(ops, {
          key: idempotencyKey,
          transactionId,
          contractRef: label,
          kind: 'REFUND_SHORT',
          party: 'CLIENT',
          owed: price,
          paid,
        });
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
   * Present only when this call applied a PT holdback (a rate > 0 on a contract that has not ended).
   * Left off entirely otherwise, so the result — and the copy of it stored for
   * idempotent replay — for a contract without a holdback is exactly what it was before this
   * field existed.
   */
  /** D77: present only when this session had a late-arrival compensation, deducted from what the parties were released. */
  lateArrivalDeducted?: { pt: string; gym: string; platform: string };
  ptHoldback?: {
    /** H = h × (the PT's expected income on this contract) in whole đồng: how much of the PT's earnings is held back. */
    target: string;
    /** Taken out of THIS session's PT entitlement (after any D77 deduction) and put in the HOLDBACK bucket. */
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
 * PT holdback (FH-9). When the contract carries a `ptHoldbackRate` h, the PT's entitlement for the session (their share after
 * the D77 late-arrival deduction; a PT no-show session is not released at all, so nothing is held for it) is not released in full
 * until a pot of H = h × (the PT's expected income on the contract) is held: the session puts min(entitlement, H − heldSoFar)
 * into the PT's HOLDBACK bucket and the rest goes to AVAILABLE (contract-money.ts#splitReleaseWithHoldback). Once H is held,
 * nothing more is held. After u sessions the PT has been released exactly max(0, E − H), E being what they earned on them. The
 * gym and the platform are not affected, nor is any other contract. The hold is collected only while the contract is running: a
 * call that arrives after the ending was recorded never holds. The amounts returned in `released` are what
 * REALLY went to available — the first session of a held contract returns 0 for the PT — which
 * is what user-service adds to releasedToPt and hands back at termination as `alreadyReleased`,
 * so the two stay consistent.
 *
 * With no rate (or 0), or once the contract has ended, this posts exactly the rows it always has.
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
      // Decided once, under the wallet locks: a contract whose ending is already recorded never raises its hold.
      const target = holdbackTarget(price, ptHoldbackRate, rates);
      const holding = target.greaterThan(0) && !(await contractEndingRecorded(ops, transactionId));
      if (holding) await recordHoldbackSnapshot(ops, transactionId, ptHoldbackRate!, target);
      let ptHoldback: ReleaseResult['ptHoldback'];

      const move = async (
        walletId: string,
        amount: Prisma.Decimal,
        who: string,
        key: 'pt' | 'gym' | 'platform',
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

        // `moving` is what the party EARNED with this session. All of it leaves "unearned" pending; with a holdback, the part
        // that tops up the PT's held-back pot goes to the HOLDBACK bucket (earned, not withdrawable) and only the rest reaches
        // available. Σ of the credits is exactly `moving`, so the books balance whatever the split.
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
          await ops.credit(walletId, heldNow, `${label}${HOLDBACK_RETAINED_SUFFIX}`, 'HOLDBACK');
        }
        if (toAvailable.greaterThan(0)) {
          await ops.credit(walletId, toAvailable, `${label} — session earned`, 'AVAILABLE');
        }
        moved[key] = toAvailable;
      };

      await move(wallets.ptId, dueOf(rel.pt, 'pt'), 'PT', 'pt', holding ? target : undefined);
      if (wallets.gymId) {
        await move(wallets.gymId, dueOf(rel.gym, 'gym'), 'Gym', 'gym');
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
 * Each party is charged ONLY from this contract's own pending (ownPending, minus the FH-2c reserve
 * of unresolved sessions); the client is credited exactly what was drawn; the rest becomes an OPEN
 * obligation (D48 invariant: no pooled AVAILABLE draw, no platform fronting, no PartnerReceivable —
 * there is no flag that restores any of them).
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
  },
): Promise<NoShowResult> {
  const { wallets, transactionId, label, idempotencyKey, kind, comp: c } = p;
  const charged = { pt: ZERO, gym: ZERO, platform: ZERO };
  const reserve = await unresolvedReserve(ops, wallets.revenueId, transactionId, p.rel);

  const charge = async (walletId: string, amount: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') => {
    if (amount.lessThanOrEqualTo(0)) return;
    // THIS contract's pending only — the money set aside for sessions still owed, and this is one of
    // them — not the wallet's pooled bucket (which also holds the party's other contracts' unearned
    // money). Whatever it cannot fund is left unpaid and becomes the client's OPEN obligation below.
    const own = (await ownPending(ops, walletId, transactionId)).minus(reserve[key]);
    const held = own.greaterThan(0) ? own : ZERO;
    const taken = held.lessThan(amount) ? held : amount;
    if (taken.greaterThan(0)) {
      await ops.debit(walletId, taken, `${label} — ${p.chargeWording}`, 'PENDING');
      charged[key] = charged[key].plus(taken);
    }
  };

  await charge(wallets.ptId, c.pt, 'pt');
  if (wallets.gymId) await charge(wallets.gymId, c.gym, 'gym');
  await charge(wallets.revenueId, c.platform, 'platform');

  const owed = c.compensation;
  // Escrow does NOT move: the cash never left the platform, the claim on it simply passed from the
  // parties to the client. Both sides of the invariant fall and rise by the same amount.
  // The client gets exactly what was drawn.
  const paid = charged.pt.plus(charged.gym).plus(charged.platform);
  if (paid.greaterThan(0)) await ops.credit(wallets.clientId, paid, `${label} — ${p.creditWording}`);

  let obligationId: string | undefined;
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

  const unpaid = owed.minus(paid);
  return {
    compensation: paid.toFixed(2),
    charged: {
      pt: charged.pt.toFixed(2),
      gym: charged.gym.toFixed(2),
      platform: charged.platform.toFixed(2),
    },
    shortfall: unpaid.toFixed(2),
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
      }),
    ),
  );
}

/**
 * D77 - RECORD-ONLY late-arrival compensation. The PT joined late, but when the contract ended payment-service had never
 * performed the session's `PT_LATE_ARRIVAL:<sessionId>` compensation (user-service asked the ledger first and the key was
 * unknown). The ending must not lose it and must not pay it out of money that is not this session's, so it is written down:
 * an OPEN unpaid obligation to the client (kind LATE_ARRIVAL, owed = the compensation computeLateArrivalCompensation gives,
 * paid = 0, a reason in words) under the ORIGINAL key. NO MONEY MOVES: no wallet is debited or credited, no pending is drawn
 * (not this contract's, a fortiori not a neighbour's), nothing is fronted, no PartnerReceivable is created. It cannot be
 * paid by this operation - a person who decides the client must be paid does it outside the ledger and marks the
 * obligation RESOLVED with a reference (scripts/fh8-adjust.ts), or waives it.
 *
 * Idempotent on the SAME key as the real compensation and with the same fingerprint (kind LATE_ARRIVAL): a retry or a
 * concurrent ending replays the stored result and never makes a second obligation; and a real compensateLateArrival that
 * arrives afterwards under that key (a slow call that outlived its caller) replays THIS result - it cannot also pay the
 * client. loadLateArrivalDeductions reads charged = 0 from it, so the session's own release is not reduced.
 */
export function recordLateArrivalObligation(params: RecordCompensationObligationParams): Promise<NoShowResult & { recordedOnly: true }> {
  return recordCompensationObligation('LATE_ARRIVAL', params);
}

/**
 * RECORD-ONLY PT no-show compensation - the same mechanism as {@link recordLateArrivalObligation}, for a `PT_NO_SHOW:<sessionId>`
 * step the ledger never performed before the contract ended (a natural completion never drains its session rows first). Kind NO_SHOW,
 * owed = computeNoShowCompensation (one session's value, rounded up), paid 0, no money moves, same key and same fingerprint as the real
 * compensateNoShow (so a slow real call arriving later replays the record and cannot also pay the client). The caller must NOT count the
 * session in compensatedSessions: nothing was compensated.
 */
export function recordNoShowObligation(params: RecordCompensationObligationParams): Promise<NoShowResult & { recordedOnly: true }> {
  return recordCompensationObligation('NO_SHOW', params);
}

export interface RecordCompensationObligationParams {
  transactionId: string;
  price: Prisma.Decimal;
  totalSessions: number;
  rates: RateTable;
  parties: ContractParties;
  label: string;
  /** `PT_LATE_ARRIVAL:<sessionId>` / `PT_NO_SHOW:<sessionId>` - the very key the compensation used (or would have used). */
  idempotencyKey: string;
  reason: string;
}

const COMPENSATION_KEY_PREFIX: Record<'NO_SHOW' | 'LATE_ARRIVAL', string> = { NO_SHOW: 'PT_NO_SHOW:', LATE_ARRIVAL: LATE_ARRIVAL_KEY_PREFIX };

async function recordCompensationObligation(
  kind: 'NO_SHOW' | 'LATE_ARRIVAL',
  params: RecordCompensationObligationParams,
): Promise<NoShowResult & { recordedOnly: true }> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey, reason } = params;
  const prefix = COMPENSATION_KEY_PREFIX[kind];
  if (!idempotencyKey.startsWith(prefix) || idempotencyKey.length <= prefix.length) {
    throw new Error(`record-only ${kind} obligation needs a ${prefix}<sessionId> key`);
  }
  const opMeta = contractOpMeta(kind, { transactionId, price, totalSessions, rates, parties });
  await assertRequestMatchesTransaction({ idempotencyKey, transactionId, price, rates, parties, meta: opMeta });
  const wallets = await resolveWallets(parties);
  const owed = (kind === 'NO_SHOW' ? computeNoShowCompensation(price, totalSessions, rates) : computeLateArrivalCompensation(price, totalSessions, rates)).compensation;

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, opMeta, async () => {
      let obligationId: string | undefined;
      if (owed.greaterThan(0)) {
        obligationId = await recordObligation(ops, {
          key: idempotencyKey,
          transactionId,
          contractRef: label,
          kind,
          party: 'CLIENT',
          owed,
          paid: ZERO,
          reason,
        });
      }
      return {
        compensation: ZERO.toFixed(2),
        charged: { pt: ZERO.toFixed(2), gym: ZERO.toFixed(2), platform: ZERO.toFixed(2) },
        shortfall: owed.toFixed(2),
        owed: owed.toFixed(2),
        paid: ZERO.toFixed(2),
        unpaid: owed.toFixed(2),
        ...(obligationId ? { obligationId } : {}),
        recordedOnly: true as const,
      };
    }),
  );
}

/**
 * Owner decision (final): there is NO automatic recovery of a partner's debt by deducting from what they earn - not from
 * this contract, not from any other. `recoverReceivables` was removed; no environment variable or configuration brings it back.
 * Old PartnerReceivable rows (created before D48 by the removed platform-fronting path) are history only: they are never read
 * or changed by any money path. FH-8 (adjustment-operations.service) is the audited tool that records decisions on them.
 * This only warns, once, when somebody still sets the old switch.
 */
export function warnIfRemovedReceivableRecoveryFlagSet(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RECEIVABLE_RECOVERY_ENABLED === undefined) return false;
  logger.warn(
    `[ContractLedger] RECEIVABLE_RECOVERY_ENABLED is set ("${String(env.RECEIVABLE_RECOVERY_ENABLED).slice(0, 20)}") but automatic debt recovery was removed: the setting is ignored and every earning is paid in full. Remove it from the environment.`,
  );
  return true;
}
warnIfRemovedReceivableRecoveryFlagSet();

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
   * Present only when the PT had money held back on this contract when it ended (FH-9; the HOLDBACK bucket of the contract's own
   * payment transaction). Left off entirely otherwise, so the result - and the copy of it stored for idempotent replay - for every
   * other termination is exactly what it was before this field existed. Kept apart from `shortfall` above so that figure keeps
   * meaning what its existing readers take it to mean.
   */
  ptHoldback?: {
    /** H = h x (the PT's expected income on the contract) in whole dong; 0 when the caller sent no rate. */
    target: string;
    /** What was really held back for the PT on this contract when it ended. */
    held: string;
    /** Always 0.00 at termination: nothing is paid to the client out of the hold automatically (owner decision). A verified PT-fault amount is paid later by holdback-review.service. */
    compensation: string;
    /** Moved from HOLDBACK to the PT's AVAILABLE by this ending: held - stillHeld. */
    returnedToPt: string;
    /** Kept in HOLDBACK as a reserve for related items of THIS contract (each has a durable review with a deadline). 0 when nothing is at risk. */
    stillHeld: string;
    /** Why `stillHeld` is held, per cause: PT_FAULT / OPEN_OBLIGATION / UNSECURED_DISPUTE / UNCOMPUTABLE. */
    reserves: Array<{ kind: string; reserve: string; reason: string }>;
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
export const PT_FAULT_WORDING: Partial<Record<TerminationReason, string>> = {
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
 * PT holdback (FH-9). What the PT has held back on this contract sits in their HOLDBACK bucket (never in pending, so the refund drain
 * cannot reach it). The ending settles it like this, always inside this one operation:
 *
 *   Owner decision (final): NOTHING is paid to the client out of the hold automatically, whatever the reason. At the ending the hold is
 *   split into
 *     - a RESERVE, kept in HOLDBACK, and only for a cause of THIS contract: the potential PT-fault compensation (PT_CANCELLED,
 *       PT_REPEATED_NO_SHOW: h x the undelivered value, capped by what the PT was still to be paid), the PT-borne part of its OPEN
 *       no-show / late-arrival obligations, the PT's part of an unsecured dispute - or the WHOLE hold when the amount cannot be
 *       computed. Each reserve gets a durable pt_holdback_reviews item (reason, handler, review deadline). PT_BANNED, a restriction,
 *       SERVICE_DISCONTINUED_BY_PLATFORM and a client ending are never a PT fault and reserve nothing for it;
 *     - everything else, which goes straight back to the PT (HOLDBACK -> AVAILABLE).
 *   The reserve is only ever paid by an admin decision (holdback-review.service: VERIFIED / NOT_VERIFIED, four-eyes, CAS, idempotent
 *   key HOLDBACK_FAULT_COMP:<contractId>:<approvalRef>), never above the verified PT share, never from another contract, never fronted
 *   by the platform, never a receivable; the rest of the reserve returns to the PT.
 *
 *   final to the PT = entitlement (the reserve, if any, is still held for them until the decision), whichever way the money travels.
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
   * Absent or zero means the contract carries no holdback, and termination settles exactly as it
   * did before this parameter existed. It only sizes the PT-fault compensation ceiling and the exposure of unresolved
   * sessions: what is HELD is read from the ledger (the contract's HOLDBACK rows), never from this rate. There is no fallback to a platform-wide rate here or in
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
  const holdbackPot = holdbackTarget(price, ptHoldbackRate, rates);
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
    const topUp = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;
    // Parties whose caller-supplied `alreadyReleased` is ahead of their final entitlement.
    const overReleased: Array<{ party: 'PT' | 'GYM' | 'PLATFORM'; amount: Prisma.Decimal }> = [];
    // Sum of the other parties' positive gaps (what they are still owed on top of what they were released).
    let positiveGapTotal = ZERO;

    // The PT holdback, decided under the wallet locks and from the LEDGER, not from the caller: `held` is what the PT really has in
    // HOLDBACK for this contract (a rate the caller no longer sends cannot make held money disappear).
    //
    // Owner decision (final): NOTHING is paid to the client out of the hold automatically - not because the PT cancelled, was banned,
    // was restricted or the client complained. A potential PT-fault amount is only KEPT as a reserve (below) and decided by an authorised
    // admin through holdback-review.service.ts. So the ending itself never debits HOLDBACK for the client.
    const held = await ptHeld(ops, wallets.ptId, transactionId);
    // Everything the PT holds counts as already paid to the PT for the top-up below: it is either released to the PT, kept as a reserve
    // for a related item of THIS contract, or (later, after a verified decision) paid to the client - never topped up a second time.
    const ptAlreadyHas = alreadyReleased.pt.plus(held);

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
        }
        shortfall = shortfall.plus(gap.minus(trimmed).minus(moving));
      } else if (gap.lessThan(0)) {
        // FH-1 (DQ-5): the caller says this party was released more than it ends up entitled to.
        // Whatever the books say, the answer is NEVER to take it out of the party pooled AVAILABLE
        // (that is money earned on other contracts) and NEVER to move it to REVENUE as a forfeit.
        // Record the discrepancy for the admin; if the money really was paid out, the contract own
        // pending is short and the client refund shows it as an unpaid obligation below.
        overReleased.push({ party: key === 'pt' ? 'PT' : key === 'gym' ? 'GYM' : 'PLATFORM', amount: gap.abs() });
      }
    };

    // Rounding dust. The three-way split rounds the PT and gym DOWN and gives the platform the
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
    {
      const plan: Array<{ key: 'pt' | 'gym' | 'platform'; walletId: string | null; ent: Prisma.Decimal; rel: Prisma.Decimal; reserve: Prisma.Decimal }> = [
        { key: 'pt', walletId: wallets.ptId, ent: outcome.entitlement.pt, rel: ptAlreadyHas, reserve: ZERO },
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
      let short = Prisma.Decimal.min(outcome.refund.minus(projectedDrain), new Prisma.Decimal(2 * totalSessions));
      for (const q of plan) {
        if (short.lessThanOrEqualTo(0)) break;
        const cut = Prisma.Decimal.min(short, topups[q.key]);
        trim[q.key] = cut;
        short = short.minus(cut);
        trimmedTotal = trimmedTotal.plus(cut);
      }
    }

    await settleParty(wallets.ptId, outcome.entitlement.pt, ptAlreadyHas, 'pt', ZERO, outcome.unresolvedHeld.pt, trim.pt);
    await settleParty(wallets.gymId, outcome.entitlement.gym, alreadyReleased.gym, 'gym',
      ZERO, outcome.unresolvedHeld.gym, trim.gym);
    await settleParty(wallets.revenueId, outcome.entitlement.platform, alreadyReleased.platform, 'platform',
      ZERO, outcome.unresolvedHeld.platform, trim.platform);

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
    {
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

    // What the client can really be paid as REFUND: only what this contract's own pending funded. The PT-fault compensation is
    // different: it is debited from the HOLDBACK bucket in the same operation, so it is funded by construction (compensation <= held).
    const owedToClient = outcome.refund;
    const refundPaid = drained.lessThan(outcome.refund) ? drained : outcome.refund;
    const compensationPaid = ZERO;

    if (refundPaid.greaterThan(0)) {
      await ops.credit(wallets.clientId, refundPaid, `${label} — refund (${reason})`);
      // Escrow does not move. The cash never left the platform; the claim on it passed from
      // the parties' pending buckets to the client's balance. Only a real payout debits escrow.
    }

    // Every dong drained out of pending must land somewhere, and the client's refund must be fully funded. Reconcile the two.
    const residue = drained.minus(outcome.refund);
    let obligationId: string | undefined;
    if (residue.greaterThan(0)) {
      // Drained more than the client is owed - the surplus is the parties' forfeited share
      // (a cancellation fee, say) and belongs to the platform, not to nobody.
      await ops.credit(wallets.revenueId, residue, `${label} — forfeited share`, 'AVAILABLE');
    } else if (residue.lessThan(0)) {
      // Drained less than the client is owed: this contract's own pending was already short.
      // The client was credited what could be drawn; the rest is an OPEN obligation (FH-1),
      // not fronted by the platform, not a PT debt - and NOT paid out of the PT's held money (that is not a PT-fault item).
      obligationId = await recordObligation(ops, {
        key: idempotencyKey,
        transactionId,
        contractRef: label,
        kind: 'REFUND_SHORT',
        party: 'CLIENT',
        owed: outcome.refund,
        paid: refundPaid,
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

    // Facts for the later operations, written only when sessions were left unresolved (zero amounts: no balance moves). The count
    // lets resolveUnresolvedSession refuse a session beyond the ones this termination left open, and lets the holdback release
    // know that the contract is not reconciled until every one of them is decided.
    const keptTotal = kept.pt.plus(kept.gym).plus(kept.platform);
    if (unresolvedCount > 0) {
      await ops.credit(wallets.revenueId, ZERO, `${label}${UNRESOLVED_HELD_MARKER}${unresolvedCount}`, 'PENDING');
    }

    // The rest of the PT's held money goes back to the PT now - except a RESERVE for what THIS contract could still make the PT bear and
    // that nothing else of this contract already secures (owner decision, Decision 1 + 2). The reserve is sized, per cause, on the PT's
    // own share only, never more than what is held, and each cause leaves a durable review item (reason, amount, review-by deadline):
    //   - PT_FAULT: the potential PT-fault amount (h x base, PT_CANCELLED / PT_REPEATED_NO_SHOW only; not for a ban, a restriction,
    //     D49, the client's own ending). If the rate is not known the risk cannot be computed: UNCOMPUTABLE keeps up to the whole hold.
    //   - OPEN_OBLIGATION: the PT-borne part of each OPEN unpaid obligation of THIS contract (what this contract's pending could not fund).
    //   - UNSECURED_DISPUTE: the PT's share of an unresolved session that this contract's pending does not cover. When the session value is
    //     held in pending (the normal case) the client's refund is already secured there, so nothing is kept in HOLDBACK for it.
    // Nothing is forfeited automatically, nothing is held for anything unrelated: with no cause, ALL of the hold is released here.
    let reserveLeft = held;
    const reserves: Array<{ kind: HoldbackReviewKind; reserve: Prisma.Decimal; reason: string; relatedRef: string | null }> = [];
    const addReserve = (kind: HoldbackReviewKind, want: Prisma.Decimal, reason: string, relatedRef: string | null = null) => {
      const take = Prisma.Decimal.min(want, reserveLeft);
      if (take.lessThanOrEqualTo(0)) return;
      reserves.push({ kind, reserve: take, reason, relatedRef });
      reserveLeft = reserveLeft.minus(take);
    };
    if (held.greaterThan(0) && PT_FAULT_REASONS.has(reason)) {
      const ptStillToBePaid = Prisma.Decimal.max(outcome.entitlement.pt.minus(alreadyReleased.pt), ZERO);
      if (ptHoldbackRate && ptHoldbackRate.greaterThan(0)) {
        addReserve('PT_FAULT', Prisma.Decimal.min(outcome.ptFaultCompensationTarget, ptStillToBePaid), `${reason}: potential PT-fault compensation (${ptHoldbackRate.toString()} x the undelivered value), pending an admin decision`);
      } else {
        addReserve('UNCOMPUTABLE', held, `${reason}: the potential PT-fault amount could not be computed (the holdback rate was not sent), so the whole hold of this contract is kept until an admin decides`);
      }
    }
    if (reserveLeft.greaterThan(0)) {
      const open = await ops.tx.contractUnpaidObligation.findMany({
        where: { transactionId, status: { in: [...OBLIGATION_STILL_OWED] }, party: 'CLIENT', kind: { in: [...PT_BORNE_OBLIGATION_KINDS] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, unpaid: true },
      });
      for (const o of open) {
        const want = ptBorneShare(new Prisma.Decimal(o.unpaid), rates);
        addReserve('OPEN_OBLIGATION', want, `an OPEN ${o.kind} obligation of this contract (${new Prisma.Decimal(o.unpaid).toFixed(2)} unpaid, the PT-borne part is ${want.toFixed(2)})`, o.id);
      }
    }
    if (reserveLeft.greaterThan(0) && unresolvedCount > 0) {
      // wanted = the PT's share the ending set out to keep in pending for those sessions; kept = what this contract's pending really kept.
      const unsecured = Prisma.Decimal.max(outcome.unresolvedHeld.pt.minus(kept.pt), ZERO);
      addReserve('UNSECURED_DISPUTE', unsecured, `${unresolvedCount} unresolved session(s): this contract's pending does not cover the PT's share (${unsecured.toFixed(2)})`);
    }
    const reservedTotal = held.minus(reserveLeft);
    for (const r of reserves) await createHoldbackReview(ops, { transactionId, ...r });
    // Never pay the PT out of HOLDBACK more than they were still to be paid in total (an anomaly would stay held and be reported,
    // never over-credited); in every normal ending the cap is not reached.
    const ptStillOwed = Prisma.Decimal.max(outcome.entitlement.pt.minus(alreadyReleased.pt), ZERO);
    const releasable = Prisma.Decimal.min(held.minus(reservedTotal), ptStillOwed);
    const returnedToPt = await releaseHeldToAvailable(ops, wallets.ptId, transactionId, label, releasable);
    const stillHeld = held.minus(returnedToPt);

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
      unpaid: unpaidToClient.toFixed(2),
      ...(obligationId ? { obligationId } : {}),
      ...(overReleasedOut.length > 0 ? { overReleased: overReleasedOut } : {}),
      // Spread in rather than assigned, so the key does not exist at all when no holdback was
      // in force: an explicit `undefined` would vanish when the result is stored as JSON for
      // replay, and the first call would then differ from every retry of it.
      ...(held.greaterThan(0)
        ? {
            ptHoldback: {
              target: holdbackPot.toFixed(2),
              held: held.toFixed(2),
              compensation: compensationPaid.toFixed(2),
              returnedToPt: returnedToPt.toFixed(2),
              stillHeld: stillHeld.toFixed(2),
              reserves: reserves.map((r) => ({ kind: r.kind, reserve: r.reserve.toFixed(2), reason: r.reason })),
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
  /** What went from the PT's HOLDBACK to their AVAILABLE balance by THIS call. 0 when nothing was held or the release is not due. */
  released: string;
  /** What the contract still has in HOLDBACK after this call. */
  heldAfter: string;
  /** The contract's ending is recorded in the ledger (a release is never due before that). */
  ended: boolean;
  /** Ended AND no reserve of this contract is still waiting: the held money is due, and after this call none is left. */
  reconciled: boolean;
  /** When not reconciled: what keeps the rest held (only THIS contract's own items). */
  blockedBy?: { notEnded?: true; openReviews: Array<{ kind: string; reserve: string; reviewBy: string; overdue: boolean }> };
}

/**
 * The release of what is still held for the PT on a contract - the sweep's call (FH-9; Z4).
 *
 * Due ONLY when the contract has ended (its TERMINATE is recorded in the ledger) AND none of its reserves is still waiting. A reserve is
 * a durable review item written by the ending (PT_FAULT / OPEN_OBLIGATION / UNSECURED_DISPUTE / UNCOMPUTABLE):
 *   - OPEN_OBLIGATION closes by itself once that obligation is no longer owed (resolved / waived / paid and verified);
 *   - UNSECURED_DISPUTE closes by itself once every held session of the contract is decided;
 *   - PT_FAULT and UNCOMPUTABLE close ONLY by an admin decision (holdback-review.service) - the sweep never decides them, so it can never
 *     pay or release money that somebody still has to judge.
 * Then ALL of the held money goes to the PT's AVAILABLE, in one pair of rows. Never early (an active contract's call changes nothing and
 * says why), never twice (the amount is derived from the contract's own HOLDBACK rows, which the release empties, so a second or a
 * concurrent call finds nothing), never from or for another contract.
 *
 * Z4: the ending itself already released everything that was not reserved, inside the TERMINATE operation, and the sweep only picks up
 * the rest. The amount is read from the ledger and written to the ledger in one transaction, so nothing can be released but not recorded.
 *
 * A final answer (ended, nothing waiting) is stored under the business key (`HOLDBACK_RELEASE:<contractId>`) so a replay returns the
 * same amount; an answer that is not final is never stored (the next sweep must be able to release the rest).
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

  return walletService.withWallets(wallets.all, transactionId, async (ops) => {
    const stored = await ops.tx.ledgerOperation.findUnique({ where: { key: idempotencyKey } });
    if (stored) return stored.result as unknown as ReleaseHoldbackResult;

    const ended = await contractEndingRecorded(ops, transactionId);
    const heldBefore = await ptHeld(ops, wallets.ptId, transactionId);
    const unresolved = await unresolvedRemaining(ops, wallets.revenueId, transactionId);

    // Close the reserves whose cause has cleared; whatever is still waiting blocks the release.
    const reviews = await ops.tx.ptHoldbackReview.findMany({ where: { transactionId, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
    const waiting: typeof reviews = [];
    const closable: string[] = [];
    for (const r of reviews) {
      let cleared = false;
      if (r.kind === 'OPEN_OBLIGATION') {
        const ob = r.relatedRef ? await ops.tx.contractUnpaidObligation.findUnique({ where: { id: r.relatedRef }, select: { status: true, unpaid: true } }) : null;
        cleared = !ob || !(OBLIGATION_STILL_OWED as readonly string[]).includes(ob.status) || new Prisma.Decimal(ob.unpaid).lessThanOrEqualTo(0);
      } else if (r.kind === 'UNSECURED_DISPUTE') {
        cleared = unresolved === 0;
      }
      if (ended && cleared) closable.push(r.id);
      else waiting.push(r);
    }
    const reconciled = ended && waiting.length === 0;

    if (!reconciled) {
      const now = Date.now();
      return {
        released: '0.00',
        heldAfter: heldBefore.toFixed(2),
        ended,
        reconciled: false,
        blockedBy: {
          ...(ended ? {} : { notEnded: true as const }),
          openReviews: waiting.map((r) => ({ kind: r.kind, reserve: new Prisma.Decimal(r.reserve).toFixed(2), reviewBy: r.reviewBy.toISOString(), overdue: r.reviewBy.getTime() < now })),
        },
      };
    }

    const released = await releaseHeldToAvailable(ops, wallets.ptId, transactionId, label, heldBefore);
    if (closable.length > 0) {
      await ops.tx.ptHoldbackReview.updateMany({ where: { id: { in: closable }, status: 'OPEN' }, data: { status: 'RELEASED_AUTO', decidedAt: new Date(), decidedBy: 'SYSTEM', releasedToPt: new Prisma.Decimal(0), note: 'the cause of this reserve cleared; the hold was released' } });
    }
    const result: ReleaseHoldbackResult = { released: released.toFixed(2), heldAfter: heldBefore.minus(released).toFixed(2), ended: true, reconciled: true };
    await ops.tx.ledgerOperation.create({
      data: {
        key: idempotencyKey,
        result: result as unknown as Prisma.InputJsonValue,
        requestFingerprint: opMeta.fingerprint,
        transactionId: opMeta.transactionId,
        kind: opMeta.kind,
      },
    });
    logger.info(`[ContractLedger] ${label}: PT holdback of ${released.toFixed(2)} released (contract ended, nothing reserved any more)`);
    return result;
  });
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
      }> = [
        { key: 'pt', walletId: wallets.ptId, amount: dueOf(rel.pt, 'pt') },
        { key: 'gym', walletId: wallets.gymId, amount: dueOf(rel.gym, 'gym') },
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
