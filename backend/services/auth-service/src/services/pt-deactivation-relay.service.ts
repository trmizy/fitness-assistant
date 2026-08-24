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
 * to retry. deactivatePT is itself safe to call more than once: it re-queries which contracts
 * still need unwinding on every call, so a contract already cancelled by an earlier attempt is
 * simply not touched again.
 */

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:3004";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";

export type PtDeactivationAction = "DEACTIVATE" | "REACTIVATE";

export interface RelayDeps {
  createRow: (input: { ptUserId: string; action: PtDeactivationAction; adminId: string; reason?: string }) => Promise<{ id: string }>;
  callUserService: (ptUserId: string, action: PtDeactivationAction, adminId: string, reason?: string) => Promise<void>;
  markSettled: (id: string) => Promise<unknown>;
  markFailed: (id: string, error: string) => Promise<unknown>;
}

const defaultRelayDeps: RelayDeps = {
  createRow: (input) => prisma.ptDeactivationCall.create({ data: { ...input, status: "PENDING" } }),
  callUserService: async (ptUserId, action, adminId, reason) => {
    const path = action === "DEACTIVATE" ? "deactivate" : "reactivate";
    await axios.post(
      `${USER_SERVICE_URL}/internal/pt/${ptUserId}/${path}`,
      { adminId, reason },
      { headers: { "x-service-secret": INTERNAL_SERVICE_SECRET }, timeout: 15_000 },
    );
  },
  markSettled: (id) => prisma.ptDeactivationCall.update({ where: { id }, data: { status: "SETTLED" } }),
  markFailed: (id, error) =>
    prisma.ptDeactivationCall.update({
      where: { id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: error.slice(0, 2000) },
    }),
};

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
  try {
    await deps.callUserService(ptUserId, action, adminId, reason);
    await deps.markSettled(row.id);
  } catch (e) {
    await deps.markFailed(row.id, (e as Error).message);
    logger.error({
      error: "PT deactivation relay to user-service failed — recorded for retry",
      ptUserId,
      action,
      message: (e as Error).message,
    });
  }
}
