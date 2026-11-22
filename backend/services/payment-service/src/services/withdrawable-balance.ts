import { Prisma, WalletOwnerType } from '../generated/prisma';
import { withdrawalRepository } from '../repositories/withdrawal.repository';
import { prisma } from '../repositories/prisma';
import { gymDebtUnpaid } from './gym-debt-recovery';

/**
 * The ONE formula for "how much can this wallet withdraw right now" (Gym Owner handoff item 7).
 *
 * Both `withdrawalService.requestWithdrawal` (the check that refuses with EXCEEDS_WITHDRAWABLE_BALANCE) and the
 * GYM wallet DTO (`GET /internal/wallets/GYM/:id` -> `withdrawable`, `reservedPending`, shown as "Có thể rút")
 * call `computeWithdrawable`, so the number on screen is by construction the number the request is checked against.
 *
 *   non-CLIENT : available - SUM(PENDING requests)
 *                (APPROVED requests already left `available` for LOCKED in approve(), so they are NOT subtracted again)
 *   CLIENT     : refund-sourced credits - paid out - open (PENDING + APPROVED)      (ledger-based, see requestWithdrawal history)
 *   always     : never above available - SUM(PENDING)
 *   GYM        : and never above available - SUM(PENDING) - open platform debt (GYM_DEBT; new income repays it automatically)
 *   result     : floored at 0 (a gym deep in debt can withdraw nothing, not a negative amount)
 */
export interface WithdrawableInputs {
  ownerType: WalletOwnerType;
  /** wallet.availableBalance */
  available: Prisma.Decimal;
  /** SUM of PENDING withdrawal requests on this wallet */
  pendingReserved: Prisma.Decimal;
  /** CLIENT only: refundSourcedCredits - paidOut - open. Ignored for other owner types. */
  clientRefundNet?: Prisma.Decimal | null;
  /** GYM only: unpaid platform debt. Ignored for other owner types. */
  gymDebt?: Prisma.Decimal | null;
}

export interface WithdrawableBreakdown {
  withdrawable: Prisma.Decimal;
  reservedPending: Prisma.Decimal;
  gymDebt: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/** Pure arithmetic of the formula above — no I/O, unit-tested on its own. */
export function withdrawableFromParts(input: WithdrawableInputs): WithdrawableBreakdown {
  const ceiling = input.available.minus(input.pendingReserved);
  let withdrawable = input.ownerType === 'CLIENT' ? (input.clientRefundNet ?? ZERO) : ceiling;
  withdrawable = Prisma.Decimal.min(withdrawable, ceiling);

  let gymDebt = ZERO;
  if (input.ownerType === 'GYM') {
    gymDebt = input.gymDebt ?? ZERO;
    if (gymDebt.greaterThan(0)) withdrawable = Prisma.Decimal.min(withdrawable, ceiling.minus(gymDebt));
  }
  return { withdrawable: Prisma.Decimal.max(withdrawable, ZERO), reservedPending: input.pendingReserved, gymDebt };
}

/** Reads what the formula needs from the database for this wallet and applies it. */
export async function computeWithdrawable(
  ownerType: WalletOwnerType,
  ownerId: string,
  wallet: { id: string; availableBalance: Prisma.Decimal },
): Promise<WithdrawableBreakdown> {
  // P0 cluster F: sumPendingAmount (PENDING only) is what is still sitting in availableBalance and not reserved anywhere.
  const pendingReserved = await withdrawalRepository.sumPendingAmount(wallet.id);

  let clientRefundNet: Prisma.Decimal | null = null;
  if (ownerType === 'CLIENT') {
    // Money-flow plan 5.3: a client wallet may only withdraw refund/compensation-sourced money.
    const refundSourced = await withdrawalRepository.sumRefundSourcedCredits(wallet.id);
    const alreadyPaidOut = await withdrawalRepository.sumPaidAmount(wallet.id);
    const alreadyOpen = await withdrawalRepository.sumOpenAmount(wallet.id);
    clientRefundNet = refundSourced.minus(alreadyPaidOut).minus(alreadyOpen);
  }

  // FIX3-PAY: a gym cannot withdraw money needed to cover what it owes the platform (an open GYM_DEBT). NET rule, not a blanket block.
  const gymDebt = ownerType === 'GYM' ? await gymDebtUnpaid(prisma, ownerId) : null;

  return withdrawableFromParts({ ownerType, available: wallet.availableBalance, pendingReserved, clientRefundNet, gymDebt });
}
