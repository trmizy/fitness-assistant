import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the worker's claim on one execution incarnation of an AiGenerationOperation through the processor call
 * tree so the plan repository can fence its writes without every processor threading a token around.
 * Deliberately dependency-free: the repository imports this file, and generation-operations.ts (which imports the
 * repository) registers the runner, so there is no import cycle.
 */
export type LeaseContext = { operationId: string; epoch: number; token: string; targetId: string };

export class StaleLeaseError extends Error {
  constructor(operationId: string) {
    super(`Generation operation ${operationId} is no longer owned by this attempt`);
    this.name = "StaleLeaseError";
  }
}

export const leaseStorage = new AsyncLocalStorage<LeaseContext>();

type DbLike = any;
type FencedRunner = <T>(ctx: LeaseContext, planId: string, fn: (db: DbLike) => Promise<T>) => Promise<T>;

let runner: FencedRunner | null = null;
let checker: ((ctx: LeaseContext) => Promise<boolean>) | null = null;
export function registerFencedRunner(r: FencedRunner | null, c: ((ctx: LeaseContext) => Promise<boolean>) | null): void {
  runner = r;
  checker = c;
}

/**
 * ATOMIC fenced write. Outside a claimed worker attempt: runs `fn(defaultDb)` unchanged. Inside one: runs `fn` in a
 * short database transaction that FIRST takes the operation row lock with the ownership predicate
 * (id + epoch + lease token + RUNNING + unexpired lease), so the lease cannot be taken over between the check and the
 * write, and a stale owner's write never executes (StaleLeaseError). The plan id must equal the operation's target. Never wrap model inference in `fn`.
 */
export async function runFenced<T>(defaultDb: DbLike, planId: string, fn: (db: DbLike) => Promise<T>): Promise<T> {
  const ctx = leaseStorage.getStore();
  if (!ctx || !runner) return fn(defaultDb);
  // `planId` is asserted against the operation's canonical target inside the transaction: a worker can only mutate the plan
  // its own execution owns, never an arbitrary plan id.
  return runner(ctx, planId, fn);
}

/** Inside a claimed worker attempt a plan write must touch exactly one row; anything else aborts (rolls back) the fenced transaction. */
export function expectOneRowInWorker(count: number, what: string): void {
  if (leaseStorage.getStore() && count !== 1) throw new Error(`Fenced plan write affected ${count} rows (${what}); expected exactly 1`);
}

/**
 * NON-atomic ownership probe, for side effects that cannot join a database transaction (e.g. an HTTP call to
 * another service). Narrows but cannot close the race; use runFenced for anything stored in this database.
 */
export async function assertGenerationLeaseHeld(): Promise<void> {
  const ctx = leaseStorage.getStore();
  if (!ctx || !checker) return;
  if (!(await checker(ctx))) throw new StaleLeaseError(ctx.operationId);
}
