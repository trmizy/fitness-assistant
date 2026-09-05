import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import {
  computeLateArrivalCompensation,
  computeNoShowCompensation,
  computeSessionRelease,
  computeTermination,
  splitThreeWays,
  type RateTable,
  type TerminationReason,
  ZERO,
} from './contract-money';
import { walletService, type LedgerOps } from './wallet.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';

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

export interface ReleaseResult {
  released: { pt: string; gym: string; platform: string };
  unit: string;
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
}): Promise<ReleaseResult> {
  const { transactionId, price, totalSessions, rates, parties, label, idempotencyKey } = params;
  const wallets = await resolveWallets(parties);
  const rel = computeSessionRelease(price, totalSessions, rates);
  assertGymConsistency(wallets, rel.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
      const move = async (
        walletId: string,
        amount: Prisma.Decimal,
        who: string,
        debtor?: { partnerType: 'PT' | 'GYM'; partnerId: string },
      ) => {
        if (amount.lessThanOrEqualTo(0)) return;
        // Clamp to what is actually there. A contract whose pending bucket has already been
        // drained (PT no-shows, an earlier partial refund) must not push a bucket negative;
        // releasing only what remains keeps the invariant intact and the shortfall visible.
        const available = ops.balance(walletId, 'PENDING');
        const moving = available.lessThan(amount) ? available : amount;
        if (moving.lessThanOrEqualTo(0)) {
          logger.warn(`[ContractLedger] ${who} pending bucket empty for ${label} — nothing to release`);
          return;
        }
        await ops.debit(walletId, moving, `${label} — release to available`, 'PENDING');
        await ops.credit(walletId, moving, `${label} — session earned`, 'AVAILABLE');

        // A partner who owes the platform works the debt off out of what they just earned,
        // before it becomes withdrawable. The platform is never a debtor to itself, so the
        // revenue wallet is not passed a debtor.
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
      };

      await move(wallets.ptId, rel.pt, 'PT', { partnerType: 'PT', partnerId: parties.ptUserId });
      if (wallets.gymId) {
        await move(wallets.gymId, rel.gym, 'Gym', { partnerType: 'GYM', partnerId: parties.gymId! });
      }
      await move(wallets.revenueId, rel.platform, 'Platform');

      return {
        unit: rel.unit.toFixed(2),
        released: { pt: rel.pt.toFixed(2), gym: rel.gym.toFixed(2), platform: rel.platform.toFixed(2) },
      };
    }),
  );
}

export interface NoShowResult {
  compensation: string;
  charged: { pt: string; gym: string; platform: string };
  shortfall: string;
}

/**
 * The PT failed to attend. The client is paid one session's value in cash, funded by taking
 * that value back off the three parties in proportion — the platform gives back its
 * commission too, since it earned nothing on a session that never happened.
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
  const wallets = await resolveWallets(parties);
  const c = computeNoShowCompensation(price, totalSessions, rates);
  assertGymConsistency(wallets, c.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    const charged = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;

    const charge = async (walletId: string, amount: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') => {
      if (amount.lessThanOrEqualTo(0)) return;
      let outstanding = amount;
      // Pending first — that is the money set aside for sessions still owed, and this is one
      // of them. Then their available balance: a session that never happened was not earned,
      // so clawing back the released part is fair rather than punitive.
      for (const bucket of ['PENDING', 'AVAILABLE'] as const) {
        if (outstanding.lessThanOrEqualTo(0)) break;
        const held = ops.balance(walletId, bucket);
        const taken = held.lessThan(outstanding) ? held : outstanding;
        if (taken.greaterThan(0)) {
          await ops.debit(walletId, taken, `${label} — PT no-show charge`, bucket);
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

    // The client is made whole regardless (section 3.9). Escrow does NOT move: the cash never
    // left the platform, the claim on it simply passed from the parties to the client. Both
    // sides of the invariant fall and rise by the same amount, so it survives untouched.
    await ops.credit(wallets.clientId, c.compensation, `${label} — compensation for a missed session`);

    // Whatever the parties could not fund, the platform fronts out of its own revenue and
    // books as a debt. Fronting it is what keeps claims equal to escrow; leaving the gap open
    // would mean the client holds a claim nobody funded.
    if (shortfall.greaterThan(0)) {
      await coverShortfall(ops, wallets.revenueId, shortfall, {
        partnerType: 'PT',
        partnerId: parties.ptUserId,
        reason: `PT no-show compensation shortfall (${label})`,
        transactionId,
      });
    }

    return {
      compensation: c.compensation.toFixed(2),
      charged: {
        pt: charged.pt.toFixed(2),
        gym: charged.gym.toFixed(2),
        platform: charged.platform.toFixed(2),
      },
      shortfall: shortfall.toFixed(2),
    };
    }),
  );
}

/**
 * Open-room online session — the PT joined the room, but after the grace window past the
 * scheduled start. Half of compensateNoShow's rate (computeLateArrivalCompensation), same
 * three-way charge/shortfall mechanics. A DELIBERATE near-duplicate of compensateNoShow rather
 * than a shared refactor: compensateNoShow is relied on exactly as it already behaves by its
 * existing callers, and touching it to parameterize the formula risks a regression there for
 * zero benefit — this new function owns its own small blast radius instead.
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
  const wallets = await resolveWallets(parties);
  const c = computeLateArrivalCompensation(price, totalSessions, rates);
  assertGymConsistency(wallets, c.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    const charged = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;

    const charge = async (walletId: string, amount: Prisma.Decimal, key: 'pt' | 'gym' | 'platform') => {
      if (amount.lessThanOrEqualTo(0)) return;
      let outstanding = amount;
      for (const bucket of ['PENDING', 'AVAILABLE'] as const) {
        if (outstanding.lessThanOrEqualTo(0)) break;
        const held = ops.balance(walletId, bucket);
        const taken = held.lessThan(outstanding) ? held : outstanding;
        if (taken.greaterThan(0)) {
          await ops.debit(walletId, taken, `${label} — PT late-arrival charge`, bucket);
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

    await ops.credit(wallets.clientId, c.compensation, `${label} — compensation for the PT's late arrival`);

    if (shortfall.greaterThan(0)) {
      await coverShortfall(ops, wallets.revenueId, shortfall, {
        partnerType: 'PT',
        partnerId: parties.ptUserId,
        reason: `PT late-arrival compensation shortfall (${label})`,
        transactionId,
      });
    }

    return {
      compensation: c.compensation.toFixed(2),
      charged: {
        pt: charged.pt.toFixed(2),
        gym: charged.gym.toFixed(2),
        platform: charged.platform.toFixed(2),
      },
      shortfall: shortfall.toFixed(2),
    };
    }),
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

  const debts = await ops.tx.partnerReceivable.findMany({
    where: { partnerType, partnerId, settledAt: null },
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
    const outstanding = new Prisma.Decimal(debt.amount).minus(debt.recovered);
    if (outstanding.lessThanOrEqualTo(0)) continue;

    const take = outstanding.lessThan(budget) ? outstanding : budget;
    const nowRecovered = new Prisma.Decimal(debt.recovered).plus(take);
    const settled = nowRecovered.greaterThanOrEqualTo(debt.amount);

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
  shortfall: string;
}

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
  rates: RateTable;
  reason: TerminationReason;
  /** Already moved to each party's available bucket, session by session. */
  alreadyReleased: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
  parties: ContractParties;
  label: string;
  /** Business key `CONTRACT_TERMINATE:<contractId>` — a retry with the same key replays the
   * first call's result instead of settling the contract a second time (plan 1.1). */
  idempotencyKey: string;
}): Promise<TerminationLedgerResult> {
  const { transactionId, price, totalSessions, usedSessions, compensatedSessions, rates, reason, alreadyReleased, parties, label, idempotencyKey } = params;

  const outcome = computeTermination({ price, totalSessions, usedSessions, compensatedSessions, rates }, reason);
  const wallets = await resolveWallets(parties);
  assertGymConsistency(wallets, outcome.entitlement.gym);

  return walletService.withWallets(wallets.all, transactionId, (ops) =>
    withIdempotentLedgerOp(ops, idempotencyKey, async () => {
    const topUp = { pt: ZERO, gym: ZERO, platform: ZERO };
    let shortfall = ZERO;

    /**
     * Bring one party from "what they have already been paid" to "what they are finally owed".
     * A positive gap is topped up out of their pending bucket; a negative gap means they were
     * released more than they ended up entitled to and the excess is clawed back.
     */
    const settleParty = async (
      walletId: string | null,
      entitlement: Prisma.Decimal,
      released: Prisma.Decimal,
      key: 'pt' | 'gym' | 'platform',
      debtor?: { partnerType: 'PT' | 'GYM'; partnerId: string },
    ) => {
      if (!walletId) return;
      const gap = entitlement.minus(released);
      if (gap.greaterThan(0)) {
        const pendingHeld = ops.balance(walletId, 'PENDING');
        const moving = pendingHeld.lessThan(gap) ? pendingHeld : gap;
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
        shortfall = shortfall.plus(gap.minus(moving));
      } else if (gap.lessThan(0)) {
        const owed = gap.abs();
        const held = ops.balance(walletId, 'AVAILABLE');
        const clawed = held.lessThan(owed) ? held : owed;
        if (clawed.greaterThan(0)) {
          await ops.debit(walletId, clawed, `${label} — over-released, clawed back`, 'AVAILABLE');
          await ops.credit(walletId, clawed, `${label} — returned to pending`, 'PENDING');
          topUp[key] = clawed.negated();
        }
        shortfall = shortfall.plus(owed.minus(clawed));
      }
    };

    await settleParty(wallets.ptId, outcome.entitlement.pt, alreadyReleased.pt, 'pt', {
      partnerType: 'PT',
      partnerId: parties.ptUserId,
    });
    await settleParty(wallets.gymId, outcome.entitlement.gym, alreadyReleased.gym, 'gym',
      parties.gymId ? { partnerType: 'GYM', partnerId: parties.gymId } : undefined);
    await settleParty(wallets.revenueId, outcome.entitlement.platform, alreadyReleased.platform, 'platform');

    // Drain whatever is left in the three pending buckets — that residue is exactly the
    // client's refund, still sitting under the parties' names.
    let drained = ZERO;
    for (const id of [wallets.ptId, wallets.gymId, wallets.revenueId]) {
      if (!id) continue;
      const left = ops.balance(id, 'PENDING');
      if (left.greaterThan(0)) {
        await ops.debit(id, left, `${label} — pending released on termination`, 'PENDING');
        drained = drained.plus(left);
      }
    }

    if (outcome.refund.greaterThan(0)) {
      await ops.credit(wallets.clientId, outcome.refund, `${label} — refund (${reason})`);
      // Escrow does not move. The cash never left the platform; the claim on it passed from
      // the parties' pending buckets to the client's balance. Only a real payout debits escrow.
    }

    // Every đồng drained out of pending must land somewhere, and the client's refund must be
    // fully funded. Reconcile the two.
    const residue = drained.minus(outcome.refund);
    if (residue.greaterThan(0)) {
      // Drained more than the client is owed — the surplus is the parties' forfeited share
      // (a cancellation fee, say) and belongs to the platform, not to nobody.
      await ops.credit(wallets.revenueId, residue, `${label} — forfeited share`, 'AVAILABLE');
    } else if (residue.lessThan(0)) {
      // Drained less than the refund: the pending buckets were already short. The platform
      // funds the difference and books it against the PT, exactly as for a no-show.
      await coverShortfall(ops, wallets.revenueId, residue.abs(), {
        partnerType: 'PT',
        partnerId: parties.ptUserId,
        reason: `Termination refund shortfall (${label}, ${reason})`,
        transactionId,
      });
    }

    return {
      reason,
      refund: outcome.refund.toFixed(2),
      entitlement: {
        pt: outcome.entitlement.pt.toFixed(2),
        gym: outcome.entitlement.gym.toFixed(2),
        platform: outcome.entitlement.platform.toFixed(2),
      },
      topUp: { pt: topUp.pt.toFixed(2), gym: topUp.gym.toFixed(2), platform: topUp.platform.toFixed(2) },
      returnedToEscrow: drained.toFixed(2),
      shortfall: shortfall.plus(residue.lessThan(0) ? residue.abs() : ZERO).toFixed(2),
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
