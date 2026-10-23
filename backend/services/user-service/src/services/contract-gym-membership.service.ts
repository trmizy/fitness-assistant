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
 *   0. GYM_CONTRACT_REQUIRES_FIXED_DURATION (owner rule, Codex #6, decided final) - a PT contract linked to a gym MUST have a fixed
 *      duration at signing. A package with no validityDays (null, 0 or negative) can never be a gym contract: refused (409) before
 *      any membership is looked at, and `validityDays = null` never means "covers forever" - not even for an unlimited membership.
 *      An UNLIMITED membership (no end date) still covers any fixed-duration contract (rule 2 passes). Contracts without a gym are
 *      not affected. The picker reports this as `reason: GYM_CONTRACT_REQUIRES_FIXED_DURATION` with canRequest false (the shipped
 *      clients already render an unknown reason with their generic "cannot register here" copy).
 *
 * Boundary of rule 2 (the day semantics): membership and contract lengths are compared in WHOLE DAYS, the days left on the membership
 * rounded UP. Vietnam (Asia/Ho_Chi_Minh, UTC+7) has no daylight saving, so a local calendar day is exactly 24 h and "days" here are
 * 24 h units, the same as the activation arithmetic (startDate + validityDays * 24 h). Consequences, pinned by tests:
 *   - membership end == projected contract end                 -> covers (60 vs 60);
 *   - membership end 1 ms before the contract end              -> still covers (it still has 60 days left, rounded up: the few minutes
 *     between buying the membership and sending the request must not turn "60 vs 60" into a refusal);
 *   - membership with exactly validityDays - 1 days left       -> refused; one ms more                  -> covers;
 *   - membership with no end date                              -> covers.
 *
 * Not decided, therefore NOT enforced here (see S_p3_3.md): a membership visit limit vs the contract's session count.
 */

export const MEMBERSHIP_REQUIRED = "MEMBERSHIP_REQUIRED";
export const MEMBERSHIP_DOES_NOT_COVER_CONTRACT = "MEMBERSHIP_DOES_NOT_COVER_CONTRACT";

export const GYM_CONTRACT_REQUIRES_FIXED_DURATION = "GYM_CONTRACT_REQUIRES_FIXED_DURATION";

export type MembershipIneligibleReason =
  | typeof MEMBERSHIP_REQUIRED
  | typeof MEMBERSHIP_DOES_NOT_COVER_CONTRACT
  | typeof GYM_CONTRACT_REQUIRES_FIXED_DURATION;

/** What `GET /contracts/gym-options` carries per gym. Computed here only. */
export interface GymContractEligibility {
  canRequest: boolean;
  /** The same code the request itself answers with. A client that does not know a reason still blocks the branch (generic copy). */
  reason: MembershipIneligibleReason | null;
}

/** A gym contract needs a real, positive, whole number of days. null / undefined / 0 / negative / fractional never qualify. */
export function hasFixedDuration(validityDays: number | null | undefined): validityDays is number {
  return typeof validityDays === "number" && Number.isInteger(validityDays) && validityDays > 0;
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

  // Rule 0 first: it is a property of the package, not of the member, and no membership can change it.
  if (!hasFixedDuration(validityDays)) {
    return { ok: false, code: GYM_CONTRACT_REQUIRES_FIXED_DURATION, details: { gymId, brandId } };
  }

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
  const covers = daysLeft(best.endDate, now) >= validityDays;
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
  return { canRequest: false, reason: result.code };
}

function codedErr(message: string, status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}

/** Who is being told: the wording differs, the verdict never does. */
export type MembershipGateAudience = "CLIENT" | "PT";

function throwRefusal(result: MembershipEligibilityRefused, audience: MembershipGateAudience): never {
  if (result.code === MEMBERSHIP_REQUIRED) {
    throw codedErr(
      audience === "PT"
        ? "Học viên hiện không còn gói hội viên còn hiệu lực tại thương hiệu phòng gym này nên chưa thể chấp nhận hợp đồng."
        : "Bạn cần có gói hội viên còn hiệu lực tại thương hiệu phòng gym này để tập với PT tại đây",
      422,
      MEMBERSHIP_REQUIRED,
      result.details,
    );
  }
  if (result.code === GYM_CONTRACT_REQUIRES_FIXED_DURATION) {
    throw codedErr(
      audience === "PT"
        ? "Hợp đồng qua phòng gym phải có thời hạn cố định, nhưng gói của yêu cầu này chưa khai báo số ngày hiệu lực nên chưa thể chấp nhận. Hãy từ chối yêu cầu, thêm thời hạn cho gói rồi nhờ học viên gửi lại."
        : "Hợp đồng PT tại phòng gym phải có thời hạn cố định, nhưng gói PT này chưa có thời hạn. Hãy chọn gói PT có thời hạn cụ thể, hoặc tập không qua phòng gym.",
      409,
      GYM_CONTRACT_REQUIRES_FIXED_DURATION,
      result.details,
    );
  }
  throw codedErr(
    audience === "PT"
      ? "Gói hội viên của học viên hết hạn trước khi hợp đồng PT kết thúc nên chưa thể chấp nhận hợp đồng."
      : "Gói hội viên của bạn hết hạn trước khi hợp đồng PT kết thúc — hãy gia hạn hoặc mua gói dài hơn",
    422,
    MEMBERSHIP_DOES_NOT_COVER_CONTRACT,
    result.details,
  );
}

async function lookupMembership(clientUserId: string, gymId: string): Promise<ClientMembershipLookup | null> {
  try {
    return await gymClient.getClientMembershipAtGym(clientUserId, gymId);
  } catch (e) {
    if (e instanceof GymServiceUnavailableError) {
      // Same shape as requestContract's other gym-service outage (503, no code). Fail closed: never "no membership", never "fine".
      throw Object.assign(new Error("Không thể xác nhận gói hội viên của bạn lúc này, vui lòng thử lại"), { status: 503 });
    }
    throw e;
  }
}

/**
 * requestContract's gate: ask gym-service (fail closed - unreachable -> 503, never "no membership"
 * and never "fine"), decide with the shared function, refuse with the coded error (422 membership, 409 fixed duration).
 * Returns the membership to snapshot on the contract.
 */
export async function assertClientMayRequestGymContract(input: {
  clientUserId: string;
  gymId: string;
  brandId?: string | null;
  validityDays: number | null | undefined;
  now?: Date;
}): Promise<{ membershipId: string }> {
  // A package without a fixed duration is refused before gym-service is even asked: nothing it could answer changes the verdict.
  const lookup = hasFixedDuration(input.validityDays) ? await lookupMembership(input.clientUserId, input.gymId) : null;
  const result = evaluateMembershipForContract({
    lookup,
    gymId: input.gymId,
    brandId: input.brandId,
    validityDays: input.validityDays,
    now: input.now ?? new Date(),
  });
  if (result.ok) return { membershipId: result.membershipId };
  return throwRefusal(result, "CLIENT");
}

/**
 * The same verdict, re-asked on an EXISTING contract at the two points where a decision is still open: the PT accepting it and the
 * client paying it (the money has not moved yet at either). A contract without a gym is not asked. The duration comes from the
 * contract's own frozen `validityDays` (the package snapshot), so a later edit of the package cannot loosen or tighten it, and the
 * membership must cover `now + validityDays` - the earliest the contract could start counting. Refusals leave the contract untouched.
 */
export async function assertGymContractStillCovered(
  contract: { gymId: string | null; clientUserId: string; gymBrandId: string | null; validityDays: number | null },
  audience: MembershipGateAudience,
  now: Date = new Date(),
): Promise<void> {
  if (!contract.gymId) return;
  const lookup = hasFixedDuration(contract.validityDays) ? await lookupMembership(contract.clientUserId, contract.gymId) : null;
  const result = evaluateMembershipForContract({
    lookup,
    gymId: contract.gymId,
    brandId: contract.gymBrandId,
    validityDays: contract.validityDays,
    now,
  });
  if (!result.ok) throwRefusal(result, audience);
}
