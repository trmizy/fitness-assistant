/**
 * PT holdback: the share of a contract's price whose first earnings the PT does not get to
 * withdraw until the contract ends well, or sits idle (see Contract.ptHoldbackRate in the schema
 * and payment-service's contract-ledger.service#releaseSession / #terminateContract).
 *
 * The rate a NEW contract is snapshotted with comes from exactly one place: this function.
 */

/**
 * The holdback rate a contract between a client and `ptUserId` is created with — a decimal string
 * like the rate table's ("0.10"), "0" for none.
 *
 * Today it ALWAYS returns "0": the rule is built and tested but switched OFF, and no real
 * contract is affected. It will return "0.10" only for PTs who have accepted the version of the
 * terms that states the rule — the terms-acceptance feature that decides that does not exist
 * yet (a later task; do not read a PT's acceptance from anywhere else in the meantime). Until
 * then `ptUserId` is deliberately unused.
 *
 * Why a snapshot, not a lookup at payout time: a PT can only be held to a term they agreed to
 * when the contract was created. Flipping this later changes only contracts created after the
 * flip; every existing row keeps the 0 it was created with.
 */
export async function resolvePtHoldbackRate(_ptUserId: string): Promise<string> {
  return "0";
}

/**
 * How many days a contract may go without any session before its held-back amount is released to
 * the PT and the contract carries on without a holdback. One constant, env-configurable
 * (PT_HOLDBACK_IDLE_DAYS), default 30. Read once at module load so the sweep and its tests agree.
 */
export const PT_HOLDBACK_IDLE_DAYS = (() => {
  const n = Number(process.env.PT_HOLDBACK_IDLE_DAYS ?? 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();
