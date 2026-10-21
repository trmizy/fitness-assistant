import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import type { ClientMembershipLookup } from "../clients/gym.client";

/**
 * Phase 3 / P3.3 (owner decision D67, D18) - "may this client ask for a PT contract at this
 * gym?", from the client's gym membership.
 *
 * ONE definition, two callers: `contractService.requestContract` (which refuses with 422) and
 * `GET /contracts/gym-options` (which reports `eligibility` per branch). Neither may re-derive it,
 * so the picker can never offer a branch the request then refuses.
 *
 * The rule (D67), for a contract that has a gym:
 *   1. MEMBERSHIP_REQUIRED - no active membership at the BRAND of the gym (membership is
 *      brand-level; a sibling branch's membership counts, another brand's does not). "Active" is
 *      gym-service's own definition (P3.1: status ACTIVE, end date not passed, visits left) -
 *      expired / cancelled / pending-payment memberships arrive here as "none".
 *   2. MEMBERSHIP_DOES_NOT_COVER_CONTRACT - an active membership exists but ends before the
 *      contract would end (10 days left vs a 60-day contract -> blocked; 60 vs 60 -> allowed;
 *      longer -> allowed). Nothing is bought, renewed or paid automatically.
 *
 *   3. OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN (owner rule, Codex #6) - the contract has NO fixed duration
 *      (the package has validityDays null) and the membership has an end date. An open-ended contract can outlive any
 *      expiring membership, so coverage cannot be proven: refused (409). A membership with NO end date (unlimited) still
 *      passes, and contracts with a validityDays keep rule 2. The picker keeps reporting reason
 *      MEMBERSHIP_DOES_NOT_COVER_CONTRACT for this case (the only reason the shipped clients render) and adds
 *      `detailCode` with the specific one.
 *
 * Not decided, therefore NOT enforced here (see S_p3_3.md): a membership visit limit vs the contract's session count.
 */

export const MEMBERSHIP_REQUIRED = "MEMBERSHIP_REQUIRED";
export const MEMBERSHIP_DOES_NOT_COVER_CONTRACT = "MEMBERSHIP_DOES_NOT_COVER_CONTRACT";

export const OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN = "OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN";

export type MembershipIneligibleReason =
  | typeof MEMBERSHIP_REQUIRED
  | typeof MEMBERSHIP_DOES_NOT_COVER_CONTRACT
  | typeof OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN;

/** What `GET /contracts/gym-options` carries per gym. Computed here only. */
export interface GymContractEligibility {
  canRequest: boolean;
  /** One of the two reasons the shipped clients know; the open-ended refusal is reported as DOES_NOT_COVER (see `detailCode`). */
  reason: typeof MEMBERSHIP_REQUIRED | typeof MEMBERSHIP_DOES_NOT_COVER_CONTRACT | null;
  /** Present only for the open-ended refusal: the specific code the request itself answers with. */
  detailCode?: typeof OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a contract with `validityDays` would end if it started at `startDate`. Same arithmetic as
 * the activation in `contractRepository.activateIfPendingGuarded` (contract.repository.ts: `endDate
 * = startDate + validityDays * 24h`, validityDays frozen on the contract from the package) - a test
 * pins the two together. Null validityDays = the contract has no expiry = no end date.
 *
 * At request time the contract has not started (the PT must accept, the client must pay), so the
 * only honest projection is "if it started now"; the real end can only be later.
 */
export function projectedContractEnd(startDate: Date, validityDays: number | null | undefined): Date | null {
  return validityDays != null ? new Date(startDate.getTime() + validityDays * DAY_MS) : null;
}

export interface MembershipEligibilityOk {
  ok: true;
  /** The membership chosen to back the contract (snapshotted as `gymMembershipId`). */
  membershipId: string;
  membershipEndDate: string | null;
  contractEndDate: string | null;
}

export interface MembershipEligibilityRefused {
  ok: false;
  code: MembershipIneligibleReason;
  /** Machine-readable facts for the UI (ids and ISO dates, no internal rates). */
  details: {
    gymId: string;
    brandId: string | null;
    membershipEndDate?: string | null;
    contractEndDate?: string | null;
  };
}

export type MembershipEligibility = MembershipEligibilityOk | MembershipEligibilityRefused;

/** Millisecond end of a membership; null end date = no expiry = never ends. */
function endMs(endDate: string | null): number {
  if (endDate == null) return Number.POSITIVE_INFINITY;
  const t = Date.parse(endDate);
  // Unreadable date from gym-service: cannot prove coverage -> treat as already over (fail closed).
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Whole days a membership still has at `now`, rounded UP ("60 days left" is what a member sees,
 * the purchase moment having moved a few minutes). A membership with no end date has infinite days.
 */
function daysLeft(endDate: string | null, now: Date): number {
  const end = endMs(endDate);
  if (end === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.ceil((end - now.getTime()) / DAY_MS);
}

/**
 * THE decision. Pure: the lookup is gym-service's answer for (client, gym), `null` when gym-service
 * does not know the branch. `now` is injected so request time and picker time agree and tests are
 * exact.
 *
 * Coverage compares WHOLE DAYS: the membership covers a `validityDays` contract when it has at
 * least `validityDays` days left (rounded up). A membership bought minutes before the request still
 * covers a contract of the same length - an exact-instant comparison would block "60 days vs 60
 * days" by the few minutes that passed since purchase, contradicting the owner's example.
 */
export function evaluateMembershipForContract(input: {
  lookup: ClientMembershipLookup | null;
  gymId: string;
  /** The brand the agreement resolved to (fallback when the lookup carries none). */
  brandId?: string | null;
  validityDays: number | null | undefined;
  now: Date;
}): MembershipEligibility {
  const { lookup, gymId, validityDays, now } = input;
  const brandId = lookup?.brandId ?? input.brandId ?? null;

  const candidates = lookup?.hasActiveMembership
    ? ((lookup.memberships && lookup.memberships.length > 0 ? lookup.memberships : lookup.membership ? [lookup.membership] : []) as NonNullable<
        ClientMembershipLookup["membership"]
      >[])
    : [];
  if (candidates.length === 0) {
    return { ok: false, code: MEMBERSHIP_REQUIRED, details: { gymId, brandId } };
  }

  // Several active memberships of one brand can exist (one per branch). The one that lasts longest
  // is the best chance of covering the contract; ties keep gym-service's order (newest first).
  let best = candidates[0];
  for (const c of candidates) if (endMs(c.endDate) > endMs(best.endDate)) best = c;

  const contractEnd = projectedContractEnd(now, validityDays);
  // Open-ended contract (validityDays null): only a membership with NO end date is proven to cover it.
  const openEnded = validityDays == null;
  if (openEnded && best.endDate != null) {
    return {
      ok: false,
      code: OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN,
      details: { gymId, brandId, membershipEndDate: best.endDate, contractEndDate: null },
    };
  }
  const covers = openEnded || daysLeft(best.endDate, now) >= validityDays!;
  if (!covers) {
    return {
      ok: false,
      code: MEMBERSHIP_DOES_NOT_COVER_CONTRACT,
      details: {
        gymId,
        brandId,
        membershipEndDate: best.endDate ?? null,
        contractEndDate: contractEnd ? contractEnd.toISOString() : null,
      },
    };
  }
  return {
    ok: true,
    membershipId: best.membershipId,
    membershipEndDate: best.endDate ?? null,
    contractEndDate: contractEnd ? contractEnd.toISOString() : null,
  };
}

export function toGymContractEligibility(result: MembershipEligibility): GymContractEligibility {
  if (result.ok) return { canRequest: true, reason: null };
  if (result.code === OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN) {
    return { canRequest: false, reason: MEMBERSHIP_DOES_NOT_COVER_CONTRACT, detailCode: OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN };
  }
  return { canRequest: false, reason: result.code };
}

function codedErr(message: string, status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}

/**
 * requestContract's gate: ask gym-service (fail closed - unreachable -> 503, never "no membership"
 * and never "fine"), decide with the shared function, refuse with 422 + code. Returns the membership
 * to snapshot on the contract.
 */
export async function assertClientMayRequestGymContract(input: {
  clientUserId: string;
  gymId: string;
  brandId?: string | null;
  validityDays: number | null | undefined;
  now?: Date;
}): Promise<{ membershipId: string }> {
  let lookup: ClientMembershipLookup | null;
  try {
    lookup = await gymClient.getClientMembershipAtGym(input.clientUserId, input.gymId);
  } catch (e) {
    if (e instanceof GymServiceUnavailableError) {
      // Same shape as requestContract's other gym-service outage (503, no code).
      throw Object.assign(new Error("Không thể xác nhận gói hội viên của bạn lúc này, vui lòng thử lại"), { status: 503 });
    }
    throw e;
  }
  const result = evaluateMembershipForContract({
    lookup,
    gymId: input.gymId,
    brandId: input.brandId,
    validityDays: input.validityDays,
    now: input.now ?? new Date(),
  });
  if (result.ok) return { membershipId: result.membershipId };
  if (result.code === MEMBERSHIP_REQUIRED) {
    throw codedErr(
      "Bạn cần có gói hội viên còn hiệu lực tại thương hiệu phòng gym này để tập với PT tại đây",
      422,
      MEMBERSHIP_REQUIRED,
      result.details,
    );
  }
  if (result.code === OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN) {
    throw codedErr(
      "Gói PT này không có thời hạn cố định, còn gói hội viên của bạn sẽ hết hạn nên không thể đảm bảo bạn được tập tại phòng gym suốt thời gian hợp đồng — hãy chọn gói PT có thời hạn cụ thể, hoặc dùng gói hội viên không giới hạn thời gian",
      409,
      OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN,
      result.details,
    );
  }
  throw codedErr(
    "Gói hội viên của bạn hết hạn trước khi hợp đồng PT kết thúc — hãy gia hạn hoặc mua gói dài hơn",
    422,
    MEMBERSHIP_DOES_NOT_COVER_CONTRACT,
    result.details,
  );
}
