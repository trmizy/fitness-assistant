import { ContractStatus } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { GymServiceUnavailableError } from "../clients/gym.client";
import { assertPtAcceptsNewBusiness, PtRestrictionError } from "./pt-restriction.service";
import {
  assertGymStillAcceptsContract,
  GYM_NOT_ACCEPTING_CONTRACTS,
  GYM_TERMS_CHANGED,
} from "./contract.service";

/**
 * Phase 3 / P3.5 - `GET /contracts/:id/checkout-context` : everything the payment step needs to
 * show for a contract that is waiting for payment (PENDING_PAYMENT), read from the contract's own
 * snapshot columns. READ-ONLY: no payment-service call, no write, no state change, and `pay`
 * is untouched.
 *
 * `amount`, `rates` and `parties` are built from the same contract fields, with the same
 * conversions, that `contractService.pay` puts into `paymentClient.checkout` (a test compares
 * the two). `recheck` runs the same refusals `pay` makes before any money moves, but only
 * REPORTS them:
 *   - `ptAcceptsNewBusiness` : the account-restriction guard (`assertPtAcceptsNewBusiness`), as a code.
 *   - `paymentDeadlinePassed`: `paymentDueAt` already behind us.
 *   - `gym`                  : `assertGymStillAcceptsContract` - the very function accept/pay call -
 *                              as OK / the refusal code / UNKNOWN (gym-service unreachable) /
 *                              NOT_APPLICABLE (no gym on the contract).
 * It never decides anything open in docs/PHASE_3_PLAN.md section 8: the membership reference is just
 * the snapshot column, `null` until slice P3.3 writes it.
 *
 * Audience: the contract's client and its PT, or an ADMIN - the same people who may already read the
 * contract through GET /contracts/:id. Anyone else gets 403.
 */

export const CHECKOUT_NOT_AVAILABLE = "CHECKOUT_NOT_AVAILABLE";

export type CheckoutGymRecheck = "OK" | typeof GYM_NOT_ACCEPTING_CONTRACTS | typeof GYM_TERMS_CHANGED | "UNKNOWN" | "NOT_APPLICABLE";

export interface CheckoutContext {
  contractId: string;
  status: ContractStatus;
  package: {
    name: string;
    totalSessions: number;
    sessionMode: string | null;
    sessionDurationMinutes: number | null;
    validityDays: number | null;
  };
  /** The price `pay` will charge (contract.price as a number, like pay's `amount`). */
  amount: number;
  /** The revenue split frozen on the contract (what `pay` sends as `rates`). */
  rates: { platformRate: string; ptRate: string; gymRate: string };
  /** Who `pay` names in `parties`. */
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  source: string;
  /** Snapshot of the PT-gym agreement the rates came from. All null for an independent contract and for contracts created before P3.2. */
  gym: {
    gymId: string | null;
    brandId: string | null;
    agreementId: string | null;
    agreementScope: string | null;
  };
  /** Reference to the membership relied on (P3.3). Null until that slice writes it. */
  membership: { membershipId: string | null };
  payment: {
    paymentDueAt: string | null;
    /** A checkout was already created for this contract (a payment transaction is attached). */
    hasPaymentTransaction: boolean;
  };
  recheck: {
    ptAcceptsNewBusiness: true | { blockedCode: string };
    paymentDeadlinePassed: boolean;
    gym: CheckoutGymRecheck;
  };
}

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status }, code ? { code } : {});
}

export const contractCheckoutContextService = {
  async getCheckoutContext(
    contractId: string,
    actor: { userId: string; role?: string },
    now: Date = new Date(),
  ): Promise<CheckoutContext> {
    const c = await contractRepository.findById(contractId);
    if (!c) throw err("Contract not found", 404);
    const isParty = c.clientUserId === actor.userId || c.ptUserId === actor.userId;
    if (!isParty && actor.role !== "ADMIN") throw err("Not authorized", 403);
    if (c.status !== ContractStatus.PENDING_PAYMENT) {
      throw err(
        `Hợp đồng không ở trạng thái chờ thanh toán (${c.status})`,
        409,
        CHECKOUT_NOT_AVAILABLE,
      );
    }

    let ptAcceptsNewBusiness: CheckoutContext["recheck"]["ptAcceptsNewBusiness"] = true;
    try {
      await assertPtAcceptsNewBusiness(c.ptUserId, "PAY_CONTRACT");
    } catch (e) {
      if (!(e instanceof PtRestrictionError)) throw e;
      ptAcceptsNewBusiness = { blockedCode: e.code };
    }

    let gym: CheckoutGymRecheck = "NOT_APPLICABLE";
    if (c.gymId) {
      try {
        await assertGymStillAcceptsContract(c);
        gym = "OK";
      } catch (e: any) {
        if (e?.code === GYM_NOT_ACCEPTING_CONTRACTS || e?.code === GYM_TERMS_CHANGED) gym = e.code;
        else if (e?.status === 503 || e instanceof GymServiceUnavailableError) gym = "UNKNOWN";
        else throw e;
      }
    }

    return {
      contractId: c.id,
      status: c.status,
      package: {
        name: c.packageName,
        totalSessions: c.totalSessions,
        sessionMode: c.sessionMode ?? null,
        sessionDurationMinutes: (c as any).sessionDurationMinutes ?? null,
        validityDays: c.validityDays ?? null,
      },
      amount: Number(c.price),
      rates: {
        platformRate: c.platformRate.toString(),
        ptRate: c.ptRate.toString(),
        gymRate: c.gymRate.toString(),
      },
      parties: { ptUserId: c.ptUserId, gymId: c.gymId, clientUserId: c.clientUserId },
      source: c.source,
      gym: {
        gymId: c.gymId ?? null,
        brandId: c.gymBrandId ?? null,
        agreementId: c.gymAgreementId ?? null,
        agreementScope: c.gymAgreementScope ?? null,
      },
      membership: { membershipId: c.gymMembershipId ?? null },
      payment: {
        paymentDueAt: c.paymentDueAt ? c.paymentDueAt.toISOString() : null,
        hasPaymentTransaction: !!c.paymentTransactionId,
      },
      recheck: {
        ptAcceptsNewBusiness,
        paymentDeadlinePassed: !!c.paymentDueAt && c.paymentDueAt.getTime() <= now.getTime(),
        gym,
      },
    };
  },
};
