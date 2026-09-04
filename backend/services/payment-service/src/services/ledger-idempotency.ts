import { Prisma } from '../generated/prisma';
import type { LedgerOps } from './wallet.service';

/**
 * Runs `run` at most once for a given business key, inside the same DB transaction as the
 * wallet movements it guards (money-flow redesign plan item 1.1).
 *
 * Every cross-service financial call in this system can legitimately be retried: the caller
 * (user-service, gym-service) may have crashed or timed out *after* payment-service committed
 * the money movement but *before* it recorded that success locally. Without a business-level
 * key, that retry re-executes the same movement a second time — the `transactionId` these
 * functions also take is only ever an FK anchor for WalletLedgerEntry rows and a label, never
 * a uniqueness check.
 *
 * The check-and-record happens inside the SAME `prisma.$transaction` as `run`'s wallet writes
 * (both share `ops.tx`), so a crash between "money moved" and "this row committed" is
 * impossible: either the whole transaction commits — money moved AND the key is claimed — or
 * it rolls back entirely and a retry starts clean. Two concurrent callers racing on the same
 * key that also touch the same wallets already serialize on the wallet FOR UPDATE locks
 * `withWallets` takes before this ever runs, so the loser simply finds the row the winner just
 * committed and replays it rather than racing on the key's unique index.
 */
export async function withIdempotentLedgerOp<T>(ops: LedgerOps, key: string, run: () => Promise<T>): Promise<T> {
  const existing = await ops.tx.ledgerOperation.findUnique({ where: { key } });
  if (existing) return existing.result as T;
  const result = await run();
  await ops.tx.ledgerOperation.create({ data: { key, result: result as unknown as Prisma.InputJsonValue } });
  return result;
}
