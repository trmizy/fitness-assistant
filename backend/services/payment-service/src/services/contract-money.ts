import { Prisma } from '../generated/prisma';

/**
 * Every money formula for a PT contract, as pure functions over Decimal.
 *
 * Nothing here touches the database, the clock, or configuration it was not handed. That is
 * deliberate: these are the rules the whole system's correctness rests on, so they have to be
 * checkable by arithmetic alone. The ledger side (contract-ledger.service) does the moving.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const ZERO = D(0);
export const ONE = D(1);

// Decimal carries 20 significant digits by default. The largest amount this system can hold
// is Decimal(14,2) — 16 digits — so division stays exact far below a đồng and no intermediate
// rounding is ever needed. Only the final writes round, under the rules in splitThreeWays.

export type TerminationReason =
  | 'CLIENT_CANCELLED'
  | 'PT_BANNED'
  | 'PT_CANCELLED'
  | 'MUTUAL'
  | 'EXPIRED'
  | 'COMPLETED'
  // Vòng 4 / Phase E2 — client-initiated, after a 3rd confirmed PT no-show on this contract
  // (user-service enforces the count before ever sending this reason here). Same
  // 100%-of-remaining formula as PT_BANNED/MUTUAL below — the PT is at fault either way.
  | 'PT_REPEATED_NO_SHOW';

/** Share of a contract each party is entitled to. Frozen onto the contract when it is signed. */
export interface RateTable {
  platformRate: Prisma.Decimal;
  ptRate: Prisma.Decimal;
  gymRate: Prisma.Decimal;
}

export interface ContractMoneyInput {
  /** P — total contract value. */
  price: Prisma.Decimal;
  /** N — total sessions. */
  totalSessions: number;
  /** u — sessions that count as used (see countsAsUsed). */
  usedSessions: number;
  /**
   * Cụm A1 — sessions consumed via cash compensation (a PT no-show), not by being trained.
   * user-service's getRemainingEntitlements() has always subtracted this alongside
   * usedSessions (money-flow plan 1.5); this formula module did not know the field existed,
   * so the two services disagreed on how many sessions a contract still owes — a client
   * compensated for a no-show could still get the same session's value back again on
   * cancellation. Optional, defaulting to 0, so no existing caller that predates
   * compensatedSessions has to change to keep compiling.
   */
  compensatedSessions?: number;
  rates: RateTable;
  /**
   * The PT holdback rate THIS contract carries (`h`): the share of the price whose first
   * earnings the PT does not get to withdraw until the contract ends well (or sits idle for
   * 30 days). Read by computeTermination only — for the compensation a PT-fault ending owes
   * the client (see holdbackCompensationTarget) — and by the ledger, which holds the money back
   * session by session (contract-ledger.service#releaseSession).
   *
   * Deliberately an input and not a constant in this module. It is a term of the individual
   * contract, like the rate table: a PT can only be held to a term they agreed to, so the caller
   * passes the value frozen onto the contract — never a figure that is merely current policy.
   * Optional, defaulting to 0, so every contract that carries no holdback (all of them, until
   * the terms-acceptance feature exists) and every caller that does not send it settles exactly
   * as it always has.
   */
  ptHoldbackRate?: Prisma.Decimal;
}

// ── Configuration ────────────────────────────────────────────────────────────
// Env is read once at module load so a formula can never change value mid-request.

function envRate(name: string, fallback: string): Prisma.Decimal {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return D(fallback);
  const parsed = D(raw);
  if (parsed.lessThan(0) || parsed.greaterThan(1)) {
    throw new Error(`${name} must be between 0 and 1, got ${raw}`);
  }
  return parsed;
}

/** Share of the unused value a client gets back when they walk away themselves. */
export const CLIENT_CANCEL_REFUND_RATE = envRate('CONTRACT_CLIENT_CANCEL_REFUND_RATE', '0.90');
/** The platform's commission floor — a contract may never be signed below it. */
export const MIN_PLATFORM_RATE = envRate('MIN_PLATFORM_RATE', '0.10');

// ── Session accounting ───────────────────────────────────────────────────────

export type SessionStatusForMoney =
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'PENDING_CLIENT_CONFIRMATION'
  | 'DISPUTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

/**
 * Whether a session consumes one of the client's paid slots.
 *
 * A no-show splits on fault: the client failing to turn up burns the session, the PT failing
 * to turn up does not — the client is owed that session back (and is compensated for it
 * separately, see computeNoShowCompensation).
 */
export function countsAsUsed(status: SessionStatusForMoney, noShowFault?: 'CLIENT' | 'PT' | null): boolean {
  if (status === 'COMPLETED') return true;
  if (status === 'NO_SHOW') return noShowFault === 'CLIENT';
  return false;
}

// ── Core quantities ──────────────────────────────────────────────────────────

function validate(input: ContractMoneyInput): void {
  if (input.price.lessThan(0)) throw new Error('price must be >= 0');
  if (!Number.isInteger(input.totalSessions) || input.totalSessions <= 0) {
    throw new Error(`totalSessions must be a positive integer, got ${input.totalSessions}`);
  }
  if (!Number.isInteger(input.usedSessions) || input.usedSessions < 0) {
    throw new Error(`usedSessions must be a non-negative integer, got ${input.usedSessions}`);
  }
  const compensatedSessions = input.compensatedSessions ?? 0;
  if (!Number.isInteger(compensatedSessions) || compensatedSessions < 0) {
    throw new Error(`compensatedSessions must be a non-negative integer, got ${compensatedSessions}`);
  }
  const consumed = input.usedSessions + compensatedSessions;
  if (consumed > input.totalSessions) {
    throw new Error(
      `usedSessions (${input.usedSessions}) + compensatedSessions (${compensatedSessions}) = ${consumed} cannot exceed totalSessions (${input.totalSessions})`,
    );
  }
  assertHoldbackRateValid(input.ptHoldbackRate);
  assertRatesValid(input.rates);
}

/** unit = P / N, unrounded. */
export function unitValue(price: Prisma.Decimal, totalSessions: number): Prisma.Decimal {
  if (totalSessions <= 0) throw new Error('totalSessions must be > 0');
  return price.div(totalSessions);
}

/**
 * remaining = P × (N − consumed) / N — the value of the sessions not yet consumed.
 *
 * consumed = usedSessions + compensatedSessions (cụm A1). A session the client was already
 * paid cash compensation for (a PT no-show) is just as "spent" against the contract's
 * entitlement as one they actually trained — leaving it out of `consumed` handed that
 * session's value back to the client a second time on cancellation, on top of the cash
 * compensation already paid.
 */
export function remainingValue(input: ContractMoneyInput): Prisma.Decimal {
  validate(input);
  const consumed = input.usedSessions + (input.compensatedSessions ?? 0);
  const unused = input.totalSessions - consumed;
  return input.price.mul(unused).div(input.totalSessions);
}

// ── Rate table ───────────────────────────────────────────────────────────────

export function assertRatesValid(rates: RateTable): void {
  const { platformRate, ptRate, gymRate } = rates;
  for (const [name, r] of Object.entries(rates)) {
    if (r.lessThan(0)) throw new Error(`${name} must be >= 0, got ${r.toString()}`);
  }
  if (platformRate.lessThan(MIN_PLATFORM_RATE)) {
    throw new Error(`platformRate must be >= ${MIN_PLATFORM_RATE.toString()}, got ${platformRate.toString()}`);
  }
  const sum = platformRate.plus(ptRate).plus(gymRate);
  // Exact equality, not a tolerance: these are stored decimals chosen by a human, so a sum
  // that is off by 0.0001 is a data-entry mistake, not floating-point noise to absorb.
  if (!sum.equals(ONE)) {
    throw new Error(`platformRate + ptRate + gymRate must equal exactly 1, got ${sum.toString()}`);
  }
}

/**
 * The rate table a new contract should carry.
 *
 * An online contract uses no gym floor space, and an independent contract has no gym at all —
 * in both cases the gym's share collapses into the PT's rather than silently paying a gym
 * that contributed nothing.
 */
export function resolveRates(params: {
  platformRate?: Prisma.Decimal;
  ptRate?: Prisma.Decimal;
  gymRate?: Prisma.Decimal;
  hasGym: boolean;
  sessionMode?: string | null;
}): RateTable {
  const platformRate = params.platformRate ?? MIN_PLATFORM_RATE;
  const gymApplies = params.hasGym && params.sessionMode !== 'ONLINE';
  const gymRate = gymApplies ? (params.gymRate ?? ZERO) : ZERO;
  const ptRate = gymApplies ? (params.ptRate ?? ONE.minus(platformRate).minus(gymRate)) : ONE.minus(platformRate);
  const rates = { platformRate, ptRate, gymRate };
  assertRatesValid(rates);
  return rates;
}

// ── Rounding ─────────────────────────────────────────────────────────────────

/**
 * Splits `total` three ways by rate, in whole đồng, with the sum guaranteed to equal `total`.
 *
 * PT and gym round DOWN and the platform absorbs whatever is left over. Someone has to take
 * the remainder — if all three rounded independently the parts would not add up, and the gap
 * would have to come out of escrow, which is other people's money. The platform is the only
 * party that can be short-changed without wronging anyone.
 */
export function splitThreeWays(
  total: Prisma.Decimal,
  rates: RateTable,
): { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal } {
  assertRatesValid(rates);
  if (total.isZero()) return { pt: ZERO, gym: ZERO, platform: ZERO };
  if (total.lessThan(0)) throw new Error(`splitThreeWays needs a non-negative total, got ${total.toString()}`);

  const pt = total.mul(rates.ptRate).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const gym = total.mul(rates.gymRate).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const platform = total.minus(pt).minus(gym);

  const sum = pt.plus(gym).plus(platform);
  if (!sum.equals(total)) {
    throw new Error(`three-way split does not reconcile: ${pt}+${gym}+${platform} != ${total}`);
  }
  if (platform.lessThan(0)) {
    throw new Error(`three-way split left the platform negative (${platform.toString()}) for total ${total.toString()}`);
  }
  return { pt, gym, platform };
}

/** Client-facing amounts round UP in the client's favour; the platform eats the difference. */
export function roundForClient(amount: Prisma.Decimal): Prisma.Decimal {
  return amount.toDecimalPlaces(0, Prisma.Decimal.ROUND_UP);
}

// ── PT holdback ──────────────────────────────────────────────────────────────

/**
 * Rate is a share of the price, so 0..1. Refusing a malformed value loudly is deliberate: a
 * caller that sends a holdback rate meant to hold something back, and gets "no holdback" on a
 * typo, would pay the PT in full without anyone noticing.
 */
export function assertHoldbackRateValid(rate: Prisma.Decimal | undefined): void {
  if (rate !== undefined && (!rate.isFinite() || rate.lessThan(0) || rate.greaterThan(1))) {
    throw new Error(`ptHoldbackRate must be between 0 and 1, got ${rate.toString()}`);
  }
}

/**
 * H — how much of the PT's first earnings on a contract is held back: h × price, in WHOLE đồng,
 * rounded DOWN. Every amount in the held-back pot is a whole đồng (session shares are whole
 * đồng, see computeSessionRelease), so the target must be one too; rounding down means the
 * sub-đồng remainder of h × price is never held — it goes to the PT with their first release.
 */
export function holdbackTarget(price: Prisma.Decimal, rate: Prisma.Decimal | undefined): Prisma.Decimal {
  assertHoldbackRateValid(rate);
  if (!rate || rate.isZero()) return ZERO;
  return price.mul(rate).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
}

/**
 * Splits ONE session's PT share between "held back" and "released to available".
 *
 * The PT's first earnings fill the pot until it holds `target`; everything after that is paid
 * out in full. So after u sessions the PT has been released exactly max(0, E − H) where
 * E = u × share, and holds min(E, H):
 *
 *   held     = clamp(target − heldBefore, 0, share)   // this session's contribution to the pot
 *   released = share − held
 *
 * (price 5,000,000 / 10 sessions / PT 0.90 / h 0.10: shares of 450,000 release 0, 400,000, then
 * 450,000 each, while the pot fills 450,000 → 500,000.) Pure, so the cumulative property can be
 * checked by arithmetic alone.
 */
export function splitReleaseWithHoldback(
  share: Prisma.Decimal,
  heldBefore: Prisma.Decimal,
  target: Prisma.Decimal,
): { held: Prisma.Decimal; released: Prisma.Decimal } {
  if (share.lessThanOrEqualTo(0)) return { held: ZERO, released: ZERO };
  const room = target.minus(heldBefore);
  const held = room.lessThanOrEqualTo(0) ? ZERO : room.lessThan(share) ? room : share;
  return { held, released: share.minus(held) };
}

/** The endings that are the PT's fault. The only ones that can draw on the held-back pot. */
export const PT_FAULT_REASONS: ReadonlySet<TerminationReason> = new Set<TerminationReason>([
  'PT_CANCELLED',
  'PT_BANNED',
  'PT_REPEATED_NO_SHOW',
]);

/**
 * The value a PT-fault ending is measured on.
 *
 *   PT_CANCELLED, PT_BANNED   the value of the sessions that will now never be delivered — the
 *                             same `remaining` the refund is taken on (never used, never
 *                             compensated).
 *   PT_REPEATED_NO_SHOW       that remaining value PLUS the value of the sessions already
 *                             compensated as PT no-shows (compensatedSessions × price / N).
 *                             A PT who stops turning up must never come out cheaper than one who
 *                             says so honestly and cancels: those sessions were just as
 *                             undelivered, the client was merely paid for them in instalments.
 *
 * Both reduce to P × (N − u − c)/N and P × (N − u)/N. Zero for every other reason.
 */
export function holdbackCompensationBase(
  input: ContractMoneyInput,
  reason: TerminationReason,
  remaining: Prisma.Decimal,
): Prisma.Decimal {
  if (!PT_FAULT_REASONS.has(reason)) return ZERO;
  if (reason !== 'PT_REPEATED_NO_SHOW') return remaining;
  const compensatedValue = input.price.mul(input.compensatedSessions ?? 0).div(input.totalSessions);
  return remaining.plus(compensatedValue);
}

/**
 * h × base for a PT-fault ending, in whole đồng rounded UP (like every amount a client
 * receives), or zero when the reason is not the PT's fault or the contract carries no holdback.
 * This is only the ceiling: the ledger pays the smaller of it and what is still held back for
 * the PT on that contract, and never funds the difference from anywhere else.
 */
export function holdbackCompensationTarget(
  input: ContractMoneyInput,
  reason: TerminationReason,
  remaining: Prisma.Decimal,
): Prisma.Decimal {
  const rate = input.ptHoldbackRate;
  if (!rate || rate.isZero()) return ZERO;
  return roundForClient(holdbackCompensationBase(input, reason, remaining).mul(rate));
}

// ── Termination ──────────────────────────────────────────────────────────────

export interface TerminationOutcome {
  reason: TerminationReason;
  /** Value of the sessions never delivered (never used, never compensated). */
  remaining: Prisma.Decimal;
  /** Paid back to the client's wallet, rounded in their favour. */
  refund: Prisma.Decimal;
  /** P − compensationValue − refund: what stays in the system to be shared out. */
  withheld: Prisma.Decimal;
  /**
   * What a PT-fault ending (PT_CANCELLED, PT_BANNED, PT_REPEATED_NO_SHOW) owes the CLIENT on
   * top of the refund, BEFORE it is capped by what is actually held back for the PT — whole
   * đồng, rounded up in the client's favour. Zero for every other reason and for a contract
   * with no holdback rate.
   *
   * It is a target, not a payment: the ledger pays min(this, the amount still held for the PT
   * on this contract) and never anything from the PT's available balance or the platform's
   * pocket (contract-ledger.service#terminateContract). It sits outside `refund`, `withheld`
   * and `entitlement`, which is why adding it leaves the reconciliation of those three
   * untouched.
   */
  ptFaultCompensationTarget: Prisma.Decimal;
  /** Final entitlement per party = rate × withheld, exact to the đồng. */
  entitlement: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
}

/**
 * What each party ends up with when a contract stops early, for every reason.
 *
 * The refund is a share of the UNUSED value, never of the whole contract. A flat 10% of P
 * would make the refund go negative on any contract longer than 10 sessions: a 20-session,
 * 2.000.000đ contract cancelled after 19 sessions would withhold 1.900.000 + 200.000 =
 * 2.100.000 — more than the client ever paid. Charging the fee against `remaining` keeps the
 * result in [0, remaining] for every N.
 */
export function computeTermination(
  input: ContractMoneyInput,
  reason: TerminationReason,
): TerminationOutcome {
  validate(input);
  const remaining = remainingValue(input);

  let rawRefund: Prisma.Decimal;
  switch (reason) {
    case 'CLIENT_CANCELLED':
      // The client walks away by choice and forfeits a slice of what is left.
      rawRefund = remaining.mul(CLIENT_CANCEL_REFUND_RATE);
      break;
    case 'PT_BANNED':
    case 'MUTUAL':
    case 'PT_REPEATED_NO_SHOW':
    case 'PT_CANCELLED':
      // The client is made whole. That the PT must also compensate them is a separate matter —
      // see holdbackCompensationTarget below, which pays out of the PT's held-back earnings only.
      rawRefund = remaining;
      break;
    case 'EXPIRED':
    case 'COMPLETED':
      // Nothing is owed back: the client either used the contract up or let it lapse.
      rawRefund = ZERO;
      break;
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled termination reason: ${exhaustive}`);
    }
  }

  const refund = roundForClient(rawRefund);
  if (refund.lessThan(0)) throw new Error(`refund went negative (${refund.toString()}) — formula bug`);
  if (refund.greaterThan(input.price)) {
    throw new Error(`refund ${refund.toString()} exceeds contract price ${input.price.toString()}`);
  }

  // Cụm A1 — a compensated (PT no-show) session's value already left the system entirely
  // before termination ever runs: compensateNoShow already debited this exact amount out of
  // the three parties' pending/available buckets and credited it to the client, as a separate
  // ledger operation with its own idempotency key. `entitlement` here must not re-claim that
  // value for the parties, or settleParty (contract-ledger.service.ts) tries to top a party up
  // using pending money that compensation already took — a silent shortfall, not a thrown
  // error, because settleParty clamps to whatever pending actually holds.
  const compensationValue = input.price.mul(input.compensatedSessions ?? 0).div(input.totalSessions);
  const withheld = input.price.minus(compensationValue).minus(refund);
  const entitlement = splitThreeWays(withheld, input.rates);

  const total = refund.plus(entitlement.pt).plus(entitlement.gym).plus(entitlement.platform);
  const expectedTotal = input.price.minus(compensationValue);
  if (!total.equals(expectedTotal)) {
    throw new Error(`termination does not reconcile: ${total.toString()} != ${expectedTotal.toString()} (price ${input.price.toString()} minus compensation ${compensationValue.toString()} already paid out)`);
  }

  const ptFaultCompensationTarget = holdbackCompensationTarget(input, reason, remaining);

  return { reason, remaining, refund, withheld, ptFaultCompensationTarget, entitlement };
}

// ── Per-session release ──────────────────────────────────────────────────────

/**
 * How much moves from each party's pending bucket to their available bucket when one session
 * is confirmed. Releasing per session (rather than at contract end) keeps the pending bucket
 * exactly equal to the value of the undelivered sessions — which is precisely the pot a
 * refund draws on, so the two mechanisms line up without extra bookkeeping.
 */
export function computeSessionRelease(
  price: Prisma.Decimal,
  totalSessions: number,
  rates: RateTable,
): { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal; unit: Prisma.Decimal } {
  const unit = unitValue(price, totalSessions).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  return { ...splitThreeWays(unit, rates), unit };
}

/**
 * A session the PT failed to attend. The client is compensated one session's value in cash,
 * charged to the three parties in proportion — the platform does not get to keep commission
 * on a session that never happened.
 *
 * The caller must also increment the contract's compensatedSessions by one (never decrement
 * totalSessions, which is immutable once signed — see money-flow plan 1.5). Compensating the
 * client AND leaving the entitlement unconsumed would hand them this session's value twice:
 * once as cash now, once again as `remaining` on a later cancellation (cụm A1).
 */
export function computeNoShowCompensation(
  price: Prisma.Decimal,
  totalSessions: number,
  rates: RateTable,
): { compensation: Prisma.Decimal; pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal } {
  const compensation = roundForClient(unitValue(price, totalSessions));
  const split = splitThreeWays(compensation, rates);
  return { compensation, ...split };
}

/**
 * Open-room online sessions — the PT joined, but after the grace window (currently 15
 * minutes past the scheduled start). Lighter than a full no-show: the PT did show up, so the
 * client's entitlement is NOT touched (they neither lose the session nor get it re-billed),
 * but they are compensated in cash for the lost time — at HALF a full no-show's rate.
 *
 * Deliberately a separate, additive function rather than a parameter added to
 * computeNoShowCompensation above — that formula is relied on elsewhere exactly as it already
 * behaves and must never change shape for its existing callers. This one simply calls it and
 * keeps half of the result; if the full-no-show rate is ever retuned, this stays in lockstep
 * by construction instead of drifting out of sync with a second hardcoded formula.
 */
export function computeLateArrivalCompensation(
  price: Prisma.Decimal,
  totalSessions: number,
  rates: RateTable,
): { compensation: Prisma.Decimal; pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal } {
  const full = computeNoShowCompensation(price, totalSessions, rates);
  const compensation = roundForClient(full.compensation.mul(0.5));
  const split = splitThreeWays(compensation, rates);
  return { compensation, ...split };
}

// ── Reporting ────────────────────────────────────────────────────────────────

export interface MoneyBreakdown {
  price: string;
  totalSessions: number;
  usedSessions: number;
  /** Cụm A1 — sessions consumed via cash compensation rather than being trained. */
  compensatedSessions: number;
  unit: string;
  remaining: string;
  rates: { platformRate: string; ptRate: string; gymRate: string };
  released: { pt: string; gym: string; platform: string };
  stillPending: { pt: string; gym: string; platform: string };
  /** What the client would get back if they cancelled right now. */
  refundIfCancelledNow: string;
}

export function buildMoneyBreakdown(input: ContractMoneyInput): MoneyBreakdown {
  validate(input);
  const unit = unitValue(input.price, input.totalSessions);
  const remaining = remainingValue(input);
  const perSession = computeSessionRelease(input.price, input.totalSessions, input.rates);
  const u = input.usedSessions;
  const c = input.compensatedSessions ?? 0;
  const released = {
    pt: perSession.pt.mul(u),
    gym: perSession.gym.mul(u),
    platform: perSession.platform.mul(u),
  };
  // Cụm A1 — compensateNoShow already debited this amount out of pending/available for a
  // compensated session, same as `released` does for a used one. stillPending must subtract
  // both, or a compensated contract's preview shows pending money that was already paid out.
  const compensationValue = input.price.mul(c).div(input.totalSessions);
  const compensationSplit = splitThreeWays(
    compensationValue.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN),
    input.rates,
  );
  const whole = splitThreeWays(input.price, input.rates);
  const cancelNow = computeTermination(input, 'CLIENT_CANCELLED');

  return {
    price: input.price.toFixed(2),
    totalSessions: input.totalSessions,
    usedSessions: u,
    compensatedSessions: c,
    unit: unit.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN).toFixed(2),
    remaining: remaining.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN).toFixed(2),
    rates: {
      platformRate: input.rates.platformRate.toString(),
      ptRate: input.rates.ptRate.toString(),
      gymRate: input.rates.gymRate.toString(),
    },
    released: {
      pt: released.pt.toFixed(2),
      gym: released.gym.toFixed(2),
      platform: released.platform.toFixed(2),
    },
    stillPending: {
      pt: whole.pt.minus(released.pt).minus(compensationSplit.pt).toFixed(2),
      gym: whole.gym.minus(released.gym).minus(compensationSplit.gym).toFixed(2),
      platform: whole.platform.minus(released.platform).minus(compensationSplit.platform).toFixed(2),
    },
    refundIfCancelledNow: cancelNow.refund.toFixed(2),
  };
}
