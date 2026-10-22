/**
 * PT financial holdback (FH-9): the share of a PT's EXPECTED INCOME on one contract that is held back from their first earnings
 * until the contract has ended and is reconciled (see payment-service's contract-ledger.service / contract-money.ts#holdbackTarget).
 *
 * The rate (and the policy version it was decided under) a NEW contract is snapshotted with comes from exactly one place: this file.
 * Everything after that reads the contract's own snapshot - never this function, never the flag.
 */
import { PT_TERMS_IS_DRAFT, PT_TERMS_VERSION } from "./pt-terms";
import { ptTermsService } from "./pt-terms.service";
import { PT_HOLDBACK_POLICY_VERSION, PT_HOLDBACK_RATE, policyVersionForRate } from "./pt-holdback-policy";

export { PT_HOLDBACK_POLICY_VERSION, PT_HOLDBACK_RATE, policyVersionForRate };

/**
 * PT_HOLDBACK_NEW_CONTRACTS_ENABLED - only the exact value "true" (case-insensitive, trimmed) turns the holdback on for NEW contracts.
 * Default OFF. Read on every call, never cached. Turning it off later changes only contracts created afterwards: every contract that
 * already carries the snapshot keeps its rules and its held money (nothing is released, nothing is lost).
 */
export function ptHoldbackEnabledForNewContracts(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PT_HOLDBACK_NEW_CONTRACTS_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * The holdback rate a contract between a client and `ptUserId` is created with - a decimal string like the rate table's ("0.10"),
 * "0" for none.
 *
 * "0.10" ONLY when ALL hold:
 *   - the flag is on (above);
 *   - the terms the PT is held to are a RELEASED version (not a draft) that states the rule: PT_HOLDBACK_TERMS_VERSION, set by
 *     operations when that version is published, must equal the version the service currently serves;
 *   - this PT has confirmed exactly that version (a PT can only be held to a term they agreed to).
 * Anything else, or any failure to find out, is "0": the holdback is never applied on a guess.
 *
 * Why a snapshot, not a lookup at payout time: flipping the flag later changes only contracts created after the flip; every existing
 * row keeps the value it was created with.
 */
export async function resolvePtHoldbackRate(
  ptUserId: string,
  deps: {
    env?: NodeJS.ProcessEnv;
    termsVersion?: string;
    termsAreDraft?: boolean;
    hasAcceptedCurrent?: (userId: string) => Promise<boolean>;
  } = {},
): Promise<string> {
  const env = deps.env ?? process.env;
  if (!ptHoldbackEnabledForNewContracts(env)) return "0";
  const statedIn = (env.PT_HOLDBACK_TERMS_VERSION ?? "").trim();
  if (!statedIn || statedIn !== (deps.termsVersion ?? PT_TERMS_VERSION) || (deps.termsAreDraft ?? PT_TERMS_IS_DRAFT)) return "0";
  try {
    const accepted = await (deps.hasAcceptedCurrent ?? ((id: string) => ptTermsService.hasAcceptedCurrent(id)))(ptUserId);
    return accepted ? PT_HOLDBACK_RATE : "0";
  } catch {
    return "0";
  }
}
