import axios from "axios";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/auth.repository";

/**
 * Money-flow redesign plan 2.6 — "khoá tài khoản PT không gỡ nghiệp vụ".
 *
 * user-service already has `ptDeactivationService.deactivatePT` (unwinds live contracts with
 * prorated refunds, hides the PT from discovery) and a ready `POST /internal/pt/:id/deactivate`
 * endpoint — but locking a PT's account here only ever flipped `isActive`. Nothing called it.
 *
 * This relay is best-effort: the account lock/unlock itself (the primary action) must always
 * succeed regardless of whether user-service is reachable. A failure is recorded in
 * `PtDeactivationCall` — NOT silently swallowed — for `pt-deactivation-relay-sweep.service.ts`
 * to retry.
 *
 * PT-lock slice 1 — what makes a retry safe:
 *  · every command row carries `seq`, a database-allocated number that orders ALL lock/unlock
 *    commands. It is sent to user-service, which keeps the last seq it applied per PT and ignores
 *    anything lower; and before (re)sending, this side checks that no HIGHER command exists for
 *    the same PT. So lock → unlock → a late or retried lock never locks again: the old row is
 *    retired as SUPERSEDED instead of being re-sent every sweep tick.
 *  · a retry re-sends the SAME row (same seq) — it does not create a new one — so the row's
 *    status is the single record of whether that command is done.
 *  · user-service answers 200 only when every contract of the unwind is done (or the command was
 *    superseded); a partial failure comes back as an error and the row stays FAILED for the sweep.
 */

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:3004";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";

export type PtDeactivationAction = "DEACTIVATE" | "REACTIVATE";

/** The part of a PtDeactivationCall row a delivery attempt needs. */
export interface PtDeactivationCallRef {
  id: string;
  ptUserId: string;
  action: PtDeactivationAction;
  adminId: string;
  reason?: string | null;
  seq: bigint;
}

export interface RelayDeps {
  createRow: (input: { ptUserId: string; action: PtDeactivationAction; adminId: string; reason?: string }) => Promise<{ id: string; seq: bigint }>;
  /** True when a command with a higher seq exists for this PT (whatever its status). */
  hasNewerCall: (ptUserId: string, seq: bigint) => Promise<boolean>;
  /** Resolves when user-service reports the command done; `{ stale: true }` when it refused it as superseded. Throws otherwise. */
  callUserService: (
    ptUserId: string,
    action: PtDeactivationAction,
    adminId: string,
    reason: string | undefined,
    seq: bigint,
  ) => Promise<{ stale?: boolean } | void>;
  markSettled: (id: string) => Promise<unknown>;
  markFailed: (id: string, error: string) => Promise<unknown>;
  markSuperseded: (id: string) => Promise<unknown>;
}

export const defaultRelayDeps: RelayDeps = {
  createRow: (input) => prisma.ptDeactivationCall.create({ data: { ...input, status: "PENDING" } }),
  hasNewerCall: async (ptUserId, seq) =>
    (await prisma.ptDeactivationCall.findFirst({ where: { ptUserId, seq: { gt: seq } }, select: { id: true } })) !== null,
  callUserService: async (ptUserId, action, adminId, reason, seq) => {
    const path = action === "DEACTIVATE" ? "deactivate" : "reactivate";
    try {
      const res = await axios.post(
        `${USER_SERVICE_URL}/internal/pt/${ptUserId}/${path}`,
        { adminId, reason, seq: seq.toString() },
        { headers: { "x-service-secret": INTERNAL_SERVICE_SECRET }, timeout: 15_000 },
      );
      return { stale: res.data?.stale === true };
    } catch (e: any) {
      // user-service answers an incomplete unwind with an error status and the per-contract
      // outcomes; keep what failed in lastError instead of just "status code 500".
      const body = e?.response?.data;
      if (body?.error) {
        const failed = Array.isArray(body.outcomes)
          ? body.outcomes
              .filter((o: any) => o.status === "FAILED")
              .map((o: any) => `${o.contractId}: ${o.reason}`)
              .join("; ")
          : "";
        throw new Error(`user-service ${e.response.status}: ${body.error}${failed ? ` [${failed}]` : ""}`);
      }
      throw e;
    }
  },
  markSettled: (id) => prisma.ptDeactivationCall.update({ where: { id }, data: { status: "SETTLED" } }),
  markFailed: (id, error) =>
    prisma.ptDeactivationCall.update({
      where: { id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: error.slice(0, 2000) },
    }),
  markSuperseded: (id) => prisma.ptDeactivationCall.update({ where: { id }, data: { status: "SUPERSEDED" } }),
};

export type PtDeactivationAttemptResult = "SETTLED" | "SUPERSEDED" | "FAILED";

/**
 * One delivery attempt of one command row — used for the first send and for every sweep retry.
 * Never throws for a delivery problem: it is recorded on the row.
 */
export async function attemptPtDeactivationCall(
  call: PtDeactivationCallRef,
  deps: RelayDeps = defaultRelayDeps,
): Promise<PtDeactivationAttemptResult> {
  try {
    // A later lock or unlock exists: this command is history and must never be (re)executed.
    if (await deps.hasNewerCall(call.ptUserId, call.seq)) {
      await deps.markSuperseded(call.id);
      return "SUPERSEDED";
    }
    const answer = await deps.callUserService(call.ptUserId, call.action, call.adminId, call.reason ?? undefined, call.seq);
    if (answer && answer.stale) {
      // user-service already applied something newer than this command and refused it.
      await deps.markSuperseded(call.id);
      return "SUPERSEDED";
    }
    await deps.markSettled(call.id);
    return "SETTLED";
  } catch (e) {
    await deps.markFailed(call.id, (e as Error).message);
    logger.error({
      error: "PT deactivation relay to user-service failed — recorded for retry",
      ptUserId: call.ptUserId,
      action: call.action,
      seq: call.seq.toString(),
      message: (e as Error).message,
    });
    return "FAILED";
  }
}

/**
 * Only ever called for a user whose role is PT (the caller checks) — relaying for a CUSTOMER
 * or ADMIN account would just 404 against user-service's PT-only internal endpoint.
 */
export async function relayPtActiveStateChange(
  ptUserId: string,
  action: PtDeactivationAction,
  adminId: string,
  reason?: string,
  deps: RelayDeps = defaultRelayDeps,
): Promise<void> {
  const row = await deps.createRow({ ptUserId, action, adminId, reason });
  await attemptPtDeactivationCall({ id: row.id, seq: row.seq, ptUserId, action, adminId, reason }, deps);
}
