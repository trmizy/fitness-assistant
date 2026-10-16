import os from "node:os";
import { ContractStatus, Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";

/**
 * A per-contract mutex (transaction-scoped advisory lock, same key function bookSession already takes AFTER the
 * PT lock: PT first, contract second - never the other way round).
 *
 * Two things must be ONE ordered fact on a contract:
 *   (a) "the contract ended": the money call and the guarded status write of settleContractTermination, and
 *   (b) "a session's money step happened": the claim that flips a session to delivered / counts it on the contract,
 *       a late cancel's charge, a PT no-show's compensation, a room-close sweep's compensation, a settlement retry.
 * Whoever takes the lock first wins; the other sees the result. That is what lets the ending's snapshot of
 * {used / compensated sessions, already released, awaiting / disputed sessions} be taken either wholly before or
 * wholly after any such step - and what lets a session that is decided AFTER the contract ended be recognised as
 * one whose value payment-service HELD at the ending (F2).
 *
 * The lock is only a mutex: nothing is written through its own connection (`fn` uses the shared client or the
 * `tx` it is handed), so a failure inside `fn` rolls back nothing but the lock.
 *
 * ── Resource rules (F4 / D56 lock-across-network assessment) ──────────────────────────────────────────────────────
 *  1. LOCK ORDER. PT lock (hashtext(ptUserId)) first, contract lock second, never the reverse. `fn` must not take a
 *     PT lock and must not call withContractLock again (a nested call would need a SECOND pool connection while this
 *     one waits on itself: a self-deadlock until the transaction times out). Steps that end or complete a contract
 *     (checkAndCompleteContract, which locks) therefore run AFTER the lock is released.
 *  2. WAITERS HOLD NO DATABASE CONNECTION. The lock transaction is a pool connection. A request that waits for a lock
 *     another request holds used to hold its own connection while it waited, so N concurrent requests on one contract
 *     could take N connections - and the holder, which needs one more connection for its own work, would starve.
 *     Callers of the same contract in this process now queue in memory first (FIFO); only the head opens a
 *     transaction. A process-wide cap on lock holders (default: about half the pool) keeps connections free for the
 *     holders' own work, so concurrent endings of DIFFERENT contracts cannot exhaust the pool either.
 *  3. A lock held by ANOTHER process (several replicas) is waited for at most LOCK_WAIT_MS (`lock_timeout`, 55P03);
 *     the caller gets 503 CONTRACT_LOCK_BUSY instead of a connection parked for minutes. The wait is bounded so it
 *     cannot eat the transaction's `timeout`: if the transaction timed out while `fn` was still running, the advisory
 *     lock would be released under it and the mutual exclusion would silently end.
 *  4. HOW LONG `fn` may take. The longest thing inside is a payment-service call; payment.client.ts bounds every one
 *     (10-20 s, no retries). The ending's attempt is bounded by SETTLEMENT_DRAIN_LIMIT x 15 s + 20 s + a few
 *     queries, far under TX_TIMEOUT_MS (contract-lock-bounds.test.ts pins the arithmetic).
 */
export const LOCK_WAIT_MS = 30_000;
export const TX_MAX_WAIT_MS = 15_000;
export const TX_TIMEOUT_MS = 120_000;

export const CONTRACT_ENDED = "CONTRACT_ENDED";
export const SESSION_ALREADY_PROCESSED = "SESSION_ALREADY_PROCESSED";
export const SESSION_STATE_NOT_ALLOWED = "SESSION_STATE_NOT_ALLOWED";
export const CONTRACT_LOCK_BUSY = "CONTRACT_LOCK_BUSY";
export const SESSION_SETTLEMENT_PENDING = "SESSION_SETTLEMENT_PENDING";
/**
 * D59 - the contract's ending was ACCEPTED (recorded durably) but payment-service has not confirmed the money yet. Every
 * action that creates or changes a money obligation on it (book, report done, confirm / auto-confirm, no-show and late
 * flows, release, compensation, date block, room-close, admin ruling) is REFUSED with this code - never queued. Reads
 * keep working. The ending itself carries on (the caller's retry, or the settlement sweep, completes it with the SAME
 * recorded reason - nothing is recomputed) and the refusal ends when it is confirmed.
 */
export const CONTRACT_ENDING = "CONTRACT_ENDING";
/** The ending's recorded intent and payment-service's answer disagree (another reason / held count): needs a human. */
export const CONTRACT_ENDING_CONFLICT = "CONTRACT_ENDING_CONFLICT";
export const PT_LOCK_BUSY = "PT_LOCK_BUSY";

/** A deliberate, coded business refusal (the controllers spread `code` into the JSON body, see errorCodeBody). */
export function codedError(message: string, status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

/** D59 - see {@link CONTRACT_ENDING}. */
export function contractEndingError() {
  return codedError(
    "Hợp đồng đang được kết thúc: yêu cầu kết thúc đã được ghi nhận nhưng khoản tiền chưa được xác nhận xong. Thao tác này tạm thời chưa thực hiện được - hệ thống sẽ tự hoàn tất, vui lòng thử lại sau ít phút.",
    409,
    CONTRACT_ENDING,
  );
}

/** D45 / L2 - the contract the session belongs to has ended: nothing money-triggering may be done on its sessions. */
export function contractEndedError() {
  return codedError(
    "Hợp đồng đã kết thúc - buổi tập này không còn thuộc một hợp đồng đang chạy nên không thực hiện được thao tác này.",
    409,
    CONTRACT_ENDED,
  );
}

/** D54 - the session was already decided by someone else (another request, a sweep): this request changed nothing. */
export function sessionAlreadyProcessedError(message = "Buổi tập đã được xử lý bởi một thao tác khác - yêu cầu này không thay đổi gì.") {
  return codedError(message, 409, SESSION_ALREADY_PROCESSED);
}

/**
 * A compare-and-set on a session was lost. Say WHY, as a business error: the contract ended meanwhile
 * (CONTRACT_ENDED) or another request already decided the session (SESSION_ALREADY_PROCESSED). Never a silent no-op.
 */
export async function throwSessionRaceLost(contractId: string): Promise<never> {
  const c = await contractRepository.findById(contractId);
  if (c && c.status !== ContractStatus.ACTIVE) throw contractEndedError();
  // The ending was accepted and has called the session off, but its money is not confirmed yet (D59).
  if (c && (await sessionSettlementRepository.hasUnconfirmedTermination(contractId))) throw contractEndingError();
  throw sessionAlreadyProcessedError();
}

/** True while the contract's ending is recorded but not confirmed by payment-service (a RUNNING contract only). */
export async function isContractEnding(contractId: string, db?: Prisma.TransactionClient): Promise<boolean> {
  return sessionSettlementRepository.hasUnconfirmedTermination(contractId, db);
}

/** D59 - refuse (409 CONTRACT_ENDING) when the contract's ending is recorded but not confirmed. Call it under the contract lock. */
export async function assertNotEnding(contractId: string, db?: Prisma.TransactionClient): Promise<void> {
  if (await isContractEnding(contractId, db)) throw contractEndingError();
}

// ── in-process queue + holder cap ───────────────────────────────────────────────────────────────────────────────

const tails = new Map<string, Promise<void>>();

/** FIFO per key. Resolves when every earlier caller of the same key has released; returns this caller's release. */
async function enterQueue(key: string): Promise<() => void> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  return () => {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  };
}

/** The pool Prisma opens: `connection_limit` of DATABASE_URL, else its default (physical CPUs x 2 + 1). */
export function poolSizeOf(url = process.env.DATABASE_URL ?? ""): number {
  const m = /[?&]connection_limit=(\d+)/.exec(url);
  const n = m ? Number(m[1]) : os.cpus().length * 2 + 1;
  return Math.max(1, n);
}

/** Lock holders allowed at once: each needs its lock connection PLUS at least one more for its own work. */
export function defaultMaxHolders(poolSize = poolSizeOf()): number {
  const fromEnv = Number(process.env.CONTRACT_LOCK_MAX_HOLDERS);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return Math.max(1, Math.floor((poolSize - 1) / 2));
}

class Semaphore {
  private free: number;
  private waiters: Array<() => void> = [];
  constructor(private readonly size: number) {
    this.free = size;
  }
  async acquire(): Promise<() => void> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.waiters.push(r));
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.free++;
    };
  }
  get capacity() {
    return this.size;
  }
}
const holders = new Semaphore(defaultMaxHolders());

function isLockTimeout(e: unknown): boolean {
  const msg = String((e as any)?.message ?? "");
  return /55P03|lock timeout/i.test(msg) || (e as any)?.meta?.code === "55P03";
}

/** Takes the contract's advisory lock on `tx` (bounded wait: 503 CONTRACT_LOCK_BUSY), then clears the wait bound. */
async function acquireContractLock(tx: Prisma.TransactionClient, contractId: string, waitMs?: number): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${waitMs ?? Math.floor(Number(process.env.CONTRACT_LOCK_WAIT_MS) || LOCK_WAIT_MS)}`);
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contractId}))`;
  } catch (e) {
    if (isLockTimeout(e)) {
      throw codedError("Hợp đồng đang được xử lý bởi một thao tác khác - vui lòng thử lại sau ít phút.", 503, CONTRACT_LOCK_BUSY);
    }
    throw e;
  }
  // The wait is over; whatever `fn` does behaves exactly as it did before this setting existed.
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = 0");
}

export async function withContractLock<T>(
  contractId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  const leaveQueue = await enterQueue(contractId);
  let leaveHolders: (() => void) | undefined;
  try {
    leaveHolders = await holders.acquire();
    return await prisma.$transaction(
      async (tx) => {
        await acquireContractLock(tx, contractId);
        return fn(tx);
      },
      { maxWait: opts.maxWait ?? TX_MAX_WAIT_MS, timeout: opts.timeout ?? TX_TIMEOUT_MS },
    );
  } finally {
    leaveHolders?.();
    leaveQueue();
  }
}

// ── the PT lock (Phase 0 / D58 unit 4) ──────────────────────────────────────────────────────────────────────────────

/**
 * The PT's schedule / restriction lock (`hashtext(ptUserId)`, transaction-scoped) had no `lock_timeout`, no in-process
 * queue and the default 5 s Prisma transaction timeout (audit G6): behind a held contract lock every booking /
 * confirmation / completion of that PT, and of its OTHER contracts, waited ~8 s and died with 500 "Transaction already
 * closed", holding a pool connection the whole time. Now it behaves like the contract lock:
 *   - waiters of one PT in this process queue in memory first and hold NO connection while they wait;
 *   - the process-wide holder cap applies (a lock transaction needs a second connection for its own work);
 *   - a lock held by ANOTHER process is waited for at most PT_LOCK_WAIT_MS (`lock_timeout`), then 503 PT_LOCK_BUSY;
 *   - the transaction timeout is explicit and far above the wait, so the wait can never outlive its transaction.
 * LOCK ORDER (unchanged, now in one place): PT lock first, contract lock second. `fn` must never take a PT lock.
 * Since an ending no longer holds the contract lock across payment-service calls (it holds it for milliseconds - see
 * contract-payout.service.ts), the only long waits left are lock holders doing local DB work.
 */
export const PT_LOCK_WAIT_MS = 15_000;
const ptLockWaitMs = () => Math.floor(Number(process.env.PT_LOCK_WAIT_MS) || PT_LOCK_WAIT_MS);

/**
 * How long a transaction that ALREADY HOLDS the PT lock waits for the contract lock. While it waits it blocks every other
 * schedule operation of that PT (including those of the PT's unrelated contracts - audit G6 head-of-line coupling), so the wait
 * is short: since an ending no longer holds the contract lock across payment-service calls, every legitimate holder keeps it for
 * milliseconds, and a longer wait means something pathological (another process stuck on it) - answer 503 CONTRACT_LOCK_BUSY and let go.
 */
export const PT_HELD_CONTRACT_WAIT_MS = 3_000;
const ptHeldContractWaitMs = () => Math.floor(Number(process.env.PT_HELD_CONTRACT_WAIT_MS) || PT_HELD_CONTRACT_WAIT_MS);

/** Prisma interactive-transaction options for ANY transaction that takes the PT lock (see above). */
export function ptTxOptions(): { maxWait: number; timeout: number } {
  return { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS };
}

/** Takes the PT's advisory lock on `tx` with a bounded wait (503 PT_LOCK_BUSY). */
export async function acquirePtLock(tx: Prisma.TransactionClient, ptUserId: string): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${ptLockWaitMs()}`);
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ptUserId}))`;
  } catch (e) {
    if (isLockTimeout(e)) {
      throw codedError("Huấn luyện viên đang được xử lý bởi một thao tác khác - vui lòng thử lại sau ít phút.", 503, PT_LOCK_BUSY);
    }
    throw e;
  }
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = 0");
}

/**
 * P0 cluster B2 - serialises concurrent writes that could otherwise both pass a check before either commits (two clients
 * booking one PT's slot, two bookings squeezing under one contract's quota): the PT lock, then (optionally) the contract
 * lock, in ONE transaction. Same queue / holder cap / bounded waits as {@link withContractLock}.
 */
export async function withPtScheduleLock<T>(
  ptUserId: string,
  contractId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const leaveQueue = await enterQueue(`pt:${ptUserId}`);
  let leaveHolders: (() => void) | undefined;
  try {
    leaveHolders = await holders.acquire();
    return await prisma.$transaction(async (tx) => {
      await acquirePtLock(tx, ptUserId);
      if (contractId) await acquireContractLock(tx, contractId, ptHeldContractWaitMs());
      return fn(tx);
    }, ptTxOptions());
  } finally {
    leaveHolders?.();
    leaveQueue();
  }
}

/**
 * The lock, plus the one question every money-triggering session step asks FIRST - "is the contract still running?" -
 * read under the lock, so it is ordered against an ending in flight (which holds the lock until its status is
 * written). A contract that has ended answers 409 CONTRACT_ENDED and `fn` never runs. Put the session's state
 * change, the quota / compensation counters and the payment-service call ALL inside `fn`: that is what makes the
 * ending's snapshot see the final state, and what makes the session's money step happen at most once.
 */
export async function withRunningContract<T>(contractId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withContractLock(contractId, async (tx) => {
    const c = await contractRepository.findById(contractId, tx);
    if (!c) throw codedError("Contract not found", 404, "CONTRACT_NOT_FOUND");
    if (c.status !== ContractStatus.ACTIVE) throw contractEndedError();
    await assertNotEnding(contractId, tx);
    return fn(tx);
  });
}
