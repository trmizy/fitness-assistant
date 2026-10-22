/**
 * The constants of the PT financial holdback that other modules need WITHOUT pulling in the terms service (the contract repository
 * stamps the policy version on create). No imports on purpose.
 */

/**
 * The version of the holdback policy a contract is created under when its rate is above 0:
 *   1 = FH-9: target = rate x the PT's expected income (frozen rates); collected when a session becomes payable; released only after
 *       the contract has ended and is reconciled; PT_BANNED / restrictions / SERVICE_DISCONTINUED_BY_PLATFORM are not PT fault.
 * A contract whose snapshot says 0 is never sent to payment-service with a rate (contract-payout.service#holdbackArgOf).
 */
export const PT_HOLDBACK_POLICY_VERSION = 1;

/** The rate the owner decided (10% of the PT's expected income). One constant, so the flag cannot choose a different figure. */
export const PT_HOLDBACK_RATE = "0.10";

/** Policy version to snapshot for a given rate: 0 for no holdback, the current version otherwise. */
export function policyVersionForRate(rate: { toString(): string } | string | number | null | undefined): number {
  if (rate === null || rate === undefined) return 0;
  const n = Number(rate.toString());
  return Number.isFinite(n) && n > 0 ? PT_HOLDBACK_POLICY_VERSION : 0;
}
