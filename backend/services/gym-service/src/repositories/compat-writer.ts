import type { Prisma } from '../generated/prisma';
import { prisma } from './prisma';

type Tx = Prisma.TransactionClient;

/** The value the database trigger on `gyms` / `gym_partners` recognises as "this write comes from code that knows about
 * the legacy-compat event log" (migration `*_amenity_catalog_listing_revisions`, function `legacy_compat_writer_guard`). */
export const COMPAT_WRITER_VERSION = 'v1';

/**
 * Marks the CURRENT transaction as written by an event-aware writer: `SET LOCAL gymini.compat_writer = 'v1'`.
 *
 * Every transaction that INSERTs or UPDATEs `gyms` or `gym_partners` must call this first. Without it the AFTER
 * INSERT/UPDATE trigger writes a `legacy_compat_events` row with outcome WRITER_ABSENT - which is exactly how a write
 * path nobody remembered to cover (old code, a not-yet-updated instance, a hand-run script) leaves a trace, and what
 * makes the "legacy clients are gone" evidence trustworthy. Seeds / maintenance scripts set 'seed' / 'maintenance'
 * instead, which the trigger records as NON_CLIENT.
 *
 * SET LOCAL lasts until the transaction ends, so it never leaks to another request on the same pooled connection.
 * It must run inside a transaction (outside one PostgreSQL ignores it and warns).
 */
export async function withCompatWriter(tx: Tx): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = '${COMPAT_WRITER_VERSION}'`);
}

/** Runs `fn` in a fresh transaction that is already marked as a compat writer. For a single write that has no
 * transaction of its own (the repositories' create/update helpers). */
export function runAsCompatWriter<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await withCompatWriter(tx);
    return fn(tx);
  });
}
