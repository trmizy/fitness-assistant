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
  | 'COMPLETED';

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
  rates: RateTable;
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
  if (input.usedSessions > input.totalSessions) {
    throw new Error(`usedSessions (${input.usedSessions}) cannot exceed totalSessions (${input.totalSessions})`);
  }
  assertRatesValid(input.rates);
}

/** unit = P / N, unrounded. */
export function unitValue(price: Prisma.Decimal, totalSessions: number): Prisma.Decimal {
  if (totalSessions <= 0) throw new Error('totalSessions must be > 0');
  return price.div(totalSessions);
}

/** remaining = P × (N − u) / N — the value of the sessions not yet consumed. */
export function remainingValue(input: ContractMoneyInput): Prisma.Decimal {
  validate(input);
  const unused = input.totalSessions - input.usedSessions;
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

// ── Termination ──────────────────────────────────────────────────────────────

export interface TerminationOutcome {
  reason: TerminationReason;
  /** Value of the sessions never delivered. */
  remaining: Prisma.Decimal;
  /** Paid back to the client's wallet, rounded in their favour. */
  refund: Prisma.Decimal;
  /** P − refund: what stays in the system to be shared out. */
  withheld: Prisma.Decimal;
  /** Extra penalty taken from the PT (and gym) on top, for PT-initiated cancellation. */
  penalty: Prisma.Decimal;
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
  let penalty = ZERO;
  switch (reason) {
    case 'CLIENT_CANCELLED':
      // The client walks away by choice and forfeits a slice of what is left.
      rawRefund = remaining.mul(CLIENT_CANCEL_REFUND_RATE);
      break;
    case 'PT_BANNED':
    case 'MUTUAL':
      rawRefund = remaining;
      break;
    case 'PT_CANCELLED':
      // Mirror image of CLIENT_CANCELLED: the client is made whole, and the same slice is
      // charged to the side that broke the arrangement.
      rawRefund = remaining;
      penalty = remaining.mul(ONE.minus(CLIENT_CANCEL_REFUND_RATE));
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

  const withheld = input.price.minus(refund);
  const entitlement = splitThreeWays(withheld, input.rates);

  const total = refund.plus(entitlement.pt).plus(entitlement.gym).plus(entitlement.platform);
  if (!total.equals(input.price)) {
    throw new Error(`termination does not reconcile: ${total.toString()} != ${input.price.toString()}`);
  }

  return { reason, remaining, refund, withheld, penalty, entitlement };
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
 * The caller must also drop totalSessions by one: the client has been paid out for this
 * session, so leaving the quota in place would hand them the value twice.
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

// ── Reporting ────────────────────────────────────────────────────────────────

export interface MoneyBreakdown {
  price: string;
  totalSessions: number;
  usedSessions: number;
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
  const released = {
    pt: perSession.pt.mul(u),
    gym: perSession.gym.mul(u),
    platform: perSession.platform.mul(u),
  };
  const whole = splitThreeWays(input.price, input.rates);
  const cancelNow = computeTermination(input, 'CLIENT_CANCELLED');

  return {
    price: input.price.toFixed(2),
    totalSessions: input.totalSessions,
    usedSessions: u,
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
      pt: whole.pt.minus(released.pt).toFixed(2),
      gym: whole.gym.minus(released.gym).toFixed(2),
      platform: whole.platform.minus(released.platform).toFixed(2),
    },
    refundIfCancelledNow: cancelNow.refund.toFixed(2),
  };
}
