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
  | 'PT_REPEATED_NO_SHOW'
  // The client leaves because the PT is administratively suspended and cannot deliver. Not the
  // client's choice to walk away (so no cancellation fee) and not proof of PT fault (so no
  // compensation out of the PT's held-back earnings, no penalty, no receivable): it is settled
  // exactly as MUTUAL is — 100% of the unused value back to the client, parties keep what the
  // delivered sessions earned. A separate reason from MUTUAL only so the ledger can tell the two
  // apart (the refund row's description embeds the reason) and so it can never be mistaken for
  // a PT-fault ending (PT_FAULT_REASONS deliberately does not list it).
  | 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION'
  // D49: the platform itself ends the service (a permanent PT ban, a closed PT account ...). Not the client's choice (no
  // cancellation fee) and NOT proof of PT fault: settled exactly as MUTUAL is - 100% of the unused value back to the client,
  // the parties keep what the delivered sessions earned, the PT's held-back money goes back to the PT. It replaces PT_BANNED for
  // every new ending; PT_BANNED stays in this union only so that an ending recorded under it can still be replayed.
  | 'SERVICE_DISCONTINUED_BY_PLATFORM';

/** Share of a contract each party is entitled to. Frozen onto the contract when it is signed. */
export interface RateTable {
  platformRate: Prisma.Decimal;
  ptRate: Prisma.Decimal;
  gymRate: Prisma.Decimal;
}

/** One amount per party. */
export interface PartySplit {
  pt: Prisma.Decimal;
  gym: Prisma.Decimal;
  platform: Prisma.Decimal;
}

/**
 * D77 - late-arrival compensation is deducted from the value of THAT late session: each party's share of the session
 * is reduced by exactly its portion of the compensation already paid to the client. Both figures are read from the
 * ledger (the PT_LATE_ARRIVAL operation of the session), never from the caller.
 *   settled  the session was released / resolved with the deduction applied: the parties were released (share - portion)
 *   open     the session is still unresolved at the exit: its held value is (share - portion)
 */
export interface LateArrivalDeductions {
  settled: PartySplit;
  open: PartySplit;
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
  /**
   * Sessions that are neither "used" nor "unused" at the moment the contract ends: the PT
   * reported them delivered and the client has not confirmed yet, or they are under dispute.
   * Their value (n × one session's value — see unresolvedHeldValue) is outside every figure
   * termination computes: it is not refunded to the client, not part of any party's final
   * entitlement, and not topped up — it stays in the three parties' pending for this contract
   * until each session is resolved one way or the other (contract-ledger.service
   * #resolveUnresolvedSession). Optional, defaulting to 0, so every caller that predates it
   * settles exactly as before.
   */
  unresolvedSessions?: number;
  /** D77, see LateArrivalDeductions. Absent: no session of this contract had its late-arrival compensation deducted. */
  lateArrival?: LateArrivalDeductions;
  rates: RateTable;
  /**
   * The PT holdback rate THIS contract carries (`h`): the share of the PT's expected income whose
   * first earnings the PT does not get to withdraw until the contract has ended and is reconciled. Read by computeTermination only — for the compensation a PT-fault ending owes
   * the client (see holdbackCompensationTarget) — and by the ledger, which holds the money back
   * session by session (contract-ledger.service#releaseSession). FH-9: the rate applies to the PT's
   * expected income on the contract (see holdbackTarget), never to the client's payment.
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
  const unresolvedSessions = input.unresolvedSessions ?? 0;
  if (!Number.isInteger(unresolvedSessions) || unresolvedSessions < 0) {
    throw new Error(`unresolvedSessions must be a non-negative integer, got ${unresolvedSessions}`);
  }
  if (consumed + unresolvedSessions > input.totalSessions) {
    throw new Error(
      `unresolvedSessions (${unresolvedSessions}) cannot exceed totalSessions (${input.totalSessions}) − usedSessions (${input.usedSessions}) − compensatedSessions (${compensatedSessions}) = ${input.totalSessions - consumed}`,
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
  // An unresolved session is not "never delivered" — it may have been taught — so its value is
  // not part of what can be refunded. It leaves `remaining` exactly like a used one does, and
  // is held apart (unresolvedHeldValue) until it is resolved.
  const consumed = input.usedSessions + (input.compensatedSessions ?? 0) + (input.unresolvedSessions ?? 0);
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
 * The PT's expected income on a contract: what the PT ends up with if every session is delivered and nothing is deducted -
 * the PT part of the three-way split of the WHOLE price under the contract's frozen rates (the same figure the final settlement
 * of a completed contract pays: terminateContract's entitlement.pt). Never the client's payment, never the current agreement.
 */
export function ptExpectedIncome(price: Prisma.Decimal, rates: RateTable): Prisma.Decimal {
  return splitThreeWays(price, rates).pt;
}

/**
 * H - FH-9. How much of the PT's earnings on ONE contract is held back: h x (the PT's expected income on that contract), in WHOLE
 * dong, rounded DOWN (the sub-dong remainder is never held - it goes to the PT with the first payout).
 *
 * The base is the PT's expected income computed from the CONTRACT'S frozen rates - NOT the client's payment (price) and never today's
 * agreement. It therefore never touches the gym's or the platform's share, never another contract, and can never exceed what the PT
 * can earn on the contract. Every amount in the pot is a whole dong (session shares are whole dong, see computeSessionRelease), so the
 * target must be one too.
 */
export function holdbackTarget(price: Prisma.Decimal, rate: Prisma.Decimal | undefined, rates: RateTable): Prisma.Decimal {
  assertHoldbackRateValid(rate);
  if (!rate || rate.isZero()) return ZERO;
  return ptExpectedIncome(price, rates).mul(rate).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
}

/**
 * Splits ONE session's PT share between "held back" and "released to available".
 *
 * The PT's earnings from the first payable sessions fill the pot until it holds `target`; everything
 * after that is paid out in full. `share` is what the PT ACTUALLY earns for the session (after the D77
 * late-arrival deduction; a PT no-show earns nothing, so nothing is held for it). After u sessions the PT
 * has been released exactly max(0, E − H) where E = what they earned on them, and holds min(E, H):
 *
 *   held     = clamp(target − heldBefore, 0, share)   // this session's contribution to the pot
 *   released = share − held
 *
 * (1,000,000 / 20 sessions / PT 0.90 / h 0.10: shares of 45,000, target 90,000: S1 and S2 release 0 and
 * hold 45,000 each, then 45,000 each is released.) Pure, so the cumulative property can be
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

/**
 * The endings that are the PT's fault. The only ones that can draw on the held-back pot.
 *
 * FH-9 / D49: PT_BANNED is NOT here any more. A ban (or any restriction) is the platform's decision, not proof that this PT failed this
 * client; "ban = compensate every client" was rejected (D31/D44/D49). New bans end contracts as SERVICE_DISCONTINUED_BY_PLATFORM; an
 * old ending recorded as PT_BANNED is replayed from the ledger with the same amounts and owes no holdback compensation either.
 */
export const PT_FAULT_REASONS: ReadonlySet<TerminationReason> = new Set<TerminationReason>([
  'PT_CANCELLED',
  'PT_REPEATED_NO_SHOW',
]);

/**
 * The value a PT-fault ending is measured on.
 *
 *   PT_CANCELLED              the value of the sessions that will now never be delivered — the
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
  /**
   * P − compensationValue − refund − (value held for unresolved sessions): what is shared out
   * between the parties NOW. With no unresolved sessions this is exactly P − compensation − refund.
   */
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
  /** Informational only (h x the undelivered value of a PT-fault ending). Since the owner closeout the ledger reserves NOTHING for it: a PT ending refunds the client in full from the contract's own funds. */
  ptFaultCompensationTarget: Prisma.Decimal;
  /**
   * Final entitlement per party for everything that is settled at termination = rate × (P −
   * compensation − refund), exact to the đồng, MINUS the share of the unresolved sessions held
   * back (`unresolvedHeld`). Those come to the party only if the session is later resolved as
   * delivered, so the final total a party can reach is this plus its unresolved share.
   */
  entitlement: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal };
  /**
   * The value of the unresolved sessions that stays in the parties' pending for this contract:
   * per party and in total, whole đồng. All zero when unresolvedSessions is 0. Conservation:
   * refund + Σ entitlement + unresolvedHeld.total = P − compensationValue, always.
   */
  unresolvedHeld: { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal; total: Prisma.Decimal };
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
    case 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION':
    case 'SERVICE_DISCONTINUED_BY_PLATFORM':
    case 'PT_REPEATED_NO_SHOW':
    case 'PT_CANCELLED':
      // The client is made whole. That the PT must also compensate them is a separate matter —
      // see holdbackCompensationTarget below, which pays out of the PT's held-back earnings only.
      // CLIENT_EXIT_DUE_TO_PT_RESTRICTION shares this arm with MUTUAL on purpose (same refund,
      // same arithmetic) but is not in PT_FAULT_REASONS, so that compensation is zero for it.
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

  // Cụm A1 — what compensateNoShow ACTUALLY paid out per compensated session: one session's value rounded UP to a
  // whole đồng (computeNoShowCompensation). When the price does not divide evenly, c × the exact unit is a fraction
  // of a đồng below the cash that really left pending, and a refund rounded up on top of it can exceed what is left
  // of the price (5.000.000 / 12 sessions, one no-show, a full refund: 4.583.334 + 416.667 = P + 1). The refund is
  // therefore capped at what remains of the price after the compensation cash, so the figure quoted by the preview,
  // the figure credited and the pending the contract really holds are one and the same number.
  const compensationCash = Prisma.Decimal.min(
    roundForClient(unitValue(input.price, input.totalSessions)).mul(input.compensatedSessions ?? 0),
    input.price,
  );
  // The refund can also never exceed what the contract's pending really holds once the sessions already paid out are
  // taken away. Per-session releases and the held value use the unit rounded DOWN (computeSessionRelease), the refund
  // is rounded UP: on a price that does not divide evenly the three can overlap by a few dong, and the ledger would
  // then credit the client less than the preview quoted. Capping here makes the quote and the credit one number.
  const unitFloor = computeSessionRelease(input.price, input.totalSessions, input.rates).unit;
  const afterPaidOut = input.price
    .minus(unitFloor.mul(input.usedSessions + (input.unresolvedSessions ?? 0)))
    .minus(compensationCash);
  const refund = Prisma.Decimal.min(roundForClient(rawRefund), Prisma.Decimal.max(afterPaidOut, ZERO));
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
  const compensationValue = compensationCash;
  // The split is taken on EVERYTHING that is not refunded, exactly as if the unresolved sessions
  // had been delivered — so a contract whose unresolved sessions all turn out delivered ends with
  // the very figures it would have had if they had been confirmed before the exit. The held
  // value is then carved out of each party's share (never more than the share itself, which
  // only matters in a sub-đồng rounding corner) and stays in pending instead of being topped up.
  // D77: the late-arrival compensation already paid to the client (deducted from the sessions it was paid for) is
  // outside the parties' pot exactly like a no-show compensation is.
  const lateSettled = input.lateArrival?.settled ?? { pt: ZERO, gym: ZERO, platform: ZERO };
  const lateOpen = input.lateArrival?.open ?? { pt: ZERO, gym: ZERO, platform: ZERO };
  const lateAllTotal = lateSettled.pt.plus(lateSettled.gym).plus(lateSettled.platform).plus(lateOpen.pt).plus(lateOpen.gym).plus(lateOpen.platform);
  const withheldAll = input.price.minus(compensationValue).minus(lateAllTotal).minus(refund);
  const fullEntitlement = splitThreeWays(withheldAll, input.rates);
  const idealHeldGross = unresolvedHeldValue(input.price, input.totalSessions, input.rates, input.unresolvedSessions ?? 0);
  const idealHeld = {
    ...idealHeldGross,
    pt: Prisma.Decimal.max(idealHeldGross.pt.minus(lateOpen.pt), ZERO),
    gym: Prisma.Decimal.max(idealHeldGross.gym.minus(lateOpen.gym), ZERO),
    platform: Prisma.Decimal.max(idealHeldGross.platform.minus(lateOpen.platform), ZERO),
  };
  // What each party's pending for this contract can really hold at this point: its share of the whole price, less
  // what the per-session releases (floor-unit splits) and the compensations (ceil-unit splits) already took out of
  // it. The platform takes the remainder of EVERY split, so across N sessions its releases can add up to a few dong
  // more than its share of the price; holding more than the party has would only be clamped by the ledger and then
  // disagree with the quote. Capping the hold here makes the quoted figure and the held figure one number.
  const wholeSplit = splitThreeWays(input.price, input.rates);
  const onePaid = computeSessionRelease(input.price, input.totalSessions, input.rates);
  const oneComp = splitThreeWays(roundForClient(unitValue(input.price, input.totalSessions)), input.rates);
  const spentOf = (key: 'pt' | 'gym' | 'platform') =>
    onePaid[key].mul(input.usedSessions).plus(oneComp[key].mul(input.compensatedSessions ?? 0));
  // (a late-arrival compensation on a session that is still held was taken out of this pending and has not been given back)
  const pendingNow = (key: 'pt' | 'gym' | 'platform') => Prisma.Decimal.max(wholeSplit[key].minus(spentOf(key)).minus(lateOpen[key]), ZERO);
  const heldPt = Prisma.Decimal.min(idealHeld.pt, fullEntitlement.pt, pendingNow('pt'));
  const heldGym = Prisma.Decimal.min(idealHeld.gym, fullEntitlement.gym, pendingNow('gym'));
  const heldPlatform = Prisma.Decimal.min(idealHeld.platform, fullEntitlement.platform, pendingNow('platform'));
  const unresolvedHeld = { pt: heldPt, gym: heldGym, platform: heldPlatform, total: heldPt.plus(heldGym).plus(heldPlatform) };
  const entitlement = {
    pt: fullEntitlement.pt.minus(heldPt),
    gym: fullEntitlement.gym.minus(heldGym),
    platform: fullEntitlement.platform.minus(heldPlatform),
  };
  const withheld = withheldAll.minus(unresolvedHeld.total);

  const total = refund.plus(entitlement.pt).plus(entitlement.gym).plus(entitlement.platform).plus(unresolvedHeld.total);
  const expectedTotal = input.price.minus(compensationValue).minus(lateAllTotal);
  if (!total.equals(expectedTotal)) {
    throw new Error(`termination does not reconcile: ${total.toString()} != ${expectedTotal.toString()} (price ${input.price.toString()} minus compensation ${compensationValue.toString()} already paid out)`);
  }

  const ptFaultCompensationTarget = holdbackCompensationTarget(input, reason, remaining);

  return { reason, remaining, refund, withheld, ptFaultCompensationTarget, entitlement, unresolvedHeld };
}

/**
 * What `n` unresolved sessions hold back: n × one session's value, in the SAME unit and the SAME
 * three-way split releaseSession moves for a single session (computeSessionRelease), so that
 * resolving a session as delivered later moves exactly the amount that is held for it.
 * Whole đồng by construction: the unit is rounded down, PT and gym round down within it and the
 * platform takes the remainder. The sub-đồng left over from P / N is NOT held — it stays in the
 * exit settlement (the refund is rounded up on the exact value, the parties share the rest).
 */
export function unresolvedHeldValue(
  price: Prisma.Decimal,
  totalSessions: number,
  rates: RateTable,
  n: number,
): { pt: Prisma.Decimal; gym: Prisma.Decimal; platform: Prisma.Decimal; total: Prisma.Decimal; unit: Prisma.Decimal } {
  const one = computeSessionRelease(price, totalSessions, rates);
  const pt = one.pt.mul(n);
  const gym = one.gym.mul(n);
  const platform = one.platform.mul(n);
  return { pt, gym, platform, total: pt.plus(gym).plus(platform), unit: one.unit };
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
  /**
   * What the client would get back if the contract ended right now for `reasonUsed` — computed by
   * computeTermination, the same function and the same inputs terminateContract uses, so the
   * preview can never disagree with the money that really moves. (The name is historical: it
   * was the client-cancellation figure before the reason became selectable.)
   */
  refundIfCancelledNow: string;
  /** The termination reason the figure above was computed for. */
  reasonUsed: TerminationReason;
  /** Present only when unresolvedSessions > 0: how many sessions are neither used nor unused. */
  unresolvedSessions?: number;
  /** Present only when unresolvedSessions > 0: the value that stays held until they are resolved. */
  unresolvedAmountHeld?: string;
}

export function buildMoneyBreakdown(input: ContractMoneyInput, reason: TerminationReason = 'CLIENT_CANCELLED'): MoneyBreakdown {
  validate(input);
  const unit = unitValue(input.price, input.totalSessions);
  const remaining = remainingValue(input);
  const perSession = computeSessionRelease(input.price, input.totalSessions, input.rates);
  const u = input.usedSessions;
  const c = input.compensatedSessions ?? 0;
  const lateSettled = input.lateArrival?.settled ?? { pt: ZERO, gym: ZERO, platform: ZERO };
  const lateOpen = input.lateArrival?.open ?? { pt: ZERO, gym: ZERO, platform: ZERO };
  const released = {
    pt: perSession.pt.mul(u).minus(lateSettled.pt),
    gym: perSession.gym.mul(u).minus(lateSettled.gym),
    platform: perSession.platform.mul(u).minus(lateSettled.platform),
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
  const cancelNow = computeTermination(input, reason);
  const unresolved = input.unresolvedSessions ?? 0;

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
      pt: whole.pt.minus(released.pt).minus(compensationSplit.pt).minus(lateSettled.pt).minus(lateOpen.pt).toFixed(2),
      gym: whole.gym.minus(released.gym).minus(compensationSplit.gym).minus(lateSettled.gym).minus(lateOpen.gym).toFixed(2),
      platform: whole.platform.minus(released.platform).minus(compensationSplit.platform).minus(lateSettled.platform).minus(lateOpen.platform).toFixed(2),
    },
    refundIfCancelledNow: cancelNow.refund.toFixed(2),
    reasonUsed: reason,
    ...(unresolved > 0
      ? { unresolvedSessions: unresolved, unresolvedAmountHeld: cancelNow.unresolvedHeld.total.toFixed(2) }
      : {}),
  };
}
